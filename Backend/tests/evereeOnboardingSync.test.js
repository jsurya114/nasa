import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertMayWork, assertMayBePaid } from '../services/payments/everee/onboardingGate.js';
import { startOnboarding, refreshStatus, createSession, recoverOnboarding } from '../services/payments/everee/driverOnboarding.js';
import { syncOnboarding } from '../services/payments/everee/onboardingSync.js';
import { EvereeError, createEvereeClient } from '../services/payments/everee/evereeClient.js';

const ENV = { EVEREE_API_TOKEN: 'tsk_test_fixture', EVEREE_TENANT_ID: '4321', EVEREE_DRIVER_ONBOARDING_ENABLED: 'true', EVEREE_ONBOARDING_SYNC_ENABLED: 'true' };
const enabled = process.env.PAYROLL_TEST_DB === '1' && process.env.PAYROLL_TEST_DB_COMMIT === '1' && /test|tmp|scratch/i.test(process.env.DB_NAME ?? '');
test('provider quota metadata is available without treating missing headers as zero', async () => {
  const config = {baseUrl: 'https://example.com', token: 'fixture', tenantId: '4321'};
  const client = createEvereeClient(config, {fetchImpl: async () => ({ok: true, status: 200, headers: new Headers({'RateLimit-Remaining': '0', 'RateLimit-Reset': '12'}), json: async () => ({id: 'worker'})})});
  assert.deepEqual((await client.getWorker('worker')).rateLimit, {remaining: 0, resetSeconds: 12});
  const absent = createEvereeClient(config, {fetchImpl: async () => ({ok: true, status: 200, headers: new Headers(), json: async () => ({})})});
  assert.deepEqual((await absent.getWorker('worker')).rateLimit, {remaining: null, resetSeconds: null});
});

test('onboarding operations on a disposable database', {skip: !enabled && 'requires commit-enabled disposable test DB'}, async t => {
  const {default: pool} = await import('../config/db.js');
  const tag = randomUUID().slice(0, 6).replace(/[0-9]/g,n=>'ghijklmnop'[n]);
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
  const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'WEEKLY') RETURNING id", [`Sync City ${tag}`, `SY${tag}`])).id;
  let seq = 0;
  const driver = async (type = 'LOCAL', cityId = city) => {
    seq++;
    return (await one(`INSERT INTO drivers (name,email,phone_number,password,driver_code,city_id,driver_type,enabled,agreement_signed,agreement_joining_date)
      VALUES ($1,$2,'5550100099','x',$3,$4,$5,true,true,'2026-09-01') RETURNING id`, [`Sync Driver ${tag} ${String.fromCharCode(65+seq)}`, `sync${tag}${seq}@example.com`, 9500000+Math.floor(Math.random()*400000),cityId,type])).id;
  };
  const intent = id => pool.query("INSERT INTO everee_onboarding (driver_id,environment,tenant_id,external_worker_id,state,request_id,post_uncertain_at) VALUES ($1,'sandbox','4321',$2,'creating',$3,now())", [id, `nasa-driver-${id}`, randomUUID()]);
  const fake = (complete=false) => {
    const calls = [];
    return { calls,
      getWorker: async id => {calls.push(['get',id]); return {data: {id, onboardingComplete: complete}};},
      searchWorkers: async external => {calls.push(['search',external]);return {data: {items: [{externalWorkerId: external, workerId: `CAN-${external.slice(12)}`}]}};},
      createEmbeddedContractor: () => assert.fail('a background check must never create a worker'),
    };
  };
  try {
    await t.test('lost-create recovery links exactly one canonical worker without profile re-entry or a second POST', async () => {
      const id = await driver(); await intent(id);
      const client = fake();
      assert.equal((await recoverOnboarding(pool,id,{env:ENV,client})).outcome,'linked');
      const w = await one('SELECT everee_worker_id, tenant_id, linked_by_driver_id FROM everee_workers WHERE driver_id=$1',[id]);
      assert.deepEqual(w,{everee_worker_id:`CAN-${id}`,tenant_id:'4321',linked_by_driver_id:id});
      assert.equal(client.calls.length,2);
      assert.equal((await recoverOnboarding(pool,id,{env:ENV,client:fake(true)})).outcome,'complete');
    });
    await t.test('missing workers and live leases never cause another create or premature link', async () => {
      const id = await driver(); await intent(id);
      let reads=0;
      const client = {getWorker: async () => {reads++;throw new EvereeError('missing',{status:404});}};
      assert.equal((await recoverOnboarding(pool,id,{env:ENV,client})).outcome,'not_found');
      assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id=$1',[id])).n,0);
      await pool.query("UPDATE everee_onboarding SET lease_until=now()+interval '1 minute' WHERE driver_id=$1",[id]);
      assert.equal((await recoverOnboarding(pool,id,{env:ENV,client})).outcome,'busy');
      assert.equal(reads,1);
      await pool.query("UPDATE everee_onboarding SET state='needs_review',lease_until=NULL WHERE driver_id=$1",[id]);
    });
    await t.test('successful quota exhaustion stops before a second read, persists a retry, and survives another run', async () => {
      const id=await driver();await intent(id);
      let calls=0;
      const client={getWorker: async external=>{calls++;return {data:{id:external},rateLimit:{remaining:0,resetSeconds:90}};},searchWorkers:()=>assert.fail('quota exhausted')};
      const result=await syncOnboarding(pool,{env:ENV,client,limit:1});
      assert.equal(result.reason,'provider_backoff');assert.equal(result.checked,1);assert.equal(calls,1);
      assert.equal((await syncOnboarding(pool,{env:ENV,client})).reason,'backoff');assert.equal(calls,1);
      await pool.query("UPDATE everee_onboarding_job SET retry_at=now() WHERE environment='sandbox' AND tenant_id='4321'");
    });
    await t.test('the whole setup unlocks work and payment only after an independent provider read, never from a UI event', async () => {
      const id=await driver();let worker=null;let creates=0;
      const client={
        getWorker: async external=>{if(!worker)throw new EvereeError('missing',{status:404});return {data:{...worker,id:external}};},
        searchWorkers:async term=>({data:{items: worker && term===`nasa-driver-${id}` ? [{externalWorkerId:term,workerId:`CAN-${id}`}] : []}}),
        createEmbeddedContractor:async body=>{creates++;worker={id:body.externalWorkerId,onboardingComplete:false};assert.equal(body.w9FormResponse,undefined);assert.equal(body.bankAccount,undefined);return {data:worker};},
        createEmbeddedSession:async body=>{assert.equal(body.workerId,`CAN-${id}`);assert.equal(body.experienceVersion,'V2_0');return {data:{url:'https://app.everee.com/single-use-test',expiresInMs:60000}};}
      };
      const env={...ENV,EVEREE_ONBOARDING_ENFORCED:'true'};
      await assert.rejects(assertMayWork(pool,id,{env}), e=>e.code==='onboarding_required');
      assert.equal((await startOnboarding(pool,id,{homeAddress:{line1:'1 Test Street',city:'Austin',state:'TX',postalCode:'78701'}},{env,client})).state,'in-progress');
      await createSession(pool,id,{experience:'ONBOARDING'},{env,client});
      await assert.rejects(assertMayBePaid(pool,[id],{env}),e=>e.code==='onboarding_required');
      assert.equal((await refreshStatus(pool,id,{env,client})).state,'in-progress');
      worker.onboardingComplete=true;
      assert.equal((await refreshStatus(pool,id,{env,client})).state,'complete');
      await assertMayWork(pool,id,{env});await assertMayBePaid(pool,[id],{env});
      assert.equal(creates,1);
    });
    await t.test('a worker Everee does not know is asked about less and less often, up to a limit',async()=>{
      const id=await driver();await intent(id);
      let reads=0;
      const client={getWorker:async()=>{reads++;throw new EvereeError('missing',{status:404});}};
      const seen=[];
      for(let i=0;i<3;i++){
        await pool.query("UPDATE everee_onboarding_sync SET next_check_at=now() WHERE driver_id=$1",[id]);
        await syncOnboarding(pool,{env:ENV,client,limit:25});
        const row=await one("SELECT failures, extract(epoch FROM next_check_at - now())::int AS wait FROM everee_onboarding_sync WHERE driver_id=$1",[id]);
        seen.push([row.failures,row.wait]);
      }
      assert.deepEqual(seen.map(([f])=>f),[1,2,3]);
      assert.ok(seen[0][1]>=590&&seen[0][1]<=600&&seen[1][1]>=1190&&seen[2][1]>=2390,'600s, 1200s, 2400s: it doubles');
      await pool.query("UPDATE everee_onboarding_sync SET failures=10,next_check_at=now() WHERE driver_id=$1",[id]);
      await syncOnboarding(pool,{env:ENV,client,limit:25});
      assert.ok((await one("SELECT extract(epoch FROM next_check_at - now())::int AS wait FROM everee_onboarding_sync WHERE driver_id=$1",[id])).wait<=21600,'never longer than six hours');
      await pool.query("UPDATE everee_onboarding SET state='needs_review' WHERE driver_id=$1",[id]);
      assert.ok(reads>=4);
    });
    await t.test('two server instances do not run the same job concurrently, and disabled mode queries nothing', async () => {
      const lock=await pool.connect();
      try {await lock.query("SELECT pg_advisory_lock(242243,hashtext('sandbox:4321'))");assert.equal((await syncOnboarding(pool,{env:ENV})).reason,'already_running');}
      finally {await lock.query("SELECT pg_advisory_unlock(242243,hashtext('sandbox:4321'))");lock.release();}
      assert.equal((await syncOnboarding({connect:()=>assert.fail('off')},{env:{...ENV,EVEREE_ONBOARDING_SYNC_ENABLED:'false'}})).reason,'switched_off');
    });
  } finally {await pool.end();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { onboardingReadiness, readinessParams } from '../services/payments/everee/onboardingReadiness.js';
const ENV = { EVEREE_API_TOKEN: 'tsk_test_fixture', EVEREE_TENANT_ID: '4321' };

test('readiness validates filters and refuses a non-owner before reading any data', async () => {
  for (const input of [{cityId: '1 OR true'}, {cityId: -1}, {cityId: 1, page: 0}, {cityId: 1, state: 'invalid'}, {cityId: 1, state: ['complete']}]) assert.throws(() => readinessParams(input));
  await assert.rejects(onboardingReadiness({query: () => assert.fail('must not query')}, {role: 'admin'}, {cityId: 1}), e => e.status === 403);
});

test('read-only readiness previews the gate using current city, tenant and verified completion', {skip: process.env.PAYROLL_TEST_DB !== '1' && 'requires disposable test DB'}, async t => {
  const {default: pool}=await import('../config/db.js');
  const db=await pool.connect();
  const one=async(sql,params)=>(await db.query(sql,params)).rows[0];
  const tag=randomUUID().slice(0,6).replace(/[0-9]/g,n=>'ghijklmnop'[n]);
  try {
    await db.query('BEGIN');
    const admin=await one("INSERT INTO admin(name,email,password,role) VALUES($1,$2,'x','superadmin') RETURNING id,role",[`Readiness Owner ${tag}`,`readiness${tag}@example.com`]);
    const city=(await one("INSERT INTO city(job,city_code,city_type) VALUES($1,$2,'WEEKLY') RETURNING id",[`Readiness ${tag}`,`RD${tag}`])).id;
    const other=(await one("INSERT INTO city(job,city_code,city_type) VALUES($1,$2,'WEEKLY') RETURNING id",[`Other Readiness ${tag}`,`RO${tag}`])).id;
    let seq=0;
    const driver=async(type='LOCAL',cityId=city)=>{
      seq++;
      return (await one("INSERT INTO drivers(name,email,password,driver_code,city_id,driver_type,enabled,agreement_signed) VALUES($1,$2,'x',$3,$4,$5,true,true) RETURNING id", [`Readiness Driver ${tag} ${String.fromCharCode(65+Math.floor(seq/26))+String.fromCharCode(65+seq%26)}`,`rd${tag}${seq}@example.com`,98000000+city*100+seq,cityId,type])).id;
    };
    const link=(id,tenant,complete,tin=null)=>db.query("INSERT INTO everee_workers(driver_id,environment,tenant_id,everee_worker_id,link_source,linked_by,onboarding_complete,tin_status) VALUES($1,'sandbox',$2,$3,'matched_email',$4,$5,$6)",[id,tenant,`RD-${id}`,admin.id,complete,tin]);
    const verified=await driver();await link(verified,'4321',true,'VERIFICATION_FAILED');
    const wrongTenant=await driver();await link(wrongTenant,'9999',true);
    await driver('DESI');await driver(null);await driver('LOCAL',other);
    await t.test('complete onboarding and payment readiness are separate; other cities and tenants never grant readiness',async()=>{
      const r=await onboardingReadiness(db,admin,{cityId:city},{env:ENV});
      assert.equal(r.enforced,false);assert.equal(r.onboardingEnabled,false);
      assert.equal(r.summary.localDrivers,2);assert.equal(r.summary.complete,1);assert.equal(r.summary.wouldHold,1);assert.equal(r.summary.unclassified,1);
      assert.equal(r.drivers.find(d=>d.driverId===verified).paymentReady,false);
      assert.equal(r.drivers.find(d=>d.driverId===wrongTenant).reason,'link_not_verified_for_tenant');
      assert.ok(r.drivers.every(d=>!Object.hasOwn(d,'email')&&!Object.hasOwn(d,'phone_number')));
      const filtered=await onboardingReadiness(db,admin,{cityId:city,state:'needs-review'},{env:ENV});
      assert.equal(filtered.total,1);assert.equal(filtered.summary.localDrivers,2);
      assert.equal((await onboardingReadiness(db,admin,{cityId:other,state:'complete'},{env:ENV})).total,0);
    });
    await t.test('pagination is bounded and stable without losing total readiness counts',async()=>{
      for(let i=0;i<51;i++) await driver();
      const a=await onboardingReadiness(db,admin,{cityId:city},{env:ENV});
      const b=await onboardingReadiness(db,admin,{cityId:city,page:2},{env:ENV});
      assert.equal(a.total,55);assert.equal(a.drivers.length,50);assert.equal(b.drivers.length,5);
      assert.equal(new Set([...a.drivers,...b.drivers].map(d=>d.driverId)).size,55);
      assert.deepEqual(a.summary,b.summary);assert.equal(a.summary.wouldHold,52);
    });
    await t.test('unconfigured Everee never reports a Local driver verified complete',async()=>{
      const r=await onboardingReadiness(db,admin,{cityId:city},{env:{}});
      assert.equal(r.configured,false);assert.equal(r.summary.complete,0);assert.equal(r.summary.wouldHold,53);
    });
    await t.test('open work is a rough count of recent unclosed work only: old unclosed rows are not counted',async()=>{
      const route=(await one("INSERT INTO routes(name,job,company_route_price,driver_route_price,company_doublestop_price,driver_doublestop_price,route_code_in_string) VALUES($1,$2,2,1.6,0.5,0.25,$3) RETURNING id",[`RD ${tag}`,`Readiness ${tag}`,`RD-${tag}`])).id;
      const recent=await driver();const stale=await driver();
      let start=7100;
      for(const [id,daysAgo] of [[recent,3],[stale,200]]){
        const dd=(await one("INSERT INTO dashboard_data(driver_id,route_id,start_seq,end_seq,journey_date,packages) VALUES($1,$2,$3,$4,current_date - $5::int,10) RETURNING id",[id,route,start,start+9,daysAgo])).id;
        start+=10;
        await db.query('UPDATE payment_dashboard SET closed = false WHERE dashboard_data_id = $1',[dd]);
      }
      const r=await onboardingReadiness(db,admin,{cityId:city},{env:ENV});
      assert.equal(r.summary.driversWithOpenWork,1);assert.equal(r.summary.openWorkRoutes,1);
    });
  } finally {await db.query('ROLLBACK');db.release();await pool.end();}
});

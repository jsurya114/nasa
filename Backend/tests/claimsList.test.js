import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { ClaimsInputError, PAGE_SIZE, claimsScopeOf, deductionOf, listClaims, parseClaimsQuery } from '../services/admin/claimsList.js';
import { getClaims } from '../controllers/admin/claimsController.js';

// The Claims page's list. The first test needs no database; the second runs the real query in a rolled-back transaction (PAYROLL_TEST_DB=1 and the DB_*
// variables) with made-up cities, drivers, admins and claims.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');

test('only known words reach the query: defaults, and every unknown choice is refused with a message', () => {
  assert.deepEqual(parseClaimsQuery({}), { tab: 'unmatched', page: 1, cityId: null, search: '' });
  assert.deepEqual(parseClaimsQuery({ tab: 'matched', page: '3', cityId: '12', search: ' 123 ' }), { tab: 'matched', page: 3, cityId: 12, search: '123' });
  assert.equal(parseClaimsQuery({ cityId: 'All' }).cityId, null);
  assert.equal(parseClaimsQuery({ search: 'x'.repeat(500) }).search.length, 100, 'a long search is cut, not refused');
  for (const bad of [{ tab: 'all' }, { tab: 'matched; DROP TABLE drivers' }, { page: '0' }, { page: 'abc' }, { page: '1.5' }, { page: '100001' }, { cityId: 'x' }, { cityId: '-1' }, { cityId: '1 OR 1=1' }]) {
    assert.throws(() => parseClaimsQuery(bad), ClaimsInputError, JSON.stringify(bad));
  }
});

test('the claims list: matched and unmatched, only the admin\'s cities, only current versions, search, paging and what was deducted', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-04-issue-180-claim-courier-name.sql']) await db.query(migration(m));
    const tag = randomBytes(3).toString('hex').toUpperCase();
    const city = async (n) => one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'DAILY') RETURNING id, job", [`CL ${n} ${tag}`, `CL${n}${tag}`]);
    const [mine, other] = [await city('A'), await city('B')];
    const sup = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id", [`CL sup ${tag}`, `cl-sup-${tag}@example.test`]);
    const adm = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'admin') RETURNING id", [`CL adm ${tag}`, `cl-adm-${tag}@example.test`]);
    const nobody = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'admin') RETURNING id", [`CL none ${tag}`, `cl-none-${tag}@example.test`]);
    await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [adm.id, mine.id]);
    let code = 700000000 + Math.floor(Math.random() * 90000000);
    const driver = (label, cityId) => one(`INSERT INTO drivers (password, name, email, driver_code, city_id, enabled, driver_type, phone_number, agreement_signed)
      VALUES ('x', $1, $2, $3, $4, true, 'LOCAL', '903-405-8843', true) RETURNING id, name`, [`${label} Driver ${tag}`, `cl-${label}-${tag}@example.test`, (code += 1), cityId]);
    const ann = await driver('Ann', mine.id);
    const bea = await driver('Bea', other.id);
    let n = 0;
    const claim = async (cityId, waybill, status, { driver: d = null, type = 'Lost parcel', day = '2026-11-02', amount = '25.00', name = null, version = 1, superseded = false, key = null } = {}) => {
      const row = await one(
        `INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row, courier_name, superseded_at)
         VALUES ('gofo', $1, $2, $3, $4, lower($4), $5, $6::numeric, abs($6::numeric), $7, 'test.xlsx', 'Claims Detail', $8, $9, $10) RETURNING id`,
        [key ?? randomBytes(32).toString('hex'), version, `${waybill}${tag}`, type, `${day} 10:00:00`, `-${amount}`, cityId, (n += 1), name, superseded ? new Date() : null]);
      const matched = d && ['chargeable', 'exempt'].includes(status);
      await db.query(
        `INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version)
         VALUES ($1, $2, $3, $4, $5, $6, 'test')`,
        [row.id, status, matched ? d.id : null, matched ? cityId : null, status === 'chargeable' ? amount : status === 'exempt' ? '0.00' : null,
          status === 'unresolved' ? 'no delivery history for this waybill yet' : status === 'ambiguous' ? 'the waybill is linked to more than one driver' : 'matched by waybill']);
      return row.id;
    };
    const c1 = await claim(mine.id, 'W1', 'chargeable', { driver: ann, day: '2026-11-05' });
    await claim(mine.id, 'W2', 'exempt', { driver: ann, day: '2026-11-04', type: 'Tracking interruption' });
    await claim(mine.id, 'W3', 'unresolved', { day: '2026-11-03', name: 'Cy Courier' });
    await claim(mine.id, 'W4', 'ambiguous', { day: '2026-11-02' });
    await claim(mine.id, 'W5', 'review', { day: '2026-11-01' });
    await claim(other.id, 'X1', 'chargeable', { driver: bea });
    await claim(other.id, 'X2', 'unresolved');
    const sharedKey = randomBytes(32).toString('hex');
    await claim(mine.id, 'W6', 'unresolved', { key: sharedKey, version: 1, superseded: true, amount: '10.00' });
    await claim(mine.id, 'W6', 'unresolved', { key: sharedKey, version: 2, amount: '12.00' });
    const mineOnly = { adminId: adm.id };
    const q = (over, scope = mineOnly) => listClaims(db, scope, parseClaimsQuery({ ...over }));
    const waybills = (r) => r.claims.map((c) => c.waybill.replace(tag, ''));

    await t.test('an ordinary admin sees the claims of their own cities only, split into matched and unmatched, newest first, current version only', async () => {
      const unmatched = await q({});
      assert.deepEqual(waybills(unmatched), ['W3', 'W6', 'W4', 'W5'], 'unresolved, ambiguous and held claims; an amended claim shows once');
      assert.deepEqual([unmatched.total, unmatched.totalPages, unmatched.counts], [4, 1, { matched: 2, unmatched: 4 }]);
      const matched = await q({ tab: 'matched' });
      assert.deepEqual(waybills(matched), ['W1', 'W2']);
      assert.deepEqual([matched.total, matched.counts], [2, { matched: 2, unmatched: 4 }]);
      const w6 = unmatched.claims.find((c) => c.waybill === `W6${tag}`);
      assert.equal(w6.amount, '12.00', 'the latest version, not the superseded one');
      const w3 = unmatched.claims.find((c) => c.waybill === `W3${tag}`);
      assert.deepEqual([w3.status, w3.reason, w3.driverName, w3.courierName, w3.city, w3.claimType, w3.claimDate, w3.amount, w3.deduction.state],
        ['unresolved', 'no delivery history for this waybill yet', null, 'Cy Courier', mine.job, 'Lost parcel', '2026-11-03', '25.00', 'none']);
      const w1 = matched.claims.find((c) => c.waybill === `W1${tag}`);
      assert.deepEqual([w1.status, w1.driverName, w1.driverCode, w1.courierName], ['chargeable', ann.name, w1.driverCode, null]);
      assert.equal(matched.claims.find((c) => c.waybill === `W2${tag}`).status, 'exempt');
      assert.deepEqual([...new Set([...unmatched.claims, ...matched.claims].map((c) => c.city))], [mine.job], 'the other city never appears');
      assert.equal([...unmatched.claims, ...matched.claims].some((c) => c.waybill.startsWith('X')), false);
    });

    await t.test('an admin with no city sees nothing; asking for another admin\'s city shows nothing; a super admin sees every city and can pick one', async () => {
      const none = await q({}, { adminId: nobody.id });
      assert.deepEqual([none.claims, none.counts], [[], { matched: 0, unmatched: 0 }]);
      assert.deepEqual((await q({ cityId: String(other.id) })).claims, [], 'a city that is not theirs');
      assert.deepEqual((await q({ cityId: String(other.id), tab: 'matched' })).claims, []);
      const all = { all: true };
      assert.deepEqual(waybills(await q({ search: tag, tab: 'unmatched' }, all)).sort(), ['W3', 'W4', 'W5', 'W6', 'X2']);
      assert.deepEqual(waybills(await q({ search: tag, tab: 'matched' }, all)).sort(), ['W1', 'W2', 'X1']);
      assert.deepEqual(waybills(await q({ cityId: String(other.id), tab: 'unmatched' }, all)), ['X2']);
      assert.deepEqual(waybills(await q({ cityId: String(other.id), tab: 'matched' }, all)), ['X1']);
      void sup;
    });

    await t.test('search: waybill, driver, claim type and the carrier\'s courier name; a % or _ is just a character', async () => {
      assert.deepEqual(waybills(await q({ search: `W3${tag}` })), ['W3']);
      assert.deepEqual(waybills(await q({ search: 'Ann Driver', tab: 'matched' })).sort(), ['W1', 'W2'], 'by the matched driver');
      assert.deepEqual(waybills(await q({ search: 'tracking', tab: 'matched' })), ['W2'], 'by claim type, ignoring case');
      assert.deepEqual(waybills(await q({ search: 'cy courier' })), ['W3'], 'by the courier name in the carrier file');
      assert.equal((await q({ search: '%' })).total, 0);
      assert.equal((await q({ search: '_' })).total, 0);
      const counted = await q({ search: 'Ann Driver' });
      assert.deepEqual(counted.counts, { matched: 2, unmatched: 0 }, 'the counts follow the search');
    });

    const run = (period, status = 'draft') => one(
      `INSERT INTO pay_runs (request_id, city_id, period_start, period_end, data_type, status, created_by) VALUES ($1, $2, $3, $4, 'weekly', 'draft', $5) RETURNING id`, [randomUUID(), mine.id, period[0], period[1], sup.id]);
    const finalize = (id) => db.query("UPDATE pay_runs SET status = 'finalized', finalized_by = $2, finalized_at = now() WHERE id = $1", [id, sup.id]);
    const statement = (r, d, taken) => one(`INSERT INTO pay_statements (pay_run_id, driver_id, gross, insurance, reimbursements, claim_deductions, recoveries, net, carried_forward) VALUES ($1, $2, 100, 0, 0, $3, 0, $4, 0) RETURNING id`, [r, d, taken, 100 - taken]);
    const takeLine = (st, claimId, amount) => db.query(`INSERT INTO pay_statement_lines (statement_id, line_type, amount, claim_id) VALUES ($1, 'claim', $2, $3)`, [st, `-${amount}`, claimId]);
    const deductionsOf = async (waybill) => (await q({ tab: 'matched' })).claims.find((c) => c.waybill === `${waybill}${tag}`).deduction;

    await t.test('a claim taken off a driver\'s pay: a draft run has deducted nothing; a finalized run says how much, and whether it was paid out', async () => {
      const draft = await run(['2026-11-01', '2026-11-07']);
      const st = await statement(draft.id, ann.id, 25);
      await takeLine(st.id, c1, '25.00');
      assert.deepEqual(await deductionsOf('W1'), { state: 'none', applied: '0.00', paid: '0.00', refunded: '0.00', left: '0.00', payout: null }, 'a draft run has not deducted anything (its 25.00 is held, so nothing is left to take)');
      assert.equal((await deductionsOf('W2')).state, 'none');
      await finalize(draft.id);
      assert.deepEqual(await deductionsOf('W1'), { state: 'full', applied: '25.00', paid: '0.00', refunded: '0.00', left: '0.00', payout: 'finalized' }, 'finalized is approval, not a completed payout');
      await db.query("UPDATE pay_statements SET payout_status = 'paid' WHERE id = $1", [st.id]);
      assert.deepEqual(await deductionsOf('W1'), { state: 'full', applied: '25.00', paid: '25.00', refunded: '0.00', left: '0.00', payout: 'paid' }, 'the payout has completed');
    });

    await t.test('an amended claim keeps what was taken under its earlier version, and a partial deduction is not shown as a full one', async () => {
      const key = randomBytes(32).toString('hex');
      const v1 = await claim(mine.id, 'W7', 'chargeable', { driver: ann, key, version: 1, superseded: true, amount: '40.00', day: '2026-11-06' });
      const runA = await run(['2026-10-01', '2026-10-07']);
      const stA = await statement(runA.id, ann.id, 15);
      await takeLine(stA.id, v1, '15.00'); // 15.00 of the 40.00 was taken in run A
      await finalize(runA.id);
      const v2 = await claim(mine.id, 'W7', 'chargeable', { driver: ann, key, version: 2, amount: '50.00', day: '2026-11-06' }); // the carrier amended it to 50.00
      assert.deepEqual(await deductionsOf('W7'), { state: 'partial', applied: '15.00', paid: '0.00', refunded: '0.00', left: '35.00', payout: 'finalized' },
        'the earlier version\'s deduction still counts (a badge keyed to the latest version id would lose it)');
      const runB = await run(['2026-10-08', '2026-10-14']);
      const stB = await statement(runB.id, ann.id, 20);
      await takeLine(stB.id, v2, '20.00');
      await finalize(runB.id);
      await db.query("UPDATE pay_statements SET payout_status = 'paid' WHERE id = $1", [stA.id]);
      assert.deepEqual(await deductionsOf('W7'), { state: 'partial', applied: '35.00', paid: '15.00', refunded: '0.00', left: '15.00', payout: 'partly_paid' }, 'two runs, one paid out, one only finalized');
      const runC = await run(['2026-10-15', '2026-10-21']);
      const stC = await statement(runC.id, ann.id, 15);
      await takeLine(stC.id, v2, '15.00');
      await finalize(runC.id);
      assert.deepEqual(await deductionsOf('W7'), { state: 'full', applied: '50.00', paid: '15.00', refunded: '0.00', left: '0.00', payout: 'partly_paid' });
    });

    await t.test('a paid correction gives money back: the history stays, the refund is shown, and what is left to deduct is never hidden', async () => {
      const w8 = await claim(mine.id, 'W8', 'chargeable', { driver: ann, amount: '30.00', day: '2026-11-06' });
      const runD = await run(['2026-09-01', '2026-09-07']);
      const stD = await statement(runD.id, ann.id, 30);
      await takeLine(stD.id, w8, '30.00');
      await finalize(runD.id);
      const refund = async (amount, payoutStatus, period) => {
        const entry = await one(
          `INSERT INTO driver_ledger_entries (request_id, driver_id, city_id, entry_type, direction, amount, reason, effective_date, claim_type, waybill, claim_courier, created_by)
           VALUES ($1, $2, $3, 'correction', 'credit', $4, 'Refund of a wrongly charged claim', '2026-11-08', 'Lost parcel', $5, 'gofo', $6) RETURNING id`,
          [randomUUID(), ann.id, mine.id, amount, `W8${tag}`, sup.id]);
        const runR = await run(period);
        const stR = await statement(runR.id, ann.id, 0);
        await db.query(`INSERT INTO pay_statement_lines (statement_id, line_type, amount, ledger_entry_id) VALUES ($1, 'reimbursement', $2, $3)`, [stR.id, amount, entry.id]);
        await finalize(runR.id);
        if (payoutStatus === 'paid') await db.query("UPDATE pay_statements SET payout_status = 'paid' WHERE id = $1", [stR.id]);
      };
      assert.deepEqual(await deductionsOf('W8'), { state: 'full', applied: '30.00', paid: '0.00', refunded: '0.00', left: '0.00', payout: 'finalized' });
      await refund('10.00', 'not_submitted', ['2026-09-08', '2026-09-14']); // approved, but the money has not reached the driver
      assert.equal((await deductionsOf('W8')).refunded, '0.00', 'a correction counts only once it is paid');
      await refund('10.00', 'paid', ['2026-09-15', '2026-09-21']);
      assert.deepEqual(await deductionsOf('W8'), { state: 'partial', applied: '30.00', paid: '0.00', refunded: '10.00', left: '10.00', payout: 'finalized' },
        'part refunded: the 30.00 stays as history, 10.00 is back and can be taken again');
      await refund('20.00', 'paid', ['2026-09-22', '2026-09-28']);
      assert.deepEqual(await deductionsOf('W8'), { state: 'refunded', applied: '30.00', paid: '0.00', refunded: '30.00', left: '30.00', payout: 'finalized' },
        'fully refunded: nothing stands, the whole amount is left to deduct');
    });

    await t.test('the deduction shape, apart from the database: none, partial, full, and what is left never below zero', () => {
      assert.deepEqual(deductionOf({ amount: '25.00', appliedCents: 0, paidCents: 0, leftCents: 2500 }), { state: 'none', applied: '0.00', paid: '0.00', refunded: '0.00', left: '25.00', payout: null });
      assert.deepEqual(deductionOf({ amount: '25.00', appliedCents: '1000', paidCents: '1000', leftCents: '1500' }), { state: 'partial', applied: '10.00', paid: '10.00', refunded: '0.00', left: '15.00', payout: 'paid' });
      assert.deepEqual(deductionOf({ amount: '25.00', appliedCents: 2500, paidCents: 0, leftCents: -500 }), { state: 'full', applied: '25.00', paid: '0.00', refunded: '0.00', left: '0.00', payout: 'finalized' });
      assert.equal(deductionOf({ amount: '25.00', appliedCents: 0, paidCents: 0, leftCents: null }).left, null, 'an unmatched or exempt claim has no amount left to take');
    });

    await t.test('who may read: the database decides, not the token (a demoted, disabled, unknown or driver account gets nothing)', async () => {
      assert.deepEqual(await claimsScopeOf(db, { id: sup.id, role: 'superadmin' }), { all: true });
      assert.deepEqual(await claimsScopeOf(db, { id: adm.id, role: 'admin' }), { adminId: adm.id });
      assert.deepEqual(await claimsScopeOf(db, { id: adm.id, role: 'superadmin' }), { adminId: adm.id }, 'a token that still says super admin for an admin in the database');
      assert.deepEqual(await claimsScopeOf(db, { id: sup.id, role: 'admin' }), { all: true }, 'promoted in the database');
      await db.query("UPDATE admin SET role = 'admin' WHERE id = $1", [sup.id]);
      assert.deepEqual(await claimsScopeOf(db, { id: sup.id, role: 'superadmin' }), { adminId: sup.id }, 'a demoted super admin sees only their own cities (none assigned: nothing)');
      assert.deepEqual((await listClaims(db, await claimsScopeOf(db, { id: sup.id, role: 'superadmin' }), parseClaimsQuery({}))).claims, []);
      await db.query("UPDATE admin SET role = 'superadmin', is_active = false WHERE id = $1", [sup.id]);
      assert.equal(await claimsScopeOf(db, { id: sup.id, role: 'superadmin' }), null, 'a disabled account');
      await db.query('UPDATE admin SET is_active = true WHERE id = $1', [sup.id]);
      for (const bad of [{ id: 987654321, role: 'admin' }, { id: adm.id, role: 'driver' }, { id: 'x', role: 'admin' }, { id: 0, role: 'superadmin' }, undefined]) assert.equal(await claimsScopeOf(db, bad), null, JSON.stringify(bad));
      const res = { code: null, status(c) { this.code = c; return this; }, json() { return this; } };
      await getClaims({ user: { id: 987654321, role: 'superadmin' }, query: {} }, res); // an account that does not exist, with a token that says super admin
      assert.equal(res.code, 403);
    });

    await t.test('paging: twenty a page, a page past the end is empty, and the counts do not move', async () => {
      assert.equal(PAGE_SIZE, 20);
      for (let i = 0; i < 22; i += 1) await claim(mine.id, `P${i}`, 'unresolved', { day: '2026-10-01' });
      const [p1, p2, p3] = [await q({ page: '1' }), await q({ page: '2' }), await q({ page: '3' })];
      assert.deepEqual([p1.claims.length, p2.claims.length, p3.claims.length], [20, 6, 0]);
      assert.deepEqual([p1.total, p1.totalPages, p2.counts.unmatched], [26, 2, 26]);
      assert.equal(new Set([...p1.claims, ...p2.claims].map((c) => c.id)).size, 26, 'no claim twice, none missing');
    });

    await t.test('reading the list changes nothing', async () => {
      const snapshot = async () => JSON.stringify(await one('SELECT (SELECT count(*) FROM courier_claims) c, (SELECT count(*) FROM courier_claim_matches) m, (SELECT count(*) FROM pay_statement_lines) l'));
      const before = await snapshot();
      await q({}); await q({ tab: 'matched' }, { all: true });
      assert.equal(await snapshot(), before);
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await pool.end();
  }
});

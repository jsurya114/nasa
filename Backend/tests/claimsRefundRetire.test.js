import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importClaims, retireRefundedClaims } from '../services/payroll/claims/claimsStore.js';
import { parseClaimsRows } from '../services/payroll/claims/claimsParser.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Everything runs in one
// transaction that is always rolled back. All values are made up.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const MIGRATION = fileURLToPath(new URL('../migrations/2026-11-03-issue-141-courier-claims.sql', import.meta.url));
const HEADER = ['date', 'Waybill No.', 'Claim Type', 'Declared value (USD)', 'Confirm date.', 'The total expenses-exclusive of taxes', 'Remarks'];

test('a refund retires the stored claims it cancels, in its own city only, and a second run changes nothing', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(MIGRATION, 'utf8'));
    const { rows: cities } = await db.query('SELECT id FROM city ORDER BY id LIMIT 2');
    const [cityA, cityB] = cities.map((r) => r.id);
    const source = { importCityId: cityA, sourceFile: 'synthetic-refund.xlsx', sourceSheet: 'Claims Detail', importedBy: null };
    // What the older rules stored: the lost penalty, an unrelated -40, and the refund kept as a +13.86 charge (no "refund" word while parsing, so the
    // parser keeps it as a claim; the remarks are then set as the carrier wrote them).
    const { claims } = parseClaimsRows([HEADER,
      ['10/23/2026 05:36:13', 'TESTLOST', 'lost', 13.86, null, -13.86, 'Claim Penalty'],
      ['10/25/2026 07:55:18', 'TESTFAKE', 'Tracking interruption', 0.01, null, -40, 'Claim Penalty'],
      ['10/13/2026 00:00:00', 'TESTLOST', 'Tracking interruption', 13.86, null, 13.86, 'Prior Period Claim']], { courier: 'gofo' });
    assert.equal(claims.length, 3);
    await importClaims(db, claims, source);
    await db.query("UPDATE courier_claims SET remarks = 'Prior Period Claim Refund' WHERE waybill = 'TESTLOST' AND original_charge > 0");
    const live = async () => (await db.query("SELECT waybill, claim_type, original_charge FROM courier_claims WHERE superseded_at IS NULL AND waybill LIKE 'TEST%' ORDER BY id"))
      .rows.map((r) => `${r.waybill}|${r.claim_type}|${Number(r.original_charge)}`);
    assert.deepEqual(await live(), ['TESTLOST|lost|-13.86', 'TESTFAKE|Tracking interruption|-40', 'TESTLOST|Tracking interruption|13.86']);
    const lost = claims.find((c) => c.claimType === 'lost');
    const cancelled = [{ key: lost.key, originalCharge: lost.originalCharge, claimAt: lost.claimAt, confirmedAt: lost.confirmedAt }];

    assert.deepEqual(await retireRefundedClaims(db, { cityId: cityB, cancelled }), { retired: 0, left: 0 }, 'another city');
    assert.equal((await live()).length, 3);
    assert.deepEqual(await retireRefundedClaims(db, { cityId: cityA, cancelled }), { retired: 2, left: 0 });
    assert.deepEqual(await live(), ['TESTFAKE|Tracking interruption|-40'], 'the unrelated claim is still owed');
    assert.deepEqual(await retireRefundedClaims(db, { cityId: cityA, cancelled }), { retired: 0, left: 0 });
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

// Through the weekly upload recorder, as the review of #268 asked (a file with no charge left, and a replay of an older report).
test('upload recorder: a file of only a penalty and its refund cancels the stored penalty, and replaying an older report keeps it cancelled', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: XLSX } = await import('xlsx');
  const { recordWorkbookClaims } = await import('../services/payroll/claims/recordWorkbookClaims.js');
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const COLS = ['date', 'Waybill No.', 'Courier', 'Claim Type', 'Declared value (USD)', 'Confirm date.', 'The total expenses-exclusive of taxes', 'Remarks'];
  const book = (rows) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([COLS, ...rows]), 'Claims Detail');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  };
  const PEN = ['10/23/2026 05:36:13', 'TESTLOST', 'Sam Lee', 'lost', 20, null, -20, 'Claim Penalty'];
  const KEEP = ['10/24/2026 05:36:13', 'TESTKEEP', 'Sam Lee', 'fake pod', 1, null, -5, 'Claim Penalty'];
  const NEW = ['10/25/2026 05:36:13', 'TESTNEW', 'Sam Lee', 'fake pod', 1, null, -7, 'Claim Penalty'];
  const REF = ['10/13/2026 00:00:00', 'TESTLOST', 'Sam Lee', 'Tracking interruption', 20, null, 20, 'Prior Period Claim Refund'];
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(MIGRATION, 'utf8'));
    // a route whose city is the only one with that job
    const { rows: [route] } = await db.query(`SELECT r.route_code_in_string AS code FROM routes r JOIN city c ON c.job = r.job GROUP BY r.route_code_in_string HAVING count(DISTINCT c.id) = 1 LIMIT 1`);
    assert.ok(route, 'needs a route with one city in the test database');
    const upload = (rows, name) => recordWorkbookClaims(db, { buffer: book(rows), fileName: name, user: { id: null, role: 'superadmin' }, routeCodes: [route.code] });
    const live = async () => (await db.query("SELECT waybill FROM courier_claims WHERE superseded_at IS NULL AND waybill LIKE 'TEST%' ORDER BY waybill")).rows.map((r) => r.waybill);

    const first = await upload([PEN, KEEP], 'week-1.xlsx');
    assert.equal(first.stored, true, JSON.stringify(first));
    assert.deepEqual(await live(), ['TESTKEEP', 'TESTLOST']);

    // only the penalty and its refund: no claim is left to store, and the stored penalty is still cancelled
    const second = await upload([PEN, REF], 'week-2.xlsx');
    assert.equal(second.refunded, 1, JSON.stringify(second));
    assert.deepEqual(await live(), ['TESTKEEP']);

    // an older report replayed, with another claim in it: nothing rolls back, the other claim is stored, the penalty stays cancelled
    const replay = await upload([PEN, KEEP, NEW], 'week-1-again.xlsx');
    assert.equal(replay.stored, true, JSON.stringify(replay));
    assert.deepEqual(await live(), ['TESTKEEP', 'TESTNEW']);
    // and the replay of the cancelling report is still a no-op
    const again = await upload([PEN, REF], 'week-2-again.xlsx');
    assert.deepEqual([again.refunded, await live()], [0, ['TESTKEEP', 'TESTNEW']]);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

// The order reports reach NASA in must not matter (second review of #268): the refund is remembered against the penalty's original facts.
test('upload order: an older report cannot bring back a refunded amount, a carrier amendment still counts', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: XLSX } = await import('xlsx');
  const { recordWorkbookClaims } = await import('../services/payroll/claims/recordWorkbookClaims.js');
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const COLS = ['date', 'Waybill No.', 'Courier', 'Claim Type', 'Declared value (USD)', 'Confirm date.', 'The total expenses-exclusive of taxes', 'Remarks'];
  const book = (rows) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([COLS, ...rows]), 'Claims Detail');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  };
  const pen = (waybill, amount) => ['10/23/2026 05:36:13', waybill, 'Sam Lee', 'lost', 20, null, -amount, 'Claim Penalty'];
  const ref = (waybill, amount) => ['10/13/2026 00:00:00', waybill, 'Sam Lee', 'Tracking interruption', 20, null, amount, 'Prior Period Claim Refund'];
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(MIGRATION, 'utf8'));
    await db.query(readFileSync(fileURLToPath(new URL('../migrations/2026-11-10-courier-claim-adjustments.sql', import.meta.url)), 'utf8'));
    const { rows: [route] } = await db.query(`SELECT r.route_code_in_string AS code FROM routes r JOIN city c ON c.job = r.job GROUP BY r.route_code_in_string HAVING count(DISTINCT c.id) = 1 LIMIT 1`);
    assert.ok(route, 'needs a route with one city in the test database');
    const upload = (rows, name) => recordWorkbookClaims(db, { buffer: book(rows), fileName: name, user: { id: null, role: 'superadmin' }, routeCodes: [route.code] });
    const owed = async (waybill) => (await db.query('SELECT deduction_amount, version FROM courier_claims WHERE waybill = $1 AND superseded_at IS NULL', [waybill])).rows.map((r) => `${Number(r.deduction_amount)}@v${r.version}`);
    const versions = async (waybill) => Number((await db.query('SELECT count(*) AS n FROM courier_claims WHERE waybill = $1', [waybill])).rows[0].n);

    // 1. a 20.00 penalty is stored, then a report with the same penalty and a 10.00 refund lowers it to 10.00. The original report again must not undo that.
    assert.equal((await upload([pen('TESTPART', 20)], 'original.xlsx')).stored, true);
    assert.deepEqual(await owed('TESTPART'), ['20@v1']);
    assert.equal((await upload([pen('TESTPART', 20), ref('TESTPART', 10)], 'with-refund.xlsx')).stored, true);
    assert.deepEqual(await owed('TESTPART'), ['10@v2']);
    const replay = await upload([pen('TESTPART', 20)], 'original-again.xlsx');
    assert.equal(replay.stored, true, JSON.stringify(replay));
    assert.deepEqual(await owed('TESTPART'), ['10@v2'], 'the refund survives the older report');
    assert.equal(await versions('TESTPART'), 2, 'no new version');

    // 2. a report that already holds the penalty and its full refund is the first NASA sees: nothing is stored, and the original report later adds nothing.
    const refundedFirst = await upload([pen('TESTFULL', 20), ref('TESTFULL', 20)], 'refund-first.xlsx');
    assert.equal(refundedFirst.stored, false);
    assert.deepEqual(await owed('TESTFULL'), []);
    const later = await upload([pen('TESTFULL', 20), pen('TESTOTHER', 5)], 'original-later.xlsx');
    assert.equal(later.stored, true, JSON.stringify(later));
    assert.deepEqual(await owed('TESTFULL'), [], 'stays cancelled');
    assert.deepEqual(await owed('TESTOTHER'), ['5@v1'], 'the other claims of that report are stored');
    assert.equal(await versions('TESTFULL'), 0);

    // 3. a genuine carrier amendment (another amount) is a new version, refunded or not
    await upload([pen('TESTFULL', 25)], 'amended.xlsx');
    assert.deepEqual(await owed('TESTFULL'), ['25@v1']);
    await upload([pen('TESTPART', 30)], 'amended-part.xlsx');
    assert.deepEqual(await owed('TESTPART'), ['30@v3']);
    // and the remembered refund still stands for the original facts
    await upload([pen('TESTPART', 20)], 'original-third-time.xlsx');
    assert.deepEqual(await owed('TESTPART'), ['10@v4'], 'the original facts read again are the refunded amount, as a new version of the amendment');
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

// Third review of #268: an older report must neither raise a part-refunded deduction nor retire a genuine carrier amendment.
test('upload order: an older partial refund cannot raise the deduction, and an older full refund cannot retire an amendment', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: XLSX } = await import('xlsx');
  const { recordWorkbookClaims } = await import('../services/payroll/claims/recordWorkbookClaims.js');
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const COLS = ['date', 'Waybill No.', 'Courier', 'Claim Type', 'Declared value (USD)', 'Confirm date.', 'The total expenses-exclusive of taxes', 'Remarks'];
  const book = (rows) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([COLS, ...rows]), 'Claims Detail');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  };
  const pen = (waybill, amount) => ['10/23/2026 05:36:13', waybill, 'Sam Lee', 'lost', 20, null, -amount, 'Claim Penalty'];
  const ref = (waybill, amount) => ['10/13/2026 00:00:00', waybill, 'Sam Lee', 'Tracking interruption', 20, null, amount, 'Prior Period Claim Refund'];
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(MIGRATION, 'utf8'));
    await db.query(readFileSync(fileURLToPath(new URL('../migrations/2026-11-10-courier-claim-adjustments.sql', import.meta.url)), 'utf8'));
    const { rows: [route] } = await db.query(`SELECT r.route_code_in_string AS code FROM routes r JOIN city c ON c.job = r.job GROUP BY r.route_code_in_string HAVING count(DISTINCT c.id) = 1 LIMIT 1`);
    assert.ok(route, 'needs a route with one city in the test database');
    const upload = (rows, name) => recordWorkbookClaims(db, { buffer: book(rows), fileName: name, user: { id: null, role: 'superadmin' }, routeCodes: [route.code] });
    const owed = async (waybill) => (await db.query('SELECT deduction_amount, version FROM courier_claims WHERE waybill = $1 AND superseded_at IS NULL', [waybill])).rows.map((r) => `${Number(r.deduction_amount)}@v${r.version}`);

    // 1. a 20.00 penalty with a 15.00 refund leaves 5.00; an older report that shows only a 5.00 refund on the same penalty must not raise it to 15.00
    await upload([pen('TESTA', 20)], 'a-original.xlsx');
    await upload([pen('TESTA', 20), ref('TESTA', 15)], 'a-refund-15.xlsx');
    assert.deepEqual(await owed('TESTA'), ['5@v2']);
    const older = await upload([pen('TESTA', 20), ref('TESTA', 5)], 'a-refund-5-older.xlsx');
    assert.equal(older.stored, true, JSON.stringify(older));
    assert.deepEqual(await owed('TESTA'), ['5@v2'], 'an older, smaller refund does not undo a larger one');

    // 1b. a part refund and then a FULL refund of the same penalty: 20.00 -> 5.00 -> nothing, even when the original report is read again (third review)
    await upload([pen('TESTD', 20)], 'd-original.xlsx');
    await upload([pen('TESTD', 20), ref('TESTD', 15)], 'd-refund-15.xlsx');
    assert.deepEqual(await owed('TESTD'), ['5@v2']);
    await upload([pen('TESTD', 20), ref('TESTD', 20)], 'd-refund-20.xlsx');
    assert.deepEqual(await owed('TESTD'), [], 'a full refund cancels the part-refunded version too');
    await upload([pen('TESTD', 20)], 'd-original-again.xlsx');
    assert.deepEqual(await owed('TESTD'), [], 'the original report read again leaves it cancelled');
    // a genuine amendment after that is still a charge, and the same refund reports read again leave it alone
    await upload([pen('TESTD', 25)], 'd-amended.xlsx');
    assert.deepEqual(await owed('TESTD'), ['25@v3']);
    await upload([pen('TESTD', 20), ref('TESTD', 20)], 'd-refund-20-again.xlsx');
    assert.deepEqual(await owed('TESTD'), ['25@v3']);

    // 2. a fully refunded 20.00 penalty, then a genuine carrier amendment to 25.00: the refund report read again must not retire the amendment
    await upload([pen('TESTB', 20), ref('TESTB', 20)], 'b-refunded.xlsx');
    assert.deepEqual(await owed('TESTB'), []);
    await upload([pen('TESTB', 25)], 'b-amended.xlsx');
    assert.deepEqual(await owed('TESTB'), ['25@v1']);
    await upload([pen('TESTB', 20), ref('TESTB', 20)], 'b-refunded-again.xlsx');
    assert.deepEqual(await owed('TESTB'), ['25@v1'], 'the amendment survives the older refund report');
    // same when the 20.00 penalty had been stored first and retired by the refund, then amended
    await upload([pen('TESTC', 20)], 'c-original.xlsx');
    await upload([pen('TESTC', 20), ref('TESTC', 20)], 'c-refunded.xlsx');
    assert.deepEqual(await owed('TESTC'), []);
    await upload([pen('TESTC', 25)], 'c-amended.xlsx');
    assert.deepEqual(await owed('TESTC'), ['25@v2']);
    await upload([pen('TESTC', 20), ref('TESTC', 20)], 'c-refunded-again.xlsx');
    assert.deepEqual(await owed('TESTC'), ['25@v2'], 'the amendment survives the older refund report');
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

// Security review of #268: one city's report must not remember a refund against, or cancel, a claim that belongs to another city.
test('refunds are remembered per city: another city\'s report cannot cancel a claim it does not own', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: XLSX } = await import('xlsx');
  const { recordWorkbookClaims } = await import('../services/payroll/claims/recordWorkbookClaims.js');
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const COLS = ['date', 'Waybill No.', 'Courier', 'Claim Type', 'Declared value (USD)', 'Confirm date.', 'The total expenses-exclusive of taxes', 'Remarks'];
  const book = (rows) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([COLS, ...rows]), 'Claims Detail');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  };
  const pen = ['10/23/2026 05:36:13', 'TESTCITY', 'Sam Lee', 'lost', 20, null, -20, 'Claim Penalty'];
  const ref = ['10/13/2026 00:00:00', 'TESTCITY', 'Sam Lee', 'Tracking interruption', 20, null, 20, 'Prior Period Claim Refund'];
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(MIGRATION, 'utf8'));
    await db.query(readFileSync(fileURLToPath(new URL('../migrations/2026-11-10-courier-claim-adjustments.sql', import.meta.url)), 'utf8'));
    const { rows: routes } = await db.query(`SELECT min(r.route_code_in_string) AS code, min(c.id) AS city FROM routes r JOIN city c ON c.job = r.job GROUP BY c.id HAVING count(DISTINCT r.route_code_in_string) >= 1 ORDER BY c.id LIMIT 2`);
    assert.equal(routes.length, 2, 'needs two cities that each have a route in the test database');
    const [a, b] = routes;
    const upload = (city, rows, name) => recordWorkbookClaims(db, { buffer: book(rows), fileName: name, user: { id: null, role: 'superadmin' }, routeCodes: [city.code] });
    const live = async () => (await db.query("SELECT import_city_id FROM courier_claims WHERE waybill = 'TESTCITY' AND superseded_at IS NULL")).rows.map((r) => Number(r.import_city_id));

    // city A owns the claim
    assert.equal((await upload(a, [pen], 'a-original.xlsx')).stored, true);
    assert.deepEqual(await live(), [Number(a.city)]);
    // city B sends the same penalty with a full refund: nothing of A's is cancelled or remembered against it
    await upload(b, [pen, ref], 'b-attack.xlsx');
    assert.deepEqual(await live(), [Number(a.city)], 'A\'s claim is still owed');
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM courier_claim_adjustments WHERE import_city_id = $1", [b.city])).rows[0].n), 0, 'nothing remembered for B against A\'s claim');
    // A's own report read again keeps the claim, with no new version
    await upload(a, [pen], 'a-again.xlsx');
    assert.deepEqual(await live(), [Number(a.city)]);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM courier_claims WHERE waybill = 'TESTCITY'")).rows[0].n), 1);
    // a memory held for city B (its own claims) is never read for city A
    await db.query(`INSERT INTO courier_claim_adjustments (courier, claim_key, facts_key, import_city_id, original_charge, claim_at, refunded, net, source_file)
                    VALUES ('gofo', repeat('a', 64), repeat('b', 64), $1, -5, '2026-10-23 05:36:13', 5, 0, 'synthetic')`, [b.city]);
    const { applyKnownAdjustments } = await import('../services/payroll/claims/claimsStore.js');
    const { factsKey } = await import('../services/payroll/claims/claimRules.js');
    const claim = { key: 'a'.repeat(64), originalCharge: '-5.00', charge: '-5.00', claimAt: '2026-10-23 05:36:13', confirmedAt: null };
    // the facts key above is made up, so build the matching row from the real function instead
    await db.query('UPDATE courier_claim_adjustments SET facts_key = $1 WHERE import_city_id = $2 AND claim_key = $3', [factsKey(claim), b.city, claim.key]);
    assert.equal((await applyKnownAdjustments(db, [claim], { importCityId: a.city })).cancelled.length, 0, 'A does not read B\'s memory');
    assert.equal((await applyKnownAdjustments(db, [claim], { importCityId: b.city })).cancelled.length, 1, 'B reads its own');
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

after(async () => { if (hasDb) { const { default: pool } = await import('../config/db.js'); await pool.end(); } });

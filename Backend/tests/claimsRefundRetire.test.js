import test from 'node:test';
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
    const lostKey = claims.find((c) => c.claimType === 'lost').key;

    assert.deepEqual(await retireRefundedClaims(db, { cityId: cityB, keys: [lostKey] }), { retired: 0, left: 0 }, 'another city');
    assert.equal((await live()).length, 3);
    assert.deepEqual(await retireRefundedClaims(db, { cityId: cityA, keys: [lostKey] }), { retired: 2, left: 0 });
    assert.deepEqual(await live(), ['TESTFAKE|Tracking interruption|-40'], 'the unrelated claim is still owed');
    assert.deepEqual(await retireRefundedClaims(db, { cityId: cityA, keys: [lostKey] }), { retired: 0, left: 0 });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});

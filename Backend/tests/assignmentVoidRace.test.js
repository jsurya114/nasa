import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evidenceFromCells } from '../services/excel/assignmentHistory/assignmentRules.js';
import { findAssignmentCandidates, recordReport, voidImport } from '../services/excel/assignmentHistory/assignmentStore.js';

// A void and an import of the same file under another scope must not overlap (review of #151). This needs two
// connections that really commit, so it cannot roll back. Run it only on a scratch copy with ASSIGNMENT_RACE_DB=1
// and the usual DB_* variables, and with EMPTY assignment history tables: it refuses to run otherwise, and it
// removes everything it created (the made-up city, route and driver, and its own history rows) at the end.
const enabled = process.env.ASSIGNMENT_RACE_DB === '1';
const MIGRATION = fileURLToPath(new URL('../migrations/2026-11-03-issue-140-carrier-assignment-history.sql', import.meta.url));
const hash = createHash('sha256').update('race-file').digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('voiding and importing the same file under another scope are serialised', { skip: !enabled && 'set ASSIGNMENT_RACE_DB=1 and the DB_* variables, on a scratch copy with empty history' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const setup = await pool.connect();
  await setup.query(readFileSync(MIGRATION, 'utf8'));
  const existing = Number((await setup.query('SELECT (SELECT count(*) FROM carrier_assignment_imports) + (SELECT count(*) FROM carrier_package_assignments) AS n')).rows[0].n);
  assert.equal(existing, 0, 'the history tables must be empty; do not run this against real history');
  const city = (await setup.query("INSERT INTO city (job, city_code, city_type) VALUES ('Race GOFO', 'RACE', 'WEEKLY') RETURNING id")).rows[0].id;
  await setup.query("INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ('Race route', 'Race GOFO', 1, 1, 1, 1, 'RACE 01-1')");
  await setup.query("INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', 'Race Driver', 'race@example.test', 90000077, $1)", [city]);
  const row = { sheet: 'fee_details', sourceRow: 2, ...evidenceFromCells({ waybill: 'RACE0001', deliveryId: 90000077, route: 'RACE 01-1', signing: '10/01/2026 10:00:00' }).evidence };
  const report = { carrier: 'gofo', sheets: { fee_details: { rows: 1 }, offset_details: { rows: 0 } }, rows: [row], problems: [], problemCount: 0 };
  setup.release();

  const inTransaction = async (fn) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  };
  try {
    const first = await inTransaction((c) => recordReport(c, report, { reportHash: hash, sourceLabel: 'race.xlsx', importedBy: 1, allowedJobs: null }));

    // The void holds the lock; an import of the same bytes under another scope starts meanwhile and must wait.
    let release;
    const holding = new Promise((resolve) => { release = resolve; });
    const voiding = inTransaction(async (c) => { await voidImport(c, first.importId, { reason: 'wrong file', adminId: 1 }); await holding; });
    await sleep(150);
    let importDone = false;
    const importing = inTransaction((c) => recordReport(c, report, { reportHash: hash, sourceLabel: 'race.xlsx', importedBy: 2, allowedJobs: ['Race GOFO'] })).then((r) => { importDone = true; return r; });
    await sleep(300);
    const importWaited = importDone === false;
    release();
    await voiding;
    const second = await importing;
    assert.equal(importWaited, true, 'the import waits for the void');
    assert.deepEqual([second.alreadyRecorded, second.voided, second.recorded], [true, true, 0], 'it then sees the void and records nothing');
    assert.deepEqual(await findAssignmentCandidates(pool, { courier: 'gofo', waybill: 'RACE0001' }), []);

    // The other order: an import of another scope is in progress when the void arrives. The void waits, then covers it.
    const hash2 = createHash('sha256').update('race-file-2').digest('hex');
    const wide = await inTransaction((c) => recordReport(c, report, { reportHash: hash2, sourceLabel: 'race2.xlsx', importedBy: 1, allowedJobs: null }));
    let releaseImport;
    const holdImport = new Promise((resolve) => { releaseImport = resolve; });
    const importing2 = inTransaction(async (c) => { const r = await recordReport(c, report, { reportHash: hash2, sourceLabel: 'race2.xlsx', importedBy: 2, allowedJobs: ['Race GOFO'] }); await holdImport; return r; });
    await sleep(150);
    let voidDone = false;
    const voiding2 = inTransaction((c) => voidImport(c, wide.importId, { reason: 'late', adminId: 1 })).then((r) => { voidDone = true; return r; });
    await sleep(300);
    const voidWaited = voidDone === false;
    releaseImport();
    const narrow = await importing2;
    assert.equal(voidWaited, true, 'the void waits for the import in progress');
    assert.notEqual(narrow.importId, wide.importId);
    assert.equal(await voiding2, true);
    const live = await pool.query('SELECT count(*)::int n FROM carrier_assignment_imports WHERE report_hash = $1 AND voided_at IS NULL', [hash2]);
    assert.equal(live.rows[0].n, 0, 'no copy of the voided file is left standing');
    assert.deepEqual(await findAssignmentCandidates(pool, { courier: 'gofo', waybill: 'RACE0001' }), []);
  } finally {
    const cleanup = await pool.connect();
    await cleanup.query('TRUNCATE carrier_assignment_sightings, carrier_package_assignments, carrier_assignment_imports');
    await cleanup.query("DELETE FROM drivers WHERE email = 'race@example.test'");
    await cleanup.query("DELETE FROM routes WHERE route_code_in_string = 'RACE 01-1'");
    await cleanup.query("DELETE FROM city WHERE city_code = 'RACE'");
    cleanup.release();
    await pool.end();
  }
});

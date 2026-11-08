import test from 'node:test';
import assert from 'node:assert/strict';
import { currentImportId, reviewImport, settleImport, stageImport } from '../services/finance/gofoStatement/weeklyImport.js';

// The saved weekly import's safety rules, without a database: a fake connection answers the few queries the module makes. The database behaviour is covered by
// gofoWeeklyUpload.test.js (PAYROLL_TEST_DB=1).
const REVIEW = { city: 'Test City', week: 'Week 43-2026', billNumber: 'AP1', deliveryRevenue: '4.91', settlementPayable: '2.21', matchedRevenue: '4.91', unallocatedRevenue: '0.00', reasons: [], outcome: { kind: 'new' } };
const fakePool = ({ row, failOn = null } = {}) => {
  const sent = [];
  let current = row ? { ...row } : null;
  const query = async (sql, params) => {
    const text = sql.trim().replace(/\s+/g, ' ');
    sent.push(text.slice(0, 60));
    if (failOn && failOn.test(text)) throw Object.assign(new Error('relation "carrier_statement_imports" does not exist'), { code: '42P01' });
    if (/^SELECT \* FROM carrier_statement_imports WHERE id = \$1/.test(text)) return { rows: current ? [current] : [] };
    if (/^UPDATE carrier_statement_imports SET status = \$2/.test(text)) {
      current = { ...current, status: params[1], reason_kind: params[2], review: params[3] ? JSON.parse(params[3]) : current.review, is_current: params[8] ? false : current.is_current, applied_at: params[8] ? new Date() : current.applied_at };
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  return { sent, query, connect: async () => ({ query, release: () => {} }) };
};
const row = (over = {}) => ({ id: 5, status: 'staged', reason_kind: null, review: REVIEW, uploaded_by_role: 'superadmin', is_current: true, applied_at: null, file: Buffer.from('not a workbook'), source_label: 'weekly.xlsx', ...over });
const OWNER = { id: 1, role: 'superadmin' };
const CITY_ADMIN = { id: 2, role: 'admin' };

test('an older database without the import table never fails the upload: nothing is saved and the answer says so', async () => {
  const client = fakePool({ failOn: /INSERT INTO carrier_statement_imports/ });
  const staged = await stageImport(client, { buffer: Buffer.from('x'), fileName: 'weekly.xlsx', user: OWNER });
  assert.equal(staged.id, null);
  assert.match(staged.reason, /not set up in the database yet/);
  assert.equal(client.sent.at(-1), 'ROLLBACK TO SAVEPOINT carrier_statement_import', 'the upload\'s own work is kept: only the savepoint is undone');
  assert.deepEqual(await reviewImport(client, null, Buffer.from('x'), OWNER), { state: 'unavailable', message: 'Revenue could not be checked. The weekly upload itself is unaffected.', importId: null, reasonKind: null, reasons: ['Revenue import is not set up in the database yet.'] });
  assert.equal(await settleImport(client, OWNER, null), null, 'no import tied to the data: nothing to settle');
  assert.equal(await currentImportId(fakePool({ failOn: /FROM carrier_statement_imports/ })), null);
});

test('a city admin\'s weekly add never publishes revenue: the saved import waits for the owner, and the admin sees no company figure', async () => {
  const pool = fakePool({ row: row() });
  const out = await settleImport(pool, CITY_ADMIN, 5);
  assert.deepEqual([out.state, out.message, out.reasonKind], ['needs_review', 'Revenue needs review', 'owner_required']);
  assert.match(out.reasons.join(' '), /Only an owner publishes company revenue/);
  assert.equal(out.importId, null);
  for (const key of ['city', 'week', 'billNumber', 'deliveryRevenue', 'settlementPayable', 'matchedRevenue', 'unallocatedRevenue', 'outcome']) assert.equal(key in out, false, `a city admin does not get ${key}`);
  assert.ok(pool.sent.includes('BEGIN') && pool.sent.includes('COMMIT'));
});

test('an owner who adds a city admin\'s staged data does not publish the city admin\'s file: it waits for the owner\'s own review', async () => {
  const pool = fakePool({ row: row({ uploaded_by_role: 'admin' }) });
  const out = await settleImport(pool, OWNER, 5);
  assert.deepEqual([out.state, out.reasonKind, out.importId], ['needs_review', 'owner_required', '5']);
  assert.match(out.reasons.join(' '), /uploaded by a city admin/);
});

test('the owner sees the figures and the import id', async () => {
  const out = await settleImport(fakePool({ row: row({ status: 'needs_review', reason_kind: 'correction' }) }), OWNER, 5);
  assert.deepEqual([out.state, out.importId, out.city, out.deliveryRevenue], ['needs_review', '5', 'Test City', '4.91']);
});

test('an import that is no longer the current one is never published: a newer upload replaced it, or it was already settled', async () => {
  const replaced = fakePool({ row: row({ status: 'replaced', is_current: false, file: null }) });
  const out = await settleImport(replaced, OWNER, 5);
  assert.equal(out.state, 'unavailable');
  assert.match(out.reasons.join(' '), /newer weekly upload replaced/);
  const done = await settleImport(fakePool({ row: row({ status: 'published', is_current: false, applied_at: new Date(), file: null }) }), OWNER, 5);
  assert.deepEqual([done.state, done.message], ['updated', 'Revenue updated'], 'a second settle only reports what already happened');
  assert.equal(replaced.sent.some((q) => q.startsWith('UPDATE carrier_statement_imports')), false, 'nothing was changed');
});

test('a problem while settling is answered, never thrown: the weekly add that already committed is not undone', async () => {
  const out = await settleImport(fakePool({ row: row(), failOn: /FOR UPDATE/ }), OWNER, 5);
  assert.equal(out.state, 'unavailable');
  assert.match(out.reasons.join(' '), /The weekly data was added/);
});

test('an owner whose saved file fails its checks keeps the import open with the reasons; nothing is published', async () => {
  // The saved bytes are not a workbook, so publishing's own check rejects them.
  const pool = fakePool({ row: row() });
  const out = await settleImport(pool, OWNER, 5);
  assert.deepEqual([out.state, out.reasonKind], ['needs_review', 'check_failed']);
  assert.ok(out.reasons.length > 0);
});

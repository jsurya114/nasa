import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requireRole } from '../middlewares/requireRole.js';

// Who may call the payroll routes. Only the super admin may use the ledger, pay runs, payments and Everee; an ordinary admin keeps
// only the Dashboard's penalty summary. The router file is read as text because importing it opens the Redis connection of the
// sign-in check. A route added above the guard line fails here.
const source = readFileSync(new URL('../routes/payrollRoutes.js', import.meta.url), 'utf8').split('\n');
const GUARD = "router.use(requireRole('superadmin'));";
const SUMMARY = "router.get('/drivers/:driverId/dashboard-summary'";
const routeLines = source.map((text, line) => ({ text: text.trim(), line })).filter(({ text }) => /^router\.(get|post|put|patch|delete)\(/.test(text));
const guardLine = source.findIndex((text) => text.trim() === GUARD);

test('the file has one super admin guard, after the sign-in check', () => {
  assert.ok(guardLine > 0, 'the guard line is missing');
  assert.equal(source.filter((text) => text.trim() === GUARD).length, 1);
  const signIn = source.findIndex((text) => text.trim() === 'router.use(adminAuth);');
  assert.ok(signIn > 0 && signIn < guardLine, 'adminAuth must run before the guard');
});

// The QuickBooks sign-in return is a plain page visit from Intuit with no login header, so it is the one route that must sit before the sign-in check. It is safe to leave
// open only because the service accepts nothing but a single-use state made by a signed-in super admin and re-checks that admin in the database.
const CALLBACK = "router.get('/quickbooks/callback'";

test('only the Dashboard penalty summary is open to an ordinary admin, and the QuickBooks sign-in return is open to no login header', () => {
  const open = routeLines.filter(({ line }) => line < guardLine);
  assert.equal(open.length, 2);
  const callback = open.find(({ text }) => text.startsWith(CALLBACK));
  assert.ok(callback, 'the QuickBooks callback must be reachable without a login header');
  assert.ok(open.some(({ text }) => text.startsWith(SUMMARY)));
  const signIn = source.findIndex((text) => text.trim() === 'router.use(adminAuth);');
  assert.ok(callback.line < signIn, 'the callback is registered before the sign-in check');
  assert.equal(open.filter(({ text }) => !text.startsWith(CALLBACK) && !text.startsWith(SUMMARY)).length, 0, 'no other route may be open');
});

test('every other payroll, payment and Everee route is behind the guard', () => {
  const guarded = routeLines.filter(({ line }) => line > guardLine).map(({ text }) => text);
  assert.ok(guarded.length >= 30, `found only ${guarded.length} guarded routes`);
  for (const wanted of ["router.get('/runs'", "router.post('/runs/:runId/finalize'", "router.get('/payments/runs'", "router.post('/runs/:runId/everee-batches'", "router.get('/everee/status'", "router.get('/ledger'", "router.put('/settings/recovery-limit'"]) {
    assert.ok(guarded.some((text) => text.startsWith(wanted)), `${wanted} should be behind the guard`);
  }
});

test('the guard refuses an admin, a driver and a token with no role; it lets a super admin through', () => {
  const guard = requireRole('superadmin');
  const call = (role) => {
    let status; let body; let passed = false;
    const res = { status(code) { status = code; return this; }, json(b) { body = b; return this; } };
    guard({ user: { id: 1, role }, admin: { id: 1, role } }, res, () => { passed = true; });
    return { status, body, passed };
  };
  for (const role of ['admin', 'driver', undefined]) {
    const result = call(role);
    assert.equal(result.status, 403, `${role} must be refused`);
    assert.equal(result.passed, false);
    assert.deepEqual(result.body, { message: 'FORBIDDEN' });
  }
  const allowed = call('superadmin');
  assert.equal(allowed.passed, true);
  assert.equal(allowed.status, undefined);
});

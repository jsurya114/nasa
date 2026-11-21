// Checks the load-test RUNNER against a fake server: every way a run can go wrong must fail, and only a clean run passes.
// A pass here says nothing about NASA's capacity. Run: node --test docs/infra/loadtest/test/runner.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNotProduction, checkAccounts, classify, createRecorder, summarise, verdict } from '../lib/core.mjs';

const runner = join(dirname(fileURLToPath(import.meta.url)), '..', 'nasa-load.mjs');
const dir = mkdtempSync(join(tmpdir(), 'nasa-loadtest-'));
const accounts = (n, prefix) => Array.from({ length: n }, (_, i) => ({ email: `${prefix}${i}@example.invalid`, password: 'fixture-only' }));
writeFileSync(join(dir, 'drivers.json'), JSON.stringify(accounts(3, 'driver')));
writeFileSync(join(dir, 'admins.json'), JSON.stringify(accounts(2, 'admin')));
writeFileSync(join(dir, 'dupes.json'), JSON.stringify([...accounts(1, 'x'), ...accounts(1, 'x')]));
writeFileSync(join(dir, 'weekly.xlsx'), 'not a real workbook');
writeFileSync(join(dir, 'expect.json'), JSON.stringify({ recordsProcessed: 10, recordsSkipped: 0, recordsInserted: 2 }));

const TOKEN = `x.${Buffer.from(JSON.stringify({ role: 'superadmin' })).toString('base64url')}.fixture-signature-padding`;
const GOOD = {
  '/driver/login': { accessToken: TOKEN, driver: { id: 7 } },
  '/admin/login': { accessToken: TOKEN },
  '/driver/availability': { success: true, data: [] },
  '/driver/profile': { success: true, profile: { id: 7 } },
  '/driver/deliveries/7': [],
  '/driver/payroll/statements': { statements: [] },
  '/driver/payroll/balances': { owed: 0 },
  '/admin/dashboard/summary': { success: true, data: {} },
  '/admin/analytics': { success: true, data: {} },
  '/admin/insights/overview': { data: {} },
  '/admin/insights/trends': { data: [] },
  '/admin/payroll/runs': { runs: [] },
  '/admin/doubleStop/weekly-upload': { success: true, data: { recordsProcessed: 10, recordsSkipped: 0, recordsInserted: 2 } },
  '/healthz': { status: 'ok' },
};

// mode: a function (path) => { status, body, raw, delayMs } overriding the good answer, or undefined to keep it
function fakeServer(mode = () => undefined) {
  const hits = new Map();
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    hits.set(path, (hits.get(path) || 0) + 1);
    req.resume();
    req.on('end', () => {
      const o = mode(path) || {};
      const status = o.status ?? (path in GOOD ? 200 : 404);
      const payload = o.raw ?? JSON.stringify(o.body ?? GOOD[path] ?? { message: 'not found' });
      setTimeout(() => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(payload); }, o.delayMs ?? 0);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, hits, base: `http://127.0.0.1:${server.address().port}` })));
}

function run(base, extra = [], { signalAfterMs } = {}) {
  const out = join(dir, `r-${Math.random().toString(36).slice(2)}.json`);
  const argv = [runner, '--base', base, '--drivers', join(dir, 'drivers.json'), '--admins', join(dir, 'admins.json'),
    '--driver-vus', '3', '--admin-vus', '1', '--ramp', '0', '--duration', '0.4', '--think-scale', '0.002', '--timeout-ms', '300', '--out', out, ...extra];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv);
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    if (signalAfterMs) setTimeout(() => child.kill('SIGINT'), signalAfterMs);
    child.on('close', (code) => {
      let report = null;
      try { report = JSON.parse(readFileSync(out, 'utf8')); } catch {}
      resolve({ code, stdout, stderr, report });
    });
  });
}

async function withServer(mode, extra, opts) {
  const s = await fakeServer(mode);
  try { return { ...(await run(s.base, extra, opts)), hits: s.hits }; } finally { await new Promise((r) => s.server.close(r)); }
}
const reasons = (r) => r.report?.verdict?.reasons?.join(' | ') ?? r.stdout + r.stderr;

test('a clean run passes and every planned endpoint was really called', async () => {
  const r = await withServer();
  assert.equal(r.code, 0, reasons(r));
  assert.equal(r.report.verdict.pass, true);
  assert.equal(r.report.verdict.successfulLogins, 4);
  for (const ep of r.report.plan.endpoints) assert.ok(r.report.rows[ep.name].ok >= 1, ep.name);
});

test('the weekly upload runs once alongside the users and must succeed', async () => {
  const ok = await withServer(undefined, ['--upload', join(dir, 'weekly.xlsx')]);
  assert.equal(ok.code, 0, reasons(ok));
  assert.equal(ok.hits.get('/admin/doubleStop/weekly-upload'), 1);
  const bad = await withServer((p) => (p === '/admin/doubleStop/weekly-upload' ? { status: 500 } : undefined), ['--upload', join(dir, 'weekly.xlsx')]);
  assert.equal(bad.code, 1);
  assert.match(reasons(bad), /POST weekly upload: 0 successful/);
});

const failures = [
  ['driver logins answer 401', (p) => (p === '/driver/login' ? { status: 401, body: { errors: {} } } : undefined), /successful logins 1 of 4/],
  ['login answers 200 without a token', (p) => (p === '/driver/login' ? { body: { message: 'ok' } } : undefined), /successful logins 1 of 4/],
  ['login gives no driver id', (p) => (p === '/driver/login' ? { body: { accessToken: TOKEN, driver: {} } } : undefined), /successful logins 1 of 4/],
  ['admin login fails', (p) => (p === '/admin/login' ? { status: 403 } : undefined), /successful logins 3 of 4/],
  ['one read endpoint is missing (404)', (p) => (p === '/driver/payroll/balances' ? { status: 404 } : undefined), /GET \/driver\/payroll\/balances: 0 successful/],
  ['every read answers 500', (p) => (p.startsWith('/driver/') && p !== '/driver/login' ? { status: 500 } : undefined), /error rate/],
  ['a 200 that says success:false', (p) => (p === '/driver/availability' ? { body: { success: false } } : undefined), /GET \/driver\/availability: 0 successful/],
  ['a 200 that is not JSON', (p) => (p === '/driver/profile' ? { raw: '<html>gateway</html>' } : undefined), /GET \/driver\/profile: 0 successful/],
  ['a 200 with the wrong shape', (p) => (p.startsWith('/driver/deliveries') ? { body: { rows: [] } } : undefined), /GET \/driver\/deliveries\/:id: 0 successful/],
  ['the server rate-limits (429)', (p) => (p === '/driver/profile' ? { status: 429 } : undefined), /rate_limited/],
  ['an endpoint is too slow (timeout)', (p) => (p === '/admin/payroll/runs' ? { delayMs: 600 } : undefined), /timeout/],
];
for (const [name, mode, why] of failures) {
  test(`fails when ${name}`, async () => {
    const r = await withServer(mode);
    assert.equal(r.code, 1, `expected a failing verdict\n${r.stdout}${r.stderr}`);
    assert.equal(r.report.verdict.pass, false);
    assert.match(reasons(r), why);
  });
}

test('fails when the run is interrupted', async () => {
  const r = await withServer(undefined, ['--duration', '3'], { signalAfterMs: 700 });
  assert.equal(r.code, 1);
  assert.match(reasons(r), /did not finish/);
});

test('refuses to start without a healthy /healthz', async () => {
  const r = await withServer((p) => (p === '/healthz' ? { status: 404 } : undefined));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /healthz/);
});

test('refuses production hosts, shared accounts and too few accounts', async () => {
  const prod = await run('https://api.nasaroutes.com');
  assert.equal(prod.code, 2);
  assert.match(prod.stderr, /production/);
  const s = await fakeServer();
  try {
    const few = await run(s.base, ['--driver-vus', '5']);
    assert.equal(few.code, 2);
    assert.match(few.stderr, /5 accounts needed, 3 given/);
    const dup = await run(s.base, ['--drivers', join(dir, 'dupes.json'), '--driver-vus', '2']);
    assert.equal(dup.code, 2);
    assert.match(dup.stderr, /duplicate account/);
    assert.equal(s.hits.size, 0, 'nothing was sent when the runner refused');
  } finally { await new Promise((r) => s.server.close(r)); }
});

test('verdict: an idle run with no requests never passes', () => {
  const plan = { expectedLogins: 0, endpoints: [{ name: 'GET /x', minOk: 1 }], minRequests: 1, maxErrorRate: 0.01, completed: true };
  const v = verdict(summarise(createRecorder()), plan, { successfulLogins: 0 });
  assert.equal(v.pass, false);
  assert.match(v.reasons.join(' '), /GET \/x: 0 successful/);
  assert.match(v.reasons.join(' '), /only 0 requests/);
});

test('verdict: requests to an endpoint outside the plan are flagged', () => {
  const rec = createRecorder();
  rec.record('GET /x', 5, 200, 'ok');
  rec.record('GET /surprise', 5, 200, 'ok');
  const v = verdict(summarise(rec), { expectedLogins: 0, endpoints: [{ name: 'GET /x', minOk: 1 }], minRequests: 1, maxErrorRate: 0.01, completed: true }, { successfulLogins: 0 });
  assert.match(v.reasons.join(' '), /outside the plan: GET \/surprise/);
});

test('classify: only a 2xx with the expected body is ok', () => {
  assert.equal(classify({ status: 200, body: { status: 'ok' }, validator: 'health' }), 'ok');
  assert.equal(classify({ status: 204, body: undefined, validator: 'health' }), 'invalid_body');
  assert.equal(classify({ status: 302, body: {}, validator: 'object' }), 'http');
  assert.equal(classify({ status: 200, body: {}, validator: 'no-such-validator' }), 'invalid_body');
  assert.equal(classify({ status: 0, networkError: true }), 'network');
});

test('production guard: only the one staging name is allowed', () => {
  for (const h of ['https://api.nasaroutes.com', 'https://nasaroutes.com', 'https://API.NASAROUTES.COM', 'https://x.staging.nasaroutes.com', 'https://api.nasaroutes.com.']) {
    assert.throws(() => assertNotProduction(h), /production/, h);
  }
  assert.equal(assertNotProduction('https://api-staging.nasaroutes.com'), 'api-staging.nasaroutes.com');
  assert.equal(assertNotProduction('https://10.0.0.5'), '10.0.0.5');
  assert.throws(() => checkAccounts([{ email: 'a@x', password: '' }], 1, 'd'), /email and a password/);
});

test('the upload must report exactly the fixture totals', async () => {
  const extra = ['--upload', join(dir, 'weekly.xlsx'), '--upload-expect', join(dir, 'expect.json')];
  const ok = await withServer(undefined, extra);
  assert.equal(ok.code, 0, reasons(ok));
  assert.equal(ok.report.uploadCheck.recordsInserted.got, 2);
  const wrong = await withServer((p) => (p === '/admin/doubleStop/weekly-upload' ? { body: { success: true, data: { recordsProcessed: 10, recordsSkipped: 1, recordsInserted: 2 } } } : undefined), extra);
  assert.equal(wrong.code, 1);
  assert.match(reasons(wrong), /upload totals match fixture: 0 successful/);
});

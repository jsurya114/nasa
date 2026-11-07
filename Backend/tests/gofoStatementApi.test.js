import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import multer from 'multer';
import { requireRole } from '../middlewares/requireRole.js';
import { createStatementRouter } from '../services/finance/gofoStatement/router.js';
import { statementWorkbook } from './helpers/gofoStatementFixture.js';

// The owner-only statement routes: who may call them, what a bad file or request gets, and that each good request reaches the service once.
// No database: the real requireRole and a stand-in for the token check and for the service.
const calls = [];
const record = (name, result) => async (...args) => { calls.push([name, ...args.map((a) => (Buffer.isBuffer(a) ? 'file' : a))]); return typeof result === 'function' ? result(...args) : result; };
const makeService = (overrides = {}) => ({
  list: record('list', [{ id: '1' }]),
  preview: record('preview', { status: 'ready' }),
  publish: record('publish', { status: 'published', statementId: 9 }),
  unallocated: record('unallocated', [{ deliveryId: '1' }]),
  exportCsv: record('exportCsv', 'City,Billing week\r\nLafayette,Week 43\r\n'),
  unallocatedCsv: record('unallocatedCsv', 'Delivery ID\r\n1\r\n'),
  rematch: record('rematch', 2),
  void: record('void', true),
  ...overrides,
});
const makeApp = (service) => {
  const adminAuth = (req, res, next) => {
    const role = req.headers['x-test-role'];
    if (!role) return res.status(401).json({ message: 'UNAUTHORIZED' });
    req.admin = { id: 7, role };
    req.user = req.admin;
    return next();
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024, files: 1 } });
  const app = express();
  app.use('/admin/finance/gofo-statements', createStatementRouter({ adminAuth, requireRole, upload, service }));
  return app;
};
const send = async (app, method, path, { role = 'superadmin', body, file } = {}) => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const headers = role ? { 'x-test-role': role } : {};
    let payload;
    if (file) { payload = new FormData(); payload.append('file', new Blob([file.bytes]), file.name ?? 'statement.xlsx'); }
    else if (body !== undefined && method !== 'GET') { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/finance/gofo-statements${path}`, { method, headers, body: payload });
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, body: type.includes('json') ? await response.json() : await response.text(), cache: response.headers.get('cache-control'), type, disposition: response.headers.get('content-disposition') };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test('only the super admin may use the statement routes: no token, a city admin and a driver are refused before anything runs', async () => {
  calls.length = 0;
  const app = makeApp(makeService());
  const good = await statementWorkbook();
  const requests = [['GET', '/'], ['GET', '/export.csv'], ['GET', '/1/unallocated.csv'], ['POST', '/preview', { file: { bytes: good } }], ['POST', '/publish', { file: { bytes: good } }], ['GET', '/1/unallocated'], ['POST', '/1/rematch'], ['POST', '/1/void', { body: { reason: 'wrong week' } }]];
  for (const [method, path, extra] of requests) {
    assert.equal((await send(app, method, path, { ...extra, role: null })).status, 401, `${method} ${path} without a token`);
    for (const role of ['admin', 'driver']) {
      const answer = await send(app, method, path, { ...extra, role });
      assert.deepEqual([answer.status, answer.body], [403, { message: 'FORBIDDEN' }], `${method} ${path} as ${role}`);
    }
  }
  assert.deepEqual(calls, [], 'no service call ran for anyone who is not the super admin');
});

test('the owner can list, preview, publish, inspect, rematch and void; company figures are never cached', async () => {
  calls.length = 0;
  const app = makeApp(makeService());
  const file = { bytes: await statementWorkbook(), name: 'LFT week 43.xlsx' };
  const list = await send(app, 'GET', '/');
  assert.deepEqual([list.status, list.body, list.cache], [200, { statements: [{ id: '1' }] }, 'no-store']);
  assert.deepEqual((await send(app, 'POST', '/preview', { file })).body, { status: 'ready' });
  const published = await send(app, 'POST', '/publish', { file });
  assert.deepEqual([published.status, published.body.statementId], [201, 9]);
  assert.deepEqual((await send(app, 'GET', '/5/unallocated')).body, { unallocated: [{ deliveryId: '1' }] });
  assert.deepEqual((await send(app, 'POST', '/5/rematch')).body, { matched: 2 });
  assert.deepEqual((await send(app, 'POST', '/5/void', { body: { reason: ' uploaded for the wrong week ' } })).body, { voided: true });
  assert.deepEqual(calls.map((c) => c[0]), ['list', 'preview', 'publish', 'unallocated', 'rematch', 'void']);
  assert.equal(calls[2][2].user.id, 7, 'who published comes from the token');
  assert.equal(calls[2][2].sourceLabel, 'LFT week 43.xlsx');
  assert.equal(calls[5][2].reason, 'uploaded for the wrong week', 'the reason is trimmed');
});

test('the CSV exports are downloads for the owner, never cached and never sniffed, and a bad id is refused', async () => {
  calls.length = 0;
  const app = makeApp(makeService());
  const all = await send(app, 'GET', '/export.csv');
  assert.deepEqual([all.status, all.type, all.disposition, all.cache], [200, 'text/csv; charset=utf-8', 'attachment; filename="carrier-statements.csv"', 'no-store']);
  assert.equal(all.body, 'City,Billing week\r\nLafayette,Week 43\r\n');
  const one = await send(app, 'GET', '/5/unallocated.csv');
  assert.deepEqual([one.status, one.disposition], [200, 'attachment; filename="carrier-statement-5-unallocated.csv"']);
  assert.equal((await send(app, 'GET', '/x/unallocated.csv')).status, 400);
  assert.equal((await send(makeApp(makeService({ unallocatedCsv: async () => null })), 'GET', '/9/unallocated.csv')).status, 404);
  assert.deepEqual(calls.map((c) => c[0]), ['exportCsv', 'unallocatedCsv']);
});

test('each publish result gets its own status: a rejected statement 422, an older version 409, the same statement again 200', async () => {
  const file = { bytes: await statementWorkbook() };
  for (const [status, code] of [['rejected', 422], ['older_version', 409], ['already_published', 200], ['published', 201]]) {
    const answer = await send(makeApp(makeService({ publish: async () => ({ status }) })), 'POST', '/publish', { file });
    assert.deepEqual([answer.status, answer.body.status], [code, status]);
  }
});

test('a missing file, a file that is not a workbook and a too-large file are refused with nothing passed on', async () => {
  calls.length = 0;
  const app = makeApp(makeService());
  for (const path of ['/preview', '/publish']) {
    assert.equal((await send(app, 'POST', path, { body: {} })).status, 400, `${path} with no file`);
    const text = await send(app, 'POST', path, { file: { bytes: Buffer.from('not a workbook at all') } });
    assert.deepEqual([text.status, text.body.message], [400, 'This is not an Excel (.xlsx) file. Upload the statement as downloaded.']);
    const big = await send(app, 'POST', path, { file: { bytes: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100 * 1024)]) } });
    assert.deepEqual([big.status, big.body.message], [400, 'The file is too large for a statement.']);
  }
  assert.deepEqual(calls, []);
});

test('a bad id or a missing reason is refused, and an unknown or already-voided statement is answered, not guessed', async () => {
  calls.length = 0;
  const app = makeApp(makeService({ unallocated: async () => null, rematch: async () => null, void: async () => false }));
  for (const [method, path] of [['GET', '/abc/unallocated'], ['POST', '/1x/rematch'], ['POST', '/-1/void']]) {
    assert.equal((await send(app, method, path, { body: { reason: 'wrong week' } })).status, 400, `${method} ${path}`);
  }
  for (const reason of [undefined, '', '   ', 'no', 'x'.repeat(301), 5]) {
    assert.equal((await send(app, 'POST', '/1/void', { body: { reason } })).status, 400, `reason ${String(reason)}`);
  }
  assert.equal((await send(app, 'GET', '/9/unallocated')).status, 404);
  assert.equal((await send(app, 'POST', '/9/rematch')).status, 404);
  assert.equal((await send(app, 'POST', '/9/void', { body: { reason: 'wrong week' } })).status, 409);
  assert.deepEqual(calls.map((c) => c[0]), []);
});

test('an unexpected failure is answered safely, without internals', async () => {
  const app = makeApp(makeService({ list: async () => { throw Object.assign(new Error('relation "secret_table" does not exist'), { code: '42P01' }); } }));
  const answer = await send(app, 'GET', '/');
  assert.equal(answer.status, 500);
  assert.equal(JSON.stringify(answer.body).includes('secret_table'), false);
});

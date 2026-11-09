import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeConfig, readEvereeConfig } from '../services/payments/everee/evereeConfig.js';
import { createEvereeClient, EvereeError } from '../services/payments/everee/evereeClient.js';
import { checkEvereeConnection, getEvereeStatus } from '../services/payments/everee/evereeService.js';

// Made-up values only. No call leaves this machine: the network is replaced by a fake.
const SANDBOX = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' };
const superAdmin = { id: 1, role: 'superadmin' };
const cityAdmin = { id: 2, role: 'admin' };

const reply = (status, body, headers = { 'x-request-id': 'req-1' }) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => { if (body === undefined) throw new Error('no body'); return body; },
});
const fakeFetch = (handler) => {
  const calls = [];
  const fn = async (url, options) => { calls.push({ url, options }); return handler(url, options); };
  fn.calls = calls;
  return fn;
};

test('configuration: a sandbox token and tenant ID are accepted and described without the token', () => {
  const config = readEvereeConfig(SANDBOX);
  assert.equal(config.configured, true);
  assert.equal(config.environment, 'sandbox');
  assert.equal(config.baseUrl, 'https://api.everee.com');
  const shown = JSON.stringify(describeConfig(config));
  assert.ok(!shown.includes('tsk_test'), 'the token is never described');
  assert.deepEqual(describeConfig(config), { configured: true, environment: 'sandbox', tenantId: '4321', problems: [] });
});

test('configuration: missing or malformed settings are named, not guessed', () => {
  const none = readEvereeConfig({});
  assert.equal(none.configured, false);
  assert.ok(none.problems.some((p) => p.includes('EVEREE_API_TOKEN is not set')));
  assert.ok(none.problems.some((p) => p.includes('EVEREE_TENANT_ID is not set')));
  assert.ok(readEvereeConfig({ ...SANDBOX, EVEREE_TENANT_ID: 'abc' }).problems.some((p) => p.includes('numeric')));
  assert.ok(readEvereeConfig({ ...SANDBOX, EVEREE_API_TOKEN: 'sk_unmarked' }).problems.some((p) => p.includes('tsk_test_')));
  assert.ok(readEvereeConfig({ ...SANDBOX, EVEREE_ENVIRONMENT: 'staging' }).problems.some((p) => p.includes('"sandbox" or "production"')));
  assert.ok(readEvereeConfig({ ...SANDBOX, EVEREE_API_BASE_URL: 'http://evil.example' }).problems.some((p) => p.includes('https')));
  assert.equal(readEvereeConfig({ ...SANDBOX, EVEREE_API_BASE_URL: 'http://localhost:9999/' }).configured, true, 'a local address is allowed for tests');
});

test('configuration: a production token is refused unless production was asked for on purpose, and the two must match', () => {
  const prod = { EVEREE_API_TOKEN: 'tsk_prod_ABCDEF123456', EVEREE_TENANT_ID: '77' };
  const byDefault = readEvereeConfig(prod);
  assert.equal(byDefault.configured, false);
  assert.ok(byDefault.problems.some((p) => p.includes('token is for production') && p.includes('EVEREE_ENVIRONMENT is sandbox')));
  assert.equal(readEvereeConfig({ ...prod, EVEREE_ENVIRONMENT: 'production' }).configured, true);
  assert.equal(readEvereeConfig({ ...SANDBOX, EVEREE_ENVIRONMENT: 'production' }).configured, false, 'a sandbox token with production asked for does not match');
  for (const config of [byDefault, readEvereeConfig({ ...SANDBOX, EVEREE_ENVIRONMENT: 'production' })]) {
    assert.ok(!JSON.stringify(config.problems).includes('ABCDEF'), 'a problem never contains the token');
  }
});

test('client: sends the token as Basic auth, the tenant ID and JSON headers, and reads the request ID', async () => {
  const f = fakeFetch(() => reply(200, { items: [] }));
  const result = await createEvereeClient(readEvereeConfig(SANDBOX), { fetchImpl: f }).listPayCodes();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.everee.com/integration/v1/pay-codes');
  assert.equal(f.calls[0].options.method, 'GET');
  const headers = f.calls[0].options.headers;
  assert.equal(headers.Authorization, `Basic ${Buffer.from('tsk_test_ABCDEF123456:').toString('base64')}`);
  assert.equal(headers['x-everee-tenant-id'], '4321');
  assert.equal(headers.Accept, 'application/json');
  assert.equal(result.requestId, 'req-1');
});

test('client: a refusal becomes an EvereeError with the status and request ID, and never the token', async () => {
  const f = fakeFetch(() => reply(401, { errorMessage: 'bad token tsk_test_ABCDEF123456' }, { 'x-request-id': 'req-9' }));
  await assert.rejects(createEvereeClient(readEvereeConfig(SANDBOX), { fetchImpl: f }).listPayCodes(), (error) => {
    assert.ok(error instanceof EvereeError);
    assert.equal(error.status, 401);
    assert.equal(error.requestId, 'req-9');
    assert.ok(!error.message.includes('ABCDEF'), 'Everee\'s own text is not copied for a 401');
    return true;
  });
  const f2 = fakeFetch(() => reply(422, { errorMessage: 'Something specific', errorCode: 'E42' }));
  await assert.rejects(createEvereeClient(readEvereeConfig(SANDBOX), { fetchImpl: f2 }).get('/x'), (error) => error.status === 422 && error.code === 'E42' && error.message.includes('Something specific'));
});

test('client: a network failure or a timeout becomes an EvereeError', async () => {
  const down = fakeFetch(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(createEvereeClient(readEvereeConfig(SANDBOX), { fetchImpl: down }).get('/x'), (e) => e instanceof EvereeError && e.message === 'Everee could not be reached');
  const slow = fakeFetch(() => { const e = new Error('slow'); e.name = 'TimeoutError'; throw e; });
  await assert.rejects(createEvereeClient(readEvereeConfig(SANDBOX), { fetchImpl: slow }).get('/x'), (e) => e.message === 'Everee did not answer in time');
});

test('service: only a super admin may see the status or run the check', async () => {
  assert.equal(getEvereeStatus(superAdmin, { env: SANDBOX }).configured, true);
  assert.throws(() => getEvereeStatus(cityAdmin, { env: SANDBOX }), (e) => e.status === 403);
  const f = fakeFetch(() => reply(200, { items: [] }));
  await assert.rejects(checkEvereeConnection(cityAdmin, { env: SANDBOX, fetchImpl: f }), (e) => e.status === 403);
  assert.equal(f.calls.length, 0, 'a city admin makes no call to Everee');
});

test('service: without settings nothing is sent; with them the pay codes come back', async () => {
  const f = fakeFetch(() => reply(200, { items: [{ apiKey: 'CONTRACTOR_PAY', displayLabel: 'Contractor pay', payCodeType: 'EARNING' }, { apiKey: 'X', name: 'Old name shape' }] }));
  const missing = await checkEvereeConnection(superAdmin, { env: {}, fetchImpl: f });
  assert.equal(missing.ok, false);
  assert.equal(f.calls.length, 0);
  const ok = await checkEvereeConnection(superAdmin, { env: SANDBOX, fetchImpl: f });
  assert.equal(ok.ok, true);
  assert.equal(ok.environment, 'sandbox');
  assert.deepEqual(ok.payCodes, [{ code: 'CONTRACTOR_PAY', label: 'Contractor pay', type: 'EARNING' }, { code: 'X', label: 'Old name shape', type: null }]);
  assert.equal(ok.requestId, 'req-1');
});

test('service: the pay codes are read whether Everee answers with a plain list (as the sandbox does) or a page object', async () => {
  const plain = [{ payCodeType: 'TAXABLE_PAY', displayLabel: 'Contractor', apiKey: 'CONTRACTOR' }, { payCodeType: 'NON_TAXABLE_PAY', displayLabel: 'Reimbursement', apiKey: 'REIMBURSEMENT' }];
  const fromList = await checkEvereeConnection(superAdmin, { env: SANDBOX, fetchImpl: fakeFetch(() => reply(200, plain)) });
  assert.deepEqual(fromList.payCodes.map((p) => p.code), ['CONTRACTOR', 'REIMBURSEMENT']);
  assert.equal(fromList.payCodes[0].label, 'Contractor');
  const fromPage = await checkEvereeConnection(superAdmin, { env: SANDBOX, fetchImpl: fakeFetch(() => reply(200, { pageNumber: 0, items: plain })) });
  assert.equal(fromPage.payCodes.length, 2);
  const none = await checkEvereeConnection(superAdmin, { env: SANDBOX, fetchImpl: fakeFetch(() => reply(200, {})) });
  assert.deepEqual(none.payCodes, []);
});

test('service: Everee problems are answered in words, with the request ID, never thrown', async () => {
  const refused = await checkEvereeConnection(superAdmin, { env: SANDBOX, fetchImpl: fakeFetch(() => reply(401, {}, { 'x-request-id': 'req-401' })) });
  assert.deepEqual([refused.ok, refused.requestId], [false, 'req-401']);
  assert.ok(refused.reason.includes('refused the token'));
  const down = await checkEvereeConnection(superAdmin, { env: SANDBOX, fetchImpl: fakeFetch(() => { throw new TypeError('x'); }) });
  assert.equal(down.ok, false);
  assert.ok(!JSON.stringify(refused).includes('ABCDEF') && !JSON.stringify(down).includes('ABCDEF'), 'the token is never in an answer');
});

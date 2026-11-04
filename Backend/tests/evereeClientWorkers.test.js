import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEvereeConfig } from '../services/payments/everee/evereeConfig.js';
import { createEvereeClient } from '../services/payments/everee/evereeClient.js';
import logger from '../utils/logger.js';

const config = readEvereeConfig({ EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' });
const fakeFetch = () => {
  const calls = [];
  const fn = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, headers: { get: () => 'req-1' }, json: async () => ({ items: [] }) }; };
  fn.calls = calls;
  return fn;
};

test('the worker calls use the documented paths, encode what is sent, and add the same headers', async () => {
  const f = fakeFetch();
  const client = createEvereeClient(config, { fetchImpl: f });
  await client.searchWorkers('a+b@example.com');
  await client.getWorker('nasa sandbox/driver-1');
  await client.createContractor({ firstName: 'Test' });
  assert.equal(f.calls[0].url, 'https://api.everee.com/integration/v1/workers/search?term=a%2Bb%40example.com');
  assert.equal(f.calls[0].options.method, 'GET');
  assert.equal(f.calls[1].url, 'https://api.everee.com/integration/v1/workers/nasa%20sandbox%2Fdriver-1');
  assert.equal(f.calls[2].url, 'https://api.everee.com/integration/v1/workers/contractor');
  assert.equal(f.calls[2].options.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[2].options.body), { firstName: 'Test' });
  for (const call of f.calls) {
    assert.equal(call.options.headers['x-everee-tenant-id'], '4321');
    assert.ok(call.options.headers.Authorization.startsWith('Basic '));
  }
});

test('a failed worker search never writes the driver\'s email or phone to the log', async () => {
  const logged = [];
  const original = logger.warn;
  logger.warn = (...args) => logged.push(JSON.stringify(args));
  try {
    const refused = async () => ({ ok: false, status: 422, headers: { get: () => 'req-9' }, json: async () => ({ errorMessage: 'no' }) });
    const down = async () => { throw new TypeError('fetch failed'); };
    for (const fetchImpl of [refused, down]) {
      await assert.rejects(createEvereeClient(config, { fetchImpl }).searchWorkers('someone@example.com'));
      await assert.rejects(createEvereeClient(config, { fetchImpl }).searchWorkers('5551230001'));
    }
  } finally {
    logger.warn = original;
  }
  assert.equal(logged.length, 4);
  for (const line of logged) {
    assert.ok(!line.includes('someone@example.com') && !line.includes('5551230001') && !line.includes('term='), `the query string is not logged: ${line}`);
    assert.ok(line.includes('/integration/v1/workers/search'), 'the path without the query is');
  }
});

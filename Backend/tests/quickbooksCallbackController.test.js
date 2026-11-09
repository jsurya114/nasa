import test from 'node:test';
import assert from 'node:assert/strict';
import { getCallback } from '../controllers/payroll/quickbooksController.js';

// The QuickBooks sign-in return reaches the callback with no signed-in admin (req.admin is not set: the browser sends no login header). No database is touched: QuickBooks is not
// switched on in the test environment, so the service refuses before any query, and the answer is the callback's own short page.
const call = async (query) => {
  const out = { headers: {} };
  const res = {
    set(name, value) { out.headers[name] = value; return this; },
    status(code) { out.status = code; return this; },
    type(kind) { out.type = kind; return this; },
    send(body) { out.body = body; return this; },
  };
  await getCallback({ query }, res);
  return out;
};

test('the callback works without a signed-in admin and answers with a private page, not a crash', async () => {
  const saved = { ...process.env };
  for (const name of Object.keys(process.env)) if (name.startsWith('QUICKBOOKS_')) delete process.env[name];
  try {
    const out = await call({ code: 'abc', state: 'zzz', realmId: '12345678' });
    assert.equal(out.status, 409);
    assert.equal(out.type, 'html');
    assert.match(out.body, /QuickBooks was not connected/);
    assert.equal(out.headers['Cache-Control'], 'no-store');
    assert.equal(out.headers['Referrer-Policy'], 'no-referrer');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('a refused approval from QuickBooks is a 400 page that never echoes the query', async () => {
  const out = await call({ error: 'access_denied', state: '<script>x</script>' });
  assert.equal(out.status, 400);
  assert.doesNotMatch(out.body, /<script>x/);
});

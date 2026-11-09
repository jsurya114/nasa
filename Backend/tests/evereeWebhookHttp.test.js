import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { signPayload } from '../services/payments/everee/webhookSignature.js';

// The real route with the real raw-body parser (as app.js mounts them), over HTTP on a local port. Only paths that need no database are used here
// (refused signatures and refused events); the database paths are in evereeWebhook.test.js. Made-up key and company.
const KEY = 'whsec_test_key_not_a_real_one';
const SETTINGS = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_WEBHOOK_SIGNING_KEY: KEY };

test('the webhook route verifies the signature over the exact bytes received, before any database work', async (t) => {
  const saved = Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, process.env[k]]));
  Object.assign(process.env, SETTINGS);
  const { default: routes } = await import('../routes/evereeWebhookRoutes.js');
  const { default: pool } = await import('../config/db.js');
  const app = express();
  app.use('/webhooks/everee', express.raw({ type: () => true, limit: '256kb' }), routes);
  app.use(express.json()); // as in app.js: a route after the webhook may parse JSON, but not the webhook
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/webhooks/everee`;
  const post = (body, { key = KEY, at = Math.floor(Date.now() / 1000), contentType = 'application/json', sign = true } = {}) => fetch(url, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      ...(sign ? { 'x-everee-webhook-timestamp': String(at), 'x-everee-webhook-signature': `v1=${signPayload(key, at, Buffer.from(body))}` } : {}),
    },
    body,
  });
  try {
    await t.test('an unsigned or wrongly signed request is 401', async () => {
      assert.equal((await post('{"id":"e"}', { sign: false })).status, 401);
      assert.equal((await post('{"id":"e"}', { key: 'another key' })).status, 401);
      assert.equal((await post('{"id":"e"}', { at: 1000 })).status, 401, 'an old timestamp');
      assert.equal((await post('')).status, 401, 'an empty body');
    });

    await t.test('a correctly signed body reaches the checks after the signature, whatever its spacing or characters', async () => {
      const compact = '{"version":"1","id":"e1","companyId":9999,"type":"worker.created","timestamp":1,"data":{"object":{}}}';
      const spaced = '{ "version": "1",\n  "id": "e2", "companyId": 9999, "type": "worker.created",\n  "note": "naïve ✓ é", "data": { "object": {} } }\n';
      assert.equal((await post(compact)).status, 403, 'signature ok, but the event is for another company');
      assert.equal((await post(spaced)).status, 403, 'the same with odd whitespace and non-ASCII text: the bytes were not re-serialized');
      assert.equal((await post(spaced, { contentType: 'text/plain' })).status, 403, 'the content type does not matter');
      assert.equal((await post('not json')).status, 400, 'signed, but not an event');
    });

    await t.test('without the signing key set, nothing is accepted (503)', async () => {
      delete process.env.EVEREE_WEBHOOK_SIGNING_KEY;
      assert.equal((await post('{"id":"e"}')).status, 503);
      process.env.EVEREE_WEBHOOK_SIGNING_KEY = KEY;
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});

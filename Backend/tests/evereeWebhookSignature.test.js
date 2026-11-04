import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signPayload, verifySignature } from '../services/payments/everee/webhookSignature.js';

// Made-up key and bodies.
const KEY = 'whsec_test_key_not_a_real_one';
const NOW = 1_793_500_000;
const body = Buffer.from('{"version":"1","id":"evt_1","companyId":10,"type":"test-event.created","timestamp":1793500000,"data":{"object":{}}}');
const good = (extra = {}) => ({ rawBody: body, signatureHeader: `v1=${signPayload(KEY, NOW, body)}`, timestampHeader: String(NOW), key: KEY, nowSeconds: NOW, ...extra });

test('a correctly signed event is accepted', () => {
  assert.deepEqual(verifySignature(good()), { ok: true });
});

test('the signature covers the raw bytes exactly: one changed byte, even whitespace, is refused', () => {
  assert.equal(verifySignature(good({ rawBody: Buffer.from(`${body.toString()} `) })).reason, 'mismatch');
  assert.equal(verifySignature(good({ rawBody: Buffer.from(body.toString().replace('evt_1', 'evt_2')) })).reason, 'mismatch');
  const pretty = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2)); // the same JSON, re-serialized
  assert.equal(verifySignature(good({ rawBody: pretty })).reason, 'mismatch');
  const unicode = Buffer.from('{"id":"evt_é","note":"naïve ✓"}');
  assert.deepEqual(verifySignature({ ...good(), rawBody: unicode, signatureHeader: `v1=${signPayload(KEY, NOW, unicode)}` }), { ok: true });
});

test('a wrong key, a changed timestamp or a missing key is refused', () => {
  assert.equal(verifySignature(good({ key: 'another key' })).reason, 'mismatch');
  assert.equal(verifySignature(good({ timestampHeader: String(NOW + 1) })).reason, 'mismatch'); // signed for another timestamp
  assert.equal(verifySignature(good({ key: '' })).reason, 'no_key');
  assert.equal(verifySignature(good({ key: undefined })).reason, 'no_key');
});

test('an old or future timestamp is refused (replay), within 120 seconds is accepted', () => {
  const signedAt = (t) => ({ timestampHeader: String(t), signatureHeader: `v1=${signPayload(KEY, t, body)}` });
  assert.equal(verifySignature(good(signedAt(NOW - 121))).reason, 'stale');
  assert.equal(verifySignature(good(signedAt(NOW + 121))).reason, 'stale');
  assert.equal(verifySignature(good(signedAt(NOW - 120))).ok, true);
  assert.equal(verifySignature(good(signedAt(NOW + 120))).ok, true);
  assert.equal(verifySignature(good({ timestampHeader: 'yesterday' })).reason, 'bad_timestamp');
  assert.equal(verifySignature(good({ timestampHeader: undefined })).reason, 'bad_timestamp');
});

test('while a key is rotated two signatures arrive: either one may match; anything malformed is refused', () => {
  const real = signPayload(KEY, NOW, body);
  const old = signPayload('the old key', NOW, body);
  assert.equal(verifySignature(good({ signatureHeader: `v1=${old},v1=${real}` })).ok, true);
  assert.equal(verifySignature(good({ signatureHeader: `v1=${real}, v1=${old}` })).ok, true);
  assert.equal(verifySignature(good({ signatureHeader: `v1=${old}` })).reason, 'mismatch');
  assert.equal(verifySignature(good({ signatureHeader: `v2=${real}` })).reason, 'no_signature'); // only v1 is valid
  assert.equal(verifySignature(good({ signatureHeader: real })).reason, 'no_signature');
  assert.equal(verifySignature(good({ signatureHeader: undefined })).reason, 'no_signature');
  assert.equal(verifySignature(good({ signatureHeader: 'v1=zzzz' })).reason, 'mismatch');
  assert.equal(verifySignature(good({ signatureHeader: `v1=${real.slice(0, 40)}` })).reason, 'mismatch'); // a short one
});

test('an empty or non-bytes body is refused', () => {
  assert.equal(verifySignature(good({ rawBody: Buffer.alloc(0) })).reason, 'no_body');
  assert.equal(verifySignature(good({ rawBody: body.toString() })).reason, 'no_body');
  assert.equal(verifySignature(good({ rawBody: undefined })).reason, 'no_body');
});

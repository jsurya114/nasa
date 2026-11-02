import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isExpoPushToken, parseRegistration, parseRemoval } from '../services/push/pushTokenRules.js';

const TOKEN = (n) => `ExponentPushToken[token-number-${String(n).padStart(3, '0')}-abcdef]`;

test('only Expo push tokens are accepted', () => {
  assert.equal(isExpoPushToken(TOKEN(1)), true);
  assert.equal(isExpoPushToken('ExpoPushToken[abcdefghij-123_456]'), true);
  for (const bad of ['', 'abc', 'ExponentPushToken[]', 'ExponentPushToken[short]', `ExponentPushToken[${'a'.repeat(300)}]`,
    "ExponentPushToken[abc';drop table x;--]", 'ExponentPushToken[abcdefghij] ', null, undefined, 42, {}, ['ExponentPushToken[abcdefghij]']]) {
    assert.equal(isExpoPushToken(bad), false, String(bad));
  }
});

test('a registration needs a valid token and platform; the app version is optional but bounded', () => {
  assert.deepEqual(parseRegistration({ token: TOKEN(1), platform: 'ios', appVersion: '0.1.0' }),
    { token: TOKEN(1), platform: 'ios', appVersion: '0.1.0' });
  assert.equal(parseRegistration({ token: TOKEN(1), platform: 'android' }).appVersion, null);
  assert.ok(parseRegistration({ token: 'nope', platform: 'ios' }).error);
  assert.ok(parseRegistration({ token: TOKEN(1), platform: 'windows' }).error);
  assert.ok(parseRegistration({ token: TOKEN(1), platform: 'ios', appVersion: 'x'.repeat(33) }).error);
  assert.ok(parseRegistration({ token: TOKEN(1), platform: 'ios', appVersion: 3 }).error);
  assert.ok(parseRegistration(undefined).error);
});

test('a removal needs only a valid token', () => {
  assert.deepEqual(parseRemoval({ token: TOKEN(2) }), { token: TOKEN(2) });
  assert.ok(parseRemoval({}).error);
  assert.ok(parseRemoval(null).error);
});

// The rest needs a throwaway PostgreSQL database (never production). Run it with PUSH_TEST_DB=1 and the usual
// DB_USER, DB_HOST, DB_NAME, DB_PASSWORD and DB_PORT pointing at it. It applies the real migration file.
const hasDb = process.env.PUSH_TEST_DB === '1';
const dbTest = (name, fn) => test(name, { skip: !hasDb && 'set PUSH_TEST_DB=1 and the DB_* variables to run' }, fn);

let pool;
let queries;
let controllers;
let MAX_DEVICES;

const run = async (controller, handler, userId, body) => {
  const req = { body, driver: { id: userId }, user: { id: userId } };
  const out = {};
  const res = { status(code) { out.status = code; return this; }, json(payload) { out.body = payload; return this; } };
  await controller[handler](req, res, (err) => { throw err; });
  return out;
};
const active = async (userType, userId) =>
  (await pool.query(
    'SELECT push_token FROM device_tokens WHERE user_type = $1 AND user_id = $2 AND revoked_at IS NULL ORDER BY push_token',
    [userType, userId]
  )).rows.map((r) => r.push_token);

before(async () => {
  if (!hasDb) return;
  pool = (await import('../config/db.js')).default;
  queries = await import('../services/push/deviceTokenQueries.js');
  controllers = await import('../controllers/pushTokenController.js');
  MAX_DEVICES = queries.MAX_ACTIVE_DEVICES_PER_USER;
  const migration = readFileSync(fileURLToPath(new URL('../migrations/2026-11-02-issue-022-device-tokens.sql', import.meta.url)), 'utf8');
  await pool.query(migration);
  await pool.query(migration); // safe to run twice
  await pool.query('DELETE FROM device_tokens');
});

after(async () => {
  if (!hasDb) return;
  await pool.query('DELETE FROM device_tokens');
  await pool.end();
});

dbTest('registering twice keeps one row and refreshes it', async () => {
  const device = { userType: 'driver', userId: 1, token: TOKEN(10), platform: 'ios', appVersion: '0.1.0' };
  await queries.default.register(device);
  await queries.default.register({ ...device, appVersion: '0.2.0' });
  const { rows } = await pool.query('SELECT app_version FROM device_tokens WHERE push_token = $1', [TOKEN(10)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].app_version, '0.2.0');
});

dbTest('a phone moves to the next person who signs in on it', async () => {
  await queries.default.register({ userType: 'driver', userId: 2, token: TOKEN(20), platform: 'android', appVersion: null });
  await queries.default.register({ userType: 'admin', userId: 7, token: TOKEN(20), platform: 'android', appVersion: null });
  assert.deepEqual(await active('driver', 2), []);
  assert.deepEqual(await active('admin', 7), [TOKEN(20)]);
});

dbTest('a person keeps at most the allowed number of active phones; the oldest are switched off', async () => {
  for (let n = 0; n < MAX_DEVICES + 2; n++) {
    await queries.default.register({ userType: 'driver', userId: 3, token: TOKEN(30 + n), platform: 'ios', appVersion: null });
  }
  const mine = await active('driver', 3);
  assert.equal(mine.length, MAX_DEVICES);
  assert.ok(!mine.includes(TOKEN(30)) && !mine.includes(TOKEN(31)), 'the two oldest are off');
  assert.ok(mine.includes(TOKEN(30 + MAX_DEVICES + 1)), 'the newest is on');
});

dbTest('a person can switch off only their own phone', async () => {
  await queries.default.register({ userType: 'driver', userId: 4, token: TOKEN(40), platform: 'ios', appVersion: null });
  assert.equal(await queries.default.revoke({ userType: 'driver', userId: 5, token: TOKEN(40) }), 0);
  assert.equal(await queries.default.revoke({ userType: 'admin', userId: 4, token: TOKEN(40) }), 0);
  assert.deepEqual(await active('driver', 4), [TOKEN(40)]);
  assert.equal(await queries.default.revoke({ userType: 'driver', userId: 4, token: TOKEN(40) }), 1);
  assert.equal(await queries.default.revoke({ userType: 'driver', userId: 4, token: TOKEN(40) }), 0, 'already off');
  assert.deepEqual(await active('driver', 4), []);
});

dbTest('registering again switches a removed phone back on', async () => {
  await queries.default.register({ userType: 'driver', userId: 6, token: TOKEN(60), platform: 'ios', appVersion: null });
  await queries.default.revoke({ userType: 'driver', userId: 6, token: TOKEN(60) });
  await queries.default.register({ userType: 'driver', userId: 6, token: TOKEN(60), platform: 'ios', appVersion: null });
  assert.deepEqual(await active('driver', 6), [TOKEN(60)]);
});

dbTest('the driver endpoints refuse bad input and take the person from the token, not the body', async () => {
  let out = await run(controllers.driverPushTokens, 'register', 8, { token: 'bad', platform: 'ios' });
  assert.equal(out.status, 400);
  out = await run(controllers.driverPushTokens, 'register', 8, { token: TOKEN(80), platform: 'plan9' });
  assert.equal(out.status, 400);
  out = await run(controllers.driverPushTokens, 'register', 8, { token: TOKEN(80), platform: 'ios', userId: 999, user_id: 999, driver_id: 999 });
  assert.equal(out.status, 200);
  assert.deepEqual(await active('driver', 8), [TOKEN(80)]);
  assert.deepEqual(await active('driver', 999), []);
});

dbTest('the admin endpoints register for the admin and remove only that admin\'s phone', async () => {
  let out = await run(controllers.adminPushTokens, 'register', 9, { token: TOKEN(90), platform: 'android', appVersion: '0.1.0' });
  assert.equal(out.status, 200);
  assert.deepEqual(await active('admin', 9), [TOKEN(90)]);
  out = await run(controllers.adminPushTokens, 'remove', 10, { token: TOKEN(90) });
  assert.equal(out.status, 200, 'looks the same as success');
  assert.deepEqual(await active('admin', 9), [TOKEN(90)], 'another admin cannot remove it');
  out = await run(controllers.adminPushTokens, 'remove', 9, { token: TOKEN(90) });
  assert.equal(out.status, 200);
  assert.deepEqual(await active('admin', 9), []);
  out = await run(controllers.adminPushTokens, 'remove', 9, {});
  assert.equal(out.status, 400);
});

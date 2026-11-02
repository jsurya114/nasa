import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A registration that the phone's page gave up on (its 5 second timeout) can still reach the server after the
// removal that signing out sent behind it. The page cannot prevent that, so the server does: a registration whose
// access token was issued at or before the person's removal of that same phone is refused. These tests run the real
// register, revoke and controllers against a throwaway PostgreSQL database (never production): set PUSH_TEST_DB=1 and
// the usual DB_* variables. They apply the real migrations.
const hasDb = process.env.PUSH_TEST_DB === '1';
const dbTest = (name, fn) => test(name, { skip: !hasDb && 'set PUSH_TEST_DB=1 and the DB_* variables to run' }, fn);

const TOKEN = (n) => `ExponentPushToken[ordering-number-${String(n).padStart(3, '0')}-abcdef]`;
const OWN_TOKENS = "'ExponentPushToken[ordering-number-%'";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowSeconds = () => Math.floor(Date.now() / 1000);

let pool;
let queries;
let controllers;

const migrate = async (name) => {
  const sql = readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
  await pool.query(sql);
  await pool.query(sql); // safe to run twice
};
const clean = async () => {
  await pool.query(`DELETE FROM device_tokens WHERE push_token LIKE ${OWN_TOKENS}`);
  await pool.query(`DELETE FROM device_token_removals WHERE push_token LIKE ${OWN_TOKENS}`);
};
const owner = async (token) =>
  (await pool.query('SELECT user_type, user_id, revoked_at FROM device_tokens WHERE push_token = $1', [token])).rows[0] ?? null;
const isOn = async (token) => {
  const row = await owner(token);
  return Boolean(row) && row.revoked_at === null;
};
const phone = (userId, token, issuedAt, userType = 'driver') => ({ userType, userId, token, platform: 'ios', appVersion: null, issuedAt });

// A database handle whose connection arrives late: the registration is still "on its way" while other requests run.
const lateBy = (ms) => ({ connect: async () => { await sleep(ms); return pool.connect(); } });

before(async () => {
  if (!hasDb) return;
  pool = (await import('../config/db.js')).default;
  queries = (await import('../services/push/deviceTokenQueries.js')).default;
  controllers = await import('../controllers/pushTokenController.js');
  await migrate('2026-11-02-issue-022-device-tokens.sql');
  await migrate('2026-11-02-issue-022-device-token-removals.sql');
  await clean();
});

after(async () => {
  if (!hasDb) return;
  await clean();
  await pool.end();
});

dbTest('a registration that reaches the server after the removal of the same phone is refused', async () => {
  const signedIn = nowSeconds() - 60;
  assert.equal((await queries.register(phone(1, TOKEN(1), signedIn))).registered, true);
  await queries.revoke({ userType: 'driver', userId: 1, token: TOKEN(1) });
  assert.equal(await isOn(TOKEN(1)), false);

  const late = await queries.register(phone(1, TOKEN(1), signedIn));
  assert.deepEqual(late, { registered: false, reason: 'stale' });
  assert.equal(await isOn(TOKEN(1)), false, 'the phone stays off');
});

dbTest('the page timed out, the removal committed first, and the registration only gets its turn afterwards', async () => {
  const signedIn = nowSeconds() - 60;
  // The registration was sent first but is slow to get a connection (the page already gave up on it)
  const slow = queries.register(phone(2, TOKEN(2), signedIn), lateBy(200));
  await sleep(30);
  await queries.revoke({ userType: 'driver', userId: 2, token: TOKEN(2) }); // sign-out's removal, answered at once
  const outcome = await slow;
  assert.equal(outcome.registered, false);
  assert.equal(await isOn(TOKEN(2)), false);
});

dbTest('the registration committed first and the removal comes right behind it: the phone ends off', async () => {
  const signedIn = nowSeconds() - 60;
  const first = queries.register(phone(3, TOKEN(3), signedIn));
  const second = queries.revoke({ userType: 'driver', userId: 3, token: TOKEN(3) });
  await Promise.all([first, second]);
  assert.equal(await isOn(TOKEN(3)), false);
});

dbTest('a removal and a registration in flight together never leave the phone on, whichever gets in first', async () => {
  const signedIn = nowSeconds() - 60;
  for (let round = 0; round < 8; round++) {
    const token = TOKEN(40 + round);
    await queries.register(phone(4, token, signedIn));
    await Promise.all([
      queries.register(phone(4, token, signedIn)),
      queries.revoke({ userType: 'driver', userId: 4, token }),
      queries.register(phone(4, token, signedIn)),
    ].map((p) => p.catch(() => {})));
    // Registration, removal and a second registration ran in some order. A registration that came after the removal
    // is refused, and one that came before it is switched off by it, so every order ends the same way.
    assert.equal(await isOn(token), false, `round ${round}: the phone is on after a removal`);
  }
});

dbTest('a token issued in the same second as the removal is refused, one issued a second later is not', async () => {
  await queries.register(phone(15, TOKEN(15), nowSeconds() - 60));
  await queries.revoke({ userType: 'driver', userId: 15, token: TOKEN(15) });
  const { rows } = await pool.query(
    `SELECT floor(extract(epoch FROM removed_at))::bigint AS second FROM device_token_removals WHERE push_token = $1`,
    [TOKEN(15)]
  );
  const second = Number(rows[0].second);
  assert.equal((await queries.register(phone(15, TOKEN(15), second))).registered, false);
  assert.equal((await queries.register(phone(15, TOKEN(15), second - 5))).registered, false);
  assert.equal((await queries.register(phone(15, TOKEN(15), second + 1))).registered, true);
});

dbTest('signing in again after the removal registers the phone: the new access token is newer than the removal', async () => {
  const before = nowSeconds() - 60;
  await queries.register(phone(5, TOKEN(5), before));
  await queries.revoke({ userType: 'driver', userId: 5, token: TOKEN(5) });
  await sleep(1100); // access tokens are stamped in whole seconds, and a person cannot sign in again within one
  const again = await queries.register(phone(5, TOKEN(5), nowSeconds()));
  assert.equal(again.registered, true);
  assert.equal(await isOn(TOKEN(5)), true);
});

dbTest('account switch: the first person\'s late registration cannot take the phone back from the next person', async () => {
  const aSignedIn = nowSeconds() - 120;
  await queries.register(phone(6, TOKEN(6), aSignedIn)); // A, driver 6
  await queries.revoke({ userType: 'driver', userId: 6, token: TOKEN(6) }); // A signs out
  await sleep(1100);
  await queries.register(phone(7, TOKEN(6), nowSeconds())); // B, driver 7, signs in on the same phone
  assert.deepEqual(await owner(TOKEN(6)), { user_type: 'driver', user_id: 7, revoked_at: null });

  const late = await queries.register(phone(6, TOKEN(6), aSignedIn)); // A's registration finally arrives
  assert.equal(late.registered, false);
  assert.deepEqual(await owner(TOKEN(6)), { user_type: 'driver', user_id: 7, revoked_at: null }, 'B keeps it');
});

dbTest('the first person\'s removal arriving after the next person registered does not switch the phone off for them', async () => {
  const aSignedIn = nowSeconds() - 120;
  await queries.register(phone(8, TOKEN(8), aSignedIn));
  await sleep(1100);
  await queries.register(phone(9, TOKEN(8), nowSeconds())); // B takes the phone
  assert.equal(await queries.revoke({ userType: 'driver', userId: 8, token: TOKEN(8) }), 0); // A's late removal
  assert.equal(await isOn(TOKEN(8)), true);
  assert.equal((await queries.register(phone(8, TOKEN(8), aSignedIn))).registered, false, 'and A is still refused');
  assert.equal((await owner(TOKEN(8))).user_id, 9);
});

dbTest('a removal only affects that person: another area or person on the same phone registers normally', async () => {
  const signedIn = nowSeconds() - 60;
  await queries.register(phone(10, TOKEN(10), signedIn, 'driver'));
  await queries.revoke({ userType: 'driver', userId: 10, token: TOKEN(10) });
  assert.equal((await queries.register(phone(10, TOKEN(11), signedIn, 'admin'))).registered, true, 'admin 10, another phone token');
  assert.equal((await queries.register(phone(10, TOKEN(10), signedIn, 'admin'))).registered, true, 'admin 10, the same token');
  assert.equal((await queries.register(phone(11, TOKEN(10), signedIn, 'driver'))).registered, true, 'driver 11, the same token');
});

dbTest('a registration with no issue time cannot be compared, and keeps working as before', async () => {
  await queries.register(phone(12, TOKEN(12), undefined));
  await queries.revoke({ userType: 'driver', userId: 12, token: TOKEN(12) });
  assert.equal((await queries.register(phone(12, TOKEN(12), undefined))).registered, true);
});

dbTest('removals are forgotten after a day: an access token lasts minutes, so older ones could not matter', async () => {
  await pool.query(
    `INSERT INTO device_token_removals (user_type, user_id, push_token, removed_at) VALUES ('driver', 13, $1, now() - interval '2 days')`,
    [TOKEN(13)]
  );
  await queries.revoke({ userType: 'driver', userId: 14, token: TOKEN(14) });
  const left = await pool.query('SELECT 1 FROM device_token_removals WHERE push_token = $1', [TOKEN(13)]);
  assert.equal(left.rowCount, 0);
  const recorded = await pool.query('SELECT 1 FROM device_token_removals WHERE push_token = $1', [TOKEN(14)]);
  assert.equal(recorded.rowCount, 1, 'a removal for a phone that was never registered is still recorded');
});

dbTest('the endpoints take the issue time from the verified token and answer a refused registration with 409', async () => {
  const call = async (controller, handler, req) => {
    const out = {};
    const res = { status(code) { out.status = code; return this; }, json(payload) { out.body = payload; return this; } };
    await controller[handler](req, res, (err) => { throw err; });
    return out;
  };
  const issued = nowSeconds() - 60;
  const body = { token: TOKEN(20), platform: 'android' };

  assert.equal((await call(controllers.driverPushTokens, 'register', { body, driver: { id: 20, iat: issued } })).status, 200);
  assert.equal((await call(controllers.driverPushTokens, 'remove', { body: { token: TOKEN(20) }, driver: { id: 20, iat: issued } })).status, 200);
  const late = await call(controllers.driverPushTokens, 'register', { body, driver: { id: 20, iat: issued } });
  assert.equal(late.status, 409);
  assert.equal(await isOn(TOKEN(20)), false);

  const adminBody = { token: TOKEN(21), platform: 'ios' };
  assert.equal((await call(controllers.adminPushTokens, 'register', { body: adminBody, user: { id: 21, iat: issued } })).status, 200);
  await call(controllers.adminPushTokens, 'remove', { body: { token: TOKEN(21) }, user: { id: 21, iat: issued } });
  assert.equal((await call(controllers.adminPushTokens, 'register', { body: adminBody, user: { id: 21, iat: issued } })).status, 409);
  assert.equal(await isOn(TOKEN(21)), false);
  // A body cannot move the issue time
  const forged = await call(controllers.adminPushTokens, 'register', {
    body: { ...adminBody, issuedAt: nowSeconds() + 1000, iat: nowSeconds() + 1000 }, user: { id: 21, iat: issued },
  });
  assert.equal(forged.status, 409);
});

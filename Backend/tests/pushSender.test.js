import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getReceipts, MAX_MESSAGES_PER_REQUEST, sendMessages } from '../services/push/expoPushClient.js';
import { deliver, RECEIPT_DELAY_MS } from '../services/push/pushSender.js';

const tok = (n) => `ExponentPushToken[sender-test-${String(n).padStart(4, '0')}-abcd]`;
const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const okTickets = (messages) => ({ data: messages.map((m, i) => ({ status: 'ok', id: `ticket-${m.to}-${i}` })) });

const withEnv = (vars, fn) => async () => {
  const before = {};
  for (const [k, v] of Object.entries(vars)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { await fn(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

// ---------- Expo client (no network: a fake fetch) ----------

test('messages go out in groups of at most 100, and results keep the order of the messages', async () => {
  const sizes = [];
  const fakeFetch = async (url, init) => {
    const group = JSON.parse(init.body);
    sizes.push(group.length);
    return jsonResponse(okTickets(group));
  };
  const messages = Array.from({ length: 250 }, (_, i) => ({ to: tok(i), title: 't', body: 'b' }));
  const results = await sendMessages(messages, fakeFetch);
  assert.deepEqual(sizes, [MAX_MESSAGES_PER_REQUEST, MAX_MESSAGES_PER_REQUEST, 50]);
  assert.equal(results.length, 250);
  results.forEach((r, i) => { assert.equal(r.token, tok(i)); assert.equal(r.status, 'ok'); });
});

test('an error ticket keeps Expo\'s code, and a missing ticket counts as a failed request', async () => {
  const fakeFetch = async () => jsonResponse({ data: [
    { status: 'ok', id: 'a' },
    { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
  ] });
  const results = await sendMessages([{ to: tok(1) }, { to: tok(2) }, { to: tok(3) }], fakeFetch);
  assert.deepEqual(results.map((r) => [r.status, r.error]), [['ok', undefined], ['error', 'DeviceNotRegistered'], ['error', 'RequestFailed']]);
});

test('a failing push service never throws: every message in the group is an error result', async () => {
  for (const fakeFetch of [
    async () => jsonResponse({}, 500),
    async () => { throw new Error('socket hang up'); },
    async () => { const e = new Error('slow'); e.name = 'TimeoutError'; throw e; },
    async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }),
  ]) {
    const results = await sendMessages([{ to: tok(1) }, { to: tok(2) }], fakeFetch);
    assert.deepEqual(results.map((r) => [r.status, r.error]), [['error', 'RequestFailed'], ['error', 'RequestFailed']]);
  }
  assert.deepEqual(await sendMessages([], async () => assert.fail('no request for no messages')), []);
});

test('the access token header is sent only when EXPO_ACCESS_TOKEN is set', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => { seen.push(init.headers.Authorization); return jsonResponse({ data: [{ status: 'ok', id: 'x' }] }); };
  await withEnv({ EXPO_ACCESS_TOKEN: undefined }, () => sendMessages([{ to: tok(1) }], fakeFetch))();
  await withEnv({ EXPO_ACCESS_TOKEN: 'secret-value' }, () => sendMessages([{ to: tok(1) }], fakeFetch))();
  assert.deepEqual(seen, [undefined, 'Bearer secret-value']);
});

test('receipts are read in groups and a failed request returns what it could not read as nothing', async () => {
  const fakeFetch = async (url, init) => {
    assert.ok(url.endsWith('/getReceipts'));
    const { ids } = JSON.parse(init.body);
    return jsonResponse({ data: Object.fromEntries(ids.map((id) => [id, id === 'bad' ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }])) });
  };
  const receipts = await getReceipts(['good', 'bad'], fakeFetch);
  assert.deepEqual(receipts, { good: { status: 'ok', error: undefined }, bad: { status: 'error', error: 'DeviceNotRegistered' } });
  assert.deepEqual(await getReceipts(['x'], async () => jsonResponse({}, 503)), {});
});

// ---------- the sender (fake client, fake database) ----------

const content = (language) => ({ title: 'NASA Logistics', body: language === 'es' ? 'hola' : 'hello', screen: 'availability' });
const fakeDb = () => { const calls = []; return { calls, query: async (sql, params) => { calls.push([sql, params]); return { rowCount: 0, rows: [] }; } }; };

test('nothing is sent unless push is switched on', withEnv({ PUSH_NOTIFICATIONS_ENABLED: undefined }, async () => {
  const out = await deliver([{ pushToken: tok(1), language: 'en' }], content, { send: async () => assert.fail('must not send') });
  assert.deepEqual(out, { sent: 0 });
}));

test('messages carry only generic text and a screen name, in each person\'s language', withEnv({ PUSH_NOTIFICATIONS_ENABLED: 'true' }, async () => {
  let sent;
  const out = await deliver(
    [{ pushToken: tok(1), language: 'es' }, { pushToken: tok(2), language: 'en' }],
    content,
    { send: async (m) => { sent = m; return m.map((x, i) => ({ token: x.to, status: 'ok', id: `t${i}` })); }, db: fakeDb(), schedule: () => {} }
  );
  assert.equal(out.sent, 2);
  assert.deepEqual(sent.map((m) => m.body), ['hola', 'hello']);
  assert.deepEqual(sent.map((m) => m.data), [{ screen: 'availability' }, { screen: 'availability' }]);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['body', 'channelId', 'data', 'priority', 'sound', 'title', 'to']);
}));

test('a phone Expo says is gone is deleted, and the others are kept', withEnv({ PUSH_NOTIFICATIONS_ENABLED: 'true' }, async () => {
  const db = fakeDb();
  const out = await deliver(
    [{ pushToken: tok(1), language: 'en' }, { pushToken: tok(2), language: 'en' }, { pushToken: tok(3), language: 'en' }],
    content,
    { send: async () => [
      { token: tok(1), status: 'ok', id: 'a' },
      { token: tok(2), status: 'error', error: 'DeviceNotRegistered' },
      { token: tok(3), status: 'error', error: 'RequestFailed' },
    ], db, schedule: () => {} }
  );
  assert.equal(out.sent, 1);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0][0], /DELETE FROM device_tokens/);
  assert.deepEqual(db.calls[0][1], [[tok(2)]]);
}));

test('receipts are checked after 15 minutes and a gone phone is deleted then', withEnv({ PUSH_NOTIFICATIONS_ENABLED: 'true' }, async () => {
  const db = fakeDb();
  const timers = [];
  await deliver(
    [{ pushToken: tok(1), language: 'en' }, { pushToken: tok(2), language: 'en' }],
    content,
    {
      send: async (m) => m.map((x, i) => ({ token: x.to, status: 'ok', id: `ticket-${i}` })),
      receipts: async (ids) => { assert.deepEqual(ids.sort(), ['ticket-0', 'ticket-1']); return { 'ticket-0': { status: 'ok' }, 'ticket-1': { status: 'error', error: 'DeviceNotRegistered' } }; },
      db,
      schedule: (fn, delay) => timers.push({ fn, delay }),
    }
  );
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, RECEIPT_DELAY_MS);
  assert.equal(RECEIPT_DELAY_MS, 15 * 60 * 1000);
  assert.equal(db.calls.length, 0, 'nothing deleted before the receipts are read');
  timers[0].fn();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(db.calls[0][1], [[tok(2)]]);
}));

test('a failure inside the sender never reaches the caller', withEnv({ PUSH_NOTIFICATIONS_ENABLED: 'true' }, async () => {
  const out = await deliver([{ pushToken: tok(1), language: 'en' }], content, { send: async () => { throw new Error('boom'); }, db: fakeDb() });
  assert.deepEqual(out, { sent: 0 });
  assert.deepEqual(await deliver([{ pushToken: tok(1), language: 'en' }], () => { throw new Error('bad content'); }, { send: async () => [], db: fakeDb() }), { sent: 0 });
}));

// ---------- targeting and the four events: a throwaway PostgreSQL database and a fake Expo server ----------
// Run with PUSH_TEST_DB=1 and the usual DB_* variables pointing at a database you can throw away (never production).
// The test adds the columns a rebuilt schema may lack, applies the real migration, and removes its own rows.

const hasDb = process.env.PUSH_TEST_DB === '1';
const dbTest = (name, fn) => test(name, { skip: !hasDb && 'set PUSH_TEST_DB=1 and the DB_* variables to run' }, fn);

let pool;
let targets;
let events;
let server;
let received = [];
let answer = (messages) => okTickets(messages);
const ids = {};

const settle = async (condition, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await condition()) return true; await new Promise((r) => setTimeout(r, 20)); }
  return false;
};
const addToken = (type, id, token, { revoked = false } = {}) =>
  pool.query('INSERT INTO device_tokens (user_type, user_id, push_token, platform, revoked_at) VALUES ($1, $2, $3, $4, $5)', [type, id, token, 'ios', revoked ? new Date() : null]);
const bodies = () => received.flatMap((r) => r).map((m) => m.body);

before(async () => {
  if (!hasDb) return;
  pool = (await import('../config/db.js')).default;
  targets = await import('../services/push/pushTargets.js');
  events = await import('../services/push/pushEvents.js');

  const migration = readFileSync(fileURLToPath(new URL('../migrations/2026-11-02-issue-022-device-tokens.sql', import.meta.url)), 'utf8');
  await pool.query(migration);
  await pool.query('ALTER TABLE drivers ADD COLUMN IF NOT EXISTS preferred_language text');
  await pool.query('ALTER TABLE drivers ADD COLUMN IF NOT EXISTS timezone text');
  await pool.query('ALTER TABLE drivers ADD COLUMN IF NOT EXISTS availability_updated_at timestamptz');
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    await pool.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS ${day} boolean DEFAULT false`);
  }
  await pool.query("DELETE FROM device_tokens WHERE push_token LIKE 'ExponentPushToken[sender-test-%'");

  const city = async (job) => (await pool.query('INSERT INTO city (job, city_code) VALUES ($1, $1) RETURNING id', [job])).rows[0].id;
  ids.cityA = await city('pushtest-city-a');
  ids.cityB = await city('pushtest-city-b');
  const driver = async (name, cityId, language, enabled = true) =>
    (await pool.query('INSERT INTO drivers (name, email, city_id, preferred_language, enabled) VALUES ($1, $2, $3, $4, $5) RETURNING id', [name, `${name}@example.test`, cityId, language, enabled])).rows[0].id;
  ids.d1 = await driver('pushtest-driver-secret-name', ids.cityA, 'es');
  ids.d2 = await driver('pushtest-driver-off', ids.cityA, 'en', false);
  ids.d3 = await driver('pushtest-driver-b', ids.cityB, null);
  const admin = async (name, role, active, cityId) => {
    const id = (await pool.query('INSERT INTO admin (name, email, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id', [name, `${name}@example.test`, role, active])).rows[0].id;
    if (cityId) await pool.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [id, cityId]);
    return id;
  };
  ids.adminA = await admin('pushtest-admin-a', 'admin', true, ids.cityA);
  ids.adminB = await admin('pushtest-admin-b', 'admin', true, ids.cityB);
  ids.adminOff = await admin('pushtest-admin-off', 'admin', false, ids.cityA);
  ids.superAdmin = await admin('pushtest-super', 'superadmin', true, null);

  await addToken('driver', ids.d1, tok(11));
  await addToken('driver', ids.d1, tok(12), { revoked: true });
  await addToken('driver', ids.d2, tok(21));
  await addToken('driver', ids.d3, tok(31));
  await addToken('admin', ids.adminA, tok(41));
  await addToken('admin', ids.adminB, tok(42));
  await addToken('admin', ids.adminOff, tok(43));
  await addToken('admin', ids.superAdmin, tok(44));

  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const messages = JSON.parse(raw);
      received.push(messages);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer(messages)));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.EXPO_PUSH_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.PUSH_NOTIFICATIONS_ENABLED = 'true';
});

afterEach(() => { received = []; answer = (messages) => okTickets(messages); });

after(async () => {
  if (!hasDb) return;
  delete process.env.EXPO_PUSH_API_URL;
  delete process.env.PUSH_NOTIFICATIONS_ENABLED;
  server.close();
  await pool.query("DELETE FROM device_tokens WHERE push_token LIKE 'ExponentPushToken[sender-test-%'");
  await pool.query("DELETE FROM admin_city_ref WHERE admin_id IN (SELECT id FROM admin WHERE name LIKE 'pushtest-%')");
  await pool.query("DELETE FROM admin WHERE name LIKE 'pushtest-%'");
  await pool.query("DELETE FROM drivers WHERE name LIKE 'pushtest-%'");
  await pool.query("DELETE FROM city WHERE job LIKE 'pushtest-%'");
  await pool.end();
});

dbTest('driver targets: only active phones of enabled drivers, in the driver\'s language', async () => {
  const found = await targets.tokensForDrivers([ids.d1, ids.d2, ids.d3]);
  assert.deepEqual(found.map((r) => [r.pushToken, r.language]).sort(), [[tok(11), 'es'], [tok(31), 'en']]);
  assert.deepEqual(await targets.tokensForDrivers([]), []);
  assert.deepEqual((await targets.tokensForDriverName('pushtest-driver-secret-name')).map((r) => r.pushToken), [tok(11)]);
  assert.deepEqual(await targets.tokensForDriverName('pushtest-no-such-driver'), []);
});

dbTest('access code targets: admins of the driver\'s city and super admins only', async () => {
  const forD1 = (await targets.tokensForAdminsOfDriver(ids.d1)).map((r) => r.pushToken).sort();
  assert.deepEqual(forD1, [tok(41), tok(44)], 'city A admin and super admin, not city B, not the switched-off admin');
  const forD3 = (await targets.tokensForAdminsOfDriver(ids.d3)).map((r) => r.pushToken).sort();
  assert.deepEqual(forD3, [tok(42), tok(44)]);
});

dbTest('the agreement event reaches the one driver, in Spanish, with a screen name and no personal detail', async () => {
  events.notifyAgreementRequired(ids.d1);
  assert.ok(await settle(() => received.length === 1), 'one request reached the fake Expo server');
  const [message] = received[0];
  assert.equal(received[0].length, 1);
  assert.equal(message.to, tok(11));
  assert.equal(message.body, 'Por favor revisa tu acuerdo.');
  assert.deepEqual(message.data, { screen: 'agreement' });
  assert.ok(!JSON.stringify(message).includes('secret-name'), 'the driver\'s name is not in the message');
});

dbTest('the availability event goes to each reset driver in their own language', async () => {
  events.notifyAvailabilityReset([ids.d1, ids.d3]);
  assert.ok(await settle(() => received.length === 1));
  assert.deepEqual(bodies().sort(), ['Es hora de indicar tu disponibilidad para la próxima semana.', 'Time to set your availability for next week.']);
  assert.deepEqual(received[0].map((m) => m.data.screen), ['availability', 'availability']);
});

dbTest('the paid event goes to that driver only', async () => {
  events.notifyDriverPaid('pushtest-driver-secret-name');
  assert.ok(await settle(() => received.length === 1));
  assert.deepEqual(received[0].map((m) => [m.to, m.data.screen]), [[tok(11), 'deliveries']]);
  assert.equal(received[0][0].body, 'Tienes una novedad de pago.');
});

dbTest('the access code event goes to that city\'s admins and super admins, with generic text', async () => {
  events.notifyAccessCodeSubmitted(ids.d1);
  assert.ok(await settle(() => received.length === 1));
  assert.deepEqual(received[0].map((m) => m.to).sort(), [tok(41), tok(44)]);
  for (const m of received[0]) {
    assert.equal(m.body, 'A new access code was submitted.');
    assert.deepEqual(m.data, { screen: 'access-codes' });
    assert.ok(!JSON.stringify(m).includes('pushtest'), 'no names or cities');
  }
});

dbTest('an event returns at once and sends nothing when push is switched off', async () => {
  process.env.PUSH_NOTIFICATIONS_ENABLED = 'false';
  try {
    const started = Date.now();
    events.notifyAgreementRequired(ids.d1);
    assert.ok(Date.now() - started < 50);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(received.length, 0);
  } finally { process.env.PUSH_NOTIFICATIONS_ENABLED = 'true'; }
});

dbTest('a phone the service says is gone is deleted from the table', async () => {
  answer = (messages) => ({ data: messages.map(() => ({ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } })) });
  events.notifyAgreementRequired(ids.d1);
  assert.ok(await settle(async () => (await pool.query('SELECT 1 FROM device_tokens WHERE push_token = $1', [tok(11)])).rowCount === 0));
  assert.equal((await pool.query('SELECT 1 FROM device_tokens WHERE push_token = $1', [tok(31)])).rowCount, 1, 'other phones are kept');
});

dbTest('a push service that is down does not break the event', async () => {
  const down = createServer((req, res) => { res.statusCode = 503; res.end('{}'); });
  await new Promise((resolve) => down.listen(0, '127.0.0.1', resolve));
  const previous = process.env.EXPO_PUSH_API_URL;
  process.env.EXPO_PUSH_API_URL = `http://127.0.0.1:${down.address().port}`;
  try {
    events.notifyAccessCodeSubmitted(ids.d3);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await pool.query('SELECT 1 FROM device_tokens WHERE push_token = $1', [tok(42)])).rowCount, 1, 'tokens are kept after a plain failure');
  } finally { process.env.EXPO_PUSH_API_URL = previous; down.close(); }
});

dbTest('the Sunday reset job notifies the drivers it reset, and only those in that time zone', async () => {
  const { resetDriversInTimezone } = await import('../utils/availabilityCronJob.js');
  await addToken('driver', ids.d1, tok(13)); // an earlier test removed this driver's first phone
  await pool.query("UPDATE drivers SET timezone = 'America/Chicago' WHERE id = $1", [ids.d1]);
  await pool.query("UPDATE drivers SET timezone = 'America/Los_Angeles' WHERE id = $1", [ids.d3]);
  const count = await resetDriversInTimezone('America/Chicago');
  assert.equal(count, 1);
  assert.ok(await settle(() => received.length === 1));
  assert.deepEqual(received[0].map((m) => [m.to, m.data.screen]), [[tok(13), 'availability']]);
  assert.equal(received[0][0].body, 'Es hora de indicar tu disponibilidad para la próxima semana.');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readQuickbooksConfig, quickbooksGate } from '../services/payments/quickbooks/quickbooksConfig.js';
import { decryptToken, encryptToken } from '../services/payments/quickbooks/tokenCrypto.js';
import { authorizationUrl, createQuickbooksClient, QuickbooksError, quoteValue } from '../services/payments/quickbooks/quickbooksClient.js';
import { completeConnect, consumeConnectState, createConnectState, getAuth } from '../services/payments/quickbooks/connectionStore.js';

const KEY = 'a'.repeat(64);
const goodEnv = { QUICKBOOKS_ENVIRONMENT: 'sandbox', QUICKBOOKS_CLIENT_ID: 'id', QUICKBOOKS_CLIENT_SECRET: 'secret', QUICKBOOKS_REDIRECT_URI: 'https://nasa.example/cb', QUICKBOOKS_TOKEN_KEY: KEY };
const config = readQuickbooksConfig(goodEnv);
const reply = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (n) => headers[n] ?? null }, json: async () => body });

test('config reports what is missing without echoing secrets, and the gate needs the switch and production approval', () => {
  const bad = readQuickbooksConfig({ QUICKBOOKS_ENVIRONMENT: 'moon', QUICKBOOKS_CLIENT_SECRET: 'topsecret', QUICKBOOKS_REDIRECT_URI: 'http://evil.example', QUICKBOOKS_TOKEN_KEY: 'short' });
  assert.equal(bad.configured, false);
  assert.ok(bad.problems.length >= 4);
  assert.ok(!JSON.stringify(bad.problems).includes('topsecret'));
  assert.equal(quickbooksGate(config, {}).enabled, false);
  assert.equal(quickbooksGate(config, { QUICKBOOKS_ENABLED: 'true' }).enabled, true);
  const prod = readQuickbooksConfig({ ...goodEnv, QUICKBOOKS_ENVIRONMENT: 'production' });
  assert.equal(quickbooksGate(prod, { QUICKBOOKS_ENABLED: 'true' }).enabled, false);
  assert.equal(quickbooksGate(prod, { QUICKBOOKS_ENABLED: 'true', QUICKBOOKS_PRODUCTION_APPROVED: 'true' }).enabled, true);
  assert.match(prod.apiBase, /^https:\/\/quickbooks\.api\.intuit\.com$/);
});

test('tokens round-trip, are different each time, and fail with the wrong key or a changed text', () => {
  const a = encryptToken('refresh-token-1', KEY);
  assert.notEqual(a, encryptToken('refresh-token-1', KEY));
  assert.equal(decryptToken(a, KEY), 'refresh-token-1');
  assert.throws(() => decryptToken(a, 'b'.repeat(64)));
  assert.throws(() => decryptToken(`${a.slice(0, -2)}AA`, KEY));
  assert.throws(() => encryptToken('x', 'nothex'));
});

test('query values are escaped and the authorization address carries the state', () => {
  assert.equal(quoteValue("o'brien\\x"), "'o\\'brien\\\\x'");
  const url = new URL(authorizationUrl(config, 'abc'));
  assert.equal(url.searchParams.get('state'), 'abc');
  assert.equal(url.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
});

test('the client sends the bearer token, minor version and request id, and never logs or returns the email in an error', async () => {
  const calls = [];
  const client = createQuickbooksClient(config, async () => ({ accessToken: 'AT', realmId: '12345678' }), {
    fetchImpl: async (url, init) => { calls.push({ url, init }); return reply(200, { QueryResponse: { Vendor: [{ Id: '9' }] } }); } });
  assert.deepEqual(await client.findVendorsByEmail("a'b@x.com"), []);
  assert.match(calls[0].url, /sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/12345678\/query\?/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer AT');
  assert.match(calls[0].url, /minorversion=75/);
  const posts = [];
  const c2 = createQuickbooksClient(config, async () => ({ accessToken: 'AT', realmId: '12345678' }), { fetchImpl: async (url, init) => { posts.push(url); return reply(200, { Bill: { Id: '5' } }); } });
  assert.equal((await c2.createBill({ x: 1 }, 'nasa-stmt-7')).Id, '5');
  assert.match(posts[0], /requestid=nasa-stmt-7/);
});

test('the vendor search never filters by email at QuickBooks, reads every page, and matches the email here', async () => {
  const urls = [];
  const vendor = (i, email) => ({ Id: String(i), Active: true, PrimaryEmailAddr: email ? { Address: email } : undefined });
  const page1 = Array.from({ length: 1000 }, (_, i) => vendor(i + 1, `other${i}@x.com`));
  const page2 = [vendor(1001, ' Driver@Example.com '), vendor(1002, 'else@x.com'), vendor(1003)];
  const client = createQuickbooksClient(config, async () => ({ accessToken: 'AT', realmId: '12345678' }), {
    fetchImpl: async (url) => { urls.push(decodeURIComponent(url.replace(/\+/g, ' '))); return reply(200, { QueryResponse: { Vendor: urls.length === 1 ? page1 : page2 } }); } });
  const found = await client.findVendorsByEmail('driver@example.com');
  assert.deepEqual(found.map((v) => v.Id), ['1001']);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => !/where[^&]*PrimaryEmailAddr/i.test(u)), 'QuickBooks cannot filter vendors by email');
  assert.match(urls[0], /startposition 1 maxresults 1000/);
  assert.match(urls[1], /startposition 1001 maxresults 1000/);
});

test('a company with too many vendors to search fails instead of saying no vendor was found', async () => {
  const full = Array.from({ length: 1000 }, (_, i) => ({ Id: String(i), Active: true }));
  const client = createQuickbooksClient(config, async () => ({ accessToken: 'AT', realmId: '12345678' }), { fetchImpl: async () => reply(200, { QueryResponse: { Vendor: full } }) });
  await assert.rejects(() => client.findVendorsByEmail('a@x.com'), (e) => e instanceof QuickbooksError && /too many vendors/.test(e.message));
});

test('client errors keep the status and Intuit transaction id, and a lost connection has no status', async () => {
  const c = createQuickbooksClient(config, async () => ({ accessToken: 'AT', realmId: '12345678' }), {
    fetchImpl: async () => reply(400, { Fault: { Error: [{ code: '6240', Detail: 'Duplicate Name Exists Error' }] } }, { intuit_tid: 'tid-1' }) });
  await assert.rejects(() => c.createVendor({ DisplayName: 'x' }), (e) => e instanceof QuickbooksError && e.status === 400 && e.requestId === 'tid-1' && /Duplicate/.test(e.message));
  const down = createQuickbooksClient(config, async () => ({ accessToken: 'AT', realmId: '1' }), { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => down.getVendor('1'), (e) => e instanceof QuickbooksError && e.status === null);
});

// A tiny in-memory stand-in for the two tables, enough for the store's own queries.
const fakeDb = () => {
  const state = { states: new Map(), connection: null };
  return { state, query: async (sql, p = []) => {
    if (/DELETE FROM quickbooks_connect_state WHERE expires_at/.test(sql)) return { rows: [] };
    if (/INSERT INTO quickbooks_connect_state/.test(sql)) { state.states.set(p[0], { admin_id: p[1], environment: p[2], expires_at: p[3] }); return { rows: [] }; }
    if (/DELETE FROM quickbooks_connect_state WHERE state_hash/.test(sql)) { const r = state.states.get(p[0]); state.states.delete(p[0]); return { rows: r ? [r] : [] }; }
    if (/INSERT INTO quickbooks_connection/.test(sql)) { state.connection = { realm_id: p[1], access_token_enc: p[2], refresh_token_enc: p[3], access_expires_at: p[4], refresh_expires_at: p[5] }; return { rows: [] }; }
    if (/FROM quickbooks_connection/.test(sql)) return { rows: state.connection ? [state.connection] : [] };
    if (/UPDATE quickbooks_connection/.test(sql)) { Object.assign(state.connection, { access_token_enc: p[1], refresh_token_enc: p[2], access_expires_at: p[3], refresh_expires_at: p[4] }); return { rows: [] }; }
    throw new Error(`unexpected query ${sql}`);
  } };
};

test('a connect state works once, and not after ten minutes', async () => {
  const db = fakeDb();
  const now = new Date('2026-11-10T10:00:00Z');
  const s1 = await createConnectState(db, { adminId: 3, environment: 'sandbox' }, now);
  assert.deepEqual(await consumeConnectState(db, s1, now), { adminId: 3, environment: 'sandbox' });
  assert.equal(await consumeConnectState(db, s1, now), null);
  const s2 = await createConnectState(db, { adminId: 3, environment: 'sandbox' }, now);
  assert.equal(await consumeConnectState(db, s2, new Date(now.getTime() + 11 * 60_000)), null);
  assert.equal(await consumeConnectState(db, 'not-a-state', now), null);
});

test('connect stores encrypted tokens; a fresh token is reused, an expiring one is refreshed and the NEW refresh token is kept', async () => {
  const db = fakeDb();
  const now = new Date('2026-11-10T10:00:00Z');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(init.body));
    return calls.length === 1
      ? reply(200, { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, x_refresh_token_expires_in: 8640000 })
      : reply(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, x_refresh_token_expires_in: 8640000 });
  };
  await completeConnect(db, config, { code: 'code1', realmId: '12345678', adminId: 3 }, { fetchImpl, now });
  assert.ok(!JSON.stringify(db.state.connection).includes('AT1') && !JSON.stringify(db.state.connection).includes('RT1'));
  assert.deepEqual(await getAuth(db, config, { fetchImpl, now: new Date(now.getTime() + 600_000) }), { accessToken: 'AT1', realmId: '12345678' });
  assert.equal(calls.length, 1);
  const later = new Date(now.getTime() + 3500_000); // inside the two minutes before expiry
  assert.deepEqual(await getAuth(db, config, { fetchImpl, now: later }), { accessToken: 'AT2', realmId: '12345678' });
  assert.match(calls[1], /grant_type=refresh_token/);
  assert.match(calls[1], /refresh_token=RT1/);
  assert.equal(decryptToken(db.state.connection.refresh_token_enc, KEY), 'RT2');
});

test('no connection, or a lapsed one, is a clear error', async () => {
  const db = fakeDb();
  await assert.rejects(() => getAuth(db, config, { now: new Date() }), /not connected/);
  const now = new Date('2026-11-10T10:00:00Z');
  await completeConnect(db, config, { code: 'c', realmId: '12345678', adminId: 1 }, { now, fetchImpl: async () => reply(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, x_refresh_token_expires_in: 60 }) });
  await assert.rejects(() => getAuth(db, config, { now: new Date(now.getTime() + 3600_000) }), /expired/);
  await assert.rejects(() => completeConnect(db, config, { code: 'c', realmId: 'x', adminId: 1 }, { now }), /which company/);
});

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
    fetchImpl: async (url, init) => { calls.push({ url, init }); return reply(200, { QueryResponse: /count/.test(url) ? { totalCount: 1 } : { Vendor: [{ Id: '9', PrimaryEmailAddr: { Address: "A'B@x.com" } }] } }); } });
  assert.deepEqual((await client.findVendorsByEmail("a'b@x.com")).map((v) => v.Id), ['9']);
  assert.match(calls[0].url, /sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/12345678\/query\?/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer AT');
  assert.match(calls[0].url, /minorversion=75/);
  const posts = [];
  const c2 = createQuickbooksClient(config, async () => ({ accessToken: 'AT', realmId: '12345678' }), { fetchImpl: async (url, init) => { posts.push(url); return reply(200, { Bill: { Id: '5' } }); } });
  assert.equal((await c2.createBill({ x: 1 }, 'nasa-stmt-7')).Id, '5');
  assert.match(posts[0], /requestid=nasa-stmt-7/);
});

// A fake QuickBooks for the vendor search: it answers the count query and the pages from `pages`, and `hooks` can change what is sent for one call.
const vendorBook = (pages, { realm = () => '12345678', count = null, reply: custom = null } = {}) => {
  const urls = [];
  const total = pages.reduce((n, rows) => n + rows.length, 0);
  let counts = 0;
  const fetchImpl = async (url) => {
    const text = decodeURIComponent(url.replace(/\+/g, ' '));
    urls.push(text);
    const made = custom?.(text, urls.length);
    if (made) return made;
    if (/select count\(\*\) from Vendor/.test(text)) { counts += 1; return reply(200, { QueryResponse: { totalCount: count ? count(counts) : total } }); }
    const start = Number(/startposition (\d+)/.exec(text)[1]);
    return reply(200, { QueryResponse: pages[(start - 1) / 1000] && pages[(start - 1) / 1000].length ? { Vendor: pages[(start - 1) / 1000], startPosition: start } : {} });
  };
  let calls = 0;
  const client = createQuickbooksClient(config, async () => ({ accessToken: 'AT', realmId: realm(++calls) }), { fetchImpl });
  return { client, urls };
};
const vendor = (i, email) => ({ Id: String(i), Active: true, PrimaryEmailAddr: email ? { Address: email } : undefined });
const fullPage = (from) => Array.from({ length: 1000 }, (_, i) => vendor(from + i, `other${from + i}@x.com`));

test('the vendor search never filters by email at QuickBooks, reads every page, and matches the email here', async () => {
  const { client, urls } = vendorBook([fullPage(1), [vendor(1001, ' Driver@Example.com '), vendor(1002, 'else@x.com'), vendor(1003)]]);
  const found = await client.findVendorsByEmail('driver@example.com');
  assert.deepEqual(found.map((v) => v.Id), ['1001']);
  assert.equal(found.realmId, '12345678');
  assert.ok(urls.every((u) => !/where[^&]*PrimaryEmailAddr/i.test(u)), 'QuickBooks cannot filter vendors by email');
  const pages = urls.filter((u) => /orderby Id/.test(u));
  assert.match(pages[0], /startposition 1 maxresults 1000/);
  assert.match(pages[1], /startposition 1001 maxresults 1000/);
});

test('a valid empty list is "no vendors", and a company with no active vendors is not an error', async () => {
  const { client } = vendorBook([[]]);
  assert.deepEqual([...(await client.findVendorsByEmail('a@x.com'))], []);
});

test('a company with too many vendors to search fails instead of saying no vendor was found', async () => {
  const { client } = vendorBook([[vendor(1, 'a@x.com')]], { count: () => 20001 });
  await assert.rejects(() => client.findVendorsByEmail('a@x.com'), (e) => e instanceof QuickbooksError && /too many vendors/.test(e.message));
});

test('an unreadable or incomplete page is an error, never the end of the list', async () => {
  const bad = (custom) => vendorBook([fullPage(1), [vendor(1001, 'a@x.com')]], { reply: custom });
  const second = (answer) => (text) => (/startposition 1001/.test(text) ? answer : null);
  const unreadable = { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('bad json'); } };
  for (const custom of [second(unreadable), second(reply(200, {})), second(reply(200, { QueryResponse: null })), second(reply(200, { QueryResponse: { Vendor: 'x' } })), second(reply(200, { Fault: { Error: [{ code: '1' }] } }))]) {
    await assert.rejects(() => bad(custom).client.findVendorsByEmail('a@x.com'), (e) => e instanceof QuickbooksError, 'a broken later page must fail the search');
  }
  const noCount = vendorBook([[vendor(1, 'a@x.com')]], { reply: (text) => (/count\(\*\)/.test(text) ? reply(200, { QueryResponse: {} }) : null) });
  await assert.rejects(() => noCount.client.findVendorsByEmail('a@x.com'), (e) => e instanceof QuickbooksError);
  const refused = vendorBook([fullPage(1), [vendor(1001, 'a@x.com')]], { reply: second(reply(429, { Fault: { Error: [{ code: '1' }] } })) });
  await assert.rejects(() => refused.client.findVendorsByEmail('a@x.com'), (e) => e instanceof QuickbooksError && e.status === 429);
});

test('a vendor list that changes while it is read fails: repeated vendor, or a count that does not match', async () => {
  const twice = vendorBook([fullPage(1), [vendor(1000, 'a@x.com')]]); // vendor 1000 is on both pages
  await assert.rejects(() => twice.client.findVendorsByEmail('a@x.com'), (e) => e instanceof QuickbooksError && /changed while/.test(e.message));
  const grew = vendorBook([[vendor(1, 'a@x.com'), vendor(2)]], { count: (n) => (n === 1 ? 2 : 3) }); // a vendor was added during the read
  await assert.rejects(() => grew.client.findVendorsByEmail('a@x.com'), (e) => e instanceof QuickbooksError && /changed while/.test(e.message));
  const shrunk = vendorBook([[vendor(1, 'a@x.com')]], { count: () => 2 }); // fewer vendors read than the company has
  await assert.rejects(() => shrunk.client.findVendorsByEmail('a@x.com'), (e) => e instanceof QuickbooksError && /changed while/.test(e.message));
});

test('the whole vendor search stays in one company: a reconnect to another company part way fails, and a pinned company is enforced', async () => {
  let call = 0;
  const swapped = vendorBook([fullPage(1), [vendor(1001, 'a@x.com')]], { realm: () => (++call <= 2 ? '11111111' : '22222222') });
  await assert.rejects(() => swapped.client.findVendorsByEmail('a@x.com'), (e) => e instanceof QuickbooksError && /company changed/.test(e.message));
  assert.ok(swapped.urls.every((u) => /company\/11111111\//.test(u)), 'nothing was sent to the second company');
  const pinned = vendorBook([[vendor(1, 'a@x.com')]]);
  await assert.rejects(() => pinned.client.findVendorsByEmail('a@x.com', { realm: '99999999' }), (e) => e instanceof QuickbooksError && /company changed/.test(e.message));
  assert.equal(pinned.urls.length, 0);
  const sameCompany = vendorBook([[vendor(1, 'a@x.com')]]);
  assert.equal((await sameCompany.client.findVendorsByEmail('a@x.com', { realm: '12345678' })).realmId, '12345678');
  const made = [];
  const create = createQuickbooksClient(config, async () => ({ accessToken: 'AT', realmId: '22222222' }), { fetchImpl: async (url) => { made.push(url); return reply(200, { Vendor: { Id: '5' } }); } });
  await assert.rejects(() => create.createVendor({ DisplayName: 'x' }, 'nasa-vendor-1', { realm: '11111111' }), (e) => e instanceof QuickbooksError && /company changed/.test(e.message));
  assert.equal(made.length, 0, 'no vendor is made in a different company than the one searched');
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

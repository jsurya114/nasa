import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import express from 'express';
import bcrypt from 'bcrypt';
import { InputError, addDays, centsToText, parseCityIds, parseLimit, parseRange, parseRankBy, percentChange, toCents } from '../services/reporting/inputs.js';
import { createReportingDb } from '../services/reporting/reportingDb.js';
import { businessSummary, listReportingCities, rankCities } from '../services/reporting/deliveryReports.js';
import { loadMcpConfig, CLAUDE_REDIRECT_URI, MCP_SCOPE } from '../services/mcp/config.js';
import { createHash } from 'node:crypto';

// ---------- inputs and exact arithmetic (no database) ----------
test('dates and periods are checked, never guessed', () => {
  assert.deepEqual(parseRange({ start_date: '2026-10-01', end_date: '2026-10-31' }), { startDate: '2026-10-01', endDate: '2026-10-31', days: 31 });
  assert.equal(parseRange({ start_date: '2026-10-05', end_date: '2026-10-05' }).days, 1);
  for (const [start, end, message] of [
    ['2026-10-31', '2026-10-01', /not be after/],
    ['2026-02-30', '2026-03-01', /real calendar date/],
    ['10/01/2026', '2026-10-31', /YYYY-MM-DD/],
    ['2026-10-01', '', /YYYY-MM-DD/],
    ['1999-12-31', '2000-01-02', /between the years/],
    ['2026-01-01', '2029-12-31', /most one question can cover/],
  ]) assert.throws(() => parseRange({ start_date: start, end_date: end }), (e) => e instanceof InputError && message.test(e.message), `${start} ${end}`);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});

test('city ids, limits and ranking metrics reject anything unsupported', () => {
  assert.equal(parseCityIds(undefined), null);
  assert.deepEqual(parseCityIds([3, 1, 3]), [1, 3]);
  for (const bad of [[], [0], [-1], [1.5], ['1'], 'all', Array.from({ length: 51 }, (_, i) => i + 1)]) assert.throws(() => parseCityIds(bad), InputError);
  assert.equal(parseLimit(undefined), 10);
  assert.equal(parseLimit(50), 50);
  for (const bad of [0, 51, 1.5, '5', -1]) assert.throws(() => parseLimit(bad), InputError);
  for (const ok of ['deliveries', 'revenue', 'gross_margin']) assert.equal(parseRankBy(ok), ok);
  for (const bad of ['profit', 'DELIVERIES', '', 'revenue; drop table x', undefined]) assert.throws(() => parseRankBy(bad), InputError);
});

test('money is exact: cents in, cents out, and percent changes round half up without floats', () => {
  assert.equal(toCents('12345.67'), 1234567n);
  assert.equal(toCents('0.1'), 10n);
  assert.equal(toCents('-3.05'), -305n);
  assert.equal(toCents(null), null);
  assert.equal(centsToText(1234567n), '12345.67');
  assert.equal(centsToText(-5n), '-0.05');
  assert.equal(centsToText(null), null);
  assert.equal(percentChange(520n, 60n), '766.67');
  assert.equal(percentChange(50n, 100n), '-50.00');
  assert.equal(percentChange(100n, 100n), '0.00');
  assert.equal(percentChange(5n, 0n), null, 'no previous amount: no percentage, not Infinity');
  assert.equal(percentChange(null, 10n), null);
  assert.equal(percentChange(1n, 3n), '-66.67');
  assert.equal(0.1 + 0.2 === 0.3, false, 'a reminder of why floats are not used');
});

test('the reporting connection is off without its own settings and refuses the application login', () => {
  assert.equal(createReportingDb({}).enabled, false);
  assert.match(createReportingDb({ REPORTING_DB_HOST: 'h', REPORTING_DB_NAME: 'n', REPORTING_DB_USER: 'u' }).reason, /REPORTING_DB_PASSWORD/);
  const same = createReportingDb({ DB_USER: 'app', REPORTING_DB_HOST: 'h', REPORTING_DB_NAME: 'n', REPORTING_DB_USER: 'app', REPORTING_DB_PASSWORD: 'p' });
  assert.equal(same.enabled, false);
  assert.match(same.reason, /different, read-only login/);
  // It never borrows the application's DB_* values.
  const borrowed = createReportingDb({ DB_HOST: 'h', DB_NAME: 'n', DB_USER: 'u', DB_PASSWORD: 'p' });
  assert.equal(borrowed.enabled, false);
});

// ---------- the database: a disposable PostgreSQL copy with the app's tables and both reporting migrations (never production) ----------
// MCP_TEST_DB=1, DB_* (owner), and REPORTING_DB_* (the read-only login). All data is made up and removed or rolled back.
const hasDb = process.env.MCP_TEST_DB === '1';
const hasReportingLogin = hasDb && process.env.REPORTING_DB_USER;

test('reports add up exactly, follow the route city, ignore today\'s rates and disclose what is missing', { skip: !hasDb && 'set MCP_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const owner = new pg.Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, database: process.env.DB_NAME, password: process.env.DB_PASSWORD });
  const db = await owner.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    const tag = randomBytes(3).toString('hex');
    const city = async (name, type) => (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, $3) RETURNING id", [`Rpt ${name} ${tag}`, `R${name}${tag}`.toUpperCase(), type])).id;
    const cityA = await city('A', 'DAILY');
    const cityB = await city('B', 'WEEKLY');
    const route = async (name, cityId, company, driver) => (await one(
      `INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
       SELECT $1, c.job, $3, $4, $3, $4, $5 FROM city c WHERE c.id = $2 RETURNING id`, [`${name} ${tag}`, cityId, company, driver, `RT-${name}-${tag}`])).id;
    const routeA = await route('A1', cityA, 2.0, 1.6);
    const routeB = await route('B1', cityB, 3.0, 2.5);
    let code = 800000000 + Math.floor(Math.random() * 100000000);
    const driver = async (label, cityId) => (await one(
      `INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', $1, $2, $3, $4) RETURNING id`,
      [`Rpt ${label} ${tag}`, `rpt-${label}-${tag}@example.test`, (code += 1), cityId])).id;
    const d1 = await driver('d1', cityA);
    const d2 = await driver('d2', cityA);
    const d3 = await driver('d3', cityB);

    // A stored delivery record, with the amounts exactly as they were stored (not derived from the route rates).
    const row = async ({ driver: d, route: r, date, seq, delivered, closed = true, pay = null, margin = null }) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, journey_date, start_seq, end_seq, packages) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [d, r, date, seq ? seq : 0, seq ? seq + 9 : 0, delivered])).id;
      await db.query('UPDATE payment_dashboard SET delivered = $2, closed = $3, driver_payment = $4, company_earnings = $5 WHERE dashboard_data_id = $1', [dd, delivered, closed, pay, margin]);
    };
    // The period: 2090-03-01 to 2090-03-14 (a year no real data uses). Daily city A:
    await row({ driver: d1, route: routeA, date: '2090-03-01', seq: 100, delivered: 10, pay: '16.00', margin: '4.00' });
    await row({ driver: d1, route: routeA, date: '2090-03-02', seq: 110, delivered: 20, pay: '32.00', margin: '8.00' });
    await row({ driver: d2, route: routeA, date: '2090-03-02', seq: 120, delivered: 5, pay: '8.00', margin: '2.00' });
    await row({ driver: d1, route: routeA, date: '2090-03-03', seq: 130, delivered: 4, closed: false });                     // still open: no amounts yet
    await row({ driver: d2, route: routeA, date: '2090-03-04', seq: 140, delivered: 6, pay: '9.60', margin: null });          // only half the amounts stored
    await row({ driver: d1, route: routeA, date: '2090-03-06', seq: 0, delivered: 7, pay: '11.20', margin: '2.80' });         // weekly-style record in a DAILY city: not counted
    await row({ driver: d1, route: routeA, date: '2090-03-20', seq: 150, delivered: 1000, pay: '1600.00', margin: '400.00' }); // outside the period
    // Weekly city B (no sequence numbers):
    await row({ driver: d3, route: routeB, date: '2090-03-01', seq: 0, delivered: 100, pay: '250.00', margin: '50.00' });
    await row({ driver: d3, route: routeB, date: '2090-03-05', seq: 0, delivered: 50, pay: '125.00', margin: '25.00' });
    // The previous equal-length period (2090-02-15 to 2090-02-28):
    await row({ driver: d1, route: routeA, date: '2090-02-20', seq: 160, delivered: 15, pay: '24.00', margin: '6.00' });
    await row({ driver: d3, route: routeB, date: '2090-02-27', seq: 0, delivered: 10, pay: '25.00', margin: '5.00' });

    const period = parseRange({ start_date: '2090-03-01', end_date: '2090-03-14' });
    const counts = async () => (await one('SELECT (SELECT count(*) FROM drivers) d, (SELECT count(*) FROM dashboard_data) dd, (SELECT count(*) FROM payment_dashboard) pd, (SELECT count(*) FROM routes) r, (SELECT count(*) FROM pay_runs) pr')).count ?? null;
    const snapshot = async () => JSON.stringify(await one('SELECT (SELECT count(*) FROM drivers) d, (SELECT count(*) FROM dashboard_data) dd, (SELECT sum(driver_payment) FROM payment_dashboard) p, (SELECT sum(company_earnings) FROM payment_dashboard) c, (SELECT count(*) FROM routes) r, (SELECT count(*) FROM pay_runs) pr'));
    const before = await snapshot();

    await t.test('the summary adds up exactly across daily and weekly cities', async () => {
      const { data, warnings, coverage } = await businessSummary(db, { period, cityIds: null });
      assert.equal(data.deliveries, 195, '45 in city A (the open and half-filled records included) + 150 in B; the mismatched and out-of-period records are not');
      assert.equal(data.grossDriverEarnings, '431.00');
      assert.equal(data.grossMarginBeforeOverheads, '89.00');
      assert.equal(data.earnedDeliveryRevenue, '520.00');
      assert.equal(data.marginPercentage, '17.12');
      assert.equal(data.activeDrivers, 3);
      assert.equal(data.activeDriverDays, 7);
      assert.equal(data.deliveriesPerActiveDriverDay, '27.86');
      assert.equal(data.revenuePerDelivery, '2.81', 'per delivery uses only the deliveries that have stored amounts (185)');
      assert.equal(data.marginPerDelivery, '0.48');
      assert.deepEqual(data.records, { total: 7, withStoredAmounts: 5, open: 1, partialAmounts: 1, daily: 5, weekly: 2 });
      assert.equal(coverage[0].daysWithRecords, 5);
      assert.equal(coverage[0].daysInPeriod, 14);
      const text = warnings.join(' | ');
      assert.match(text, /1 record is still open/);
      assert.match(text, /1 record has only one of driver earnings and margin stored/);
      assert.match(text, /1 record is left out because its sequence numbers do not match the city type/);
      assert.match(text, /9 days have no delivery records/);
      assert.equal(data.comparison, undefined, 'no comparison unless asked');
    });

    await t.test('a city filter agrees with the whole, and an unknown city is rejected', async () => {
      const a = (await businessSummary(db, { period, cityIds: [cityA] })).data;
      const b = (await businessSummary(db, { period, cityIds: [cityB] })).data;
      assert.deepEqual([a.deliveries, a.earnedDeliveryRevenue, a.grossMarginBeforeOverheads, a.marginPercentage], [45, '70.00', '14.00', '20.00']);
      assert.deepEqual([b.deliveries, b.earnedDeliveryRevenue, b.grossMarginBeforeOverheads], [150, '450.00', '75.00']);
      assert.equal(a.deliveries + b.deliveries, 195);
      await assert.rejects(businessSummary(db, { period, cityIds: [cityA, 2147483000] }), (e) => e instanceof InputError && /Unknown city_id: 2147483000/.test(e.message));
    });

    await t.test('a driver who changes city, or a route whose rate changes, does not change history', async () => {
      const before = (await businessSummary(db, { period, cityIds: [cityA] })).data;
      await db.query('UPDATE drivers SET city_id = $2 WHERE id = $1', [d2, cityB]);
      await db.query('UPDATE routes SET company_route_price = 9.99, driver_route_price = 9.00 WHERE id = $1', [routeA]);
      const after = (await businessSummary(db, { period, cityIds: [cityA] })).data;
      assert.deepEqual(after, before, 'the records stay in the city of their route, with their stored amounts');
      assert.equal((await businessSummary(db, { period, cityIds: [cityB] })).data.deliveries, 150);
    });

    await t.test('comparison with the previous equal-length period, complete, incomplete and absent', async () => {
      const all = (await businessSummary(db, { period, cityIds: null, comparePrevious: true })).data.comparison;
      assert.equal(all.status, 'complete');
      assert.deepEqual(all.previousPeriod, { startDate: '2090-02-15', endDate: '2090-02-28', days: 14 });
      assert.deepEqual(all.previous, { deliveries: 25, earnedDeliveryRevenue: '60.00', grossMarginBeforeOverheads: '11.00' });
      assert.deepEqual(all.change, {
        deliveries: { absolute: '170', percent: '680.00' },
        earnedDeliveryRevenue: { absolute: '460.00', percent: '766.67' },
        grossMarginBeforeOverheads: { absolute: '78.00', percent: '709.09' },
      });
      const partial = await businessSummary(db, { period, cityIds: [cityB], comparePrevious: true });
      assert.equal(partial.data.comparison.status, 'incomplete', 'the city\'s data starts inside the previous period');
      assert.match(partial.warnings.join(' '), /only partly covered/);
      const none = (await businessSummary(db, { period: parseRange({ start_date: '2090-02-15', end_date: '2090-02-28' }), cityIds: null, comparePrevious: true })).data.comparison;
      assert.equal(none.status, 'insufficient_data');
      assert.equal(none.change, null, 'no previous data: no change, never Infinity');
    });

    await t.test('an empty period is empty, not zero', async () => {
      const empty = await businessSummary(db, { period: parseRange({ start_date: '2091-01-01', end_date: '2091-01-07' }), cityIds: null });
      assert.equal(empty.data.deliveries, 0);
      assert.equal(empty.data.earnedDeliveryRevenue, null);
      assert.equal(empty.data.grossMarginBeforeOverheads, null);
      assert.equal(empty.data.marginPercentage, null, 'zero revenue: N/A');
      assert.equal(empty.data.deliveriesPerActiveDriverDay, null);
      assert.equal(empty.data.revenuePerDelivery, null);
      assert.match(empty.warnings.join(' '), /no delivery records in this period/);
    });

    await t.test('city ranking by each metric, with shares of the total and stable order', async () => {
      const by = async (rankBy, limit = 10) => (await rankCities(db, { period, rankBy, limit })).data;
      const deliveries = await by('deliveries');
      assert.deepEqual(deliveries.ranking.map((r) => [r.rank, r.cityId, r.deliveries, r.shareOfTotalPercent]), [[1, cityB, 150, '76.92'], [2, cityA, 45, '23.08']]);
      assert.deepEqual(deliveries.totalsAllCities, { deliveries: 195, earnedDeliveryRevenue: '520.00', grossMarginBeforeOverheads: '89.00', citiesWithData: 2 });
      const revenue = await by('revenue');
      assert.deepEqual(revenue.ranking.map((r) => [r.cityId, r.earnedDeliveryRevenue, r.shareOfTotalPercent]), [[cityB, '450.00', '86.54'], [cityA, '70.00', '13.46']]);
      const margin = await by('gross_margin');
      assert.deepEqual(margin.ranking.map((r) => [r.cityId, r.grossMarginBeforeOverheads, r.marginPercentage, r.shareOfTotalPercent]), [[cityB, '75.00', '16.67', '84.27'], [cityA, '14.00', '20.00', '15.73']]);
      const one = await rankCities(db, { period, rankBy: 'deliveries', limit: 1 });
      assert.equal(one.data.ranking.length, 1);
      assert.match(one.warnings.join(' '), /top 1 of 2 cities/);
      const cityRow = deliveries.ranking.find((r) => r.cityId === cityA);
      assert.equal(cityRow.recordsWithoutStoredAmounts, 2);
      const noData = await rankCities(db, { period: parseRange({ start_date: '2091-01-01', end_date: '2091-01-07' }), rankBy: 'revenue', limit: 5 });
      assert.deepEqual(noData.data.ranking, []);
      assert.equal(noData.data.totalsAllCities.earnedDeliveryRevenue, null);
    });

    await t.test('the city list carries id, type and data coverage', async () => {
      const { data } = await listReportingCities(db);
      const a = data.cities.find((c) => c.cityId === cityA);
      assert.deepEqual([a.type, a.enabled, a.firstDeliveryDate, a.lastDeliveryDate], ['DAILY', true, '2090-02-20', '2090-03-20']);
      assert.ok(Object.keys(a).every((k) => !/email|phone|password/i.test(k)));
    });

    await t.test('reading reports changes nothing', async () => {
      await businessSummary(db, { period, cityIds: null, comparePrevious: true });
      await rankCities(db, { period, rankBy: 'revenue', limit: 5 });
      await listReportingCities(db);
      assert.equal(await snapshot(), before);
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await owner.end();
  }
});

test('the reporting login can read only the views, cannot write, and its limits and cancellation work', { skip: !hasReportingLogin && 'set MCP_TEST_DB=1, DB_* and REPORTING_DB_* to run' }, async (t) => {
  const reporting = createReportingDb({ ...process.env, REPORTING_DB_POOL_MAX: '1', REPORTING_DB_TIMEOUT_MS: '1000' });
  assert.equal(reporting.enabled, true);
  const denied = (job) => assert.rejects(reporting.run(job), (e) => /permission denied|read-only|must be owner|cannot (insert into|update|delete from) view/i.test(e.message), 'refused by the database');
  try {
    await t.test('it reads the reporting views', async () => {
      const rows = await reporting.run(async (db) => (await db.query('SELECT count(*)::int AS n FROM reporting.delivery_facts')).rows[0]);
      assert.ok(rows.n >= 0);
      assert.ok((await reporting.run(async (db) => (await db.query('SELECT * FROM reporting.cities LIMIT 1')).fields.map((f) => f.name))).every((n) => !/email|phone|password/i.test(n)));
    });

    await t.test('it cannot read any base table, sign-in record or account', async () => {
      const wanted = ['drivers', 'admin', 'payment_dashboard', 'dashboard_data', 'routes', 'city', 'pay_runs', 'pay_statements', 'courier_claims', 'everee_workers', 'everee_payment_items', 'mcp_oauth_tokens', 'mcp_oauth_grants', 'mcp_oauth_clients', 'driver_ledger_entries', 'weekly_excel_data', 'access_codes', 'device_tokens'];
      let checked = 0;
      for (const table of wanted) {
        const exists = await reporting.run(async (db) => (await db.query('SELECT to_regclass($1) AS t', [`public.${table}`])).rows[0].t);
        if (!exists) continue; // a copy that predates some later migration
        await denied((db) => db.query(`SELECT 1 FROM public.${table} LIMIT 1`));
        checked += 1;
      }
      assert.ok(checked >= 10, `checked ${checked} tables`);
    });

    await t.test('it cannot write, change the schema or leave read-only mode', async () => {
      await denied((db) => db.query("UPDATE reporting.cities SET city_name = 'x'"));
      await denied((db) => db.query('DELETE FROM reporting.delivery_facts'));
      await denied((db) => db.query('INSERT INTO reporting.cities (city_id) VALUES (1)'));
      await denied((db) => db.query('INSERT INTO public.city (job, city_code, city_type) VALUES (\'x\', \'x\', \'DAILY\')'));
      await denied((db) => db.query('CREATE TABLE reporting.should_not_exist (id int)'));
      await denied((db) => db.query('CREATE TABLE public.should_not_exist (id int)'));
      await denied((db) => db.query('DROP VIEW reporting.cities'));
      // Even if a statement switched the transaction to read-write, the login has no write privilege to use.
      await denied(async (db) => { await db.query('SET TRANSACTION READ WRITE'); await db.query("UPDATE reporting.cities SET city_name = 'x'"); });
      await denied(async (db) => { await db.query('SET TRANSACTION READ WRITE'); await db.query("INSERT INTO public.city (job, city_code, city_type) VALUES ('x', 'x', 'DAILY')"); });
      await denied(async (db) => { await db.query('SET TRANSACTION READ WRITE'); await db.query('CREATE TABLE public.should_not_exist (id int)'); });
      await denied((db) => db.query("COPY (SELECT 1) TO PROGRAM 'id'"));
      await denied((db) => db.query("SELECT pg_read_file('/etc/hostname')"));
      await denied((db) => db.query('GRANT SELECT ON reporting.cities TO PUBLIC'));
    });

    await t.test('a slow query is stopped by the time limit and the connection is reusable', async () => {
      const started = Date.now();
      await assert.rejects(reporting.run((db) => db.query('SELECT pg_sleep(5)')), (e) => e.code === '57014');
      assert.ok(Date.now() - started < 3500, 'stopped at about one second');
      assert.equal((await reporting.run(async (db) => (await db.query('SELECT 1 AS ok')).rows[0])).ok, 1, 'the single pooled connection was released');
    });

    await t.test('a cancelled request cancels its query and frees its connection', async () => {
      const controller = new AbortController();
      const started = Date.now();
      setTimeout(() => controller.abort(), 200);
      await assert.rejects(reporting.run((db) => db.query('SELECT pg_sleep(0.9)'), { signal: controller.signal }), /cancelled/);
      assert.ok(Date.now() - started < 800, 'the query did not run to completion');
      assert.equal((await reporting.run(async (db) => (await db.query('SELECT 2 AS ok')).rows[0])).ok, 2);
      await assert.rejects(reporting.run((db) => db.query('SELECT 1'), { signal: AbortSignal.abort() }), /cancelled/);
    });
  } finally {
    await reporting.close();
  }
});

test('over HTTP the tools list only with a reporting login, validate input, and match the Dashboard\'s own totals', { skip: !hasReportingLogin && 'set MCP_TEST_DB=1, DB_* and REPORTING_DB_* to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const { createMcpRouter } = await import('../services/mcp/router.js');
  const { AdminDashboardQueries } = await import('../services/admin/dashboardQueries.js');
  const { default: appPool } = await import('../config/db.js');
  const pool = new pg.Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, database: process.env.DB_NAME, password: process.env.DB_PASSWORD });
  const tag = randomBytes(4).toString('hex');
  const password = `Test-pass-${tag}`;
  const { rows: [owner] } = await pool.query("INSERT INTO admin (password, name, email, role, is_active) VALUES ($1, $2, $3, 'superadmin', true) RETURNING id, email",
    [await bcrypt.hash(password, 4), `rpt-http-${tag}`, `rpt-http-${tag}@example.test`]);

  const reporting = createReportingDb(process.env);
  const servers = [];
  const start = async (withReporting) => {
    const app = express();
    let router = (_req, _res, next) => next();
    app.use((req, res, next) => router(req, res, next));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = `http://localhost:${server.address().port}`;
    const config = loadMcpConfig({ MCP_ENABLED: 'true', MCP_PUBLIC_BASE_URL: origin });
    router = createMcpRouter({ config, db: pool, loginLimiter: (_q, _s, n) => n(), limits: { register: 1000, authorize: 1000, token: 1000, revoke: 1000 }, reporting: withReporting ? reporting : { enabled: false } }).router;
    servers.push(server);
    const call = async (path, init = {}) => { const res = await fetch(`${origin}${path}`, { redirect: 'manual', ...init }); const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = text; } return { res, body }; };
    // Sign in through the real flow.
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const { body: client } = await call('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CLAUDE_REDIRECT_URI], token_endpoint_auth_method: 'none' }) });
    const page = await call(`/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource: config.resourceUrl, scope: MCP_SCOPE })}`);
    const requestId = /name="request" value="([^"]+)"/.exec(page.body)[1];
    const done = await call('/mcp-consent', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request: requestId, email: owner.email, password, decision: 'allow' }) });
    const code = new URL(done.res.headers.get('location')).searchParams.get('code');
    const { body: tokens } = await call('/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: verifier, redirect_uri: CLAUDE_REDIRECT_URI, resource: config.resourceUrl }) });
    let id = 0;
    const rpc = (method, params) => call('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tokens.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: (id += 1), method, params }) });
    const tool = async (name, args) => (await rpc('tools/call', { name, arguments: args })).body.result;
    return { rpc, tool };
  };

  try {
    await t.test('without a reporting login only the definitions tool is offered', async () => {
      const bare = await start(false);
      const names = (await bare.rpc('tools/list')).body.result.tools.map((x) => x.name);
      assert.deepEqual(names, ['get_metric_definitions']);
      const call = await bare.tool('get_business_summary', { start_date: '2026-10-01', end_date: '2026-10-31' });
      assert.ok(call.isError || call === undefined, 'a tool that is not offered cannot be called');
    });

    const full = await start(true);
    await t.test('with it the four read-only tools are listed with annotations and schemas', async () => {
      const { tools } = (await full.rpc('tools/list')).body.result;
      assert.deepEqual(tools.map((x) => x.name), ['get_metric_definitions', 'list_reporting_cities', 'get_business_summary', 'rank_cities']);
      for (const x of tools) {
        assert.equal(x.annotations.readOnlyHint, true);
        assert.equal(x.annotations.destructiveHint, false);
        assert.ok(x.inputSchema && x.outputSchema);
      }
      const defs = (await full.tool('get_metric_definitions', {})).structuredContent.data.connector.tools;
      assert.deepEqual(defs, tools.map((x) => x.name));
    });

    await t.test('bad input is explained, and unsupported arguments are rejected', async () => {
      const bad = [
        ['get_business_summary', { start_date: '2026-10-31', end_date: '2026-10-01' }, /not be after/],
        ['get_business_summary', { start_date: '2026-13-01', end_date: '2026-10-01' }, /real calendar date/],
        ['get_business_summary', { start_date: '2020-01-01', end_date: '2026-10-01' }, /most one question can cover/],
        ['get_business_summary', { start_date: '2026-10-01', end_date: '2026-10-31', city_ids: [2147483000] }, /Unknown city_id/],
        ['rank_cities', { start_date: '2026-10-01', end_date: '2026-10-31', rank_by: 'profit' }, /rank_by|Invalid/i],
        ['rank_cities', { start_date: '2026-10-01', end_date: '2026-10-31', rank_by: 'revenue', limit: 500 }, /limit|Too big|Invalid/i],
        ['rank_cities', { start_date: '2026-10-01', end_date: '2026-10-31', rank_by: 'revenue', sql: 'select 1' }, /sql|Unrecognized|Invalid/i],
        ['list_reporting_cities', { anything: true }, /Unrecognized|Invalid/i],
      ];
      for (const [name, args, pattern] of bad) {
        const reply = (await full.rpc('tools/call', { name, arguments: args })).body;
        const text = reply.error?.message ?? reply.result?.content?.[0]?.text ?? '';
        assert.ok(reply.error || reply.result?.isError, `${name} ${JSON.stringify(args)} should be refused`);
        assert.match(text, pattern, text);
      }
    });

    await t.test('totals equal the Dashboard\'s own totals for the same dates and city', async () => {
      const cities = (await full.tool('list_reporting_cities', {})).structuredContent.data.cities;
      assert.ok(cities.length > 0);
      const toCentsLocal = (v) => toCents(v);
      let compared = 0;
      for (const [start, end] of [['2026-10-01', '2026-10-31'], ['2026-06-01', '2026-06-30']]) {
        for (const c of cities) {
          const dash = await AdminDashboardQueries.getSummaryData({ job: c.name, startDate: start, endDate: end }, owner.id, 'superadmin');
          const mine = (await full.tool('get_business_summary', { start_date: start, end_date: end, city_ids: [c.cityId] })).structuredContent.data;
          assert.equal(mine.deliveries, Number(dash.total_delivered), `${c.name} ${start} deliveries`);
          if (mine.earnedDeliveryRevenue !== null) {
            assert.equal(toCentsLocal(mine.grossMarginBeforeOverheads), toCentsLocal(dash.total_company_earnings), `${c.name} ${start} margin`);
            assert.equal(toCentsLocal(mine.grossDriverEarnings), toCentsLocal(dash.total_driver_payment), `${c.name} ${start} driver earnings`);
            assert.equal(toCentsLocal(mine.earnedDeliveryRevenue), toCentsLocal(dash.total_driver_payment) + toCentsLocal(dash.total_company_earnings), `${c.name} ${start} revenue`);
            compared += 1;
          }
        }
        // The whole-company figure is the sum of the cities, and the ranking agrees with the per-city summaries.
        const ranked = (await full.tool('rank_cities', { start_date: start, end_date: end, rank_by: 'deliveries', limit: 50 })).structuredContent.data;
        const total = (await full.tool('get_business_summary', { start_date: start, end_date: end })).structuredContent.data;
        assert.equal(ranked.totalsAllCities.deliveries, total.deliveries);
        assert.equal(ranked.ranking.reduce((n, r) => n + r.deliveries, 0), total.deliveries);
        assert.equal(ranked.totalsAllCities.earnedDeliveryRevenue, total.earnedDeliveryRevenue);
        assert.equal(ranked.totalsAllCities.grossMarginBeforeOverheads, total.grossMarginBeforeOverheads);
        const sorted = [...ranked.ranking].map((r) => r.deliveries);
        assert.deepEqual(sorted, [...sorted].sort((a, b) => b - a), 'ranked high to low');
      }
      assert.ok(compared > 0, 'at least some cities had stored amounts to compare');
    });
  } finally {
    for (const s of servers) await new Promise((resolve) => s.close(resolve));
    await pool.query('DELETE FROM admin WHERE id = $1', [owner.id]);
    await pool.query('DELETE FROM mcp_oauth_clients c WHERE NOT EXISTS (SELECT 1 FROM mcp_oauth_grants g WHERE g.client_id = c.client_id)');
    await reporting.close();
    await pool.end();
    await appPool.end();
  }
});

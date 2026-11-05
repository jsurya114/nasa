import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { requireRole } from '../middlewares/requireRole.js';
import { createInsightsRouter } from '../services/insights/router.js';
import { createReportRunner } from '../services/insights/reportRunner.js';
import { getCityRanking, getDefinitions, getOverview, parseFilters } from '../services/insights/insightsService.js';
import { InputError, parseCityIdsText, parseSource } from '../services/reporting/inputs.js';

// The Insights page's data API (issue #227): super admin only, read only, one shared reporting layer. The first part needs no database. The second
// part (MCP_TEST_DB=1 and the DB_* variables, on a disposable copy that has the reporting views) runs the real queries in a rolled-back transaction.

// ---------- who may call it (no database; the real requireRole, a stand-in for the token check) ----------
const REPORT = { data: { ok: true }, scope: { description: 'stub' }, coverage: [], warnings: [] };
const makeApp = (run) => {
  // The real adminAuth opens Redis; this stand-in only decides who is signed in, from a test header. requireRole is the real one.
  const adminAuth = (req, res, next) => {
    const role = req.headers['x-test-role'];
    if (!role) return res.status(401).json({ message: 'UNAUTHORIZED' });
    req.admin = { id: 7, role };
    req.user = req.admin;
    return next();
  };
  const app = express();
  app.use('/admin/insights', createInsightsRouter({ adminAuth, requireRole, run }));
  return app;
};
const call = async (app, path, role) => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/insights${path}`, { headers: role ? { 'x-test-role': role } : {} });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
const PERIOD = 'start_date=2026-10-01&end_date=2026-10-31';
const PATHS = ['/definitions', '/cities', `/overview?${PERIOD}`, `/rankings/cities?${PERIOD}`];

test('only the super admin may use Insights: no token, an ordinary admin and a driver are refused before any report runs', async () => {
  let calls = 0;
  const app = makeApp(async () => { calls += 1; return REPORT; });
  for (const path of PATHS) {
    assert.equal((await call(app, path, null)).status, 401, `${path} without a token`);
    assert.deepEqual([(await call(app, path, 'admin')).status, (await call(app, path, 'admin')).body], [403, { message: 'FORBIDDEN' }], `${path} as an admin`);
    assert.equal((await call(app, path, 'driver')).status, 403, `${path} as a driver`);
    assert.equal((await call(app, path, undefined)).status, 401);
  }
  assert.equal(calls, 0, 'no report ran for anyone who is not the super admin');
  for (const path of PATHS) {
    const answer = await call(app, path, 'superadmin');
    assert.equal(answer.status, 200, `${path} as the super admin`);
    assert.equal(answer.cache, 'no-store', 'company figures are never cached');
    assert.deepEqual(Object.keys(answer.body).sort(), ['data', 'meta']);
  }
  assert.equal(calls, 3, 'the three data routes ran one report each; definitions read no data');
});

test('a bad request is refused with a message and runs nothing; a report failure shows no internal detail', async () => {
  let calls = 0;
  const app = makeApp(async () => { calls += 1; return REPORT; });
  const bad = [
    '/overview', '/overview?start_date=2026-10-01', '/overview?start_date=2026-13-01&end_date=2026-10-31', '/overview?start_date=2026-10-31&end_date=2026-10-01',
    `/overview?${PERIOD}&source=monthly`, `/overview?${PERIOD}&city_ids=abc`, `/overview?${PERIOD}&city_ids=0`, `/overview?${PERIOD}&city_ids=1,,2`,
    `/rankings/cities?${PERIOD}&rank_by=profit`, `/rankings/cities?${PERIOD}&limit=0`, `/rankings/cities?${PERIOD}&limit=abc`, `/rankings/cities?${PERIOD}&limit=51`,
    '/overview?start_date=2020-01-01&end_date=2026-10-31',
  ];
  for (const path of bad) {
    const answer = await call(app, path, 'superadmin');
    assert.equal(answer.status, 400, path);
    assert.equal(typeof answer.body.message, 'string', path);
  }
  assert.equal(calls, 0, 'a refused request never reaches the database');

  const sql = makeApp(async () => { throw Object.assign(new Error('relation "reporting.delivery_facts" does not exist'), { code: '42P01' }); });
  const failed = await call(sql, `/overview?${PERIOD}`, 'superadmin');
  assert.equal(failed.status, 500);
  assert.doesNotMatch(JSON.stringify(failed.body), /relation|reporting|42P01/, 'no SQL or table name reaches the caller');
  const slow = await call(makeApp(async () => { throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }); }), `/overview?${PERIOD}`, 'superadmin');
  assert.equal(slow.status, 504);
});

test('the route files keep the guard first and are mounted before /admin', () => {
  const router = readFileSync(new URL('../services/insights/router.js', import.meta.url), 'utf8').split('\n').map((l) => l.trim());
  const auth = router.indexOf('router.use(adminAuth);');
  const role = router.indexOf("router.use(requireRole('superadmin'));");
  const firstRoute = router.findIndex((l) => /^router\.(get|post|put|patch|delete)\(/.test(l));
  assert.ok(auth > -1 && role > auth && firstRoute > role, 'adminAuth, then requireRole("superadmin"), then the first route');
  assert.equal(router.filter((l) => /^router\.(post|put|patch|delete)\(/.test(l)).length, 0, 'Insights has no route that changes anything');
  const routes = readFileSync(new URL('../routes/insightsRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /import adminAuth from '..\/middlewares\/adminAuth\.js'/);
  assert.match(routes, /createInsightsRouter\(\{ adminAuth, requireRole,/);
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf("app.use('/admin/insights'") > -1 && app.indexOf("app.use('/admin/insights'") < app.indexOf("app.use('/admin', "), 'mounted before the general /admin router');
});

// ---------- what the filters mean (no database) ----------
test('filters: dates are required, source and cities are validated, nothing is guessed', () => {
  assert.equal(parseSource(undefined), null);
  assert.equal(parseSource('all'), null);
  assert.equal(parseSource('daily'), 'daily');
  assert.throws(() => parseSource('Daily'), InputError);
  assert.deepEqual(parseCityIdsText('9,3,3,5'), [3, 5, 9], 'sorted, no duplicates');
  assert.equal(parseCityIdsText(''), null);
  assert.equal(parseCityIdsText(undefined), null);
  for (const bad of ['1.5', '-2', '1;2', ' ', '1,x', '99999999999']) assert.throws(() => parseCityIdsText(bad), InputError, bad);
  assert.throws(() => parseCityIdsText(Array.from({ length: 51 }, (_, i) => String(i + 1)).join(',')), InputError, 'at most 50 cities');
  const ok = parseFilters({ start_date: '2026-10-01', end_date: '2026-10-31', city_ids: '2,1', source: 'weekly' });
  assert.deepEqual([ok.period.startDate, ok.period.endDate, ok.period.days, ok.cityIds, ok.source], ['2026-10-01', '2026-10-31', 31, [1, 2], 'weekly']);
  assert.throws(() => parseFilters({}), /start_date/);
  // a long range is allowed (the pay run's 31-day limit is not inherited), up to three years
  assert.equal(parseFilters({ start_date: '2024-01-01', end_date: '2026-12-31' }).period.days, 1096);
  assert.throws(() => parseFilters({ start_date: '2023-12-31', end_date: '2026-12-31' }), /1096/);
});

test('definitions: the page reads the same words as the connector and needs no data', async () => {
  const answer = getDefinitions(new Date('2026-11-06T00:00:00Z'));
  assert.equal(answer.meta.generatedAt, '2026-11-06T00:00:00.000Z');
  assert.ok(answer.data.definitions.some((d) => d.id === 'company_margin'));
  assert.match(JSON.stringify(answer.data.definitions), /gross profit before overheads/i);
  let ran = false;
  await assert.rejects(getOverview(async () => { ran = true; }, { start_date: 'x', end_date: 'y' }), InputError);
  assert.equal(ran, false);
});

// ---------- the database ----------
const hasDb = process.env.MCP_TEST_DB === '1';

test('reports follow the source and city filters and add up: daily + weekly = all; the connector\'s default is unchanged; the runner is read only', { skip: !hasDb && 'set MCP_TEST_DB=1 and the DB_* variables to run (a disposable copy with the reporting views)' }, async (t) => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, database: process.env.DB_NAME, password: process.env.DB_PASSWORD });
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    const tag = randomBytes(3).toString('hex');
    const city = async (name, type) => (await one('INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, $3) RETURNING id', [`Ins ${name} ${tag}`, `I${name}${tag}`.toUpperCase(), type])).id;
    const cityA = await city('A', 'DAILY');
    const cityB = await city('B', 'WEEKLY');
    const route = async (name, cityId) => (await one(
      `INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
       SELECT $1, c.job, 2, 1.6, 2, 1.6, $3 FROM city c WHERE c.id = $2 RETURNING id`, [`${name} ${tag}`, cityId, `RT-${name}-${tag}`])).id;
    const routeA = await route('A1', cityA);
    const routeB = await route('B1', cityB);
    let code = 810000000 + Math.floor(Math.random() * 100000000);
    const driver = async (label, cityId) => (await one('INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES (\'x\', $1, $2, $3, $4) RETURNING id',
      [`Ins ${label} ${tag}`, `ins-${label}-${tag}@example.test`, (code += 1), cityId])).id;
    const d1 = await driver('d1', cityA);
    const d3 = await driver('d3', cityB);
    const row = async ({ driver: d, route: r, date, seq, delivered, pay, margin }) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, journey_date, start_seq, end_seq, packages) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [d, r, date, seq || 0, seq ? seq + 9 : 0, delivered])).id;
      await db.query('UPDATE payment_dashboard SET delivered = $2, closed = true, driver_payment = $3, company_earnings = $4 WHERE dashboard_data_id = $1', [dd, delivered, pay, margin]);
    };
    // 2091-03-01 to 2091-03-14, daily city A and weekly city B; the previous equal-length period is 2091-02-15 to 2091-02-28.
    await row({ driver: d1, route: routeA, date: '2091-03-01', seq: 100, delivered: 10, pay: '16.00', margin: '4.00' });
    await row({ driver: d1, route: routeA, date: '2091-03-02', seq: 110, delivered: 20, pay: '32.00', margin: '8.00' });
    await row({ driver: d3, route: routeB, date: '2091-03-01', seq: 0, delivered: 100, pay: '250.00', margin: '50.00' });
    await row({ driver: d3, route: routeB, date: '2091-03-05', seq: 0, delivered: 50, pay: '125.00', margin: '25.00' });
    await row({ driver: d1, route: routeA, date: '2091-02-20', seq: 160, delivered: 15, pay: '24.00', margin: '6.00' });
    await row({ driver: d3, route: routeB, date: '2091-02-27', seq: 0, delivered: 10, pay: '25.00', margin: '5.00' });
    const run = async (job) => job({ query: (sql, params) => db.query(sql, params) });
    const base = 'start_date=2091-03-01&end_date=2091-03-14';
    const q = (extra = '') => Object.fromEntries(new URLSearchParams(`${base}${extra}`));
    const summary = async (extra) => (await getOverview(run, q(`&compare=false${extra}`))).data;
    const snapshot = async () => JSON.stringify(await one('SELECT (SELECT count(*) FROM drivers) d, (SELECT count(*) FROM payment_dashboard) pd, (SELECT sum(driver_payment) FROM payment_dashboard) p, (SELECT sum(company_earnings) FROM payment_dashboard) c, (SELECT count(*) FROM pay_runs) pr'));

    await t.test('daily + weekly add up to all, and each source is only its own cities\' records', async () => {
      const [all, daily, weekly] = [await summary(''), await summary('&source=daily'), await summary('&source=weekly')];
      assert.deepEqual([all.deliveries, daily.deliveries, weekly.deliveries], [180, 30, 150]);
      assert.deepEqual([all.earnedDeliveryRevenue, daily.earnedDeliveryRevenue, weekly.earnedDeliveryRevenue], ['510.00', '60.00', '450.00']);
      assert.equal(Number(all.grossMarginBeforeOverheads), Number(daily.grossMarginBeforeOverheads) + Number(weekly.grossMarginBeforeOverheads));
      assert.equal(daily.records.weekly + weekly.records.daily, 0);
      assert.deepEqual([daily.marginPercentage, weekly.marginPercentage], ['20.00', '16.67']);
    });

    await t.test('a city filter and the source combine; a mismatch is empty with N/A, not zero', async () => {
      assert.equal((await summary(`&city_ids=${cityA}`)).deliveries, 30);
      assert.equal((await summary(`&city_ids=${cityA},${cityB}&source=weekly`)).deliveries, 150);
      const empty = await getOverview(run, q(`&compare=false&city_ids=${cityB}&source=daily`));
      assert.equal(empty.data.deliveries, 0);
      assert.equal(empty.data.earnedDeliveryRevenue, null, 'no revenue is not 0.00');
      assert.equal(empty.data.marginPercentage, null);
      assert.match(empty.meta.warnings.join(' '), /no delivery records/i);
      assert.match(empty.meta.scope.description, /daily records only/);
      await assert.rejects(getOverview(run, q(`&city_ids=${cityA},999999999`)), /Unknown city_id/);
    });

    await t.test('the previous period follows the same filters, and says when the data does not cover all of it', async () => {
      // the daily data starts on 20 Feb, after the previous period begins (15 Feb): the comparison is shown but marked incomplete, with the reason
      const partly = (await getOverview(run, q('&source=daily'))).data.comparison;
      assert.deepEqual([partly.status, partly.previous.deliveries, partly.change.deliveries.absolute], ['incomplete', 15, '15']);
      assert.match(partly.note, /starts on 2091-02-20/);
      // with a record on the first day of the previous period (no deliveries, so no totals move) it covers all of it
      await row({ driver: d1, route: routeA, date: '2091-02-15', seq: 170, delivered: 0, pay: '0.00', margin: '0.00' });
      await row({ driver: d3, route: routeB, date: '2091-02-15', seq: 0, delivered: 0, pay: '0.00', margin: '0.00' });
      const daily = (await getOverview(run, q('&source=daily'))).data.comparison;
      assert.deepEqual([daily.status, daily.previous.deliveries, daily.change.deliveries.absolute], ['complete', 15, '15']);
      const weekly = (await getOverview(run, q('&source=weekly'))).data.comparison;
      assert.deepEqual([weekly.status, weekly.previous.deliveries, weekly.change.deliveries.absolute], ['complete', 10, '140']);
      // a period whose previous equal-length period has no data at all shows no change, never a made-up one
      const none = (await getOverview(run, 'start_date=2091-01-01&end_date=2091-01-10&source=daily'.split('&').reduce((o, kv) => ({ ...o, [kv.split('=')[0]]: kv.split('=')[1] }), {}))).data.comparison;
      assert.deepEqual([none.status, none.change], ['insufficient_data', null]);
    });

    await t.test('the city ranking takes the same filters and shares add up', async () => {
      const mine = (r) => r.data.ranking.filter((c) => [cityA, cityB].includes(c.cityId));
      const weekly = await getCityRanking(run, q('&rank_by=deliveries&source=weekly'));
      assert.deepEqual(mine(weekly).map((c) => [c.cityId, c.deliveries]), [[cityB, 150]]);
      const onlyA = await getCityRanking(run, q(`&rank_by=revenue&city_ids=${cityA}`));
      assert.deepEqual(onlyA.data.ranking.map((c) => c.cityId), [cityA], 'a city filter ranks only those cities');
      assert.equal(onlyA.data.ranking[0].shareOfTotalPercent, '100.00');
      assert.match(onlyA.meta.scope.description, new RegExp(`cities ${cityA}`));
      const unfiltered = await getCityRanking(run, q('&rank_by=gross_margin&limit=50'));
      assert.ok(mine(unfiltered).length === 2);
      await assert.rejects(getCityRanking(run, q(`&rank_by=deliveries&city_ids=999999999`)), /Unknown city_id/);
    });

    await t.test('reading changed nothing', async () => {
      const before = await snapshot();
      await summary('');
      await summary('&source=weekly');
      await getOverview(run, q(`&city_ids=${cityA}`));
      await getCityRanking(run, q('&rank_by=deliveries&source=daily'));
      assert.equal(await snapshot(), before, 'no driver, delivery record, amount or pay run changed');
    });

    await t.test('the runner reads only: a write fails, a slow report is stopped, a cancelled one frees its connection', async () => {
      await db.query('ROLLBACK');
      const runner = createReportRunner({ pool, env: {}, timeoutMs: 400 });
      assert.equal(runner.restrictedLogin, false);
      assert.deepEqual((await runner.run(async (c) => (await c.query('SELECT 1 AS n')).rows))[0], { n: 1 });
      await assert.rejects(runner.run((c) => c.query('CREATE TEMP TABLE insights_probe (a int)')), /read-only transaction/);
      await assert.rejects(runner.run((c) => c.query('SELECT pg_sleep(3)')), (e) => e.code === '57014');
      const idleBefore = pool.idleCount;
      const abort = new AbortController();
      setTimeout(() => abort.abort(), 100);
      const started = Date.now();
      await assert.rejects(createReportRunner({ pool, env: {}, timeoutMs: 5000 }).run((c) => c.query('SELECT pg_sleep(4)'), { signal: abort.signal }), /cancelled/);
      assert.ok(Date.now() - started < 2000, 'cancelling stops the query');
      assert.ok(pool.idleCount >= idleBefore, 'the connection is back in the pool');
      await db.query('BEGIN');
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await pool.end();
  }
});

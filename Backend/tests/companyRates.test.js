import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AdminDashboardQueries } from '../services/admin/dashboardQueries.js';
import { citiesWithVerifiedStatements, companyEarningsSql, companyPricesToStore, companyRatesRetired, noCompanyRateSql } from '../services/finance/companyRates.js';
import { publishStatement } from '../services/finance/gofoStatement/publishStatement.js';
import { statementSheets, statementWorkbook } from './helpers/gofoStatementFixture.js';

test('the SQL says what "no company rate" means, and the earnings formula is written once', () => {
  assert.equal(noCompanyRateSql('r', 'c'), "(c.city_type = 'WEEKLY' AND r.company_route_price = 0 AND r.company_doublestop_price = 0)");
  const sql = companyEarningsSql({ route: 'r', city: 'c', ds: 'wc.ds', fs: 'wc.fs' });
  assert.match(sql, /THEN NULL/);
  assert.match(sql, /wc\.ds \* \(r\.company_doublestop_price - r\.driver_doublestop_price\)\) \+ \(wc\.fs \* \(r\.company_route_price - r\.driver_route_price\)/);
  assert.match(companyEarningsSql({ route: 'r', city: 'c', ds: '1', fs: '2', keep: 'pd.company_earnings' }), /THEN pd\.company_earnings/);
});

test('a route save keeps the stored company prices in a retired city and uses the request elsewhere', () => {
  const stored = { company_route_price: '5.00', company_doublestop_price: '2.50' };
  const sent = { companyRoutePrice: 9, companyDoubleStopPrice: 8 };
  assert.deepEqual(companyPricesToStore({ retired: true, sent, current: stored }), { company_route_price: 5, company_doublestop_price: 2.5 }, 'an edited route keeps what it had');
  assert.deepEqual(companyPricesToStore({ retired: true, sent: { companyRoutePrice: NaN, companyDoubleStopPrice: NaN }, current: stored }), { company_route_price: 5, company_doublestop_price: 2.5 }, 'hidden fields are not needed');
  assert.deepEqual(companyPricesToStore({ retired: true, sent }), { company_route_price: 0, company_doublestop_price: 0 }, 'a new route has no company rate');
  assert.deepEqual(companyPricesToStore({ retired: false, sent, current: stored }), { company_route_price: 9, company_doublestop_price: 8 }, 'not retired: the request decides');
});

// Needs a PostgreSQL copy that has the app's tables (never production). PAYROLL_TEST_DB=1 and the DB_* variables. One rolled-back transaction, made-up data.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const MIGRATION = fileURLToPath(new URL('../migrations/2026-11-08-issue-252-carrier-statements.sql', import.meta.url));
const nestedPool = (client) => {
  let depth = 0;
  return {
    connect: async () => ({
      query: (sql, params) => {
        if (sql === 'BEGIN') { depth += 1; return client.query(`SAVEPOINT s${depth}`); }
        if (sql === 'COMMIT') { const name = `s${depth}`; depth -= 1; return client.query(`RELEASE SAVEPOINT ${name}`); }
        if (sql === 'ROLLBACK') { const name = `s${depth}`; depth -= 1; return client.query(`ROLLBACK TO SAVEPOINT ${name}`).then(() => client.query(`RELEASE SAVEPOINT ${name}`)); }
        return client.query(sql, params);
      },
      release: () => {},
    }),
  };
};

test('company prices are retired for a weekly city only once it has a verified statement; daily keeps them', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const client = await pool.connect();
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(MIGRATION, 'utf8'));
    const weekly = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Rates GOFO', 'TST GOFO', 'WEEKLY') RETURNING id")).id;
    const daily = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Rates SpeedX', 'TSD SPX', 'DAILY') RETURNING id")).id;
    const route = async (job, code, company) => (await one(
      'INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, $3, 3, $3, 1.5, $4) RETURNING id',
      [`Test ${code}`, job, company, code])).id;
    const routeNoRate = await route('Test Rates GOFO', 'TS01-001', 0);   // weekly, company prices retired
    const routeRated = await route('Test Rates GOFO', 'TS01-002', 5);    // weekly, an old route that still has company prices
    const routeDaily = await route('Test Rates SpeedX', 'TSD-001', 0);   // daily with 0 company prices: SpeedX keeps its formula
    const driver = async (name, code, cityId) => (await one("INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', $1, $2, $3, $4) RETURNING id", [name, `${name.replace(/\s+/g, '.')}@example.test`, code, cityId])).id;
    const driverW = await driver('Rates Test One', 90000401, weekly);
    const driverD = await driver('Rates Test Two', 90000402, daily);
    const row = async (driverId, routeId, day, { seq = 0, existing = '99.00' } = {}) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, journey_date, start_seq, end_seq, packages, first_stop, ds, delivered, closed, paid) VALUES ($1,$2,$3,$4,$5,3,2,1,3,true,false) RETURNING id',
        [driverId, routeId, day, seq, seq ? seq + 9 : 0])).id;
      return (await one('UPDATE payment_dashboard SET driver_payment = 1, company_earnings = $2 WHERE dashboard_data_id = $1 RETURNING id', [dd, existing])).id;
    };
    const noRateRow = await row(driverW, routeNoRate, '2026-09-01');
    const ratedRow = await row(driverW, routeRated, '2026-09-02');
    const dailyRow = await row(driverD, routeDaily, '2026-09-03', { seq: 100 });
    const formula = async (routeId) => (await one(`SELECT ${companyEarningsSql({ route: 'r', city: 'c', ds: '1', fs: '2' })} AS v FROM routes r JOIN city c ON c.job = r.job WHERE r.id = $1`, [routeId])).v;

    assert.equal(await formula(routeNoRate), null, 'a new weekly record with no company rate gets no company figure: nothing is estimated');
    assert.equal(await formula(routeRated), '7.50', 'a weekly route that still has company prices keeps the formula: 1 x (5 - 1.5) + 2 x (5 - 3)');
    assert.equal(await formula(routeDaily), '-7.50', 'daily SpeedX keeps its formula even at 0');

    await AdminDashboardQueries.updatePaymentTable(null, client);
    const company = async (id) => (await one('SELECT company_earnings AS v FROM payment_dashboard WHERE id = $1', [id])).v;
    assert.equal(await company(noRateRow), '99.00', 'recalculating a record with no company rate keeps the figure it already had');
    assert.equal(await company(ratedRow), '7.50');
    assert.equal(await company(dailyRow), '-7.50');

    assert.equal(await companyRatesRetired(client, 'Test Rates GOFO'), false, 'not before the first verified statement');
    assert.equal(await companyRatesRetired(client, 'Test Rates SpeedX'), false);
    assert.equal(await companyRatesRetired(client, 'No Such City'), false);
    const published = await publishStatement(nestedPool(client), await statementWorkbook(statementSheets({ idA: '90000401', idB: '90000499', routeA: 'TS01-001', routeB: 'TS01-002' })), { user: { id: 1 }, sourceLabel: 'rates.xlsx' });
    assert.equal(published.status, 'published');
    assert.equal(await companyRatesRetired(client, 'Test Rates GOFO'), true, 'a weekly city with a published statement');
    assert.equal(await companyRatesRetired(client, 'Test Rates SpeedX'), false, 'daily SpeedX never retires them');
    assert.deepEqual([...await citiesWithVerifiedStatements(client, [weekly, daily])], [weekly]);
    // Retirement keeps the stored prices: an untouched route and a route saved after publication estimate an unverified week the same way, and voiding changes nothing.
    const routeUntouched = await route('Test Rates GOFO', 'TS01-003', 5);            // same prices, never saved after publication
    const unverifiedA = await row(driverW, routeUntouched, '2026-09-10');
    const unverifiedB = await row(driverW, routeRated, '2026-09-11');                 // the route that is saved below
    await client.query("UPDATE routes SET company_route_price = $2, company_doublestop_price = $3 WHERE id = $1", [routeRated, ...Object.values(companyPricesToStore({ retired: true, sent: { companyRoutePrice: NaN, companyDoubleStopPrice: NaN }, current: (await one('SELECT * FROM routes WHERE id = $1', [routeRated])) }))]);
    const stored = async (id) => { const r = await one('SELECT company_route_price AS a, company_doublestop_price AS b FROM routes WHERE id = $1', [id]); return [r.a, r.b]; };
    assert.deepEqual(await stored(routeRated), ['5.00', '5.00'], 'saving a route in a retired city does not erase its prices');
    await AdminDashboardQueries.updatePaymentTable(null, client);
    assert.equal(await company(unverifiedA), '7.50');
    assert.equal(await company(unverifiedB), '7.50', 'the same estimate for the same unverified week, edited or not');
    await client.query("UPDATE carrier_statements SET status = 'voided', voided_at = now(), void_reason = 'test'");
    assert.equal(await companyRatesRetired(client, 'Test Rates GOFO'), false, 'a voided statement verifies nothing');
    assert.deepEqual(await stored(routeRated), ['5.00', '5.00'], 'voiding brings the same prices back, not zeros');
    await AdminDashboardQueries.updatePaymentTable(null, client);
    assert.equal(await company(unverifiedA), '7.50');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});

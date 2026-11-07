import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publishStatement } from '../services/finance/gofoStatement/publishStatement.js';
import { createStatementService } from '../services/finance/gofoStatement/statementService.js';
import { statementSheets, statementWorkbook } from './helpers/gofoStatementFixture.js';

// Needs a PostgreSQL copy that has the app's tables and the reporting views (never production). PAYROLL_TEST_DB=1 and the DB_* variables. One rolled-back
// transaction, made-up data. The numbers follow the owner's own worked example: margin before claims and adjustments, then the contribution after them.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const dir = (name) => fileURLToPath(new URL(`../migrations/${name}`, import.meta.url));
const nestedPool = (client) => {
  let depth = 0;
  return {
    query: (sql, params) => client.query(sql, params),
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

test('a statement\'s economics: revenue, driver earnings, margin before claims, contribution after them, settlement and net of insurance', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const client = await pool.connect();
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(dir('2026-11-08-issue-252-carrier-statements.sql'), 'utf8'));
    await client.query(readFileSync(dir('2026-11-08-issue-252-reporting-statement-revenue.sql'), 'utf8'));
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Economics GOFO', 'TST GOFO', 'WEEKLY') RETURNING id")).id;
    const route = async (code) => (await one('INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, 0, 3, 0, 1.5, $3) RETURNING id', [`Test ${code}`, 'Test Economics GOFO', code])).id;
    const routeA = await route('TS01-001');
    const routeB = await route('TS01-002');
    const driver = async (name, code) => (await one("INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', $1, $2, $3, $4) RETURNING id", [name, `${name.replace(/\s+/g, '.')}@example.test`, code, city])).id;
    const driverA = await driver('Economics Test One', 90000501);
    const driverB = await driver('Economics Test Two', 90000502);
    const row = async (driverId, routeId, day, pay, insurance) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, journey_date, start_seq, end_seq, packages, delivered, closed, paid) VALUES ($1,$2,$3,0,0,2,2,true,false) RETURNING id', [driverId, routeId, day])).id;
      await client.query('UPDATE payment_dashboard SET delivered = 2, driver_payment = $2, company_earnings = NULL, insurance_deduction = $3 WHERE dashboard_data_id = $1', [dd, pay, insurance]);
    };
    await row(driverA, routeA, '2026-10-19', '3.00', '1.92');
    await row(driverB, routeB, '2026-10-20', '1.50', '0');
    await row(driverB, routeA, '2026-10-23', '2.00', '0'); // work the carrier did not bill
    const db = nestedPool(client);
    const published = await publishStatement(db, await statementWorkbook(statementSheets({ idA: '90000501', idB: '90000502' })), { user: { id: 1 }, sourceLabel: 'economics.xlsx' });
    assert.equal(published.status, 'published');

    const [statement] = await createStatementService(db).list();
    assert.deepEqual(statement.economics, {
      deliveryRevenue: '4.91', driverEarnings: '6.50', deliveryMargin: '-1.59', carrierClaims: '-0.70', ledgerAdjustments: '-2.00', contribution: '-4.29',
      settlementPayable: '2.21', insuranceWithheld: '1.92', driverEarningsAfterInsurance: '4.58', matchedRevenue: '4.91', unallocatedRevenue: '0.00',
      nasaRecords: 3, nasaDeliveries: 6, recordsWithoutBilledFee: 1, recordsWithoutDriverEarnings: 0, carrierDeliveries: 5,
      carrierDeliveriesNote: 'The carrier counts offset tickets as deliveries; NASA keeps its own completed-delivery count.',
    });
    assert.equal(statement.economics.deliveryRevenue, statement.deliveryRevenue, 'the list and the economics agree on revenue');

    const csv = await createStatementService(db).exportCsv();
    const [header, line] = csv.split('\r\n');
    assert.match(header, /^City,Billing week,Week start,Week end,Bill number,Version,Status,Delivery revenue,Matched revenue,Unallocated revenue,Driver earnings,Delivery margin,Carrier claims,Ledger adjustments,Contribution,GOFO settlement payable/);
    assert.match(line, /^Test Economics GOFO,Week 43-2026,2026-10-19,2026-10-25,AP0000000001,1,published,4\.91,4\.91,0\.00,6\.50,-1\.59,-0\.70,-2\.00,-4\.29,2\.21,1\.92,4\.58,6,5$/);
    assert.equal(/Economics Test/.test(csv), false, 'no driver name is exported');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});

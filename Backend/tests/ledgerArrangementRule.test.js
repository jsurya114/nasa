import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEntry } from '../services/payroll/ledger/ledgerStore.js';
import { parseNewEntry } from '../services/payroll/ledger/ledgerRules.js';
import { getDriverBalances, getMyBalances } from '../services/payroll/statements/statementStore.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables.
// Everything runs in one transaction that is always rolled back. All names and amounts are made up.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('a penalty or advance bigger than the driver\'s payment must say how it is repaid', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql']) await db.query(migration(m));
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('DFW GOFO', 'TSTARR', 'WEEKLY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('AR 1', 'DFW GOFO', 2, 1.6, 0.5, 0.25, 'AR-1') RETURNING id`)).id;
    const [d1, d2] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 2')).rows.map((r) => r.id);
    await db.query('UPDATE drivers SET city_id = $1 WHERE id = ANY($2::int[])', [city, [d1, d2]]);
    const tag = randomUUID();
    const admin = (await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Test ${tag}`, `${tag}@example.com`]));

    // d1's payment now: 120 closed and unpaid, less 20 insurance = 100. A paid row and an open row do not count.
    let seq = 9500;
    const payRow = async (driver, gross, insurance, { closed = true, paid = false } = {}) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [driver, route, seq, seq + 9, `2026-11-0${(seq % 5) + 1}`])).id;
      seq += 10;
      await one('UPDATE payment_dashboard SET closed = $2, paid = $3, driver_payment = $4, insurance_deduction = $5 WHERE dashboard_data_id = $1 RETURNING id', [dd, closed, paid, gross, insurance]);
    };
    await payRow(d1, '120.00', '20.00');
    await payRow(d1, '500.00', '0', { paid: true });
    await payRow(d1, '700.00', '0', { closed: false });

    const make = (o) => createEntry(db, admin, parseNewEntry({ requestId: randomUUID(), driverId: d1, cityId: city, reason: 'Test entry', effectiveDate: '2026-11-03', ...o }).entry);
    const refused = async (o) => {
      await db.query('SAVEPOINT s');
      try {
        await assert.rejects(make(o), (e) => e.status === 400 && /more than the driver's payment \(\$100\.00\)/.test(e.errors?.recoveryPlan ?? ''));
      } finally { await db.query('ROLLBACK TO SAVEPOINT s'); }
    };

    await t.test('the driver\'s payment is their closed, unpaid pay less insurance; paid and open rows do not count', async () => {
      const balances = await getDriverBalances(db, admin, d1, city);
      assert.equal(balances.payable, '100.00');
      assert.equal(await getMyBalances(db, d1).then((b) => b.payable), undefined, 'a driver is not shown the admin field');
      assert.equal((await getDriverBalances(db, admin, d2, city)).payable, '0.00');
    });

    await t.test('up to the payment, no arrangement is needed; more than it is refused with a message on the arrangement field', async () => {
      await make({ type: 'manual_claim', claimType: 'Damaged Item', amount: '100' }); // equal, not more
      await make({ type: 'advance', amount: '100', disbursedOutsidePayroll: true });
      await refused({ type: 'manual_claim', claimType: 'Late', amount: '100.01' });
      await refused({ type: 'advance', amount: '250', disbursedOutsidePayroll: true });
    });

    await t.test('with all on the next payday, or fixed instalments, any amount is accepted', async () => {
      assert.equal((await make({ type: 'manual_claim', claimType: 'Late', amount: '300', recoveryPlan: 'full_next_payday' })).entry.recovery_plan, 'full_next_payday');
      assert.equal((await make({ type: 'advance', amount: '300', disbursedOutsidePayroll: true, recoveryPlan: 'installments', installmentAmount: '50' })).entry.installment_amount, '50.00');
    });

    await t.test('a driver with no pay at all needs an arrangement for any amount', async () => {
      await db.query('SAVEPOINT s');
      try {
        await assert.rejects(createEntry(db, admin, parseNewEntry({ requestId: randomUUID(), driverId: d2, cityId: city, type: 'manual_claim', claimType: 'Late', amount: '1', reason: 'Test entry', effectiveDate: '2026-11-03' }).entry), { status: 400 });
      } finally { await db.query('ROLLBACK TO SAVEPOINT s'); }
    });

    await t.test('an exempt claim, an expense, and the credit types are not affected', async () => {
      const exempt = await make({ type: 'manual_claim', claimType: 'Tracking interruption', amount: '999' }); // DFW GOFO: not charged
      assert.equal(exempt.entry.exempt, true);
      assert.ok(await make({ type: 'expense', amount: '999' }));
      assert.ok(await make({ type: 'reimbursement', amount: '999' }));
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});

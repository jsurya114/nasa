// What the admin dashboard shows for one driver, one city and one date range (issue #166). Read-only: every figure is
// read from pay statements and ledger balances that already exist; nothing is calculated or recalculated here.
//
// - This payday: claim and recovery deductions on the pay runs inside the range. Finalized runs are approved and frozen,
//   drafts are only a preview. Their net is the pay run's own net, never "old payment minus a penalty total".
// - Still outstanding: what the driver still owes after pay runs, settlements and repayments made outside payroll (the balance
//   cards of the Payroll page), with the hand-entered penalties apart from the rest. The parts add up to the total exactly.
// A run counts only when its whole period lies inside the range, so a deduction is never counted for two ranges or
// spread over daily rows. A run that crosses the range edge is reported, not counted.

import { fromCents, toCents } from '../payRuns/payCalculator.js';
import { assertCityAllowed, PayrollError } from '../payRuns/payRunStore.js';
import { parseDate } from '../ledger/ledgerRules.js';
import { getDriverBalances } from './statementStore.js';

const sum = (rows, key) => rows.reduce((total, r) => total + toCents(r[key]), 0);

const totalsOf = (rows) => {
  const claims = sum(rows, 'claim_deductions');
  const recoveries = sum(rows, 'recoveries');
  return { count: rows.length, claimDeductions: fromCents(claims), recoveries: fromCents(recoveries), deducted: fromCents(claims + recoveries), net: fromCents(sum(rows, 'net')) };
};

// range: { from, to } as YYYY-MM-DD. Returns the figures, or throws PayrollError (400, 403, 404).
export const getDriverPeriodSummary = async (db, admin, { driverId, cityId, from, to }) => {
  if (!parseDate(from) || !parseDate(to) || from > to) throw new PayrollError(400, 'from and to must be real dates (YYYY-MM-DD), from not after to');
  await assertCityAllowed(db, admin, cityId);
  const { rows: driver } = await db.query('SELECT 1 FROM drivers WHERE id = $1 AND city_id = $2', [driverId, cityId]);
  if (driver.length === 0) throw new PayrollError(404, 'driver not found in this city');

  const { rows } = await db.query(
    `SELECT s.id AS statement_id, r.id AS run_id, r.status AS run_status,
            to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
            s.claim_deductions, s.recoveries, s.net, (r.period_start >= $3 AND r.period_end <= $4) AS inside
       FROM pay_statements s JOIN pay_runs r ON r.id = s.pay_run_id
      WHERE s.driver_id = $1 AND r.city_id = $2 AND r.status IN ('draft', 'finalized')
        AND r.period_start <= $4 AND r.period_end >= $3
      ORDER BY r.period_start, r.id`,
    [driverId, cityId, from, to]
  );
  const inside = rows.filter((r) => r.inside);
  // The split comes from the server's own allocation, which spreads repayments made outside payroll over what is owed, so
  // penalties and other debts always add up to the total. Linked settlements and waivers are already in each entry's balance.
  const { totals } = await getDriverBalances(db, admin, driverId, cityId);

  return {
    driverId, cityId, from, to,
    // approved: finalized runs, frozen. preview: drafts, not yet approved. Show approved when there is any.
    period: {
      status: inside.some((r) => r.run_status === 'finalized') ? 'approved' : inside.length ? 'preview' : 'none',
      approved: totalsOf(inside.filter((r) => r.run_status === 'finalized')),
      preview: totalsOf(inside.filter((r) => r.run_status === 'draft')),
      statements: inside.map((r) => ({ statementId: r.statement_id, runId: r.run_id, runStatus: r.run_status, periodStart: r.period_start, periodEnd: r.period_end,
        claimDeductions: r.claim_deductions, recoveries: r.recoveries, net: r.net })),
      crossingRuns: rows.length - inside.length,
    },
    outstanding: { penalties: totals.owedPenalties, other: totals.owedOther, total: totals.owedByDriver },
  };
};

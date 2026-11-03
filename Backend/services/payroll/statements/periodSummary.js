// What the admin dashboard shows for one driver, one city and one date range (issue #166). Read-only.
//
// - This payday (`payday`): what comes off the driver this payday, by how each record was created (all on the next payday, or
//   its instalment), under the recovery limit and the review holds. If a pay run inside the range exists, its own figures are
//   used: finalized runs are approved and frozen, drafts are previews. If none exists, the same pay calculator that builds a
//   run is run on a copy and nothing is saved (`estimate`), so the dashboard agrees with the run that will follow.
// - Still outstanding: what the driver still owes after pay runs, settlements and repayments made outside payroll (the balance
//   cards of the Payroll page), with the hand-entered penalties apart from the rest. The parts add up to the total exactly.
// A run counts only when its whole period lies inside the range, so a deduction is never counted for two ranges or
// spread over daily rows. A run that crosses the range edge is reported, not counted.

import { calculateStatement, fromCents, toCents } from '../payRuns/payCalculator.js';
import {
  assertCityAllowed, getRecoveryLimit, inputsFor, loadClaims, loadEarnings, loadLedger, loadOverRecovered, PayrollError,
} from '../payRuns/payRunStore.js';
import { parseDate } from '../ledger/ledgerRules.js';
import { getDriverBalances } from './statementStore.js';

const sum = (rows, key) => rows.reduce((total, r) => total + toCents(r[key]), 0);

const totalsOf = (rows) => {
  const claims = sum(rows, 'claim_deductions');
  const recoveries = sum(rows, 'recoveries');
  return { count: rows.length, claimDeductions: fromCents(claims), recoveries: fromCents(recoveries), deducted: fromCents(claims + recoveries), net: fromCents(sum(rows, 'net')) };
};

// A read-only run of the pay calculator for this driver and range, for when no pay run exists yet. Nothing is written and no row
// is locked. A driver with no closed, unpaid pay rows in the range still gets a result, so the reasons (no recovery limit set, no
// repayment arrangement, ...) are shown instead of a silent zero.
const estimatePayday = async (db, driverId, cityId, from, to) => {
  const recoveryLimit = await getRecoveryLimit(db);
  let claims = 0;
  let recoveries = 0;
  const flags = [];
  const seen = new Set();
  const collect = (result) => {
    claims += toCents(result.totals.claimDeductions);
    recoveries += toCents(result.totals.recoveries);
    for (const f of result.flags) if (!seen.has(f.code)) { seen.add(f.code); flags.push({ code: f.code, message: f.message }); }
  };
  let any = false;
  for (const dataType of ['daily', 'weekly']) {
    const run = { id: 0, city_id: cityId, period_start: from, period_end: to, data_type: dataType, recovery_limit: recoveryLimit };
    const earnings = (await loadEarnings(db, run)).filter((e) => e.driver_id === driverId);
    if (earnings.length === 0) continue;
    any = true;
    const [c, l, o] = await Promise.all([loadClaims(db, cityId, [driverId], false), loadLedger(db, run, [driverId], false), loadOverRecovered(db, cityId, [driverId])]);
    collect(calculateStatement(inputsFor(driverId, run, earnings, c, l, o)));
  }
  if (!any) {
    const run = { id: 0, city_id: cityId, period_start: from, period_end: to, data_type: 'weekly', recovery_limit: recoveryLimit };
    const [c, l, o] = await Promise.all([loadClaims(db, cityId, [driverId], false), loadLedger(db, run, [driverId], false), loadOverRecovered(db, cityId, [driverId])]);
    collect(calculateStatement(inputsFor(driverId, run, [], c, l, o)));
  }
  return { claimDeductions: fromCents(claims), recoveries: fromCents(recoveries), deducted: fromCents(claims + recoveries), flags };
};

// range: { from, to } as YYYY-MM-DD, or both left out. Without dates only what is outstanding is returned (the dashboard
// shows it as soon as a record is saved); the pay-run part is then empty. Returns the figures, or throws PayrollError.
export const getDriverPeriodSummary = async (db, admin, { driverId, cityId, from, to }) => {
  const hasRange = Boolean(from || to);
  if (hasRange && (!parseDate(from) || !parseDate(to) || from > to)) throw new PayrollError(400, 'from and to must be real dates (YYYY-MM-DD), from not after to, or both left out');
  await assertCityAllowed(db, admin, cityId);
  const { rows: driver } = await db.query('SELECT 1 FROM drivers WHERE id = $1 AND city_id = $2', [driverId, cityId]);
  if (driver.length === 0) throw new PayrollError(404, 'driver not found in this city');

  const { rows } = hasRange ? await db.query(
    `SELECT s.id AS statement_id, r.id AS run_id, r.status AS run_status,
            to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
            s.claim_deductions, s.recoveries, s.net, (r.period_start >= $3 AND r.period_end <= $4) AS inside
       FROM pay_statements s JOIN pay_runs r ON r.id = s.pay_run_id
      WHERE s.driver_id = $1 AND r.city_id = $2 AND r.status IN ('draft', 'finalized')
        AND r.period_start <= $4 AND r.period_end >= $3
      ORDER BY r.period_start, r.id`,
    [driverId, cityId, from, to]
  ) : { rows: [] };
  const inside = rows.filter((r) => r.inside);
  // The split comes from the server's own allocation, which spreads repayments made outside payroll over what is owed, so
  // penalties and other debts always add up to the total. Linked settlements and waivers are already in each entry's balance.
  const { totals } = await getDriverBalances(db, admin, driverId, cityId);

  // This payday: an approved run's frozen figures, else a draft's, else an estimate from the calculator, else nothing (no dates).
  const approved = totalsOf(inside.filter((r) => r.run_status === 'finalized'));
  const draft = totalsOf(inside.filter((r) => r.run_status === 'draft'));
  let payday = { source: 'none', claimDeductions: '0.00', recoveries: '0.00', deducted: '0.00', net: null, flags: [] };
  if (approved.count > 0) payday = { source: 'approved', ...approved, flags: [] };
  else if (draft.count > 0) payday = { source: 'draft', ...draft, flags: [] };
  else if (hasRange) payday = { source: 'estimate', ...(await estimatePayday(db, driverId, cityId, from, to)), net: null };

  return {
    driverId, cityId, from: from || null, to: to || null,
    // This payday's deduction, by how each record was created. `net` is the pay run's own net when a run exists, else null.
    payday,
    // approved: finalized runs, frozen. preview: drafts, not yet approved. Show approved when there is any.
    period: {
      status: inside.some((r) => r.run_status === 'finalized') ? 'approved' : inside.length ? 'preview' : 'none',
      approved,
      preview: draft,
      statements: inside.map((r) => ({ statementId: r.statement_id, runId: r.run_id, runStatus: r.run_status, periodStart: r.period_start, periodEnd: r.period_end,
        claimDeductions: r.claim_deductions, recoveries: r.recoveries, net: r.net })),
      crossingRuns: rows.length - inside.length,
    },
    // What is still owed in all, apart from this payday's share: never implies the whole amount is due now.
    outstanding: { penalties: totals.owedPenalties, other: totals.owedOther, total: totals.owedByDriver },
  };
};

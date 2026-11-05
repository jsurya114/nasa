// What the admin dashboard shows for one driver, one city and one date range (issue #166). Read-only.
//
// - This payday (`payday`): what comes off the driver this payday, by how each record was created (all on the next payday, or
//   its instalment), under the recovery limit and the review holds. If a pay run inside the range exists, its own figures are
//   used: finalized runs are approved and frozen, drafts are previews. If none exists, the same pay calculator that builds a
//   run is run on a copy and nothing is saved (`estimate`), so the dashboard agrees with the run that will follow.
// - Still outstanding: what the driver still owes after pay runs, settlements and repayments made outside payroll (the balance
//   cards of the Payroll page), with the penalties (hand-entered and carrier claims from the Excel) apart from the rest. The parts add up to the total exactly.
// A run counts only when its whole period lies inside the range, so a deduction is never counted for two ranges or
// spread over daily rows. A run that crosses the range edge is reported, not counted.

import { calculateStatement, fromCents, toCents } from '../payRuns/payCalculator.js';
import {
  assertCityAllowed, inputsFor, loadClaims, loadEarnings, loadLedger, loadOverRecovered, PayrollError,
} from '../payRuns/payRunStore.js';
import { parseDate } from '../ledger/ledgerRules.js';
import { getDriverBalances } from './statementStore.js';

// The dashboard's estimate shows what each record asks for this payday, capped only by the pay available, whatever recovery limit the
// pay runs use. Saved pay runs (draft or approved) keep applying the limit; their own figures are shown once they exist.
const ESTIMATE_LIMIT = Object.freeze({ type: 'percent_of_available', value: 100 });

const sum = (rows, key) => rows.reduce((total, r) => total + toCents(r[key]), 0);

const totalsOf = (rows) => {
  const claims = sum(rows, 'claim_deductions');
  const recoveries = sum(rows, 'recoveries');
  return { count: rows.length, claimDeductions: fromCents(claims), recoveries: fromCents(recoveries), deducted: fromCents(claims + recoveries), net: fromCents(sum(rows, 'net')) };
};

// A read-only run of the pay calculator for this driver and range, for when no pay run exists yet. Nothing is written and no row
// is locked. With no range (from and to null) the period is the span of this driver's own closed, unpaid pay rows, the period a real run
// for that work would cover, so an instalment taken for an earlier period is not mistaken for one taken in this period. It follows what real drafts do: if the driver has both daily and weekly pay rows in the range, the daily run is
// worked out first and what it takes (claims, instalments) and pays (reimbursements) is carried into the weekly one, as the
// reservations of a first draft are for the second, so nothing is counted twice. `net` is the calculator's own net for the
// same earnings (reimbursements included). When the driver has no closed, unpaid pay rows in the range a real run creates no
// statement, so nothing is taken and `net` is null; the reasons (no recovery limit set, no repayment arrangement, ...) are still
// returned.
// The span of the driver's own closed, unpaid pay rows not yet on a run (both data types): from their first day to today, or to their last
// day if that is later. A real run is drafted for the latest days and ends today, so a record dated up to today is due in it; ending the
// span at the work's last day would call a penalty entered after that week "not yet due" and silently take nothing. With no such rows the
// span is today.
const workSpan = async (db, driverId, cityId, recoveryLimit) => {
  const wide = { id: 0, city_id: cityId, period_start: '1970-01-01', period_end: '2999-12-31', recovery_limit: recoveryLimit };
  const days = [];
  for (const dataType of ['daily', 'weekly']) {
    (await loadEarnings(db, { ...wide, data_type: dataType })).filter((e) => e.driver_id === driverId).forEach((e) => days.push(e.journey_date));
  }
  const { rows } = await db.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d");
  const today = rows[0].d;
  if (days.length) {
    const last = days.reduce((a, b) => (a > b ? a : b));
    return { from: days.reduce((a, b) => (a < b ? a : b)), to: last > today ? last : today };
  }
  return { from: today, to: today };
};

const estimatePayday = async (db, driverId, cityId, rangeFrom, rangeTo) => {
  const recoveryLimit = ESTIMATE_LIMIT;
  const { from, to } = rangeFrom && rangeTo ? { from: rangeFrom, to: rangeTo } : await workSpan(db, driverId, cityId, recoveryLimit);
  const base = { id: 0, city_id: cityId, period_start: from, period_end: to, recovery_limit: recoveryLimit };
  const [claims, ledger, over] = await Promise.all([
    loadClaims(db, cityId, [driverId], false), loadLedger(db, base, [driverId], false), loadOverRecovered(db, cityId, [driverId]),
  ]);
  const takeOff = (row, key, lineAmount) => { row[key] = fromCents(toCents(row[key]) + toCents(lineAmount)); };

  let claimCents = 0;
  let recoveryCents = 0;
  let netCents = 0;
  let any = false;
  const flags = [];
  const seen = new Set();
  const run = (dataType, earnings) => {
    // Carrier claims are taken only by a weekly run; a daily run never consumes them.
    const result = calculateStatement(inputsFor(driverId, { ...base, data_type: dataType }, earnings, dataType === 'weekly' ? claims : [], ledger, over));
    claimCents += toCents(result.totals.claimDeductions);
    recoveryCents += toCents(result.totals.recoveries);
    netCents += toCents(result.totals.net);
    for (const f of result.flags) if (!seen.has(f.code)) { seen.add(f.code); flags.push({ code: f.code, message: f.message }); }
    // What this run takes or pays is spoken for when the next one is worked out.
    for (const line of result.lines) {
      if (line.type === 'claim') takeOff(claims.find((c) => String(c.claim_id) === String(line.claimId)), 'outstanding', line.amount);
      if (line.type === 'recovery') {
        const e = ledger.find((x) => String(x.id) === String(line.entryId));
        takeOff(e, 'outstanding', line.amount);
        e.recovered_in_overlap = true; // the next run covers the same period, so it takes no second instalment
      }
      if (line.type === 'reimbursement') ledger.find((x) => String(x.id) === String(line.entryId)).reimbursed = true;
    }
  };
  for (const dataType of ['daily', 'weekly']) {
    const earnings = (await loadEarnings(db, { ...base, data_type: dataType })).filter((e) => e.driver_id === driverId);
    if (earnings.length === 0) continue;
    any = true;
    run(dataType, earnings);
  }
  if (!any) {
    // No closed, unpaid pay rows in the range (none, already paid, or already on a run), so a real run creates no statement for
    // this driver and takes nothing. Nothing is estimated: a reimbursement or credit is not money paid by a statement that cannot
    // exist, so it must not fund a deduction. The calculator is run without credits only to collect the reasons.
    const debitsOnly = ledger.filter((e) => e.direction === 'debit');
    const result = calculateStatement(inputsFor(driverId, { ...base, data_type: 'weekly' }, [], claims, debitsOnly, over));
    for (const f of result.flags) {
      if (f.code === 'carried_forward') continue; // "limit reached" would mislead: the limit is not the reason
      if (!seen.has(f.code)) { seen.add(f.code); flags.push({ code: f.code, message: f.message }); }
    }
    flags.push({ code: 'no_eligible_earnings', message: 'no closed, unpaid pay rows in these dates, so nothing can be taken' });
    return { claimDeductions: '0.00', recoveries: '0.00', deducted: '0.00', net: null, flags };
  }
  return {
    claimDeductions: fromCents(claimCents), recoveries: fromCents(recoveryCents), deducted: fromCents(claimCents + recoveryCents),
    net: fromCents(netCents), flags,
  };
};

// range: { from, to } as YYYY-MM-DD, or both left out. Without dates (the owner does not want to choose them) the estimate covers all
// the driver's closed, unpaid pay, as the next pay run would; runs already made are then not looked at. Returns the
// figures, or throws PayrollError.
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
  else if (hasRange) payday = { source: 'estimate', ...(await estimatePayday(db, driverId, cityId, from, to)) };
  else {
    // No dates: all the driver's closed, unpaid pay, over the span of that work (see estimatePayday).
    payday = { source: 'estimate', ...(await estimatePayday(db, driverId, cityId, null, null)) };
  }

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

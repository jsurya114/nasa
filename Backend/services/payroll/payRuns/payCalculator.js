// Works out one driver's pay statement for one pay run (issue #143). Pure: no database, no clock.
// All money is handled in whole cents and returned as "12.34" text.
//
// Proposed policy from the owner, 3 Nov 2026, NOT yet confirmed with the client (see issue #143):
// - Never a negative payout. Recover only up to the payday's recovery limit; the rest stays owed and carries forward.
// - The recovery limit is a setting. While it is not set (null), nothing is recovered automatically.
// - A debit is recovered by its recorded arrangement: all on the next payday, or fixed instalments.
//   A debit with no arrangement is flagged for review and not recovered.
// - Only matched, chargeable claims are recovered. Pending claims are not this function's input at all.

export const RECOVERY_LIMIT_TYPES = Object.freeze(['percent_of_available', 'fixed_amount']);

export const toCents = (value) => {
  const text = typeof value === 'number' ? value.toFixed(2) : String(value ?? '').trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error(`not a money amount: ${value}`);
  const [whole, part = ''] = text.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(part.padEnd(2, '0'));
  return text.startsWith('-') ? -cents : cents;
};

export const fromCents = (cents) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;

// The most that may be recovered this payday from `availableCents` (pay after insurance, plus reimbursements).
// Returns null when no limit is set, meaning: recover nothing automatically.
export const recoveryCap = (limit, availableCents) => {
  if (!limit) return null;
  if (availableCents <= 0) return 0;
  if (limit.type === 'percent_of_available') {
    const pct = Number(limit.value);
    if (!(pct >= 0 && pct <= 100)) throw new Error('recovery limit percent must be 0 to 100');
    return Math.floor((availableCents * pct) / 100);
  }
  if (limit.type === 'fixed_amount') return Math.min(toCents(limit.value), availableCents);
  throw new Error(`unknown recovery limit type: ${limit.type}`);
};

// Spreads repayments made outside payroll over the oldest debits first, so they lower what is still owed, and records
// how much of each repayment was used, so the run can keep an audit line for it.
const applyRepayments = (debits, repayments) => {
  const pool = [...repayments].sort((a, b) => String(a.entryId).localeCompare(String(b.entryId), undefined, { numeric: true }))
    .map((r) => ({ entryId: r.entryId, left: toCents(r.amount), used: 0 }));
  const allocated = debits.map((d) => {
    let owed = toCents(d.outstanding);
    let repaid = 0;
    for (const r of pool) {
      const use = Math.min(owed, r.left);
      r.left -= use;
      r.used += use;
      owed -= use;
      repaid += use;
    }
    return { ...d, owedCents: owed, repaidOutsideCents: repaid };
  });
  return { debits: allocated, used: pool.filter((r) => r.used > 0) };
};

// Why a debit is not recovered on this run even though it is owed. The run decides; the calculator only obeys.
export const HOLD_MESSAGES = Object.freeze({
  advance_not_disbursed: 'this advance is not marked as paid out to the driver; nothing is recovered until it is',
  already_recovered_this_period: 'already recovered on a run for an overlapping period; the next amount waits for the next pay period',
});

const byDateThenId = (dateKey) => (a, b) => (a[dateKey] < b[dateKey] ? -1 : a[dateKey] > b[dateKey] ? 1 : String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

// input:
//   periodEnd       "YYYY-MM-DD", last day of the run
//   recoveryLimit   null | { type: 'percent_of_available' | 'fixed_amount', value }
//   earnings        [{ paymentId, journeyDate, routeId, gross, insurance }]   closed, unpaid pay rows
//   reimbursements  [{ entryId, amount }]                                     credits paid to the driver
//   claims          [{ claimId, claimAt, outstanding }]                       matched chargeable claims, still owed
//   debits          [{ entryId, effectiveDate, intendedPayday, plan, installmentAmount, outstanding, hold? }]
//                   hold: a HOLD_MESSAGES code; the debit stays owed and is not recovered on this run
//   repayments      [{ entryId, amount }]                                     repaid outside payroll and already due
//   overRecovered   [{ claimId, amount }]  claims the carrier lowered after more was deducted; flagged, never refunded here
// Returns { lines, totals, flags }. Line amounts are signed: money to the driver is positive.
export const calculateStatement = (input) => {
  const flags = [];
  const lines = [];

  const earnings = [...(input.earnings ?? [])].sort(byDateThenId('journeyDate'));
  let grossCents = 0;
  let insuranceCents = 0;
  for (const e of earnings) {
    const gross = toCents(e.gross);
    const insurance = toCents(e.insurance ?? 0);
    grossCents += gross;
    insuranceCents += insurance;
    lines.push({ type: 'earning', paymentId: e.paymentId, journeyDate: e.journeyDate, amount: fromCents(gross) });
    if (insurance) lines.push({ type: 'insurance', paymentId: e.paymentId, journeyDate: e.journeyDate, amount: fromCents(-insurance) });
  }

  let reimbursementCents = 0;
  for (const r of input.reimbursements ?? []) {
    const cents = toCents(r.amount);
    reimbursementCents += cents;
    lines.push({ type: 'reimbursement', entryId: r.entryId, amount: fromCents(cents) });
  }

  const availableCents = grossCents - insuranceCents + reimbursementCents;
  if (availableCents < 0) flags.push({ code: 'negative_before_recovery', message: 'insurance is more than the pay; review before finalizing' });

  // What falls due this payday, oldest first: claims, then debits.
  const due = [];
  for (const c of [...(input.claims ?? [])].sort(byDateThenId('claimAt'))) {
    const owed = toCents(c.outstanding);
    if (owed > 0) due.push({ kind: 'claim', id: c.claimId, owed, want: owed });
  }
  const { debits, used } = applyRepayments([...(input.debits ?? [])].sort(byDateThenId('effectiveDate')), input.repayments ?? []);
  for (const r of used) lines.push({ type: 'repayment', entryId: r.entryId, amount: fromCents(r.used) });
  for (const d of debits) {
    if (d.owedCents <= 0) continue;
    const notYet = d.effectiveDate > input.periodEnd || (d.intendedPayday && d.intendedPayday > input.periodEnd);
    let want = 0;
    if (d.hold) flags.push({ code: d.hold, entryId: d.entryId, message: HOLD_MESSAGES[d.hold] ?? 'held for review; not recovered' });
    else if (notYet) want = 0;
    else if (d.plan === 'full_next_payday') want = d.owedCents;
    else if (d.plan === 'installments') want = Math.min(toCents(d.installmentAmount), d.owedCents);
    else flags.push({ code: 'needs_review', entryId: d.entryId, message: 'no repayment arrangement recorded; not recovered' });
    due.push({ kind: 'debit', id: d.entryId, owed: d.owedCents, want, repaidOutsideCents: d.repaidOutsideCents });
  }

  const cap = recoveryCap(input.recoveryLimit, availableCents);
  const wanted = due.reduce((sum, item) => sum + item.want, 0);
  if (cap === null && wanted > 0) flags.push({ code: 'recovery_limit_not_set', message: 'no recovery limit is set; nothing was recovered automatically' });

  let room = cap ?? 0;
  let claimCents = 0;
  let recoveryCents = 0;
  let carriedCents = 0;
  for (const item of due) {
    const take = Math.max(0, Math.min(item.want, room));
    room -= take;
    if (take > 0) {
      if (item.kind === 'claim') {
        claimCents += take;
        lines.push({ type: 'claim', claimId: item.id, amount: fromCents(-take) });
      } else {
        recoveryCents += take;
        lines.push({ type: 'recovery', entryId: item.id, amount: fromCents(-take) });
      }
    }
    carriedCents += item.owed - take;
    // With no limit set, the recovery_limit_not_set flag already says why nothing was taken.
    if (take < item.want && cap !== null) flags.push({ code: 'carried_forward', [item.kind === 'claim' ? 'claimId' : 'entryId']: item.id, message: `${fromCents(item.want - take)} of this payday's amount carried forward (limit reached)` });
  }

  for (const o of input.overRecovered ?? []) {
    flags.push({ code: 'claim_over_recovered', claimId: o.claimId, amount: o.amount,
      message: `the carrier lowered this claim after it was deducted: ${o.amount} more was taken than is now owed; record an approved correction` });
  }

  const netCents = availableCents - claimCents - recoveryCents;
  return {
    lines,
    flags,
    totals: {
      gross: fromCents(grossCents),
      insurance: fromCents(insuranceCents),
      reimbursements: fromCents(reimbursementCents),
      claimDeductions: fromCents(claimCents),
      recoveries: fromCents(recoveryCents),
      net: fromCents(netCents),
      carriedForward: fromCents(carriedCents),
    },
  };
};

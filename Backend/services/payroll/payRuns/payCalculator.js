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

// Spreads repayments made outside payroll over the oldest debits first, so they lower what is still owed.
const applyRepayments = (debits, repayments) => {
  let left = repayments.reduce((sum, r) => sum + toCents(r.amount), 0);
  return debits.map((d) => {
    const owed = toCents(d.outstanding);
    const used = Math.min(owed, left);
    left -= used;
    return { ...d, owedCents: owed - used, repaidOutsideCents: used };
  });
};

const byDateThenId = (dateKey) => (a, b) => (a[dateKey] < b[dateKey] ? -1 : a[dateKey] > b[dateKey] ? 1 : String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

// input:
//   periodEnd       "YYYY-MM-DD", last day of the run
//   recoveryLimit   null | { type: 'percent_of_available' | 'fixed_amount', value }
//   earnings        [{ paymentId, journeyDate, routeId, gross, insurance }]   closed, unpaid pay rows
//   reimbursements  [{ entryId, amount }]                                     credits paid to the driver
//   claims          [{ claimId, claimAt, outstanding }]                       matched chargeable claims, still owed
//   debits          [{ entryId, effectiveDate, intendedPayday, plan, installmentAmount, outstanding }]
//   repayments      [{ entryId, amount }]                                     repaid outside payroll, not yet allocated
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
  const debits = applyRepayments([...(input.debits ?? [])].sort(byDateThenId('effectiveDate')), input.repayments ?? []);
  for (const d of debits) {
    if (d.owedCents <= 0) continue;
    const notYet = d.effectiveDate > input.periodEnd || (d.intendedPayday && d.intendedPayday > input.periodEnd);
    let want = 0;
    if (notYet) want = 0;
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
    if (take < item.want) flags.push({ code: 'carried_forward', [item.kind === 'claim' ? 'claimId' : 'entryId']: item.id, message: `${fromCents(item.want - take)} of this payday's amount carried forward (limit reached)` });
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

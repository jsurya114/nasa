import { centsToText } from './statementMoney.js';

// Checks a parsed carrier statement against its own controls (issue: GOFO revenue and margin, part 1). All money is whole cents. The detail lines are the
// source of truth: the three summary sheets and the DSP Summary are only CONTROLS, compared with the detail totals and never added to them.
// A statement with any issue or any failed check is `rejected`: no finance figure from it may be published.

const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);
const maybe = (value) => (value === null || value === undefined ? 0 : value);

export const reconcileStatement = (statement) => {
  const checks = [];
  const compare = (name, expected, actual) => checks.push({ name, expected, actual, ok: expected !== null && expected !== undefined && expected === actual });

  const detailFees = sum(statement.details, (l) => l.feeCents);
  const offsets = sum(statement.offsets, (l) => l.feeCents);
  const deliveryRevenue = detailFees + offsets; // fees after offsets (offsets are negative)
  const claims = sum(statement.claims, (c) => c.amountCents);
  const adjustments = sum(statement.adjustments, (a) => a.amountCents);
  const settlementPayable = deliveryRevenue + claims + adjustments;
  const totals = { detailFees, offsets, deliveryRevenue, claims, adjustments, settlementPayable,
    prepaid: sum(statement.prepaid, (p) => p.amountCents), withdrawalFees: sum(statement.withdrawals, (w) => w.amountCents),
    detailLines: statement.details.length, offsetLines: statement.offsets.length };

  const h = statement.header;
  if (h) {
    compare('DSP Summary delivery fee = detail lines + offsets', h.deliveryFee, deliveryRevenue);
    compare('DSP Summary offset amount = Offset Details', h.offsetAmount, offsets);
    compare('DSP Summary claims = Claims Detail', h.claims, claims);
    compare('DSP Summary adjustments = General Ledger Adjustment', h.adjustments, adjustments);
    compare('DSP Summary total billing = revenue + claims + adjustments', h.totalBilling, settlementPayable);
    compare('DSP Summary remaining payable = total billing - prepayments', h.remainingPayable, settlementPayable - maybe(h.prepaid));
    compare('DSP Summary offset tickets = Offset Details lines', h.offsetTickets, statement.offsets.length);
    // The carrier's delivery count includes offset tickets in this file; NASA keeps its own completed-delivery definition and only checks this control.
    compare('DSP Summary deliveries = detail lines + offset lines', h.deliveries, statement.details.length + statement.offsets.length);
  }
  for (const [label, rows] of [['Driver Summary', statement.driverSummary], ['Driver Daily Summary', statement.dailySummary]]) {
    compare(`${label} delivery fees (after offsets) = detail lines + offsets`, sum(rows, (r) => maybe(r.deliveryFee)), deliveryRevenue);
    compare(`${label} bill (after claims and adjustments) = settlement payable`, sum(rows, (r) => maybe(r.totalBill)), settlementPayable);
  }
  const byDriver = new Map();
  for (const l of [...statement.details, ...statement.offsets]) byDriver.set(l.deliveryId, (byDriver.get(l.deliveryId) ?? 0) + l.feeCents);
  const mismatched = statement.driverSummary.filter((r) => r.deliveryId && maybe(r.deliveryFee) !== (byDriver.get(r.deliveryId) ?? 0));
  compare('Driver Summary: every driver\'s fees = that driver\'s detail lines + offsets', 0, mismatched.length);

  const currencyOk = h && h.currency === 'USD';
  checks.push({ name: 'Currency is USD', expected: 'USD', actual: h?.currency ?? null, ok: Boolean(currencyOk) });

  const failed = checks.filter((c) => !c.ok);
  const status = statement.issues.length === 0 && failed.length === 0 && h ? 'reconciled' : 'rejected';
  const view = (cents) => centsToText(cents);
  return {
    status, checks, failed, issues: statement.issues, totals,
    amounts: Object.fromEntries(['detailFees', 'offsets', 'deliveryRevenue', 'claims', 'adjustments', 'settlementPayable', 'prepaid', 'withdrawalFees'].map((k) => [k, view(totals[k])])),
    identity: h ? { billNumber: h.billNumber, fleet: h.fleet, billingPeriod: h.billingPeriod, billingPeriodRange: h.billingPeriodRange, currency: h.currency } : null,
    fingerprint: statement.fingerprint,
  };
};

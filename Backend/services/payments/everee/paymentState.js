import { toCents } from '../../payroll/payRuns/payCalculator.js';

// Reading what Everee says about a payment, as pure functions (issue #31, part 5). Nothing here touches the database or the network.
// "Paid" is claimed only when EVERY payout of the payment is PAID (Everee's Payment Data API: PENDING, PAID or FAILED). The answer's
// shape is only partly documented, so anything not understood is "unknown" and never counts as paid.

const PAYOUT_STATUSES = new Set(['PENDING', 'PAID', 'FAILED']);
const ID_TEXT = /^[A-Za-z0-9_.:-]{1,200}$/;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

// The payment a payable belongs to, from Everee's answer for the payable: { paymentStatus, paymentId } (either may be null).
export const readPayable = (data) => {
  const o = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    paymentStatus: typeof o.paymentStatus === 'string' ? o.paymentStatus.slice(0, 40) : null,
    paymentId: typeof o.paymentId === 'string' && ID_TEXT.test(o.paymentId) ? o.paymentId : null,
  };
};

const amountCents = (value) => {
  const raw = value && typeof value === 'object' ? value.amount : value;
  const n = typeof raw === 'string' && /^-?\d+(\.\d{1,2})?$/.test(raw) ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? toCents(n.toFixed(2)) : null;
};

// state: 'landed' (all payouts PAID) | 'returned' (some FAILED: a bank returned the deposit) | 'pending' | 'unknown'.
// netCents: the sum of the payouts when every one states an amount, else null.
export const readPayoutState = (body) => {
  const payouts = body && typeof body === 'object' && Array.isArray(body.netPayouts) ? body.netPayouts : null;
  if (!payouts || payouts.length === 0) return { state: 'unknown', netCents: null, payDate: null };
  const statuses = payouts.map((p) => (p && typeof p.status === 'string' ? p.status.toUpperCase() : ''));
  if (statuses.some((s) => !PAYOUT_STATUSES.has(s))) return { state: 'unknown', netCents: null, payDate: null };
  const amounts = payouts.map((p) => amountCents(p.netAmount));
  const netCents = amounts.every((a) => a !== null) ? amounts.reduce((sum, a) => sum + a, 0) : null;
  const payDate = typeof body.payDate === 'string' && DATE_TEXT.test(body.payDate) ? body.payDate : null;
  let state = 'landed';
  if (statuses.includes('FAILED')) state = 'returned';
  else if (statuses.includes('PENDING')) state = 'pending';
  return { state, netCents, payDate };
};

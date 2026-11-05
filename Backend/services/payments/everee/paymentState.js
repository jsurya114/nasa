import { toCents } from '../../payroll/payRuns/payCalculator.js';

// Reading what Everee says about a payment, as pure functions (issue #31, part 5). Nothing here touches the database or the network.
// "Paid" is claimed only when EVERY payout of the payment is PAID (Everee's Payment Data API: PENDING, PAID or FAILED). The answer's
// shape is only partly documented, so anything not understood is "unknown" and never counts as paid.

const PAYOUT_STATUSES = new Set(['PENDING', 'PAID', 'FAILED']);
const ID_TEXT = /^[A-Za-z0-9_.:-]{1,200}$/;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

export const isPaymentId = (value) => typeof value === 'string' && ID_TEXT.test(value);

// Everee's payment ID is a number in its payable answer (and a string in its events and its Payment Data API); both are the same ID, kept as text.
const paymentIdOf = (raw) => {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? String(raw) : null;
  return typeof raw === 'string' && ID_TEXT.test(raw) ? raw : null;
};

// The payment a payable belongs to, from Everee's answer for the payable: { paymentStatus, paymentId } (either may be null).
export const readPayable = (data) => {
  const o = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    paymentStatus: typeof o.paymentStatus === 'string' ? o.paymentStatus.slice(0, 40) : null,
    paymentId: paymentIdOf(o.paymentId),
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
  if (!payouts || payouts.length === 0) return { state: 'unknown', netCents: null, payDate: null, workerId: null };
  const statuses = payouts.map((p) => (p && typeof p.status === 'string' ? p.status.toUpperCase() : ''));
  if (statuses.some((s) => !PAYOUT_STATUSES.has(s))) return { state: 'unknown', netCents: null, payDate: null, workerId: null };
  const amounts = payouts.map((p) => amountCents(p.netAmount));
  const netCents = amounts.every((a) => a !== null) ? amounts.reduce((sum, a) => sum + a, 0) : null;
  const payDate = typeof body.payDate === 'string' && DATE_TEXT.test(body.payDate) ? body.payDate : null;
  let state = 'landed';
  if (statuses.includes('FAILED')) state = 'returned';
  else if (statuses.includes('PENDING')) state = 'pending';
  // The worker the payment belongs to, when the answer says (the field is not fully documented; absent means "not stated", never a match).
  const rawWorker = body.workerId ?? body.worker?.workerId ?? body.worker?.id;
  const workerId = (typeof rawWorker === 'string' || typeof rawWorker === 'number') && ID_TEXT.test(String(rawWorker)) ? String(rawWorker) : null;
  return { state, netCents, payDate, workerId };
};

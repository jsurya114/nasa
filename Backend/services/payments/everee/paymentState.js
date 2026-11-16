import { toCents } from '../../payroll/payRuns/payCalculator.js';

// Reading what Everee says about a payment, as pure functions (issue #31, part 5). Nothing here touches the database or the network.
// "Paid" is claimed only when EVERY payout of the payment is PAID (Everee's Payment Data API: PENDING, PAID or FAILED); in the sandbox alone, the
// payment's own PAID status is enough too (countsAsLanded, issue #242 follow-up). The answer's
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

const readWorkerId = (body) => {
  // The worker the payment belongs to, when the answer says (the field is not fully documented; absent means "not stated", never a match).
  const rawWorker = body.workerId ?? body.worker?.workerId ?? body.worker?.id;
  return (typeof rawWorker === 'string' || typeof rawWorker === 'number') && ID_TEXT.test(String(rawWorker)) ? String(rawWorker) : null;
};
const readPayDate = (body) => (typeof body.payDate === 'string' && DATE_TEXT.test(body.payDate) ? body.payDate : null);

// A payment Everee marks PAID whose payout list is empty: a card payment has no bank payout, and Everee states its net pay as 0.00. An empty list
// proves nothing about what was delivered (the payment's total is the sum of its payouts), so the amount is NOT taken from here: `needsPayoutCheck`
// tells the caller to read the payouts of this payment from Everee's net payouts list and verify them (readCardPayouts) before anything is settled.
const readPaidWithoutPayouts = (body) => ({
  state: 'pending', netCents: null, payDate: readPayDate(body), workerId: readWorkerId(body), paymentPaid: true, needsPayoutCheck: true,
});

const NET_PAYOUT_STATUSES = new Set(['PENDING', 'PAID', 'RETURNED', 'SUPERSEDED']);
const CARD_PAYOUT_TYPE = 'PAY_CARD';
const NOT_VERIFIED = (why) => ({ state: 'unknown', netCents: null, workerId: null, paymentPaid: false, why });

// Everee's net payouts list for one payment (GET /integration/v1/net-payouts?payment-id=): each payout has its payment, worker, type, status and
// amount. A payment paid to the worker's Everee card is verified here and only here: every payout in use must belong to this payment, be a card
// payout (PAY_CARD), and name the same worker (the worker the payment itself names, when it does). Replaced payouts (SUPERSEDED) are ignored; with no
// other payout, or any payout whose type, status, amount or worker is not understood, nothing is claimed. Then RETURNED is 'returned', PENDING is
// 'pending', and only when every payout in use is PAID is it 'landed', with the sum of their amounts. The caller still compares that sum with
// what NASA froze and checks the worker.
export const readCardPayouts = (listing, { paymentId, workerId = null }) => {
  if (!listing || typeof listing !== 'object' || !Array.isArray(listing.items)) return NOT_VERIFIED("Everee's payout list could not be read");
  if (listing.hasNextPage) return NOT_VERIFIED("Everee's payout list for this payment is longer than one page");
  const inUse = [];
  for (const p of listing.items) {
    if (!p || typeof p !== 'object') return NOT_VERIFIED("a payout in Everee's list was not understood");
    const status = typeof p.status === 'string' ? p.status.toUpperCase() : '';
    if (!NET_PAYOUT_STATUSES.has(status)) return NOT_VERIFIED("a payout in Everee's list has a status that is not understood");
    if (status === 'SUPERSEDED') continue;
    if (String(p.paymentId) !== String(paymentId)) return NOT_VERIFIED('a payout in the list belongs to another payment');
    if (typeof p.type !== 'string' || p.type.toUpperCase() !== CARD_PAYOUT_TYPE) return NOT_VERIFIED('the payout is not a pay card payout');
    inUse.push({ status, cents: amountCents(p.netAmount), worker: readWorkerId({ workerId: p.workerId }) });
  }
  if (inUse.length === 0) return NOT_VERIFIED("Everee's list has no active payout for this payment");
  const workers = new Set(inUse.map((p) => p.worker));
  if (workers.size !== 1 || workers.has(null)) return NOT_VERIFIED('the payout does not name one worker');
  const [worker] = workers;
  if (workerId !== null && workerId !== worker) return NOT_VERIFIED("the payment and its payout name different workers");
  if (inUse.some((p) => p.cents === null || p.cents <= 0)) return NOT_VERIFIED('the amount of the payout could not be read');
  const netCents = inUse.reduce((sum, p) => sum + p.cents, 0);
  const statuses = inUse.map((p) => p.status);
  // paymentPaid stays false: a pending payout must never count as landed through the payment's own PAID.
  let state = 'landed';
  if (statuses.includes('RETURNED')) state = 'returned';
  else if (statuses.includes('PENDING')) state = 'pending';
  return { state, netCents, workerId: worker, paymentPaid: false, why: null };
};

// state: 'landed' (all payouts PAID) | 'returned' (some FAILED: a bank returned the deposit) | 'pending' | 'unknown'.
// netCents: the sum of the payouts when every one states an amount, else null.
export const readPayoutState = (body) => {
  const payouts = body && typeof body === 'object' && Array.isArray(body.netPayouts) ? body.netPayouts : null;
  // Everee's real production answer for a payment it shows as PAID can carry an EMPTY payout list (seen on a paid contractor payment). The payment's own
  // PAID then decides, and its total (totalNetPay) is the amount the caller compares with what NASA sent. A payment that is not PAID, or has no payout
  // list at all, is still not understood.
  if (payouts && payouts.length === 0 && typeof body.status === 'string' && body.status.toUpperCase() === 'PAID') return readPaidWithoutPayouts(body);
  if (!payouts || payouts.length === 0) return { state: 'unknown', netCents: null, payDate: null, workerId: null };
  const statuses = payouts.map((p) => (p && typeof p.status === 'string' ? p.status.toUpperCase() : ''));
  if (statuses.some((s) => !PAYOUT_STATUSES.has(s))) return { state: 'unknown', netCents: null, payDate: null, workerId: null };
  const amounts = payouts.map((p) => amountCents(p.netAmount));
  const netCents = amounts.every((a) => a !== null) ? amounts.reduce((sum, a) => sum + a, 0) : null;
  const payDate = readPayDate(body);
  let state = 'landed';
  if (statuses.includes('FAILED')) state = 'returned';
  else if (statuses.includes('PENDING')) state = 'pending';
  const workerId = readWorkerId(body);
  // The payment's own status (Everee's Payment Data API), apart from its payouts: the sandbox sets it to PAID while the bank payouts stay PENDING.
  const paymentPaid = typeof body.status === 'string' && body.status.toUpperCase() === 'PAID';
  return { state, netCents, payDate, workerId, paymentPaid };
};

// Sandbox only: a worker's payment may hold payables from other sends too (the same week sent from another NASA database), so its total can be more
// than this item. Our own payable decides instead: it must be PAID, inside this very payment, for exactly the amount NASA sent.
export const ownPayableIsPaidInPayment = (environment, data, { paymentId, amount }) => {
  if (environment !== 'sandbox') return false;
  const own = readPayable(data);
  return own.paymentStatus === 'PAID' && own.paymentId !== null && own.paymentId === String(paymentId) && amountCents(data?.amount) === toCents(amount);
};

// The payment counts as landed when every payout is PAID, or when Everee says the payment itself is PAID while a bank payout is still PENDING (Everee
// shows the payment as Paid and the driver already has the money, but the payout record can stay pending for days). A returned (FAILED) payout is never
// covered by this, and the caller still checks the amount and the worker. A deposit returned later is flagged for a person by the payment event.
export const countsAsLanded = (payout) => payout.state === 'landed' || (payout.state === 'pending' && payout.paymentPaid === true);

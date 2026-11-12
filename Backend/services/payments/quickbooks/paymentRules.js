import { createHash } from 'node:crypto';
import { QuickbooksError } from './quickbooksClient.js';

// Pure rules for recording a Desi driver's pay in QuickBooks. The amount is always the statement's frozen net; nothing is recalculated here.

export const docNumberOf = (statementId) => `NASA-S${statementId}`; // also QuickBooks' bill number, our idempotency key (max 21 characters)
export const billRequestId = (statementId) => `nasa-bill-${statementId}`;
export const paymentRequestId = (statementId) => `nasa-bpay-${statementId}`;
// A batch that has not changed for this long while items are still "submitted" was interrupted (the server stopped mid-send). The longest one item can take is
// about 80 seconds (four requests, each cut off at 20), so ten minutes never mistakes a send that is still running for a dead one.
export const STALE_AFTER_MINUTES = 10;
const MAX_MESSAGE = 480;
export const clip = (text) => String(text ?? '').slice(0, MAX_MESSAGE);

export const QB_BLOCKERS = Object.freeze({
  not_desi: { severity: 'blocking', message: 'only Desi drivers are recorded in QuickBooks; Local drivers are paid through Everee' },
  nothing_to_pay: { severity: 'blocking', message: 'the statement is $0.00; there is nothing to pay' },
  no_quickbooks_vendor: { severity: 'blocking', message: 'this driver is not linked to a QuickBooks vendor' },
  vendor_not_1099: { severity: 'blocking', message: 'the QuickBooks vendor is not marked for 1099 tracking; its payment would be missing from the 1099 report' },
  in_quickbooks_batch: { severity: 'blocking', message: 'this statement is already in a QuickBooks payment batch; follow it there (a failed one is retried from its batch)' },
});

// Fingerprint of what would be recorded: the run, the company and, for each driver who can be paid, the statement, the amount in cents and the vendor.
export const previewHashOf = ({ runId, environment, realmId, items }) => {
  const canonical = items.map((i) => [i.statementId, i.driverId, i.amountCents, i.vendorId]).sort((a, b) => a[0] - b[0]);
  return createHash('sha256').update(JSON.stringify({ v: 1, runId, environment, realmId, items: canonical })).digest('hex');
};

// The bill: one line for the whole statement, booked to the chosen expense account. TxnDate is the date the admin says the driver was paid.
export const billBody = ({ statementId, vendorId, amount, paidOn, expenseAccountId, runId, periodStart, periodEnd }) => ({
  VendorRef: { value: String(vendorId) },
  DocNumber: docNumberOf(statementId),
  TxnDate: paidOn,
  PrivateNote: `NASA pay run ${runId}, statement ${statementId}`,
  Line: [{
    DetailType: 'AccountBasedExpenseLineDetail',
    Amount: Number(amount),
    Description: `Delivery pay ${periodStart} to ${periodEnd}`,
    AccountBasedExpenseLineDetail: { AccountRef: { value: String(expenseAccountId) } },
  }],
});

// The payment that settles the bill, recorded from the bank account as a check/transfer (not a credit card, which QuickBooks leaves out of 1099 totals).
export const billPaymentBody = ({ statementId, vendorId, amount, paidOn, bankAccountId, billId }) => ({
  VendorRef: { value: String(vendorId) },
  PayType: 'Check',
  TotalAmt: Number(amount),
  TxnDate: paidOn,
  PrivateNote: `NASA statement ${statementId}`,
  CheckPayment: { BankAccountRef: { value: String(bankAccountId) } },
  Line: [{ Amount: Number(amount), LinkedTxn: [{ TxnId: String(billId), TxnType: 'Bill' }] }],
});

export class UnexpectedAnswerError extends Error {}

// What a failure means for the item: not taken (safe to retry) or unknown (retry asks QuickBooks first, so it is safe too, but it is shown as unconfirmed).
export const classifyFailure = (error) => {
  if (error instanceof UnexpectedAnswerError) return { outcome: 'unexpected_answer', definite: false, status: null };
  if (!(error instanceof QuickbooksError)) return { outcome: 'unreachable', definite: false, status: null };
  if (error.status === null) return { outcome: /in time/.test(error.message) ? 'timeout' : 'unreachable', definite: false, status: null };
  if (error.status === 429) return { outcome: 'rate_limited', definite: true, status: 429 };
  if (error.status >= 500) return { outcome: 'server_error', definite: false, status: error.status };
  return { outcome: 'refused', definite: true, status: error.status };
};

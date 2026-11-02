// Input rules for manual driver ledger entries (issue #142). Pure functions: no database.
// Who may record an entry, and for which driver, is checked in ledgerStore.js against the database.

import { parseCharge, claimTypeKey, normalizeWaybill } from '../claims/claimRules.js';

// Each type moves the balance one fixed way, so nobody has to pick a sign:
// debit = the driver owes NASA more; credit = the driver owes less, or NASA owes the driver.
export const ENTRY_DIRECTIONS = Object.freeze({
  advance: 'debit',            // money advanced to the driver, to be recovered
  expense: 'debit',            // a cost charged to the driver
  manual_claim: 'debit',       // a claim entered by hand (exempt ones carry no balance)
  advance_repayment: 'credit', // the driver repaid an advance outside payroll
  reimbursement: 'credit',     // money NASA owes the driver
  correction: null,            // the person states the direction
});
export const ENTRY_TYPES = Object.freeze(Object.keys(ENTRY_DIRECTIONS));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 10000;

const positiveId = (value) => (/^\d{1,9}$/.test(String(value ?? '')) && Number(value) > 0 ? Number(value) : null);

// A real calendar date written YYYY-MM-DD, or null.
export const parseDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? value : null;
};

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');

// Checks a new entry from the form. Returns { entry } or { errors: { field: message } }.
// The amount is always positive; the direction comes from the type (or, for a correction, from the form).
export const parseNewEntry = (body = {}) => {
  const errors = {};
  const requestId = typeof body.requestId === 'string' ? body.requestId.toLowerCase() : '';
  if (!UUID.test(requestId)) errors.requestId = 'requestId must be a UUID made by the form';

  const driverId = positiveId(body.driverId);
  if (!driverId) errors.driverId = 'choose a driver';
  const cityId = positiveId(body.cityId);
  if (!cityId) errors.cityId = 'choose a city';

  const type = ENTRY_TYPES.includes(body.type) ? body.type : null;
  if (!type) errors.type = `type must be one of: ${ENTRY_TYPES.join(', ')}`;

  let direction = type ? ENTRY_DIRECTIONS[type] : null;
  if (type === 'correction') {
    direction = ['debit', 'credit'].includes(body.direction) ? body.direction : null;
    if (!direction) errors.direction = 'a correction needs direction "debit" or "credit"';
  } else if (body.direction !== undefined && body.direction !== null && body.direction !== direction) {
    errors.direction = `a ${type} is always ${direction}`;
  }

  const amount = parseCharge(body.amount);
  if (amount.error) errors.amount = amount.error;
  else if (Number(amount.charge) < 0) errors.amount = 'amount must be positive; the type sets the direction';
  else if (Number(amount.charge) > MAX_AMOUNT) errors.amount = `amount must be at most ${MAX_AMOUNT}`;

  const reason = cleanText(body.reason, 500);
  if (reason.length < 3) errors.reason = 'give a reason (at least 3 characters)';

  const effectiveDate = parseDate(body.effectiveDate);
  if (!effectiveDate) errors.effectiveDate = 'effectiveDate must be a real date (YYYY-MM-DD)';
  const intendedPayday = body.intendedPayday === undefined || body.intendedPayday === null || body.intendedPayday === '' ? null : parseDate(body.intendedPayday);
  if (intendedPayday === null && body.intendedPayday) errors.intendedPayday = 'intendedPayday must be a real date (YYYY-MM-DD)';

  const disbursed = body.disbursedOutsidePayroll === true;
  if (disbursed && type !== 'advance') errors.disbursedOutsidePayroll = 'only an advance can be marked as already paid out';
  if (type === 'advance' && typeof body.disbursedOutsidePayroll !== 'boolean') {
    errors.disbursedOutsidePayroll = 'say whether this advance was already paid out outside payroll (true or false)';
  }

  const claimType = type === 'manual_claim' ? cleanText(body.claimType, 100) : null;
  if (type === 'manual_claim' && !claimTypeKey(claimType)) errors.claimType = 'a manual claim needs its claim type';
  const waybill = type === 'manual_claim' && body.waybill ? normalizeWaybill(body.waybill).slice(0, 64) : null;

  if (Object.keys(errors).length) return { errors };
  return {
    entry: {
      requestId, driverId, cityId, type, direction, amount: amount.charge, reason, effectiveDate, intendedPayday,
      disbursedOutsidePayroll: disbursed, claimType, waybill,
    },
  };
};

// Checks a void request. Returns { void } or { errors }.
export const parseVoid = (body = {}, entryIdParam) => {
  const errors = {};
  const entryId = positiveId(entryIdParam);
  if (!entryId) errors.entryId = 'unknown entry';
  const requestId = typeof body.requestId === 'string' ? body.requestId.toLowerCase() : '';
  if (!UUID.test(requestId)) errors.requestId = 'requestId must be a UUID made by the form';
  const reason = cleanText(body.reason, 500);
  if (reason.length < 3) errors.reason = 'give a reason for the void (at least 3 characters)';
  return Object.keys(errors).length ? { errors } : { void: { entryId, requestId, reason } };
};

// Rules for the carrier's waybill -> Delivery ID -> route evidence (issue #140). Pure functions: no database,
// no files. The report layout is the one the weekly GOFO upload already reads.
//
// Identifiers are text. A waybill or Delivery ID is never rounded, truncated or reshaped; only surrounding
// spaces are dropped. An identifier that cannot be read back exactly is reported, not guessed.

import { createHash } from 'node:crypto';

export const CARRIER = 'gofo';

// Sheet names as the carrier writes them, and the short names stored in the database.
export const SHEETS = Object.freeze({
  fee_details: 'Details of Delivery Fees',
  offset_details: 'Offset Details',
});

// Header text after normalizeHeader. "Waybill No" and "Waybill No." are the same column.
export const HEADERS = Object.freeze({
  waybill: ['waybill no', 'waybill number', 'waybill'],
  deliveryId: ['delivery id'],
  route: ['region/route'],
  signing: ['signing time'],
});

// Excel keeps 15 significant digits. A number longer than that has already lost digits.
const MAX_EXACT_NUMBER_DIGITS = 15;
const MAX_WAYBILL_LENGTH = 64;
const MAX_ROUTE_LENGTH = 100;
const MAX_DRIVER_CODE = 2147483647; // drivers.driver_code is a 32-bit integer

export const normalizeHeader = (value) =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '')
    : '';

// Waybills compare without case or spaces (the same rule the claims side uses to find them).
export const normalizeWaybill = (value) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, '').toUpperCase() : '';

// The text of a cell value as ExcelJS hands it over: plain, rich text, formula result or link.
export const cellValue = (value) => {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('');
    if ('result' in value) return cellValue(value.result);
    if ('text' in value) return cellValue(value.text);
    return null;
  }
  return value ?? null;
};

// Returns { text } for a readable waybill, or { reason }.
export const readWaybill = (raw) => {
  const value = cellValue(raw);
  if (value === null || value === '') return { reason: 'waybill is blank' };
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return { reason: 'waybill is a number that cannot be read exactly' };
    if (String(value).length > MAX_EXACT_NUMBER_DIGITS) return { reason: 'waybill is a long number that may have lost digits' };
    return { text: String(value) };
  }
  if (typeof value !== 'string') return { reason: 'waybill is not text' };
  const text = value.trim();
  if (text === '') return { reason: 'waybill is blank' };
  if (text.length > MAX_WAYBILL_LENGTH) return { reason: 'waybill is too long' };
  return { text };
};

// Returns { text, form } where form is "canonical" (digits, no leading zero, fits a driver code) or "unusable"
// (kept as evidence but never matched to a driver), or { reason } when there is nothing to keep.
export const readDeliveryId = (raw) => {
  const value = cellValue(raw);
  if (value === null || value === '') return { reason: 'Delivery ID is blank' };
  let text;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return { reason: 'Delivery ID is a number that cannot be read exactly' };
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return { reason: 'Delivery ID is not text or a number' };
  }
  if (text === '') return { reason: 'Delivery ID is blank' };
  if (text.length > MAX_WAYBILL_LENGTH) return { reason: 'Delivery ID is too long' };
  const canonical = /^[1-9]\d*$/.test(text) && Number(text) <= MAX_DRIVER_CODE;
  return { text, form: canonical ? 'canonical' : 'unusable' };
};

export const readRoute = (raw) => {
  const value = cellValue(raw);
  if (value === null) return null;
  const text = String(value).trim();
  return text === '' || text.length > MAX_ROUTE_LENGTH ? null : text;
};

const pad = (n) => String(n).padStart(2, '0');

// Month first, as the carrier writes it ("10/01/2026 14:05:00"), or an ISO date. Returns
// { signedAt: "YYYY-MM-DD HH:MM:SS", signedOn: "YYYY-MM-DD" } or null when it is not a real date and time.
export const readSigningTime = (raw) => {
  const value = cellValue(raw);
  let y, mo, d, h = 0, mi = 0, s = 0;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    [y, mo, d, h, mi, s] = [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds()];
  } else if (typeof value === 'string') {
    const text = value.trim();
    let m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (m) {
      [, mo, d, y, h = 0, mi = 0, s = 0] = m;
    } else {
      m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
      if (!m) return null;
      [, y, mo, d, h = 0, mi = 0, s = 0] = m;
    }
    [y, mo, d, h, mi, s] = [y, mo, d, h, mi, s].map(Number);
  } else {
    return null;
  }
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (h > 23 || mi > 59 || s > 59) return null;
  const signedOn = `${y}-${pad(mo)}-${pad(d)}`;
  return { signedAt: `${signedOn} ${pad(h)}:${pad(mi)}:${pad(s)}`, signedOn };
};

// The identity of one fact. The report, the sheet, the row and the file name are deliberately not part of it,
// so a renamed, reordered or overlapping report describes the same facts.
export const identityHash = ({ carrier = CARRIER, waybillKey, deliveryId, routeCode, signedOn }) =>
  createHash('sha256').update([carrier, waybillKey, deliveryId, routeCode ?? '', signedOn ?? ''].join('|')).digest('hex');

// One report row to one piece of evidence, or the reason it cannot be kept.
// cells: { waybill, deliveryId, route, signing } raw cell values.
export const evidenceFromCells = (cells) => {
  const waybill = readWaybill(cells.waybill);
  if (waybill.reason) return { problem: waybill.reason };
  const deliveryId = readDeliveryId(cells.deliveryId);
  if (deliveryId.reason) return { problem: deliveryId.reason };

  const routeCode = readRoute(cells.route);
  const signing = readSigningTime(cells.signing);
  const waybillKey = normalizeWaybill(waybill.text);
  return {
    evidence: {
      waybill: waybill.text,
      waybillKey,
      deliveryId: deliveryId.text,
      idForm: deliveryId.form,
      routeCode,
      signedAt: signing?.signedAt ?? null,
      signedOn: signing?.signedOn ?? null,
      identityHash: identityHash({ waybillKey, deliveryId: deliveryId.text, routeCode, signedOn: signing?.signedOn ?? null }),
    },
    // A signing time that is present but unreadable is kept as evidence without a date, and counted.
    unreadableDate: signing === null && cellValue(cells.signing) !== null && cellValue(cells.signing) !== '',
  };
};

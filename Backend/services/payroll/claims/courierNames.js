// Reads the driver names out of the carrier's "Details of Delivery Fees" sheet (issue #180): each row's Courier (the driver's
// name) and Delivery ID (the driver code). A claim names its driver only by the Courier column, so a claim is matched to a driver
// by finding the same name here and taking that row's Delivery ID. Only this sheet is read; Offset Details is not used.
// No database work here.

import XLSX from 'xlsx';
import { occupiedRange } from './claimsParser.js';
import { driverNameKey } from '../../admin/driverName.js';

export const FEES_SHEET = 'Details of Delivery Fees';
const MAX_DRIVER_CODE = 2147483647; // drivers.driver_code is a 32-bit integer

const headerKey = (text) => (typeof text === 'string' ? text.toLowerCase().replace(/[^a-z0-9]/g, '') : '');
const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

// A Delivery ID that can be a driver code: whole digits, no leading zero, small enough. Returns its text, or null. Never rounded
// or reshaped: a number Excel could not hold exactly is refused.
export const readDriverCode = (value) => {
  let text;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }
  return /^[1-9]\d*$/.test(text) && Number(text) <= MAX_DRIVER_CODE ? text : null;
};

// rows: the sheet as an array of arrays (first non-blank row is the header).
// Returns { names, rows, unreadable, missingColumns }. names maps a name key (see driverNameKey) to the set of Delivery IDs
// seen with that name. A name linked to two different Delivery IDs is kept as it is: matching calls it ambiguous.
export const parseFeeNameRows = (rows) => {
  const out = { names: new Map(), rows: 0, unreadable: 0, missingColumns: [] };
  const all = Array.isArray(rows) ? rows : [];
  const headerIndex = all.findIndex((r) => Array.isArray(r) && r.some((c) => !isBlank(c)));
  if (headerIndex < 0) return out;
  const header = all[headerIndex].map(headerKey);
  const nameAt = header.indexOf('courier');
  const idAt = header.indexOf('deliveryid');
  if (nameAt < 0) out.missingColumns.push('Courier');
  if (idAt < 0) out.missingColumns.push('Delivery ID');
  if (out.missingColumns.length) return out;

  for (let i = headerIndex + 1; i < all.length; i += 1) {
    const row = Array.isArray(all[i]) ? all[i] : [];
    if (row.every(isBlank)) continue;
    out.rows += 1;
    const key = isBlank(row[nameAt]) ? '' : driverNameKey(String(row[nameAt]));
    const id = readDriverCode(row[idAt]);
    if (!key || !id) { out.unreadable += 1; continue; }
    if (!out.names.has(key)) out.names.set(key, new Set());
    out.names.get(key).add(id);
  }
  return out;
};

// Reads the sheet from a workbook already loaded with the xlsx library. Every occupied row is read, whatever range the file says.
// Returns { found, names, rows, unreadable, missingColumns }.
export const parseFeeNames = (workbook) => {
  const name = (workbook?.SheetNames || []).find((n) => headerKey(n) === headerKey(FEES_SHEET));
  if (!name) return { found: false, names: new Map(), rows: 0, unreadable: 0, missingColumns: [] };
  const sheet = workbook.Sheets[name];
  const ref = occupiedRange(sheet);
  if (!ref) return { found: true, names: new Map(), rows: 0, unreadable: 0, missingColumns: [] };
  const rows = XLSX.utils.sheet_to_json({ ...sheet, '!ref': ref }, { header: 1, defval: null, raw: true, blankrows: true });
  return { found: true, ...parseFeeNameRows(rows) };
};

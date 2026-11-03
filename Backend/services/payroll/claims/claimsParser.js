// Reads the carrier's "Claims Detail" sheet into claim records (issue #141). No database work here.
// Every row that is not blank becomes either a claim or a reported problem: nothing is skipped silently,
// turned into zero, or assigned to anyone. Who owes a claim is decided later, by matching the Courier name (the driver's name)
// with the same name in Details of Delivery Fees, whose Delivery ID is the driver code (issue #180).

import XLSX from 'xlsx';
import { claimKey, claimTypeKey, normalizeWaybill, parseCarrierDateTime, parseCharge } from './claimRules.js';
import { cleanDriverName, driverNameKey } from '../../admin/driverName.js';

export const CLAIMS_SHEET = 'Claims Detail';

// Column titles as the carrier writes them, compared without case, spaces or punctuation.
const COLUMNS = Object.freeze({
  claimDate: 'date',
  waybill: 'Waybill No.',
  claimType: 'Claim Type',
  charge: 'The total expenses-exclusive of taxes',
  declaredValue: 'Declared value (USD)',
  courierName: 'Courier', // the driver's name: how a claim is matched to a driver (issue #180)
  confirmDate: 'Confirm date.',
  remarks: 'Remarks',
});
const REQUIRED = Object.freeze(['claimDate', 'waybill', 'claimType', 'charge']);

const headerKey = (text) => (typeof text === 'string' ? text.toLowerCase().replace(/[^a-z0-9]/g, '') : '');
const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const MAX_TEXT = 500;
const text = (v) => (isBlank(v) ? null : String(v).trim().slice(0, MAX_TEXT));

// Two rows name different drivers only when both give a name and the names differ (case and spacing do not count).
const namesDiffer = (a, b) => Boolean(a.courierNameKey && b.courierNameKey && a.courierNameKey !== b.courierNameKey);

// rows: the sheet as an array of arrays (first non-blank row is the header).
// Returns { claims, problems }. A problem is { row, message } with the Excel row number.
export const parseClaimsRows = (rows, { courier }) => {
  const problems = [];
  const claims = [];
  const all = Array.isArray(rows) ? rows : [];
  const headerIndex = all.findIndex((r) => Array.isArray(r) && r.some((c) => !isBlank(c)));
  if (headerIndex < 0) return { claims, problems };

  const header = all[headerIndex].map(headerKey);
  const at = {};
  for (const [field, title] of Object.entries(COLUMNS)) at[field] = header.indexOf(headerKey(title));
  const missing = REQUIRED.filter((field) => at[field] < 0).map((field) => `"${COLUMNS[field]}"`);
  if (missing.length) {
    problems.push({ row: headerIndex + 1, message: `missing column ${missing.join(', ')}` });
    return { claims, problems };
  }

  const byKey = new Map();
  for (let i = headerIndex + 1; i < all.length; i += 1) {
    const row = Array.isArray(all[i]) ? all[i] : [];
    if (row.every(isBlank)) continue;
    const excelRow = i + 1;
    const cell = (field) => (at[field] >= 0 ? row[at[field]] : null);
    const rowProblems = [];

    const waybill = normalizeWaybill(cell('waybill'));
    if (!waybill) rowProblems.push('waybill is missing');
    const claimType = text(cell('claimType'));
    if (!claimType) rowProblems.push('claim type is missing');
    const amount = parseCharge(cell('charge'));
    if (amount.error) rowProblems.push(amount.error);
    const claimAt = parseCarrierDateTime(cell('claimDate'));
    if (!claimAt) rowProblems.push('claim date is missing or not a real date');
    const confirmRaw = cell('confirmDate');
    const confirmedAt = isBlank(confirmRaw) ? null : parseCarrierDateTime(confirmRaw);
    if (!isBlank(confirmRaw) && !confirmedAt) rowProblems.push('confirm date is not a real date');
    const declaredRaw = cell('declaredValue');
    const declared = isBlank(declaredRaw) ? null : parseCharge(declaredRaw);

    if (rowProblems.length) {
      problems.push({ row: excelRow, message: rowProblems.join('; ') });
      continue;
    }

    const claim = {
      courier,
      key: claimKey({ courier, waybill, claimType }),
      sourceRow: excelRow,
      waybill,
      claimType,
      claimTypeKey: claimTypeKey(claimType),
      claimAt,
      confirmedAt,
      charge: amount.charge,
      deduction: amount.deduction,
      // Kept only as evidence. Never used for the deduction.
      declaredValue: declared && !declared.error ? declared.charge : null,
      remarks: text(cell('remarks')),
      // The driver's name as the carrier wrote it, and the key it is compared by. Blank when the column is empty or missing.
      courierName: isBlank(cell('courierName')) ? null : cleanDriverName(String(cell('courierName'))).slice(0, 100) || null,
      courierNameKey: isBlank(cell('courierName')) ? null : driverNameKey(String(cell('courierName'))).slice(0, 100) || null,
    };

    const earlier = byKey.get(claim.key);
    if (!earlier) {
      byKey.set(claim.key, claim);
      claims.push(claim);
    } else if (earlier.charge !== claim.charge || earlier.claimAt !== claim.claimAt || namesDiffer(earlier, claim)) {
      // Same waybill and claim type twice with different facts: neither row is trusted until a person checks. The driver's name is a
      // fact: it decides who is charged, so two rows naming different drivers must not pick one of them by position (#180).
      const what = namesDiffer(earlier, claim) ? 'a different driver name' : 'different facts';
      problems.push({ row: excelRow, message: `conflicts with row ${earlier.sourceRow} for the same waybill and claim type (${what}); neither is imported` });
      earlier.conflict = true;
    } else {
      // A repeat may carry the name the first row lacked; keep it, so the claim can be matched.
      if (!earlier.courierNameKey && claim.courierNameKey) {
        earlier.courierName = claim.courierName;
        earlier.courierNameKey = claim.courierNameKey;
      }
      problems.push({ row: excelRow, message: `repeats row ${earlier.sourceRow}; imported once` });
    }
  }

  return { claims: claims.filter((c) => !c.conflict), problems };
};

// The range the sheet's cells really occupy. A workbook's saved range ("!ref") can say less than it holds (carrier
// exports have said A1:L2 for 16 rows), and the reader stops at that range, so every claim past it would be lost
// without a word. Handles both sheet layouts: sparse (cells keyed "A1") and dense (rows in "!data").
export const occupiedRange = (sheet) => {
  let maxRow = -1;
  let maxCol = -1;
  const see = (r, c) => {
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  };
  if (Array.isArray(sheet['!data'])) {
    sheet['!data'].forEach((row, r) => row?.forEach((cell, c) => { if (cell) see(r, c); }));
  } else {
    for (const key of Object.keys(sheet)) {
      if (key.startsWith('!')) continue;
      const { r, c } = XLSX.utils.decode_cell(key);
      see(r, c);
    }
  }
  if (sheet['!ref']) {
    const saved = XLSX.utils.decode_range(sheet['!ref']);
    see(saved.e.r, saved.e.c);
  }
  return maxRow < 0 ? null : XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
};

// Reads the claims sheet from a workbook already loaded with the xlsx library. A workbook without the sheet
// simply has no claims. Every occupied row is read, whatever range the file claims. Returns { found, claims, problems }.
export const parseClaimsWorkbook = (workbook, { courier }) => {
  const name = (workbook?.SheetNames || []).find((n) => headerKey(n) === headerKey(CLAIMS_SHEET));
  if (!name) return { found: false, claims: [], problems: [] };
  const sheet = workbook.Sheets[name];
  const ref = occupiedRange(sheet);
  if (!ref) return { found: true, sheet: name, claims: [], problems: [] };
  // A shallow copy with the true range: the caller's workbook object is left as it was.
  const rows = XLSX.utils.sheet_to_json({ ...sheet, '!ref': ref }, { header: 1, defval: null, raw: true, blankrows: true });
  return { found: true, sheet: name, ...parseClaimsRows(rows, { courier }) };
};

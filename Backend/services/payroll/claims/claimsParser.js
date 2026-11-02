// Reads the carrier's "Claims Detail" sheet into claim records (issue #141). No database work here.
// Every row that is not blank becomes either a claim or a reported problem: nothing is skipped silently,
// turned into zero, or assigned to anyone. Who owes a claim is decided later, from delivery history only.

import XLSX from 'xlsx';
import { claimKey, claimTypeKey, normalizeWaybill, parseCarrierDateTime, parseCharge } from './claimRules.js';

export const CLAIMS_SHEET = 'Claims Detail';

// Column titles as the carrier writes them, compared without case, spaces or punctuation.
const COLUMNS = Object.freeze({
  claimDate: 'date',
  waybill: 'Waybill No.',
  claimType: 'Claim Type',
  charge: 'The total expenses-exclusive of taxes',
  declaredValue: 'Declared value (USD)',
  confirmDate: 'Confirm date.',
  remarks: 'Remarks',
});
const REQUIRED = Object.freeze(['claimDate', 'waybill', 'claimType', 'charge']);

const headerKey = (text) => (typeof text === 'string' ? text.toLowerCase().replace(/[^a-z0-9]/g, '') : '');
const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const MAX_TEXT = 500;
const text = (v) => (isBlank(v) ? null : String(v).trim().slice(0, MAX_TEXT));

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
    };

    const earlier = byKey.get(claim.key);
    if (!earlier) {
      byKey.set(claim.key, claim);
      claims.push(claim);
    } else if (earlier.charge !== claim.charge || earlier.claimAt !== claim.claimAt) {
      // Same waybill and claim type twice with different facts: neither row is trusted until a person checks.
      problems.push({ row: excelRow, message: `conflicts with row ${earlier.sourceRow} for the same waybill and claim type; neither is imported` });
      earlier.conflict = true;
    } else {
      problems.push({ row: excelRow, message: `repeats row ${earlier.sourceRow}; imported once` });
    }
  }

  return { claims: claims.filter((c) => !c.conflict), problems };
};

// Reads the claims sheet from a workbook already loaded with the xlsx library. A workbook without the sheet
// simply has no claims. Returns { found, claims, problems }.
export const parseClaimsWorkbook = (workbook, { courier }) => {
  const name = (workbook?.SheetNames || []).find((n) => headerKey(n) === headerKey(CLAIMS_SHEET));
  if (!name) return { found: false, claims: [], problems: [] };
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null, raw: true, blankrows: true });
  return { found: true, sheet: name, ...parseClaimsRows(rows, { courier }) };
};

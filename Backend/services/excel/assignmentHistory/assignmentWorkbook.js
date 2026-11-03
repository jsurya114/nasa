// Reads the assignment evidence out of a GOFO report that ExcelJS has already loaded (issue #140).
// Both "Details of Delivery Fees" and "Offset Details" count: an offset is evidence of who carried a package,
// not a charge and not wages. Only identity and date columns are read. Earnings columns are never touched, so a
// row with an incomplete stop count still keeps its identity.

import {
  CARRIER,
  HEADERS,
  SHEETS,
  cellValue,
  evidenceFromCells,
  normalizeHeader,
} from './assignmentRules.js';

// A report with thousands of bad rows should not make the answer huge.
const MAX_REPORTED_PROBLEMS = 50;

const findSheet = (workbook, name) => {
  const wanted = normalizeHeader(name);
  return workbook.worksheets.find((sheet) => normalizeHeader(sheet.name) === wanted) ?? null;
};

const columnIndexes = (sheet) => {
  const byHeader = new Map();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    const key = normalizeHeader(cellValue(cell.value));
    if (key && !byHeader.has(key)) byHeader.set(key, column);
  });
  const find = (aliases) => aliases.map((alias) => byHeader.get(alias)).find((index) => index !== undefined) ?? null;
  return {
    waybill: find(HEADERS.waybill),
    deliveryId: find(HEADERS.deliveryId),
    route: find(HEADERS.route),
    signing: find(HEADERS.signing),
  };
};

// Returns the evidence of one sheet. A sheet without a waybill or Delivery ID column gives no evidence and
// says why. Rows are read from the data itself, not from the sheet's saved size, which the carrier's files
// understate.
const readSheet = (sheet, sheetKey, out) => {
  const columns = columnIndexes(sheet);
  const summary = { found: true, rows: 0, kept: 0, duplicates: 0, unreadableDates: 0, missingColumns: [] };
  // Every route the sheet names, whether or not its row also gives a usable package identity. Which city a report
  // belongs to must not depend on how many rows had a readable waybill or Delivery ID.
  if (columns.route) {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const value = cellValue(row.getCell(columns.route).value);
      const text = value === null || value === undefined ? '' : String(value).trim();
      if (text !== '') out.routeCodes.add(text);
    });
  }
  if (!columns.waybill) summary.missingColumns.push('Waybill No');
  if (!columns.deliveryId) summary.missingColumns.push('Delivery ID');
  if (summary.missingColumns.length > 0) return summary;

  const seen = new Set();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    summary.rows += 1;
    const cell = (index) => (index ? row.getCell(index).value : null);
    const result = evidenceFromCells({
      waybill: cell(columns.waybill),
      deliveryId: cell(columns.deliveryId),
      route: cell(columns.route),
      signing: cell(columns.signing),
    });
    if (result.problem) {
      out.problemCount += 1;
      if (out.problems.length < MAX_REPORTED_PROBLEMS) out.problems.push({ sheet: sheetKey, row: rowNumber, reason: result.problem });
      return;
    }
    if (result.unreadableDate) summary.unreadableDates += 1;
    if (seen.has(result.evidence.identityHash)) {
      summary.duplicates += 1;
      return;
    }
    seen.add(result.evidence.identityHash);
    summary.kept += 1;
    out.rows.push({ ...result.evidence, sheet: sheetKey, sourceRow: rowNumber });
  });
  return summary;
};

// workbook: an ExcelJS Workbook that has been loaded.
// Returns { carrier, sheets, rows, problems, problemCount }:
// - rows: one entry per distinct fact per sheet, with the Excel row it was first seen on;
// - problems: up to 50 { sheet, row, reason } (no cell values), problemCount: the full number.
export const extractAssignmentEvidence = (workbook) => {
  const out = { carrier: CARRIER, sheets: {}, rows: [], problems: [], problemCount: 0, routeCodes: new Set() };
  for (const [sheetKey, name] of Object.entries(SHEETS)) {
    const sheet = findSheet(workbook, name);
    out.sheets[sheetKey] = sheet ? readSheet(sheet, sheetKey, out) : { found: false, rows: 0, kept: 0, duplicates: 0, unreadableDates: 0, missingColumns: [] };
  }
  out.routeCodes = [...out.routeCodes];
  return out;
};

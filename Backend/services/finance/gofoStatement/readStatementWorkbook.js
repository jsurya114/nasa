import ExcelJS from 'exceljs';
import { StatementError } from './statementMoney.js';
import { assertSafeWorkbook } from './workbookSafety.js';

// Turns an .xlsx buffer into { [sheet name]: rows[][] } for parseStatement. Formula cells give their saved result; rich text gives its text.
const plain = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return plain(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return value.text;
    return null;
  }
  return value;
};

const MAX_SHEETS = 20;
const MAX_ROWS = 200000; // a week of one fleet is about 16,000 lines

export const readStatementWorkbook = async (buffer) => {
  assertSafeWorkbook(buffer);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); } catch { throw new StatementError('The file could not be read as an Excel (.xlsx) workbook.'); }
  if (workbook.worksheets.length > MAX_SHEETS) throw new StatementError(`The workbook has ${workbook.worksheets.length} sheets; a statement has about nine.`);
  const sheets = {};
  for (const worksheet of workbook.worksheets) {
    if (worksheet.rowCount > MAX_ROWS) throw new StatementError(`The sheet "${worksheet.name}" has ${worksheet.rowCount} rows, far more than a statement.`);
    const rows = [];
    worksheet.eachRow({ includeEmpty: true }, (row, number) => { rows[number - 1] = row.values.slice(1).map(plain); });
    sheets[worksheet.name] = Array.from(rows, (row) => row ?? []);
  }
  return sheets;
};

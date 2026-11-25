import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import { readStatementWorkbook, sheetsFromWorkbook } from '../services/finance/gofoStatement/readStatementWorkbook.js';
import { readAndReconcile } from '../services/finance/gofoStatement/publishStatement.js';
import { StatementError } from '../services/finance/gofoStatement/statementMoney.js';
import { FEES_SHEET, parseFeeNameRows, parseFeeNames } from '../services/payroll/claims/courierNames.js';
import { statementSheets, statementWorkbook } from './helpers/gofoStatementFixture.js';

// The weekly upload opens the workbook once and hands its rows to the claims step and the statement check, instead of reading the file again.
// These tests prove the rows are the same as the old read from the bytes. All values are made up. No database needed.
const open = async (buffer) => { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); return workbook; };

test('rows taken from an already opened workbook are exactly the rows read from the file', async () => {
  const buffer = await statementWorkbook();
  assert.deepEqual(sheetsFromWorkbook(await open(buffer)), await readStatementWorkbook(buffer));
});

test('the sheet limit still applies when the workbook is already open', async () => {
  const workbook = new ExcelJS.Workbook();
  for (let i = 1; i <= 21; i += 1) workbook.addWorksheet(`Sheet ${i}`).addRow(['x']);
  assert.throws(() => sheetsFromWorkbook(workbook), StatementError);
});

test('the statement check gives the same answer from the opened rows, and does not open the file again', async () => {
  const buffer = await statementWorkbook();
  const sheets = sheetsFromWorkbook(await open(buffer));
  const fromFile = await readAndReconcile(buffer);
  const fromRows = await readAndReconcile(buffer, { sheets });
  assert.equal(fromFile.status, 'ok');
  assert.equal(fromRows.status, fromFile.status);
  assert.equal(fromRows.reconciliation.fingerprint, fromFile.reconciliation.fingerprint);
  assert.deepEqual(fromRows.week, fromFile.week);
  // Bytes that are not a workbook would be refused if they were opened; with the rows supplied they are never opened.
  const notOpened = await readAndReconcile(Buffer.from('these bytes are not a workbook'), { sheets });
  assert.equal(notOpened.status, 'ok');
  assert.equal((await readAndReconcile(Buffer.from('these bytes are not a workbook'))).status, 'rejected', 'without rows the bytes are opened, and refused');
});

test('driver names read from the opened rows equal the names read from the sheet by the xlsx library (text and numeric Delivery IDs)', async () => {
  for (const numeric of [false, true]) {
    const sheets = statementSheets();
    if (numeric) for (const row of sheets[FEES_SHEET].slice(1)) row[9] = Number(row[9]);
    const buffer = await statementWorkbook(sheets);
    const old = parseFeeNames(XLSX.read(buffer, { type: 'buffer', sheets: FEES_SHEET }));
    const rows = parseFeeNameRows((await readStatementWorkbook(buffer))[FEES_SHEET]);
    assert.ok(old.names.size > 0, 'the fixture has driver names');
    assert.deepEqual(rows.names, old.names);
    assert.deepEqual([rows.rows, rows.unreadable, rows.missingColumns], [old.rows, old.unreadable, old.missingColumns]);
  }
});

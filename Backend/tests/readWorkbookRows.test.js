import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readWorkbookRows, sheetsWithinLimits, WorkbookReadError, MAX_ROWS, MAX_SHEETS } from '../services/excel/readWorkbookRows.js';
import { workbookFromRows } from '../services/excel/workbookFromRows.js';
import { sheetsFromWorkbook, readStatementWorkbook } from '../services/finance/gofoStatement/readStatementWorkbook.js';
import { extractAssignmentEvidence } from '../services/excel/assignmentHistory/assignmentWorkbook.js';
import { StatementError } from '../services/finance/gofoStatement/statementMoney.js';

// The light reader (rows without ExcelJS's cell objects) must give exactly the rows `sheetsFromWorkbook` gives from an opened ExcelJS workbook:
// same sheets in the same order, same row widths, the same values, and a hole where there is no cell. Every value here is made up.

const toBuffer = async (workbook) => Buffer.from(await workbook.xlsx.writeBuffer());
const reference = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return sheetsFromWorkbook(workbook, { limits: false });
};
const sameValue = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : Object.is(a, b));
const assertSameRows = (expected, actual, label = '') => {
  assert.deepEqual(Object.keys(actual), Object.keys(expected), `${label} sheet names and order`);
  for (const name of Object.keys(expected)) {
    assert.equal(actual[name].length, expected[name].length, `${label} ${name}: row count`);
    expected[name].forEach((row, index) => {
      const got = actual[name][index];
      assert.equal(got.length, row.length, `${label} ${name} row ${index + 1}: width`);
      for (let column = 0; column < row.length; column += 1) {
        assert.equal(column in got, column in row, `${label} ${name} r${index + 1}c${column + 1}: hole`);
        if (column in row) assert.ok(sameValue(row[column], got[column]), `${label} ${name} r${index + 1}c${column + 1}: ${JSON.stringify(row[column])} vs ${JSON.stringify(got[column])}`);
      }
    });
  }
};

const mixedWorkbook = () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Mixed & "Odd" Ünï');
  sheet.addRow(['text', 'accents', 'symbols', 'number', 'negative', 'big', 'bool', 'date', 'time', 'formula']);
  sheet.addRow(['plain', 'Ana Pérez Ramírez, Ángel Peña, Zoë Müller, Łukasz', '<a> & "b" \'c\'', 12, -3.5, 123456789012, true, new Date(Date.UTC(2026, 10, 3, 14, 30, 5)), new Date(Date.UTC(1899, 11, 30, 8, 15)), { formula: 'D2*2', result: 24 }]);
  sheet.addRow(['  padded  ', 'line\nbreak', 'emoji 🚚 and 中文', 0.1, 1e-7, 9007199254740991, false, new Date(Date.UTC(2026, 0, 1)), null, { formula: '"a"&"b"', result: 'ab' }]);
  sheet.addRow(['', undefined, null, 'x']); // an empty string, a hole, a styled null
  sheet.getCell('K5').value = { richText: [{ text: 'Rich ', font: { bold: true } }, { text: 'text é' }] };
  sheet.getCell('L5').value = { formula: '1=1', result: true };
  sheet.getCell('M5').value = { formula: '1/0', result: { error: '#DIV/0!' } };
  sheet.getCell('N5').value = { text: 'link text', hyperlink: 'https://example.test/' };
  sheet.getCell('AA7').value = 'far right';
  sheet.getCell('ZZ9').value = 'farther';
  sheet.getCell('B3').numFmt = '0.00';
  sheet.getCell('A8').value = 'a_x000D_b';
  sheet.getCell('A9').value = { error: '#N/A' };
  sheet.getCell('A10').value = { formula: 'NOW()', result: new Date(Date.UTC(2026, 10, 25, 9, 0, 0)) };
  sheet.getCell('A10').numFmt = 'mm-dd-yy';
  sheet.mergeCells('A12:C12');
  sheet.getCell('A12').value = 'merged across';
  sheet.mergeCells('E12:E14');
  sheet.getCell('E12').value = 'merged down';
  sheet.mergeCells('G15:H16');
  sheet.getCell('G15').value = 42;
  sheet.getRow(20).height = 30; // a row that exists but has no cell
  sheet.getCell('C22').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }; // a styled cell with no value
  sheet.getCell('D22').value = 'after styled';
  const hidden = workbook.addWorksheet('Hidden');
  hidden.state = 'hidden';
  hidden.addRow(['hidden', 1, 2]);
  workbook.addWorksheet('Empty');
  const numbers = workbook.addWorksheet('Dates');
  numbers.addRow(['d1', 'd2']);
  numbers.addRow([new Date(Date.UTC(2026, 11, 31, 23, 59, 59)), new Date(Date.UTC(2000, 1, 29))]);
  numbers.getColumn(2).numFmt = 'yyyy-mm-dd';
  return workbook;
};

test('the light reader gives the same rows as ExcelJS for a workbook with every kind of cell', async () => {
  const buffer = await toBuffer(mixedWorkbook());
  assertSameRows(await reference(buffer), readWorkbookRows(buffer));
});

test('an accent split between two pieces of the file is kept whole, at every possible split', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Details of Delivery Fees');
  sheet.addRow(['Courier', 'Note']);
  for (let i = 0; i < 40; i += 1) sheet.addRow([`Ramírez ${i} Ángel Peña Zoë 中文 🚚`, `é${'ü'.repeat(i)}`]);
  const buffer = await toBuffer(workbook);
  const expected = await reference(buffer);
  assert.equal(expected['Details of Delivery Fees'][1][0], 'Ramírez 0 Ángel Peña Zoë 中文 🚚');
  for (const sliceBytes of [1, 2, 3, 5, 7, 64]) assertSameRows(expected, readWorkbookRows(buffer, { sliceBytes }), `slice ${sliceBytes}`);
});

test('the 1904 date system is read like ExcelJS reads it', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.properties.date1904 = true;
  const sheet = workbook.addWorksheet('S');
  sheet.addRow([new Date(Date.UTC(2026, 5, 15, 12, 0, 0)), 5]);
  const buffer = await toBuffer(workbook);
  assertSameRows(await reference(buffer), readWorkbookRows(buffer));
});

test('a workbook with no shared strings and no styles to speak of is read the same', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Numbers').addRows([[1, 2, 3], [4.5, -6, 7e10]]);
  const buffer = await toBuffer(workbook);
  assertSameRows(await reference(buffer), readWorkbookRows(buffer));
});

test('the sheet limit applies unless the caller asks for no limit', () => {
  const sheets = {};
  for (let i = 0; i <= MAX_SHEETS; i += 1) sheets[`s${i}`] = [];
  assert.equal(sheetsWithinLimits(sheets), false);
  assert.equal(sheetsWithinLimits({ a: new Array(MAX_ROWS).fill([]) }), true);
  assert.equal(sheetsWithinLimits({ a: new Array(MAX_ROWS + 1).fill([]) }), false);
});

test('too many sheets is refused by default and read when limits are off', async () => {
  const workbook = new ExcelJS.Workbook();
  for (let i = 1; i <= MAX_SHEETS + 1; i += 1) workbook.addWorksheet(`Sheet ${i}`).addRow(['x']);
  const buffer = await toBuffer(workbook);
  assert.throws(() => readWorkbookRows(buffer), StatementError);
  assert.equal(Object.keys(readWorkbookRows(buffer, { limits: false })).length, MAX_SHEETS + 1);
});

test('something that is not a workbook gives a read error the callers can fall back from', async () => {
  assert.throws(() => readWorkbookRows(Buffer.from('this is not a zip file at all, just text'.repeat(3))), WorkbookReadError);
  // a workbook cut in half has lost the end of its zip
  const whole = await toBuffer(mixedWorkbook());
  assert.throws(() => readWorkbookRows(whole.subarray(0, Math.floor(whole.length / 2))), WorkbookReadError);
});

test('the statement reader that publish and preview use gives the same rows as before', async () => {
  const buffer = await toBuffer(mixedWorkbook());
  assertSameRows(await reference(buffer), await readStatementWorkbook(buffer));
});

test('assignment evidence is the same from rows as from an opened ExcelJS workbook', async () => {
  const workbook = new ExcelJS.Workbook();
  const fees = workbook.addWorksheet('Details of Delivery Fees');
  fees.addRow(['Waybill No', 'Courier', 'Delivery ID', 'Region/Route', 'Signing Time', 'Stop Point Details']);
  fees.addRow(['GF0001', 'Ana Pérez', 1001, 'DFW-001', '11/03/2026 10:15:00', '1 Main St']);
  fees.addRow(['GF0002', 'Ana Pérez', '1001', 'DFW-001', new Date(Date.UTC(2026, 10, 3, 11, 0, 0)), '2 Main St']);
  fees.addRow(['GF0002', 'Ana Pérez', '1001', 'DFW-001', new Date(Date.UTC(2026, 10, 3, 11, 0, 0)), '2 Main St']); // a repeat
  fees.addRow(['', 'No Waybill', 1002, 'DFW-002', '11/04/2026 09:00:00', 'x']);
  fees.addRow(['GF0003', 'Bo Li', 'abc', 'DFW-003', '11/04/2026 09:00:00', 'y']);
  fees.addRow([{ formula: '"GF"&"0004"', result: 'GF0004' }, 'Cy', 1004, { richText: [{ text: 'DFW-' }, { text: '004' }] }, '11/05/2026 08:00:00', 'z']);
  const offsets = workbook.addWorksheet('Offset Details');
  offsets.addRow(['Waybill No', 'Delivery ID', 'Region/Route']);
  offsets.addRow(['GF0900', 1900, 'DFW-009']);
  const buffer = await toBuffer(workbook);
  const opened = new ExcelJS.Workbook();
  await opened.xlsx.load(buffer);
  const expected = extractAssignmentEvidence(opened);
  const actual = extractAssignmentEvidence(workbookFromRows(readWorkbookRows(buffer)));
  assert.deepEqual(actual, expected);
  assert.ok(expected.rows.length >= 4);
});

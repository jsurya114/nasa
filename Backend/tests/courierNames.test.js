import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { parseFeeNameRows, parseFeeNames, readDriverCode } from '../services/payroll/claims/courierNames.js';

// The carrier's Details of Delivery Fees columns, with made-up names and codes. Only Courier and Delivery ID are read.
const HEADER = ['Waybill No', 'Destination city', 'Recipient postal code', 'Region/route', 'Courier', 'Delivery ID', 'Signing time'];
const row = (name, id, waybill = 'TESTW001') => [waybill, 'Testville', '00000', 'TST 01-1', name, id, '09/28/2026 10:00:00'];

test('a Delivery ID is a driver code only when it is whole digits that fit, and is never rounded or reshaped', () => {
  assert.equal(readDriverCode(391331), '391331');
  assert.equal(readDriverCode(' 391331 '), '391331');
  assert.equal(readDriverCode('391331'), '391331');
  for (const bad of [0, -5, 1.5, '0123', '12a', '', null, undefined, 2147483648, 9007199254740993, {}, '1e5']) assert.equal(readDriverCode(bad), null, String(bad));
  assert.equal(readDriverCode(2147483647), '2147483647');
});

test('names map to the Delivery IDs seen with them, ignoring case and spaces; two IDs for one name are both kept', () => {
  const { names, rows, unreadable } = parseFeeNameRows([HEADER, row('Cherise Robinson', 391331), row('  cherise   ROBINSON ', 391331, 'TESTW002'), row('Pat Jones', 411111), row('Pat Jones', 422222, 'TESTW003'), row('', 333333), row('No Id', null), row('Bad Id', 'x1')]);
  assert.equal(rows, 7);
  assert.equal(unreadable, 3, 'a row without a name or a usable Delivery ID is counted, not guessed');
  assert.deepEqual([...names.get('cherise robinson')], ['391331']);
  assert.deepEqual([...names.get('pat jones')].sort(), ['411111', '422222'], 'the same name on two Delivery IDs stays visible, so matching can call it ambiguous');
  assert.equal(names.has('no id'), false);
});

test('a sheet missing the Courier or Delivery ID column is reported, and gives no names', () => {
  const noCourier = parseFeeNameRows([HEADER.filter((h) => h !== 'Courier'), ['W', 'x', '0', 'r', 1, 't']]);
  assert.deepEqual([noCourier.missingColumns, noCourier.names.size], [['Courier'], 0]);
  const noId = parseFeeNameRows([HEADER.filter((h) => h !== 'Delivery ID'), ['W', 'x', '0', 'r', 'A Name', 't']]);
  assert.deepEqual(noId.missingColumns, ['Delivery ID']);
});

test('only Details of Delivery Fees is read: Offset Details with the same names adds nothing', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADER, row('Fee Driver', 100001)]), 'Details of Delivery Fees');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADER, row('Offset Driver', 200002)]), 'Offset Details');
  const fees = parseFeeNames(book);
  assert.equal(fees.found, true);
  assert.deepEqual([...fees.names.keys()], ['fee driver']);
  assert.deepEqual(parseFeeNames(XLSX.utils.book_new()), { found: false, names: new Map(), rows: 0, unreadable: 0, missingColumns: [] });
});

test('every occupied row is read even when the sheet\'s saved range says less', () => {
  const sheet = XLSX.utils.aoa_to_sheet([HEADER, row('First Driver', 100001), row('Second Driver', 100002, 'TESTW002')]);
  sheet['!ref'] = 'A1:G2'; // the carrier's files understate their size
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Details of Delivery Fees');
  assert.deepEqual([...parseFeeNames(book).names.keys()].sort(), ['first driver', 'second driver']);
});

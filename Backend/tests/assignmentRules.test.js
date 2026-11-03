import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  evidenceFromCells,
  identityHash,
  normalizeHeader,
  normalizeWaybill,
  readDeliveryId,
  readSigningTime,
  readWaybill,
} from '../services/excel/assignmentHistory/assignmentRules.js';
import { extractAssignmentEvidence } from '../services/excel/assignmentHistory/assignmentWorkbook.js';

// All identifiers and dates in this file are made up.

test('headers differ only in spacing, case and a final full stop', () => {
  assert.equal(normalizeHeader('Waybill No'), normalizeHeader('  Waybill  No. '));
  assert.equal(normalizeHeader('Region/route'), 'region/route');
  assert.equal(normalizeHeader(null), '');
});

test('a waybill keeps its exact text; only the spaces around it go', () => {
  assert.deepEqual(readWaybill('  000123ab456  '), { text: '000123ab456' });
  assert.deepEqual(readWaybill('GF 0012'), { text: 'GF 0012' });
  assert.equal(normalizeWaybill('gf 0012'), 'GF0012');
  assert.deepEqual(readWaybill(123456789), { text: '123456789' });
});

test('a waybill that cannot be read back exactly is reported, never guessed', () => {
  assert.match(readWaybill('').reason, /blank/);
  assert.match(readWaybill('   ').reason, /blank/);
  assert.match(readWaybill(null).reason, /blank/);
  assert.match(readWaybill(1234567890123456789).reason, /cannot be read exactly|lost digits/);
  assert.match(readWaybill(1.5).reason, /cannot be read exactly/);
  assert.match(readWaybill('x'.repeat(65)).reason, /too long/);
  assert.match(readWaybill(true).reason, /not text/);
});

test('a Delivery ID read from a number or from text is the same text, and leading zeros are kept', () => {
  assert.deepEqual(readDeliveryId(12345678), { text: '12345678', form: 'canonical' });
  assert.deepEqual(readDeliveryId(12345678.0), { text: '12345678', form: 'canonical' });
  assert.deepEqual(readDeliveryId(' 12345678 '), { text: '12345678', form: 'canonical' });
  assert.deepEqual(readDeliveryId('00012345'), { text: '00012345', form: 'unusable' });
  assert.deepEqual(readDeliveryId('AB1234'), { text: 'AB1234', form: 'unusable' });
  assert.deepEqual(readDeliveryId('99999999999'), { text: '99999999999', form: 'unusable' }); // beyond a driver code
  assert.notEqual(readDeliveryId('00012345').text, readDeliveryId('12345').text);
});

test('a Delivery ID that is missing or not exact leaves nothing to keep', () => {
  assert.match(readDeliveryId(null).reason, /blank/);
  assert.match(readDeliveryId('').reason, /blank/);
  assert.match(readDeliveryId(12.5).reason, /cannot be read exactly/);
  assert.match(readDeliveryId(true).reason, /not text or a number/);
});

test('signing times are month first, or ISO, or a date cell; impossible dates are not dates', () => {
  assert.deepEqual(readSigningTime('10/01/2026 14:05:09'), { signedAt: '2026-10-01 14:05:09', signedOn: '2026-10-01' });
  assert.deepEqual(readSigningTime('10/01/2026'), { signedAt: '2026-10-01 00:00:00', signedOn: '2026-10-01' });
  assert.deepEqual(readSigningTime('2026-10-01T09:30'), { signedAt: '2026-10-01 09:30:00', signedOn: '2026-10-01' });
  assert.deepEqual(readSigningTime(new Date(Date.UTC(2026, 9, 1, 23, 59, 58))), { signedAt: '2026-10-01 23:59:58', signedOn: '2026-10-01' });
  assert.equal(readSigningTime('13/01/2026'), null); // day first would be wrong here
  assert.equal(readSigningTime('02/30/2026'), null);
  assert.equal(readSigningTime('10/01/2026 25:00:00'), null);
  assert.equal(readSigningTime('last Tuesday'), null);
  assert.equal(readSigningTime(null), null);
});

test('one fact has one identity, whichever report, sheet, row or spelling it came from', () => {
  const base = { waybillKey: normalizeWaybill('gf 0012'), deliveryId: '12345678', routeCode: 'TST 01-1', signedOn: '2026-10-01' };
  assert.equal(identityHash(base), identityHash({ ...base, waybillKey: normalizeWaybill(' GF0012 ') }));
  assert.notEqual(identityHash(base), identityHash({ ...base, deliveryId: '12345679' }));
  assert.notEqual(identityHash(base), identityHash({ ...base, routeCode: 'TST 02-1' }));
  assert.notEqual(identityHash(base), identityHash({ ...base, signedOn: '2026-10-02' }));
  assert.notEqual(identityHash(base), identityHash({ ...base, deliveryId: '012345678' }));
});

test('a row keeps its identity whatever else is missing from it', () => {
  const { evidence, unreadableDate } = evidenceFromCells({ waybill: 'TW1', deliveryId: 12345678, route: null, signing: 'not a date' });
  assert.equal(evidence.waybill, 'TW1');
  assert.equal(evidence.routeCode, null);
  assert.equal(evidence.signedOn, null);
  assert.equal(unreadableDate, true);
  assert.match(evidenceFromCells({ waybill: 'TW1', deliveryId: null }).problem, /Delivery ID/);
  assert.match(evidenceFromCells({ waybill: null, deliveryId: 1 }).problem, /waybill/);
});

const REPORT_HEADER = ['Waybill No', 'Courier', 'Region/route', 'Delivery ID', 'Signing time', 'The total expenses-exclusive of taxes', 'STOP Point Details'];

const workbookOf = async ({ fee = [], offset = [], feeHeader = REPORT_HEADER, offsetHeader = REPORT_HEADER, sheets = {} } = {}) => {
  const workbook = new ExcelJS.Workbook();
  const add = (name, header, rows) => {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(header);
    rows.forEach((row) => sheet.addRow(row));
  };
  add(sheets.fee ?? 'Details of Delivery Fees', feeHeader, fee);
  add(sheets.offset ?? 'Offset Details', offsetHeader, offset);
  // Through a real file, as the upload does.
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  return loaded;
};

test('both sheets give evidence, and an offset row is evidence like any other', async () => {
  const workbook = await workbookOf({
    fee: [['TW1', 'Sam', 'TST 01-1', 12345678, '10/01/2026 10:00:00', 4.5, 'A']],
    offset: [['TW2', 'Sam', 'TST 01-1', 12345678, '09/20/2026 10:00:00', -2, 'A']],
  });
  const result = extractAssignmentEvidence(workbook);
  assert.deepEqual(result.rows.map((r) => [r.sheet, r.sourceRow, r.waybillKey]), [['fee_details', 2, 'TW1'], ['offset_details', 2, 'TW2']]);
  assert.equal(result.sheets.fee_details.rows, 1);
  assert.equal(result.sheets.offset_details.rows, 1);
  assert.equal(result.problemCount, 0);
});

test('"Waybill No." with a full stop, other column orders and extra columns still read', async () => {
  const header = ['Delivery ID', 'junk', 'Waybill No.', 'Signing time', 'Region/route'];
  const workbook = await workbookOf({ fee: [[12345678, 'x', 'TW1', '10/01/2026 10:00:00', 'TST 01-1']], feeHeader: header });
  const { rows } = extractAssignmentEvidence(workbook);
  assert.deepEqual(rows.map((r) => [r.waybill, r.deliveryId, r.routeCode]), [['TW1', '12345678', 'TST 01-1']]);
});

test('rows with no stop details or money still keep who carried the package', async () => {
  const workbook = await workbookOf({ fee: [['TW1', 'Sam', 'TST 01-1', 12345678, '10/01/2026 10:00:00', null, null]] });
  assert.equal(extractAssignmentEvidence(workbook).rows.length, 1);
});

test('bad rows are reported by Excel row number and reason, with no cell values', async () => {
  const workbook = await workbookOf({
    fee: [
      ['TW1', 'Sam', 'TST 01-1', 12345678, '10/01/2026 10:00:00'],
      [null, 'Sam', 'TST 01-1', 12345679, '10/01/2026 10:00:00'],
      ['TW3', 'Sam', 'TST 01-1', null, '10/01/2026 10:00:00'],
    ],
  });
  const result = extractAssignmentEvidence(workbook);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.problems, [
    { sheet: 'fee_details', row: 3, reason: 'waybill is blank' },
    { sheet: 'fee_details', row: 4, reason: 'Delivery ID is blank' },
  ]);
  assert.equal(JSON.stringify(result.problems).includes('12345679'), false);
});

test('the same fact twice in one sheet is read once; the same fact on two sheets is read on each', async () => {
  const row = ['TW1', 'Sam', 'TST 01-1', 12345678, '10/01/2026 10:00:00'];
  const result = extractAssignmentEvidence(await workbookOf({ fee: [row, row], offset: [row] }));
  assert.deepEqual(result.rows.map((r) => r.sheet), ['fee_details', 'offset_details']);
  assert.equal(result.sheets.fee_details.duplicates, 1);
  assert.equal(result.rows[0].identityHash, result.rows[1].identityHash);
});

test('the same report with its rows reordered describes the same facts', async () => {
  const rows = [
    ['TW1', 'Sam', 'TST 01-1', 12345678, '10/01/2026 10:00:00'],
    ['TW2', 'Pat', 'TST 02-1', 22345678, '10/02/2026 10:00:00'],
    ['TW3', 'Lee', 'TST 03-1', 32345678, '10/03/2026 10:00:00'],
  ];
  const a = extractAssignmentEvidence(await workbookOf({ fee: rows }));
  const b = extractAssignmentEvidence(await workbookOf({ fee: [...rows].reverse() }));
  assert.deepEqual(a.rows.map((r) => r.identityHash).sort(), b.rows.map((r) => r.identityHash).sort());
});

test('a missing sheet or a missing column is said, not hidden', async () => {
  const noOffset = await workbookOf({ fee: [['TW1', 'S', 'R', 12345678, '10/01/2026']], sheets: { offset: 'Something else' } });
  assert.equal(extractAssignmentEvidence(noOffset).sheets.offset_details.found, false);
  const noId = await workbookOf({ fee: [['TW1', 'S']], feeHeader: ['Waybill No', 'Courier'] });
  const result = extractAssignmentEvidence(noId);
  assert.deepEqual(result.sheets.fee_details.missingColumns, ['Delivery ID']);
  assert.equal(result.rows.length, 0);
});

test('text that looks like a number keeps its leading zeros through a real file', async () => {
  const workbook = await workbookOf({ fee: [['000771', 'S', 'TST 01-1', '00012345', '10/01/2026 10:00:00']] });
  const [row] = extractAssignmentEvidence(workbook).rows;
  assert.equal(row.waybill, '000771');
  assert.equal(row.deliveryId, '00012345');
  assert.equal(row.idForm, 'unusable');
});

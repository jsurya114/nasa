import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { DETAIL, line, statementSheets } from './helpers/gofoStatementFixture.js';
import { StatementError, centsOf, centsToText, countOf, dayOf } from '../services/finance/gofoStatement/statementMoney.js';
import { parseStatement } from '../services/finance/gofoStatement/parseStatement.js';
import { reconcileStatement } from '../services/finance/gofoStatement/reconcileStatement.js';
import { readStatementWorkbook } from '../services/finance/gofoStatement/readStatementWorkbook.js';

const fixture = () => statementSheets();
const run = (change) => { const sheets = fixture(); change?.(sheets); return reconcileStatement(parseStatement(sheets)); };

test('money is read in exact cents; a blank is missing, a zero is a real zero, and anything else is refused', () => {
  assert.equal(centsOf('-246.05'), -24605);
  assert.equal(centsOf(0.07), 7);
  assert.equal(centsOf(2.61), 261);
  assert.equal(centsOf(0), 0);
  assert.equal(centsOf('0.00'), 0);
  assert.equal(centsOf(''), null);
  assert.equal(centsOf(null), null);
  assert.equal(centsOf({ result: 1.5 }), 150);
  for (const bad of ['abc', '1,5', '1.005', 1.005, NaN, Infinity, true, '1.2.3']) assert.throws(() => centsOf(bad), StatementError, String(bad));
  assert.equal(centsToText(-24605), '-246.05');
  assert.equal(centsToText(5), '0.05');
  assert.equal(countOf(' 12 '), 12);
  assert.equal(countOf(''), null);
  assert.throws(() => countOf(1.5), StatementError);
  assert.throws(() => countOf(-1), StatementError);
});

test('the carrier date format becomes the carrier\'s own day, never shifted by a time zone', () => {
  assert.deepEqual(dayOf('10/24/2026'), { day: '2026-10-24', time: '00:00:00' });
  assert.deepEqual(dayOf('10/19/2026 23:59:59'), { day: '2026-10-19', time: '23:59:59' });
  for (const bad of ['2026-10-24', '13/01/2026', '02/30/2026', '10/19/2026 24:00:00', '', null]) assert.throws(() => dayOf(bad), StatementError, String(bad));
});

test('a consistent statement reconciles to the cent and keeps every figure separate', () => {
  const r = run();
  assert.equal(r.status, 'reconciled');
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.amounts, { detailFees: '6.71', offsets: '-1.80', deliveryRevenue: '4.91', claims: '-0.70', adjustments: '-2.00', settlementPayable: '2.21', prepaid: '0.00', withdrawalFees: '0.00' });
  assert.deepEqual(r.identity, { billNumber: 'AP0000000001', fleet: 'TST-NLC', billingPeriod: 'Weekly settlement', billingPeriodRange: 'Week 43-2026', currency: 'USD' });
  assert.equal(r.totals.detailLines, 4);
  assert.equal(r.totals.offsetLines, 1);
});

test('the lines keep their source row, route, courier ID and signing day', () => {
  const s = parseStatement(fixture());
  assert.deepEqual(s.details[0], { ref: { sheet: 'Details of Delivery Fees', row: 2 }, waybill: 'W1', courier: 'Driver One', deliveryId: '1001', route: 'TS01-001', signedOn: '2026-10-19', feeCents: 180, weightRange: '0-1lb' });
  assert.equal(s.offsets[0].feeCents, -180);
  assert.equal(s.offsets[0].ref.row, 2);
  assert.equal(s.claims[0].onDay, '2026-10-19');
  assert.equal(s.adjustments[0].amountCents, -200);
  assert.equal(s.driverSummary[2].deliveryId, null, 'the row for the fleet-wide adjustment has no courier');
});

test('any control that is one cent off rejects the statement and names the check', () => {
  for (const [sheet, rowIndex, column, bump] of [['DSP Summary', 2, 9, 0.01], ['DSP Summary', 2, 13, 0.01], ['DSP Summary', 2, 12, 1], ['Driver Summary', 2, 6, 0.01], ['Driver Daily Summary', 3, 3, 0.01]]) {
    const r = run((sheets) => { sheets[sheet][rowIndex][column] = Number((sheets[sheet][rowIndex][column] + bump).toFixed(2)); });
    assert.equal(r.status, 'rejected', `${sheet} ${column}`);
    assert.ok(r.failed.length >= 1);
  }
  const r = run((sheets) => { sheets['DSP Summary'][2][9] = 2.22; });
  assert.ok(r.failed.some((c) => /total billing/.test(c.name) && c.expected === 222 && c.actual === 221));
});

test('a detail line with a bad amount, bad day, blank amount or missing ID is reported with its sheet and row, and the statement is rejected', () => {
  const r = run((sheets) => {
    sheets['Details of Delivery Fees'][2][15] = '1.2x'; // row 3
    sheets['Details of Delivery Fees'][3][12] = '31/31/2026'; // row 4
    sheets['Offset Details'][1][15] = null; // blank money is missing, not zero
    sheets['Details of Delivery Fees'][4][9] = null;
  });
  assert.equal(r.status, 'rejected');
  assert.deepEqual(r.issues.map((i) => [i.sheet, i.row, i.field]).sort(), [['Details of Delivery Fees', 3, 'Fee'], ['Details of Delivery Fees', 4, 'Signing time'], ['Details of Delivery Fees', 5, 'Delivery ID'], ['Offset Details', 2, 'Fee']].sort());
});

test('a valid zero is accepted, while a missing sheet or column is refused', () => {
  assert.equal(run((sheets) => { sheets['Details of Delivery Fees'].push(line('W5', 'Driver Two', 1002, 'TS01-002', '10/20/2026 11:00:00', 0)); sheets['DSP Summary'][2][12] = 6; }).status, 'reconciled');
  const noSheet = run((sheets) => { delete sheets['Claims Detail']; });
  assert.equal(noSheet.status, 'rejected');
  assert.ok(noSheet.issues.some((i) => i.sheet === 'Claims Detail'));
  const noColumn = run((sheets) => { sheets['Details of Delivery Fees'][0][15] = 'Other'; });
  assert.equal(noColumn.status, 'rejected');
});

test('prepayments and withdrawal fees are shown on their own and never counted as delivery revenue', () => {
  const r = run((sheets) => {
    sheets['Total Prepaid to Driver Account'].push(['10/20/2026', 1.5, '77', 'Driver One', '10/20/2026', '2026-43']);
    sheets['Total Withdrawal Fees for Drive'].push(['T1', 'TST-NLC', '77', 'Driver One', 20, '10/20/2026', '10/01/2026', 'Y', 0.25]);
    sheets['DSP Summary'][2][7] = 1.5; sheets['DSP Summary'][2][6] = 0.71; // remaining payable = payable - prepaid
  });
  assert.equal(r.status, 'reconciled');
  assert.equal(r.amounts.deliveryRevenue, '4.91');
  assert.equal(r.amounts.settlementPayable, '2.21');
  assert.equal(r.amounts.prepaid, '1.50');
  assert.equal(r.amounts.withdrawalFees, '0.25');
});

test('the fingerprint ignores row order and changes when the statement is corrected', () => {
  const same = parseStatement(fixture()).fingerprint;
  const shuffled = fixture();
  shuffled['Details of Delivery Fees'] = [DETAIL, ...shuffled['Details of Delivery Fees'].slice(1).reverse()];
  assert.equal(parseStatement(shuffled).fingerprint, same, 'a re-upload of the same statement is recognised');
  const corrected = fixture();
  corrected['Details of Delivery Fees'][1][15] = 1.81;
  assert.notEqual(parseStatement(corrected).fingerprint, same, 'a corrected statement is a different one');
});

test('a real .xlsx file is read the same way as the rows (formula results, truncated sheet names)', async () => {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(fixture())) workbook.addWorksheet(name).addRows(rows.map((row) => row.map((v) => (v === '' ? null : v))));
  workbook.getWorksheet('DSP Summary').getCell('N3').value = { formula: '4.91', result: 4.91 };
  const sheets = await readStatementWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  const r = reconcileStatement(parseStatement(sheets));
  assert.equal(r.status, 'reconciled');
  assert.equal(r.fingerprint, reconcileStatement(parseStatement(fixture())).fingerprint);
  await assert.rejects(readStatementWorkbook(Buffer.from('not a workbook')), StatementError);
});

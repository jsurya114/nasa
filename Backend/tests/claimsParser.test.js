import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { parseClaimsRows, parseClaimsWorkbook } from '../services/payroll/claims/claimsParser.js';

// The carrier's column titles, with made-up rows. No real waybill, courier, postal code or amount.
const HEADER = ['date', 'Waybill No.', 'Courier', 'Postal code', 'Claim Type', 'Declared value (USD)', 'Tax Included', 'Tax Rate', 'Weight(KG)', 'Confirm date.', 'The total expenses-exclusive of taxes', 'Remarks'];
const row = (o = {}) => [
  o.date ?? '09/28/2026 10:00:00', o.waybill ?? 'TEST0001', o.courier ?? 'Any Name', '00000', o.type ?? 'Damaged Item',
  o.declared ?? 120, 'Excluding Tax', 0, 1.2, o.confirm ?? '10/02/2026 09:00:00', 'charge' in o ? o.charge : -40, o.remarks ?? null,
];

test('every real claim type is read, with the absolute charge and not the declared value', () => {
  const types = ['fake pod', 'Damaged Item', 'Driver Violent Delivery', 'Driver Harassment of Customer', 'Tracking interruption', 'A Type Never Seen Before'];
  const rows = [HEADER, ...types.map((type, i) => row({ type, waybill: `TEST000${i}`, charge: i % 2 ? 40 : -40, declared: 999 }))];
  const { claims, problems } = parseClaimsRows(rows, { courier: 'gofo' });
  assert.deepEqual(problems, []);
  assert.equal(claims.length, types.length);
  assert.deepEqual(claims.map((c) => c.deduction), types.map(() => '40.00'));
  assert.deepEqual(claims.map((c) => c.charge), types.map((_, i) => (i % 2 ? '40.00' : '-40.00')));
  assert.ok(claims.every((c) => c.declaredValue === '999.00'));
  assert.equal(claims[4].claimTypeKey, 'tracking interruption');
  assert.deepEqual([claims[0].claimAt, claims[0].confirmedAt, claims[0].sourceRow], ['2026-09-28 10:00:00', '2026-10-02 09:00:00', 2]);
});

test('the Courier column (the driver\'s name) is kept, cleaned, with the key a claim is matched by (issue #180)', () => {
  const { claims } = parseClaimsRows([HEADER, row({ courier: '  Sam   LEE\t' }), row({ waybill: 'TEST0002', courier: 'sam lee' }), row({ waybill: 'TEST0003', courier: '' }), row({ waybill: 'TEST0004', courier: '   ' })], { courier: 'gofo' });
  assert.deepEqual(claims.map((c) => [c.courierName, c.courierNameKey]), [['Sam LEE', 'sam lee'], ['sam lee', 'sam lee'], [null, null], [null, null]]);
});

test('a sheet without a Courier column still gives its claims, with no name to match by', () => {
  const header = HEADER.filter((h) => h !== 'Courier');
  const rows = [header, ['09/28/2026 10:00:00', 'TEST0001', '00000', 'Damaged Item', 120, 'Excluding Tax', 0, 1.2, '10/02/2026 09:00:00', -40, null]];
  const { claims, problems } = parseClaimsRows(rows, { courier: 'gofo' });
  assert.deepEqual(problems, []);
  assert.deepEqual([claims.length, claims[0].courierName, claims[0].courierNameKey], [1, null, null]);
});

test('bad rows are reported with their Excel row number and are not imported', () => {
  const rows = [
    HEADER,
    row({ waybill: '' }),
    row({ waybill: 'TEST0002', type: ' ' }),
    row({ waybill: 'TEST0003', charge: null }),
    row({ waybill: 'TEST0004', charge: 0 }),
    row({ waybill: 'TEST0005', charge: 'n/a' }),
    row({ waybill: 'TEST0006', date: '28/09/2026' }),
    row({ waybill: 'TEST0007', confirm: 'soon' }),
    [null, '', null],
    row({ waybill: 'TEST0008' }),
  ];
  const { claims, problems } = parseClaimsRows(rows, { courier: 'gofo' });
  assert.deepEqual(claims.map((c) => c.waybill), ['TEST0008']);
  assert.deepEqual(problems.map((p) => p.row), [2, 3, 4, 5, 6, 7, 8]);
  assert.match(problems[0].message, /waybill is missing/);
  assert.match(problems[1].message, /claim type is missing/);
  assert.match(problems[2].message, /blank or not a number/);
  assert.match(problems[3].message, /zero/);
  assert.match(problems[5].message, /claim date/);
  assert.match(problems[6].message, /confirm date/);
});

test('the same claim twice in one file is imported once; conflicting copies are not imported at all', () => {
  const same = parseClaimsRows([HEADER, row(), row({ waybill: ' test0001 ', type: 'damaged item' })], { courier: 'gofo' });
  assert.equal(same.claims.length, 1);
  assert.match(same.problems[0].message, /repeats row 2; imported once/);

  const conflict = parseClaimsRows([HEADER, row(), row({ charge: -55 }), row({ waybill: 'TEST0009' })], { courier: 'gofo' });
  assert.deepEqual(conflict.claims.map((c) => c.waybill), ['TEST0009']);
  assert.match(conflict.problems[0].message, /conflicts with row 2/);
});

test('a missing required column stops the sheet with one clear problem', () => {
  const header = HEADER.filter((h) => h !== 'The total expenses-exclusive of taxes');
  const { claims, problems } = parseClaimsRows([header, row()], { courier: 'gofo' });
  assert.equal(claims.length, 0);
  assert.match(problems[0].message, /missing column "The total expenses-exclusive of taxes"/);
});

test('column titles match without case or spacing; empty sheets give nothing', () => {
  const header = HEADER.map((h) => ` ${h.toUpperCase()} `);
  assert.equal(parseClaimsRows([header, row()], { courier: 'gofo' }).claims.length, 1);
  assert.deepEqual(parseClaimsRows([], { courier: 'gofo' }), { claims: [], problems: [] });
  assert.deepEqual(parseClaimsRows(undefined, { courier: 'gofo' }), { claims: [], problems: [] });
});

test('reads the Claims Detail sheet from a workbook, and a workbook without it has no claims', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Waybill No'], ['TEST0001']]), 'Details of Delivery Fees');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, row(), row({ waybill: 'TEST0002', type: 'Tracking interruption', charge: 25 })]), 'Claims Detail');
  const read = parseClaimsWorkbook(XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })), { courier: 'gofo' });
  assert.equal(read.found, true);
  assert.deepEqual(read.claims.map((c) => [c.waybill, c.deduction]), [['TEST0001', '40.00'], ['TEST0002', '25.00']]);

  const none = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(none, XLSX.utils.aoa_to_sheet([['x']]), 'Driver Summary');
  assert.deepEqual(parseClaimsWorkbook(none, { courier: 'gofo' }), { found: false, claims: [], problems: [] });
});

test('every occupied row is read even when the file\'s saved range says fewer rows (sparse and dense sheets)', () => {
  const rows = [HEADER];
  for (let i = 1; i <= 15; i += 1) rows.push(row({ waybill: `TEST${String(i).padStart(4, '0')}` }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Claims Detail');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  for (const dense of [false, true]) {
    const read = XLSX.read(buffer, { dense });
    // As carrier exports have it: the saved range covers the header and one row, the cells go on.
    read.Sheets['Claims Detail']['!ref'] = 'A1:L2';
    const out = parseClaimsWorkbook(read, { courier: 'gofo' });
    assert.equal(out.claims.length, 15, dense ? 'dense sheet' : 'sparse sheet');
    assert.deepEqual(out.problems, []);
    assert.equal(read.Sheets['Claims Detail']['!ref'], 'A1:L2', 'the caller\'s workbook is not changed');
  }
});

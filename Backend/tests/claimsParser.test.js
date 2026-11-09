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

test('one claim twice in a file under different driver names conflicts: neither is imported, so no driver is picked by position', () => {
  const { claims, problems } = parseClaimsRows([HEADER, row({ courier: 'Sam Lee' }), row({ courier: 'Pat Jones' })], { courier: 'gofo' });
  assert.deepEqual(claims, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /conflicts with row 2 .*different driver name.*neither is imported/);
});

test('a repeat that differs only by case or spacing is a plain repeat, and a repeat that supplies the missing name keeps it', () => {
  const same = parseClaimsRows([HEADER, row({ courier: 'Sam Lee' }), row({ courier: '  sam   LEE ' })], { courier: 'gofo' });
  assert.deepEqual([same.claims.length, same.problems.length], [1, 1]);
  assert.match(same.problems[0].message, /repeats row 2; imported once/);
  const lateName = parseClaimsRows([HEADER, row({ courier: '' }), row({ courier: 'Sam Lee' })], { courier: 'gofo' });
  assert.deepEqual([lateName.claims.length, lateName.claims[0].courierNameKey], [1, 'sam lee']);
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

// Refunds (the carrier's "Prior Period Claim Refund"): money given back for an earlier penalty, never a charge. Made-up values.
const REFUND = { remarks: 'Prior Period Claim Refund', type: 'Tracking interruption' };

test('a refunded penalty nets out: lost -13.86, refund +13.86 and a separate -40 deduct 40 in total', () => {
  const rows = [HEADER,
    row({ waybill: 'TESTLOST', type: 'lost', charge: -13.86, remarks: 'Claim Penalty' }),
    row({ waybill: 'TESTFAKE', type: 'Tracking interruption', charge: -40, remarks: 'Claim Penalty' }),
    row({ waybill: 'TESTLOST', charge: 13.86, ...REFUND })];
  const { claims, problems } = parseClaimsRows(rows, { courier: 'gofo' });
  assert.deepEqual(claims.map((c) => [c.waybill, c.deduction]), [['TESTFAKE', '40.00']]);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].row, 4);
  assert.match(problems[0].message, /refund of 13\.86 cancels the penalty in row 2/);
});

test('a refund listed before its penalty nets the same way, and cents add up exactly', () => {
  const rows = [HEADER, row({ waybill: 'TESTLOST', charge: 0.1, ...REFUND }), row({ waybill: 'TESTLOST', type: 'lost', charge: -0.1 }), row({ waybill: 'TESTOTHER', charge: -0.2 })];
  assert.deepEqual(parseClaimsRows(rows, { courier: 'gofo' }).claims.map((c) => c.deduction), ['0.20']);
});

test('a part refund reduces the penalty to what is left', () => {
  const rows = [HEADER, row({ waybill: 'TESTLOST', type: 'lost', charge: -20 }), row({ waybill: 'TESTLOST', charge: 5.25, ...REFUND })];
  const { claims, problems } = parseClaimsRows(rows, { courier: 'gofo' });
  assert.deepEqual(claims.map((c) => [c.deduction, c.charge]), [['14.75', '-14.75']]);
  assert.match(problems[0].message, /refund of 5\.25 reduces the penalty in row 2 .* to 14\.75/);
});

test('a refund with no penalty for its waybill in the file deducts nothing and is reported, never charged', () => {
  const rows = [HEADER, row({ waybill: 'TESTGONE', charge: 8, ...REFUND }), row({ waybill: 'TESTFAKE', charge: -40 })];
  const { claims, problems } = parseClaimsRows(rows, { courier: 'gofo' });
  assert.deepEqual(claims.map((c) => c.waybill), ['TESTFAKE']);
  assert.match(problems[0].message, /refund of 8\.00 has no penalty for the same waybill in this file; nothing is deducted/);
});

test('a refund larger than the penalty cancels it and reports the rest; it never becomes a credit', () => {
  const rows = [HEADER, row({ waybill: 'TESTLOST', type: 'lost', charge: -10 }), row({ waybill: 'TESTLOST', charge: 12, ...REFUND })];
  const { claims, problems } = parseClaimsRows(rows, { courier: 'gofo' });
  assert.deepEqual(claims, []);
  assert.equal(problems.length, 2);
  assert.match(problems[1].message, /2\.00 of this refund is more than the penalty/);
});

test('a positive amount without "Refund" in the remarks is still a deduction (the owner-confirmed absolute rule)', () => {
  const { claims } = parseClaimsRows([HEADER, row({ waybill: 'TESTPLUS', charge: 40, remarks: 'Claim Penalty' })], { courier: 'gofo' });
  assert.deepEqual(claims.map((c) => c.deduction), ['40.00']);
});

test('one refund is used once: two penalties on the same waybill are not both cancelled by it', () => {
  const rows = [HEADER, row({ waybill: 'TESTLOST', type: 'lost', charge: -10 }), row({ waybill: 'TESTLOST', type: 'Damaged Item', charge: -10 }), row({ waybill: 'TESTLOST', charge: 10, ...REFUND })];
  assert.deepEqual(parseClaimsRows(rows, { courier: 'gofo' }).claims.map((c) => [c.claimType, c.deduction]), [['Damaged Item', '10.00']]);
});

test('an identical copy of a refund row is counted once, so it cannot cancel more than was refunded (review of #268)', () => {
  const penalty = row({ waybill: 'TESTLOST', type: 'lost', charge: -20 });
  const refund = row({ waybill: 'TESTLOST', charge: 10, ...REFUND });
  const { claims, problems } = parseClaimsRows([HEADER, penalty, refund, [...refund]], { courier: 'gofo' });
  assert.deepEqual(claims.map((c) => [c.waybill, c.deduction]), [['TESTLOST', '10.00']]);
  assert.ok(problems.some((p) => p.row === 4 && /repeats the refund in row 3; counted once/.test(p.message)));
  // an identical copy that differs only by case or spacing of the driver name is the same refund
  const named = parseClaimsRows([HEADER, penalty, row({ waybill: 'TESTLOST', charge: 10, courier: 'Sam Lee', ...REFUND }), row({ waybill: 'TESTLOST', charge: 10, courier: ' sam  LEE ', ...REFUND })], { courier: 'gofo' });
  assert.deepEqual(named.claims.map((c) => c.deduction), ['10.00']);
});

test('genuinely different refunds on one waybill are each applied (another date or another amount)', () => {
  const penalty = row({ waybill: 'TESTLOST', type: 'lost', charge: -20 });
  const byDate = parseClaimsRows([HEADER, penalty, row({ waybill: 'TESTLOST', charge: 10, date: '10/13/2026 00:00:00', ...REFUND }), row({ waybill: 'TESTLOST', charge: 10, date: '10/14/2026 00:00:00', ...REFUND })], { courier: 'gofo' });
  assert.deepEqual(byDate.claims, []);
  const byAmount = parseClaimsRows([HEADER, penalty, row({ waybill: 'TESTLOST', charge: 10, ...REFUND }), row({ waybill: 'TESTLOST', charge: 4, ...REFUND })], { courier: 'gofo' });
  assert.deepEqual(byAmount.claims.map((c) => c.deduction), ['6.00']);
});

test('the parse says how many refund rows a file holds and which penalties they cancelled, even when no claim is left', () => {
  const { claims, refunds, refundedKeys } = parseClaimsRows([HEADER, row({ waybill: 'TESTLOST', type: 'lost', charge: -20 }), row({ waybill: 'TESTLOST', charge: 20, ...REFUND })], { courier: 'gofo' });
  assert.deepEqual([claims.length, refunds, refundedKeys.length], [0, 1, 1]);
});

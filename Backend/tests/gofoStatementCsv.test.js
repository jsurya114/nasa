import test from 'node:test';
import assert from 'node:assert/strict';
import { STATEMENT_COLUMNS, UNALLOCATED_COLUMNS, numberCell, textCell, toCsv } from '../services/finance/gofoStatement/statementCsv.js';

test('text from a statement file cannot run as a spreadsheet formula, and is quoted when it needs to be', () => {
  for (const hostile of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) assert.equal(textCell(hostile).replace(/^"|"$/g, '').startsWith("'"), true, JSON.stringify(hostile));
  assert.equal(textCell('Lafayette GOFO'), 'Lafayette GOFO');
  assert.equal(textCell('a,b'), '"a,b"');
  assert.equal(textCell('say "hi"'), '"say ""hi"""');
  assert.equal(textCell(null), '');
  assert.equal(numberCell('-0.70'), '-0.70', 'a number we formatted is not mangled');
  assert.equal(numberCell(null), '');
});

test('a CSV has one header and one line per row, with CRLF line ends and no driver names', () => {
  const csv = toCsv(STATEMENT_COLUMNS, [{ city: '=Lafayette', billingWeek: 'Week 43-2026', periodStart: '2026-10-19', periodEnd: '2026-10-25', billNumber: 'AP1', version: 2, status: 'published', deliveryRevenue: '4.91', carrierClaims: '-0.70' }]);
  const [header, line, end] = csv.split('\r\n');
  assert.equal(end, '');
  assert.equal(header.split(',').length, STATEMENT_COLUMNS.length);
  assert.equal(line.split(',').length, STATEMENT_COLUMNS.length);
  assert.match(line, /^'=Lafayette,Week 43-2026,2026-10-19,2026-10-25,AP1,2,published,4\.91,,,,,-0\.70,/);
  assert.equal(/driver name|courier/i.test(header), false);
  assert.match(toCsv(UNALLOCATED_COLUMNS, []), /^Delivery ID,Signing day,Route,Why,Revenue,Fee lines,Offset lines\r\n$/);
});

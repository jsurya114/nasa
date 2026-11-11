import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  InvoiceInputError, centsText, chicagoToday, datesBetween, lineTotalCents, parseHistoryQuery, parseInvoice, parsePayment, parseVendor, toCents, weekdayOf,
} from '../services/invoices/invoiceRules.js';

// Invoices: the server's rules and money. No database.
const errorsOf = (fn) => { try { fn(); return null; } catch (e) { assert.ok(e instanceof InvoiceInputError, e.message); return e.errors; } };
const hourly = (over = {}) => ({ invoiceNumber: '0028', type: 'hourly', vendorId: 1, periodStart: '2026-10-26', periodEnd: '2026-11-01', billTo: { name: 'GOFO INC.', line1: '36-47 MAIN STREET,', line2: 'FLUSHING, NY, 11354, USA' },
  lines: [{ job: 'General worker', reHours: '360', overtime: '71.05', totalHours: '431.05', totalCost: '7543.37' }], ...over });
const item = (lines, over = {}) => ({ invoiceNumber: 'A-1', type: 'item', vendorId: 2, periodStart: '2026-06-01', periodEnd: '2026-06-05', billTo: { name: 'Acme' }, lines, ...over });

test('money is exact: cents, line totals rounded half up, subtotal the sum of rounded lines', () => {
  assert.deepEqual([toCents('200'), toCents('200.5'), toCents('1,234.56'), toCents(' 7 ')], [20000, 20050, 123456, 700]);
  for (const bad of ['', '-1', '1.234', 'abc', '1e3', null, undefined, '.5']) assert.equal(toCents(bad), null, String(bad));
  assert.equal(centsText(lineTotalCents(20000, 400)), '800.00', '$200.00 x 4');
  assert.equal(centsText(lineTotalCents(33, 50)), '0.17', '0.33 x 0.5 = 0.165, up to 0.17');
  assert.equal(centsText(lineTotalCents(1999, 333)), '66.57', '19.99 x 3.33 = 66.5667');
  assert.equal(centsText(lineTotalCents(999999999, 9999999)), '999999899000.00', 'no floating point even at the limits (9,999,999.99 x 99,999.99)');
  assert.match(errorsOf(() => parseInvoice(item([{ date: '2026-06-01', item: 'Huge', rate: '9999999.99', quantity: '99999.99' }]))).lineErrors[0].quantity, /more than 99,999,999.99/, 'refused, not an overflow in the database');
  const near = Array.from({ length: 5 }, (_, i) => ({ date: `2026-06-0${i + 1}`, item: 'Big', rate: '9999999.99', quantity: '5' }));
  assert.match(errorsOf(() => parseInvoice(item(near))).lines, /invoice total is more than/);
  const { totalCents, lines } = parseInvoice(item([
    { date: '2026-06-01', item: 'Cargo van', rate: '0.33', quantity: '0.5' },
    { date: '2026-06-02', item: 'Cargo van', rate: '0.33', quantity: '0.5' },
    { date: '2026-06-03', item: 'Cargo van', rate: '0.33', quantity: '0.5' },
  ]));
  assert.deepEqual(lines.map((l) => l.lineTotal), [17, 17, 17]);
  assert.equal(totalCents, 51, 'each line rounded first, then summed (not 0.495 rounded once)');
});

test('dates: every day from start to end, both included, with the weekday', () => {
  assert.deepEqual(datesBetween('2026-06-01', '2026-06-05').map(weekdayOf), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  assert.deepEqual(datesBetween('2026-06-05', '2026-06-08'), ['2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08'], 'weekends included');
  assert.deepEqual(datesBetween('2026-06-01', '2026-06-01'), ['2026-06-01']);
  assert.equal(datesBetween('2026-02-27', '2026-03-02').length, 4, '2026 is not a leap year');
  assert.equal(datesBetween('2026-11-01', '2026-11-02').length, 2, 'a daylight-saving change does not skip or repeat a day');
});

test('hourly: the total is the sum of the job costs as entered, and the old form rules still hold', () => {
  const two = parseInvoice(hourly({ lines: [...hourly().lines, { job: 'Forklift', reHours: '40', overtime: '', totalHours: '40', totalCost: '1200' }] }));
  assert.equal(two.totalCents, 754337 + 120000);
  assert.equal(two.lines[1].overtime, 0, 'empty overtime is 0');
  assert.ok(errorsOf(() => parseInvoice(hourly({ lines: [] }))).lines);
  assert.ok(errorsOf(() => parseInvoice(hourly({ lines: Array(8).fill(hourly().lines[0]) }))).lines);
  const bad = errorsOf(() => parseInvoice(hourly({ lines: [{ job: '', reHours: '-1', overtime: 'x', totalHours: '1.234', totalCost: '$5' }] })));
  assert.deepEqual(Object.keys(bad.lineErrors[0]).sort(), ['job', 'overtime', 'reHours', 'totalCost', 'totalHours']);
});

test('item-based: blank rows are skipped, partial rows are flagged, at least one billed line, dates inside the period', () => {
  const ok = parseInvoice(item([
    { date: '2026-06-01', item: 'Box truck', rate: '200', quantity: '4' },
    { date: '2026-06-02', item: '', rate: '', quantity: '' },
    { date: '2026-06-03', item: 'Box truck', rate: '200.00', quantity: '1.5' },
  ]));
  assert.deepEqual(ok.lines.map((l) => [l.date, l.lineTotal]), [['2026-06-01', 80000], ['2026-06-03', 30000]]);
  assert.equal(ok.totalCents, 110000);
  const partial = errorsOf(() => parseInvoice(item([{ date: '2026-06-01', item: 'Box truck', rate: '200', quantity: '' }])));
  assert.match(partial.lineErrors[0].row, /Fill in the item, rate and quantity/);
  assert.match(errorsOf(() => parseInvoice(item([{ date: '2026-06-01', item: '', rate: '', quantity: '' }]))).lines, /at least one line/);
  assert.match(errorsOf(() => parseInvoice(item([{ date: '2026-06-01', item: 'Free', rate: '0', quantity: '3' }]))).lines, /must have an amount/);
  assert.match(errorsOf(() => parseInvoice(item([{ date: '2026-06-09', item: 'X', rate: '1', quantity: '1' }]))).lineErrors[0].date, /outside the billing period/);
  assert.match(errorsOf(() => parseInvoice(item([{ date: '2026-02-30', item: 'X', rate: '1', quantity: '1' }], { periodStart: '2026-02-01', periodEnd: '2026-02-28' }))).lineErrors[0].date, /Not a real date/);
  assert.match(errorsOf(() => parseInvoice(item([{ date: '2026-06-01', item: 'X', rate: '1', quantity: '1' }, { date: '2026-06-01', item: 'Y', rate: '1', quantity: '1' }]))).lineErrors[1].date, /twice/);
  const numbers = errorsOf(() => parseInvoice(item([{ date: '2026-06-01', item: 'X', rate: '-1', quantity: 'two' }])));
  assert.ok(numbers.lineErrors[0].rate && numbers.lineErrors[0].quantity);
});

test('the header: number, vendor, period (no reversed range), bill-to', () => {
  const e = errorsOf(() => parseInvoice(hourly({ invoiceNumber: '', vendorId: 'x', periodStart: '2026-11-02', periodEnd: '2026-11-01', billTo: { name: '' } })));
  assert.deepEqual(Object.keys(e).sort(), ['billTo.name', 'invoiceNumber', 'periodEnd', 'vendorId']);
  assert.match(e.periodEnd, /cannot be before/);
  assert.ok(errorsOf(() => parseInvoice(hourly({ invoiceNumber: '<b>' }))).invoiceNumber);
  assert.ok(errorsOf(() => parseInvoice(hourly({ periodStart: '2025-01-01', periodEnd: '2026-06-01' }))).periodEnd, 'a period over 366 days');
  assert.ok(errorsOf(() => parseInvoice(hourly({ type: 'weekly' }))).type);
  assert.ok(errorsOf(() => parseInvoice(hourly({ billTo: { name: 'A', contactEmail: 'not-an-email' } })))['billTo.contactEmail']);
  assert.equal(parseInvoice(hourly({ invoiceNumber: '  0028 ' })).invoiceNumber, '0028');
});

test('vendors, payments and history queries accept only known values', () => {
  assert.deepEqual(parseVendor({ billingName: ' Acme  Ltd ', addressLine1: '1 Main', billingType: 'item' }),
    { billingName: 'Acme Ltd', addressLine1: '1 Main', addressLine2: '', contactName: '', contactEmail: '', billingType: 'item' });
  assert.ok(errorsOf(() => parseVendor({ billingName: 'A' })).billingType, 'a billing type is required');
  assert.ok(errorsOf(() => parseVendor({ billingType: 'hourly' })).name);
  assert.deepEqual(parsePayment({ receivedOn: '2026-11-10', reference: ' CHK 1001 ', version: 3 }, '2026-11-11'), { receivedOn: '2026-11-10', reference: 'CHK 1001', version: 3 });
  assert.match(errorsOf(() => parsePayment({ receivedOn: '2026-11-12' }, '2026-11-11')).receivedOn, /future/);
  assert.ok(errorsOf(() => parsePayment({ receivedOn: '' })).receivedOn);
  assert.equal(parsePayment({ receivedOn: '2026-11-10' }, '2026-11-11').reference, null);
  assert.deepEqual(parseHistoryQuery({}), { page: 1, search: '', vendorId: null, type: '', status: '', from: '', to: '', sort: 'invoice_date', dir: 'desc' });
  for (const bad of [{ sort: 'total; DROP' }, { status: 'void' }, { type: 'weekly' }, { from: '2026-13-01' }, { from: '2026-11-02', to: '2026-11-01' }, { page: '0' }, { vendorId: 'x' }, { dir: 'up' }]) {
    assert.throws(() => parseHistoryQuery(bad), InvoiceInputError, JSON.stringify(bad));
  }
});

test('today is taken in America/Chicago', () => {
  assert.equal(chicagoToday(new Date('2026-11-11T05:30:00Z')), '2026-11-10', '11:30 PM in Chicago the day before');
  assert.equal(chicagoToday(new Date('2026-11-11T06:30:00Z')), '2026-11-11');
});

test('the routes check the token and then the super admin role before any invoice route, and are mounted before /admin', () => {
  const lines = readFileSync(new URL('../routes/invoiceRoutes.js', import.meta.url), 'utf8').split('\n').map((l) => l.trim());
  const auth = lines.indexOf('router.use(adminAuth);');
  const role = lines.indexOf("router.use(requireRole('superadmin'));");
  const first = lines.findIndex((l) => /^router\.(get|post|put|patch|delete)\(/.test(l));
  assert.ok(auth > -1 && role > auth && first > role);
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf("app.use('/admin/invoices'") > -1 && app.indexOf("app.use('/admin/invoices'") < app.indexOf("app.use('/admin', "));
});

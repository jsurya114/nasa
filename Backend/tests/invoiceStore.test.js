import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { chicagoToday, parseHistoryQuery, parseInvoice, parseVendor } from '../services/invoices/invoiceRules.js';
import {
  createInvoice, createVendor, getInvoice, listInvoices, listVendors, markPaymentReceived, nextInvoiceNumber, updateInvoice, updateVendor,
} from '../services/invoices/invoiceStore.js';
import { businessSummary } from '../services/reporting/deliveryReports.js';
import { parseRange } from '../services/reporting/inputs.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. The first test runs in one
// transaction that is always rolled back. The second needs two connections, so its few rows are committed and removed again at the end.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const MIGRATION = new URL('../migrations/2026-11-11-invoices.sql', import.meta.url);

test('invoices: saved, reloaded, numbered once, edited while pending, locked when paid, listed, and counted in Insights by receipt date', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  let sp = 0;
  const savepoint = async (fn) => { const name = `s${sp++}`; await db.query(`SAVEPOINT ${name}`); try { return await fn(); } finally { await db.query(`ROLLBACK TO SAVEPOINT ${name}`); } };
  // fn starts its queries only after the savepoint, so a refused statement never aborts the outer transaction
  const rejects = async (fn, status, pattern) => {
    const name = `r${sp++}`;
    await db.query(`SAVEPOINT ${name}`);
    try { await assert.rejects(fn, (e) => e.status === status && pattern.test(e.message), `expected ${status} ${pattern}`); } finally { await db.query(`ROLLBACK TO SAVEPOINT ${name}`); }
  };
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(MIGRATION, 'utf8'));
    const tag = randomBytes(3).toString('hex').toUpperCase();
    const admin = { id: (await one('SELECT id FROM admin ORDER BY id LIMIT 1')).id, role: 'superadmin' };
    const hourlyVendor = await createVendor(db, admin, parseVendor({ billingName: `Hourly Co ${tag}`, addressLine1: '1 Main St', addressLine2: 'Dallas, TX', billingType: 'hourly' }));
    const itemVendor = await createVendor(db, admin, parseVendor({ billingName: `Item Co ${tag}`, addressLine1: '9 Elm St', contactName: 'Pat', contactEmail: 'pat@example.test', billingType: 'item' }));
    const hourlyBody = (over = {}) => ({
      invoiceNumber: `H${tag}`, type: 'hourly', vendorId: hourlyVendor.id, periodStart: '2026-10-26', periodEnd: '2026-11-01',
      billTo: { name: hourlyVendor.billingName, line1: hourlyVendor.addressLine1, line2: hourlyVendor.addressLine2 },
      lines: [{ job: 'General worker', reHours: '360', overtime: '71.05', totalHours: '431.05', totalCost: '7543.37' }], ...over });
    const itemBody = (over = {}) => ({
      invoiceNumber: `I${tag}`, type: 'item', vendorId: itemVendor.id, periodStart: '2026-06-01', periodEnd: '2026-06-05',
      billTo: { name: itemVendor.billingName, line1: itemVendor.addressLine1, contactName: 'Pat', contactEmail: 'pat@example.test' },
      lines: [
        { date: '2026-06-01', item: 'Box truck', rate: '200', quantity: '4' },
        { date: '2026-06-02', item: '', rate: '', quantity: '' },
        { date: '2026-06-03', item: 'Box truck', rate: '199.99', quantity: '3.33' },
      ], ...over });

    await t.test('the GOFO preset is carried forward as an editable Hourly vendor, and a vendor name is used once', async () => {
      const gofo = (await listVendors(db)).find((v) => v.billingName === 'GOFO INC.');
      assert.deepEqual([gofo.addressLine1, gofo.addressLine2, gofo.billingType], ['36-47 MAIN STREET,', 'FLUSHING, NY, 11354, USA', 'hourly']);
      await rejects(() => createVendor(db, admin, parseVendor({ billingName: `  hourly co ${tag.toLowerCase()} `, billingType: 'item' })), 409, /already exists/);
    });

    await t.test('an hourly invoice is saved with server-worked totals, today\'s Chicago date, and its issuer, terms and bill-to snapshot', async () => {
      const { invoice, replay } = await createInvoice(db, admin, parseInvoice(hourlyBody()), randomUUID());
      assert.equal(replay, false);
      const again = await getInvoice(db, invoice.id); // as after a reload
      assert.deepEqual([again.invoiceNumber, again.type, again.status, again.total, again.invoiceDate, again.version], [`H${tag}`, 'hourly', 'pending', '7543.37', chicagoToday(), 1]);
      assert.deepEqual(again.lines, [{ position: 1, kind: 'hourly', job: 'General worker', reHours: '360', overtime: '71.05', totalHours: '431.05', totalCost: '7543.37' }]);
      assert.deepEqual(again.issuer.addressLines, ['ARLINGTON, TEXAS 76015']);
      assert.deepEqual(again.issuer.emails, ['nasalogisticscarriers@gmail.com', 'Info@drivefornlc.com']);
      assert.match(again.terms, /Please include the invoice number with your payment/);
      assert.equal(again.billTo.name, hourlyVendor.billingName);
    });

    await t.test('an item-based invoice: blank rows skipped, each line rounded to the cent, subtotal the sum of the lines', async () => {
      const { invoice } = await createInvoice(db, admin, parseInvoice(itemBody()), null);
      assert.deepEqual(invoice.lines.map((l) => [l.date, l.item, l.rate, l.quantity, l.total]), [
        ['2026-06-01', 'Box truck', '200.00', '4', '800.00'],
        ['2026-06-03', 'Box truck', '199.99', '3.33', '665.97'], // 665.9667 rounds to 665.97
      ]);
      assert.equal(invoice.total, '1465.97');
      const sum = (await one('SELECT sum(line_total)::text AS s FROM invoice_lines WHERE invoice_id = $1', [invoice.id])).s;
      assert.equal(sum, invoice.total, 'the saved lines add up to the saved total');
    });

    await t.test('an invoice number is used once (ignoring case), a retried create returns the same invoice, and the vendor must bill that way', async () => {
      await rejects(() => createInvoice(db, admin, parseInvoice(hourlyBody({ invoiceNumber: `h${tag}`.toLowerCase() })), null), 409, /already used/);
      const key = randomUUID();
      const first = await createInvoice(db, admin, parseInvoice(hourlyBody({ invoiceNumber: `R${tag}` })), key);
      const retry = await createInvoice(db, admin, parseInvoice(hourlyBody({ invoiceNumber: `R${tag}` })), key);
      assert.deepEqual([retry.replay, retry.invoice.id], [true, first.invoice.id]);
      assert.equal(Number((await one('SELECT count(*) AS n FROM invoices WHERE invoice_number = $1', [`R${tag}`])).n), 1);
      await rejects(() => createInvoice(db, admin, parseInvoice(hourlyBody({ invoiceNumber: `X${tag}`, vendorId: itemVendor.id })), null), 400, /billed by item/);
    });

    await t.test('a pending invoice is edited and regenerated under its own number and invoice date; a stale edit is refused', async () => {
      const { invoice } = await createInvoice(db, admin, parseInvoice(hourlyBody({ invoiceNumber: `E${tag}` })), null);
      const edited = await updateInvoice(db, admin, invoice.id, parseInvoice(hourlyBody({ invoiceNumber: `E${tag}`, lines: [{ job: 'General worker', reHours: '10', overtime: '', totalHours: '10', totalCost: '250' }] })), 1);
      assert.deepEqual([edited.id, edited.invoiceNumber, edited.invoiceDate, edited.version, edited.total], [invoice.id, `E${tag}`, invoice.invoiceDate, 2, '250.00']);
      assert.equal(Number((await one('SELECT count(*) AS n FROM invoices WHERE upper(invoice_number) = $1', [`E${tag}`])).n), 1, 'regenerating never makes a second invoice');
      await rejects(() => updateInvoice(db, admin, invoice.id, parseInvoice(hourlyBody({ invoiceNumber: `E${tag}` })), 1), 409, /changed after you opened it/);
      await rejects(() => updateInvoice(db, admin, invoice.id, parseInvoice(itemBody({ invoiceNumber: `E${tag}` })), 2), 400, /cannot change/);
      await db.query('SAVEPOINT d');
      await assert.rejects(db.query("UPDATE invoices SET invoice_date = '2020-01-01' WHERE id = $1", [invoice.id]), /invoice date and who created it never change/);
      await db.query('ROLLBACK TO SAVEPOINT d');
    });

    await t.test('editing a vendor leaves invoices already saved for it unchanged', async () => {
      const { invoice } = await createInvoice(db, admin, parseInvoice(hourlyBody({ invoiceNumber: `V${tag}` })), null);
      await updateVendor(db, admin, hourlyVendor.id, parseVendor({ billingName: `Hourly Co ${tag} Renamed`, addressLine1: '2 New Rd', billingType: 'hourly' }));
      const later = await getInvoice(db, invoice.id);
      assert.deepEqual(later.billTo, invoice.billTo);
      assert.equal(later.billTo.line1, '1 Main St');
      await updateVendor(db, admin, hourlyVendor.id, parseVendor({ billingName: `Hourly Co ${tag}`, addressLine1: '1 Main St', addressLine2: 'Dallas, TX', billingType: 'hourly' }));
    });

    await t.test('payment received: recorded once, a retry changes nothing, and a paid invoice and its lines are locked', async () => {
      const { invoice } = await createInvoice(db, admin, parseInvoice(hourlyBody({ invoiceNumber: `P${tag}` })), null);
      await rejects(() => markPaymentReceived(db, admin, invoice.id, { receivedOn: '2026-11-05', reference: null, version: 9 }), 409, /changed after you opened it/);
      const paid = await markPaymentReceived(db, admin, invoice.id, { receivedOn: '2026-11-05', reference: 'CHK 1001', version: 1 });
      assert.deepEqual([paid.replay, paid.invoice.status, paid.invoice.paymentReceivedOn, paid.invoice.paymentReference, paid.invoice.paymentRecordedBy], [false, 'paid', '2026-11-05', 'CHK 1001', admin.id]);
      assert.ok(paid.invoice.paymentRecordedAt);
      const retry = await markPaymentReceived(db, admin, invoice.id, { receivedOn: '2026-11-05', reference: 'CHK 1001', version: 1 });
      assert.equal(retry.replay, true);
      assert.equal(retry.invoice.paymentRecordedAt.toISOString(), paid.invoice.paymentRecordedAt.toISOString(), 'nothing changed');
      await rejects(() => markPaymentReceived(db, admin, invoice.id, { receivedOn: '2026-11-06', reference: null, version: null }), 409, /already recorded as received on 2026-11-05/);
      await rejects(() => updateInvoice(db, admin, invoice.id, parseInvoice(hourlyBody({ invoiceNumber: `P${tag}` })), 1), 409, /paid and can no longer be changed/);
      // the database itself refuses, whatever code tries
      for (const sql of ["UPDATE invoices SET total = 1 WHERE id = $1", "UPDATE invoices SET status = 'pending', payment_received_on = NULL WHERE id = $1", 'DELETE FROM invoices WHERE id = $1',
        "UPDATE invoice_lines SET job = 'x' WHERE invoice_id = $1", 'DELETE FROM invoice_lines WHERE invoice_id = $1']) {
        const name = `t${sp++}`;
        await db.query(`SAVEPOINT ${name}`);
        await assert.rejects(db.query(sql, [invoice.id]), /paid invoice/, sql);
        await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
      }
      assert.equal((await getInvoice(db, invoice.id)).total, '7543.37', 'still readable and downloadable');
    });

    await t.test('the next number follows the highest all-digit number, keeping its width', async () => {
      await savepoint(async () => {
        await createInvoice(db, admin, parseInvoice(hourlyBody({ invoiceNumber: '990028' })), null);
        assert.equal(await nextInvoiceNumber(db), '990029');
      });
    });

    await t.test('history: newest first by default, search, vendor, type, status and date filters, three sorts and pages', async () => {
      const mine = (f) => listInvoices(db, parseHistoryQuery({ search: tag, ...f }));
      const all = await mine({});
      assert.ok(all.total >= 6);
      const ids = all.invoices.map((i) => i.id);
      assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'same invoice date: newest saved first, a stable order');
      assert.ok((await mine({ type: 'item' })).invoices.every((i) => i.type === 'item'));
      assert.deepEqual((await mine({ status: 'paid' })).invoices.map((i) => i.invoiceNumber), [`P${tag}`]);
      assert.ok((await mine({ vendorId: String(itemVendor.id) })).invoices.every((i) => i.vendorId === itemVendor.id));
      assert.equal((await listInvoices(db, parseHistoryQuery({ search: `i${tag}`.toLowerCase() }))).total, 1, 'by invoice number, any case');
      assert.equal((await listInvoices(db, parseHistoryQuery({ search: `Item Co ${tag}` }))).total >= 1, true, 'by vendor');
      assert.equal((await mine({ from: '2090-01-01' })).total, 0);
      assert.equal((await mine({ to: chicagoToday() })).total, all.total);
      const byAmount = (await mine({ sort: 'amount', dir: 'asc' })).invoices.map((i) => Number(i.total));
      assert.deepEqual(byAmount, [...byAmount].sort((a, b) => a - b));
      assert.equal((await mine({ sort: 'payment_date', dir: 'desc' })).invoices[0].invoiceNumber, `P${tag}`, 'paid first, pending (no date) last');
      assert.equal((await mine({ sort: 'payment_date', dir: 'asc' })).invoices[0].invoiceNumber, `P${tag}`, 'unpaid last both ways');
      assert.equal((await mine({ page: '99' })).invoices.length, 0);
      assert.equal(all.pageSize, 20);
    });

    await t.test('Insights: invoice payments received count once per invoice, by receipt date, apart from delivery revenue', async () => {
      const summary = async (start, end, extra = {}) => (await businessSummary(db, { period: parseRange({ start_date: start, end_date: end }), cityIds: null, ...extra })).data;
      const before = await summary('2026-11-01', '2026-11-30');
      const inPeriod = Number(before.invoicePaymentsReceived.amount);
      const { invoice } = await createInvoice(db, admin, parseInvoice(itemBody({ invoiceNumber: `Q${tag}` })), null);
      const pending = await summary('2026-11-01', '2026-11-30');
      assert.equal(Number(pending.invoicePaymentsReceived.amount), inPeriod, 'a pending invoice adds nothing');
      await markPaymentReceived(db, admin, invoice.id, { receivedOn: '2026-11-07', reference: null, version: null });
      await markPaymentReceived(db, admin, invoice.id, { receivedOn: '2026-11-07', reference: null, version: null }); // a retry
      const after = await summary('2026-11-01', '2026-11-30');
      assert.equal(Number(after.invoicePaymentsReceived.amount).toFixed(2), (inPeriod + 1465.97).toFixed(2), 'counted once');
      assert.equal(after.invoicePaymentsReceived.invoices, before.invoicePaymentsReceived.invoices + 1);
      assert.equal(after.earnedDeliveryRevenue, before.earnedDeliveryRevenue, 'delivery revenue is unchanged');
      assert.equal(after.grossMarginBeforeOverheads, before.grossMarginBeforeOverheads, 'and so is the margin');
      assert.equal(after.driverEarnings, before.driverEarnings, 'and driver earnings');
      const october = await summary('2026-10-01', '2026-10-31');
      assert.ok(!october.invoicePaymentsReceived.invoices || Number(october.invoicePaymentsReceived.amount) >= 0);
      const octoberAfter = await summary('2026-10-01', '2026-10-31');
      assert.equal(octoberAfter.invoicePaymentsReceived.amount, october.invoicePaymentsReceived.amount, 'not in a period outside the receipt date');
      assert.equal((await summary('2026-11-07', '2026-11-07')).invoicePaymentsReceived.invoices >= 1, true, 'the receipt day itself');
      assert.equal(after.invoicePaymentsReceived.scope, 'company-wide');
      assert.equal(after.invoicePaymentsReceived.filtersApply, true);
      const filtered = await summary('2026-11-01', '2026-11-30', { source: 'daily' });
      assert.equal(filtered.invoicePaymentsReceived.filtersApply, false, 'a source filter does not apply, and the page says so');
      assert.equal(filtered.invoicePaymentsReceived.amount, after.invoicePaymentsReceived.amount);
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
  }
});

test('an edit and a payment confirmation for the same invoice cannot interleave: the second sees the first', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const tag = randomBytes(3).toString('hex').toUpperCase();
  const admin = { id: (await pool.query('SELECT id FROM admin ORDER BY id LIMIT 1')).rows[0].id, role: 'superadmin' };
  await pool.query(readFileSync(MIGRATION, 'utf8'));
  const vendor = await createVendor(pool, admin, parseVendor({ billingName: `Race Co ${tag}`, billingType: 'hourly' }));
  const body = { invoiceNumber: `C${tag}`, type: 'hourly', vendorId: vendor.id, periodStart: '2026-10-26', periodEnd: '2026-11-01', billTo: { name: vendor.billingName },
    lines: [{ job: 'General worker', reHours: '1', overtime: '', totalHours: '1', totalCost: '100' }] };
  const a = await pool.connect();
  const b = await pool.connect();
  let id;
  try {
    await a.query('BEGIN');
    ({ invoice: { id } } = await createInvoice(a, admin, parseInvoice(body), null));
    await a.query('COMMIT');
    // A marks it paid and holds the row; B tries to edit the version it opened, waits, then sees the invoice is paid.
    await a.query('BEGIN');
    await markPaymentReceived(a, admin, id, { receivedOn: '2026-11-05', reference: null, version: 1 });
    await b.query('BEGIN');
    const edit = updateInvoice(b, admin, id, parseInvoice({ ...body, lines: [{ ...body.lines[0], totalCost: '999' }] }), 1).then(() => 'saved', (e) => e.message);
    await new Promise((r) => setTimeout(r, 300));
    await a.query('COMMIT');
    assert.match(await edit, /paid and can no longer be changed/);
    await b.query('ROLLBACK');
    assert.deepEqual([(await getInvoice(pool, id)).total, (await getInvoice(pool, id)).status], ['100.00', 'paid']);
  } finally {
    await a.query('ROLLBACK').catch(() => {});
    await b.query('ROLLBACK').catch(() => {});
    a.release();
    b.release();
    // remove the rows this test committed (the guard refuses to delete a paid invoice, so it is switched off for this cleanup only)
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('ALTER TABLE invoices DISABLE TRIGGER invoices_guard');
      await c.query('ALTER TABLE invoice_lines DISABLE TRIGGER invoice_lines_guard');
      await c.query('DELETE FROM invoices WHERE vendor_id = $1', [vendor.id]);
      await c.query('DELETE FROM invoice_vendors WHERE id = $1', [vendor.id]);
      await c.query('ALTER TABLE invoice_lines ENABLE TRIGGER invoice_lines_guard');
      await c.query('ALTER TABLE invoices ENABLE TRIGGER invoices_guard');
      await c.query('COMMIT');
    } finally {
      c.release();
      await pool.end();
    }
  }
});

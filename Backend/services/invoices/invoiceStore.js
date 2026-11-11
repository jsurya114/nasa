// Saved vendors and invoices (migration 2026-11-11-invoices.sql). Every write runs in one transaction and locks the row it changes, so an edit and a
// "payment received" for the same invoice can never interleave: the second one sees what the first one did. Amounts are worked out by invoiceRules.js;
// nothing here trusts a total sent by the browser.
import { HISTORY_PAGE_SIZE, centsText, chicagoToday } from './invoiceRules.js';
import { ISSUER, TEMPLATE_VERSION, TERMS } from './invoiceTemplate.js';

export class InvoiceError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const money = (value) => (value === null || value === undefined ? null : Number(value).toFixed(2));
const day = (value) => (value === null || value === undefined ? null : (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)));
const hours = (value) => (value === null || value === undefined ? null : String(Number(Number(value).toFixed(2))));

const vendorView = (r) => ({
  id: Number(r.id), billingName: r.billing_name, addressLine1: r.address_line1, addressLine2: r.address_line2,
  contactName: r.contact_name, contactEmail: r.contact_email, billingType: r.billing_type, updatedAt: r.updated_at,
});

// ---------- vendors ----------

export const listVendors = async (db) => (await db.query('SELECT * FROM invoice_vendors ORDER BY lower(billing_name), id')).rows.map(vendorView);

const nameTaken = (error) => error?.code === '23505' && /invoice_vendors_name_once/.test(error.constraint ?? '');

export const createVendor = async (db, admin, v) => {
  try {
    const { rows } = await db.query(
      `INSERT INTO invoice_vendors (billing_name, address_line1, address_line2, contact_name, contact_email, billing_type, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
      [v.billingName, v.addressLine1, v.addressLine2, v.contactName, v.contactEmail, v.billingType, admin.id]);
    return vendorView(rows[0]);
  } catch (error) {
    if (nameTaken(error)) throw new InvoiceError(409, 'A vendor with this billing name already exists.');
    throw error;
  }
};

// Editing a vendor changes what the next invoice is filled in with. Saved invoices keep their own copy of the bill-to block and are never touched.
export const updateVendor = async (db, admin, id, v) => {
  try {
    const { rows } = await db.query(
      `UPDATE invoice_vendors SET billing_name = $2, address_line1 = $3, address_line2 = $4, contact_name = $5, contact_email = $6, billing_type = $7,
              updated_by = $8, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, v.billingName, v.addressLine1, v.addressLine2, v.contactName, v.contactEmail, v.billingType, admin.id]);
    if (!rows[0]) throw new InvoiceError(404, 'Vendor not found.');
    return vendorView(rows[0]);
  } catch (error) {
    if (nameTaken(error)) throw new InvoiceError(409, 'A vendor with this billing name already exists.');
    throw error;
  }
};

// ---------- invoices ----------

const lineView = (l) => (l.kind === 'hourly'
  ? { position: l.position, kind: 'hourly', job: l.job, reHours: hours(l.re_hours), overtime: hours(l.overtime), totalHours: hours(l.total_hours), totalCost: money(l.line_total) }
  : { position: l.position, kind: 'item', date: day(l.line_date), item: l.item, rate: money(l.rate), quantity: hours(l.quantity), total: money(l.line_total) });

const invoiceView = (r, lines) => ({
  id: Number(r.id),
  invoiceNumber: r.invoice_number,
  type: r.invoice_type,
  invoiceDate: day(r.invoice_date),
  periodStart: day(r.period_start),
  periodEnd: day(r.period_end),
  vendorId: Number(r.vendor_id),
  vendorName: r.vendor_name ?? null,
  billTo: r.bill_to,
  issuer: r.issuer,
  terms: r.terms,
  templateVersion: r.template_version,
  includeSignature: r.include_signature,
  total: money(r.total),
  status: r.status,
  paymentReceivedOn: day(r.payment_received_on),
  paymentReference: r.payment_reference,
  paymentRecordedBy: r.payment_recorded_by,
  paymentRecordedAt: r.payment_recorded_at,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(lines && { lines: lines.map(lineView) }),
});

const SELECT_INVOICE = `SELECT i.*, v.billing_name AS vendor_name FROM invoices i JOIN invoice_vendors v ON v.id = i.vendor_id`;

export const getInvoice = async (db, id) => {
  const { rows } = await db.query(`${SELECT_INVOICE} WHERE i.id = $1`, [id]);
  if (!rows[0]) throw new InvoiceError(404, 'Invoice not found.');
  const { rows: lines } = await db.query('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY position', [id]);
  return invoiceView(rows[0], lines);
};

const insertLines = async (db, invoiceId, lines) => {
  for (const l of lines) {
    if (l.kind === 'hourly') {
      await db.query(
        `INSERT INTO invoice_lines (invoice_id, position, kind, job, re_hours, overtime, total_hours, line_total)
         VALUES ($1, $2, 'hourly', $3, $4, $5, $6, $7)`,
        [invoiceId, l.position, l.job, centsText(l.reHours), centsText(l.overtime), centsText(l.totalHours), centsText(l.lineTotal)]);
    } else {
      await db.query(
        `INSERT INTO invoice_lines (invoice_id, position, kind, line_date, item, rate, quantity, line_total)
         VALUES ($1, $2, 'item', $3, $4, $5, $6, $7)`,
        [invoiceId, l.position, l.date, l.item, centsText(l.rate), centsText(l.quantity), centsText(l.lineTotal)]);
    }
  }
};

const numberTaken = (error) => error?.code === '23505' && /invoices_number_once/.test(error.constraint ?? '');

// The vendor must exist and bill the way the invoice is made (locked, so it cannot change type while the invoice is saved).
const lockVendor = async (db, vendorId) => {
  const { rows } = await db.query('SELECT * FROM invoice_vendors WHERE id = $1 FOR SHARE', [vendorId]);
  if (!rows[0]) throw new InvoiceError(400, 'Choose a vendor.', { errors: { vendorId: 'Vendor not found.' } });
  return rows[0];
};

// Creates an invoice. Its invoice date is today in America/Chicago and never changes. A retried create with the same requestId returns the invoice it
// already made, so a double click or a lost answer never makes two. Call inside a transaction.
export const createInvoice = async (db, admin, input, requestId) => {
  if (requestId) {
    const { rows } = await db.query('SELECT id FROM invoices WHERE request_id = $1', [requestId]);
    if (rows[0]) return { invoice: await getInvoice(db, rows[0].id), replay: true };
  }
  const vendor = await lockVendor(db, input.vendorId);
  if (vendor.billing_type !== input.type) throw new InvoiceError(400, `${vendor.billing_name} is billed ${vendor.billing_type === 'hourly' ? 'hourly' : 'by item'}: use that form.`);
  let row;
  try {
    ({ rows: [row] } = await db.query(
      `INSERT INTO invoices (invoice_number, invoice_type, invoice_date, period_start, period_end, vendor_id, bill_to, issuer, terms, template_version,
                             include_signature, total, request_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14) RETURNING id`,
      [input.invoiceNumber, input.type, chicagoToday(), input.period.start, input.period.end, input.vendorId, JSON.stringify(input.billTo), JSON.stringify(ISSUER),
        TERMS, TEMPLATE_VERSION, input.includeSignature, centsText(input.totalCents), requestId ?? null, admin.id]));
  } catch (error) {
    if (numberTaken(error)) throw new InvoiceError(409, `Invoice number ${input.invoiceNumber} is already used.`, { errors: { invoiceNumber: 'This invoice number is already used.' } });
    throw error;
  }
  await insertLines(db, row.id, input.lines);
  return { invoice: await getInvoice(db, row.id), replay: false };
};

// Updates a pending invoice under its own number and invoice date. `version` is the version the admin opened: an invoice changed since (or marked paid) is
// refused, so nobody overwrites a change they have not seen. The type never changes; a different vendor must bill the same way. Call inside a transaction.
export const updateInvoice = async (db, admin, id, input, version) => {
  const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
  const current = rows[0];
  if (!current) throw new InvoiceError(404, 'Invoice not found.');
  if (current.status === 'paid') throw new InvoiceError(409, 'This invoice is paid and can no longer be changed.', { code: 'invoice_paid' });
  if (version !== current.version) throw new InvoiceError(409, 'This invoice was changed after you opened it. Open it again to see the latest version.', { code: 'stale' });
  if (input.type !== current.invoice_type) throw new InvoiceError(400, 'The type of a saved invoice cannot change.');
  const vendor = await lockVendor(db, input.vendorId);
  if (Number(vendor.id) !== Number(current.vendor_id) && vendor.billing_type !== current.invoice_type) {
    throw new InvoiceError(400, `${vendor.billing_name} is billed ${vendor.billing_type === 'hourly' ? 'hourly' : 'by item'}; this invoice is ${current.invoice_type === 'hourly' ? 'hourly' : 'item-based'}.`);
  }
  try {
    await db.query(
      `UPDATE invoices SET invoice_number = $2, period_start = $3, period_end = $4, vendor_id = $5, bill_to = $6, include_signature = $7, total = $8,
              version = version + 1, updated_by = $9, updated_at = now()
        WHERE id = $1`,
      [id, input.invoiceNumber, input.period.start, input.period.end, input.vendorId, JSON.stringify(input.billTo), input.includeSignature, centsText(input.totalCents), admin.id]);
  } catch (error) {
    if (numberTaken(error)) throw new InvoiceError(409, `Invoice number ${input.invoiceNumber} is already used.`, { errors: { invoiceNumber: 'This invoice number is already used.' } });
    throw error;
  }
  await db.query('DELETE FROM invoice_lines WHERE invoice_id = $1', [id]);
  await insertLines(db, id, input.lines);
  return getInvoice(db, id);
};

// Records that the full amount was received outside NASA. Nothing is sent or transferred. The same confirmation sent again (a retry) answers with the
// invoice as it is and changes nothing, so revenue can never count it twice; a different date or reference for an invoice already paid is refused.
// With `version`, an invoice edited after the admin opened the confirmation is refused, so they always confirm the amount they saw. Call inside a transaction.
export const markPaymentReceived = async (db, admin, id, payment) => {
  const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
  const current = rows[0];
  if (!current) throw new InvoiceError(404, 'Invoice not found.');
  if (current.status === 'paid') {
    const same = day(current.payment_received_on) === payment.receivedOn && (current.payment_reference ?? null) === payment.reference;
    if (same) return { invoice: await getInvoice(db, id), replay: true };
    throw new InvoiceError(409, `Payment for this invoice was already recorded as received on ${day(current.payment_received_on)}.`, { code: 'invoice_paid' });
  }
  if (payment.version !== null && payment.version !== current.version) {
    throw new InvoiceError(409, 'This invoice was changed after you opened it. Check the amount again before recording the payment.', { code: 'stale' });
  }
  await db.query(
    `UPDATE invoices SET status = 'paid', payment_received_on = $2, payment_reference = $3, payment_recorded_by = $4, payment_recorded_at = now(),
            updated_by = $4, updated_at = now()
      WHERE id = $1`,
    [id, payment.receivedOn, payment.reference, admin.id]);
  return { invoice: await getInvoice(db, id), replay: false };
};

// A number to start from: the highest all-digit invoice number plus one, keeping its width (0028 -> 0029). The admin can type any other number.
export const nextInvoiceNumber = async (db) => {
  const { rows } = await db.query(
    `SELECT invoice_number FROM invoices WHERE invoice_number ~ '^[0-9]{1,12}$' ORDER BY invoice_number::bigint DESC, length(invoice_number) DESC LIMIT 1`);
  if (!rows[0]) return '0001';
  const last = rows[0].invoice_number;
  return String(BigInt(last) + 1n).padStart(last.length, '0');
};

// ---------- history ----------

const ORDER = {
  invoice_date: (dir) => `i.invoice_date ${dir}, i.id ${dir}`,
  payment_date: (dir) => `i.payment_received_on ${dir} NULLS LAST, i.invoice_date DESC, i.id DESC`,
  amount: (dir) => `i.total ${dir}, i.invoice_date DESC, i.id DESC`,
};

export const listInvoices = async (db, f) => {
  const params = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  const where = [];
  if (f.search) {
    const like = add(`%${f.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`(i.invoice_number ILIKE ${like} OR v.billing_name ILIKE ${like} OR i.bill_to->>'name' ILIKE ${like})`);
  }
  if (f.vendorId) where.push(`i.vendor_id = ${add(f.vendorId)}`);
  if (f.type) where.push(`i.invoice_type = ${add(f.type)}`);
  if (f.status) where.push(`i.status = ${add(f.status)}`);
  if (f.from) where.push(`i.invoice_date >= ${add(f.from)}`);
  if (f.to) where.push(`i.invoice_date <= ${add(f.to)}`);
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM invoices i JOIN invoice_vendors v ON v.id = i.vendor_id ${filter}`, params);
  const limit = add(HISTORY_PAGE_SIZE);
  const offset = add((f.page - 1) * HISTORY_PAGE_SIZE);
  const { rows } = await db.query(`${SELECT_INVOICE} ${filter} ORDER BY ${ORDER[f.sort](dir)} LIMIT ${limit} OFFSET ${offset}`, params);
  return { invoices: rows.map((r) => invoiceView(r)), total: n, page: f.page, pageSize: HISTORY_PAGE_SIZE, totalPages: Math.ceil(n / HISTORY_PAGE_SIZE) };
};

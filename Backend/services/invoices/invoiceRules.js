// Invoices: what is accepted and how the money is worked out. Pure: no database, no Express. The server is the authority for every amount: the browser's
// figures are only a preview, and what is saved (and later printed) is what these rules calculate.
//
// Money is handled in whole cents (BigInt where it multiplies), never in floating point:
//   Hourly       the invoice total is the sum of the job costs exactly as entered.
//   Item-based   each line is rate x quantity rounded to the cent (half up), and the subtotal is the sum of those rounded lines.

export class InvoiceInputError extends Error {
  constructor(message, errors) {
    super(message);
    this.status = 400;
    this.errors = errors;
  }
}

export const TYPES = Object.freeze(['hourly', 'item']);
export const LIMITS = Object.freeze({
  invoiceNumber: 20, name: 80, address: 80, contactName: 80, email: 150, job: 40, item: 80, reference: 80,
  hourlyRows: 7, periodDays: 366,
  hoursCents: 9999999, costCents: 9999999999, rateCents: 999999999, quantityHundredths: 9999999,
});

const INVOICE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9\-_/ ]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// "1,234.5" -> 123450 cents; anything else (a sign, a letter, a third decimal, a blank) -> null.
export const toCents = (value) => {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!AMOUNT.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
};
export const centsText = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

// rate (cents) x quantity (hundredths) -> cents, rounded half up. 200.00 x 4 = 800.00; 0.33 x 0.5 = 0.17 (0.165 rounds up).
export const lineTotalCents = (rateCents, quantityHundredths) => Number((BigInt(rateCents) * BigInt(quantityHundredths) + 50n) / 100n);

export const isRealDate = (iso) => {
  if (!DATE.test(iso ?? '')) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
export const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

// Every calendar date from start to end, both included (weekends too).
export const datesBetween = (start, end) => {
  const out = [];
  for (let d = dayNumber(start); d <= dayNumber(end); d += 1) out.push(new Date(d * DAY_MS).toISOString().slice(0, 10));
  return out;
};

// Today's date where NASA bills from (America/Chicago), as YYYY-MM-DD.
export const chicagoToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const positiveId = (value) => (/^\d{1,18}$/.test(String(value ?? '')) && Number(value) > 0 ? Number(value) : null);

const billingBlock = (source, errors, prefix = '') => {
  const name = clean(source?.name ?? source?.billingName);
  const line1 = clean(source?.line1 ?? source?.addressLine1);
  const line2 = clean(source?.line2 ?? source?.addressLine2);
  const contactName = clean(source?.contactName);
  const contactEmail = clean(source?.contactEmail);
  if (!name) errors[`${prefix}name`] = 'Enter the billing name.';
  else if (name.length > LIMITS.name) errors[`${prefix}name`] = `Up to ${LIMITS.name} characters.`;
  if (line1.length > LIMITS.address) errors[`${prefix}line1`] = `Up to ${LIMITS.address} characters.`;
  if (line2.length > LIMITS.address) errors[`${prefix}line2`] = `Up to ${LIMITS.address} characters.`;
  if (contactName.length > LIMITS.contactName) errors[`${prefix}contactName`] = `Up to ${LIMITS.contactName} characters.`;
  if (contactEmail && (contactEmail.length > LIMITS.email || !EMAIL.test(contactEmail))) errors[`${prefix}contactEmail`] = 'Enter a valid email address, or leave it empty.';
  return { name, line1, line2, contactName, contactEmail };
};

const refuse = (errors) => {
  if (Object.keys(errors).length > 0) throw new InvoiceInputError('Check the highlighted fields.', errors);
};

// A saved vendor: billing name and address, optional contact, and how they are billed (Hourly or Item-based).
export const parseVendor = (body = {}) => {
  const errors = {};
  const block = billingBlock(body, errors);
  const billingType = body.billingType;
  if (!TYPES.includes(billingType)) errors.billingType = 'Choose Hourly or Item-based.';
  refuse(errors);
  return { billingName: block.name, addressLine1: block.line1, addressLine2: block.line2, contactName: block.contactName, contactEmail: block.contactEmail, billingType };
};

const parseHourlyLines = (rows, errors) => {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) { errors.lines = 'Add at least one job.'; return []; }
  if (list.length > LIMITS.hourlyRows) { errors.lines = `An hourly invoice holds up to ${LIMITS.hourlyRows} jobs.`; return []; }
  const lineErrors = {};
  const lines = list.map((row, i) => {
    const own = {};
    const job = clean(row?.job);
    if (!job) own.job = 'Enter the job.';
    else if (job.length > LIMITS.job) own.job = `Up to ${LIMITS.job} characters.`;
    const re = toCents(row?.reHours);
    if (re === null || re > LIMITS.hoursCents) own.reHours = 'Enter the hours, like 360 or 71.05.';
    const ot = clean(row?.overtime) === '' ? 0 : toCents(row?.overtime);
    if (ot === null || ot > LIMITS.hoursCents) own.overtime = 'Enter the hours, like 71.05, or leave it empty.';
    const total = toCents(row?.totalHours);
    if (total === null || total > LIMITS.hoursCents) own.totalHours = 'Enter the hours, like 431.05.';
    const cost = toCents(row?.totalCost);
    if (cost === null || cost > LIMITS.costCents) own.totalCost = 'Enter the amount, like 7543.37.';
    if (Object.keys(own).length) lineErrors[i] = own;
    return { position: i + 1, kind: 'hourly', job, reHours: re, overtime: ot, totalHours: total, lineTotal: cost };
  });
  if (Object.keys(lineErrors).length) errors.lineErrors = lineErrors;
  return lines;
};

const parseItemLines = (rows, period, errors) => {
  const list = Array.isArray(rows) ? rows : [];
  const lineErrors = {};
  const seen = new Set();
  const lines = [];
  list.forEach((row, i) => {
    const item = clean(row?.item);
    const rateText = clean(row?.rate);
    const quantityText = clean(row?.quantity);
    // A row with nothing typed is not a line: it is skipped, never printed and never an error.
    if (!item && !rateText && !quantityText) return;
    const own = {};
    const date = String(row?.date ?? '');
    if (!isRealDate(date)) own.date = 'Not a real date.';
    else if (period && (date < period.start || date > period.end)) own.date = 'This date is outside the billing period.';
    else if (seen.has(date)) own.date = 'This date is listed twice.';
    if (!item || !rateText || !quantityText) own.row = 'Fill in the item, rate and quantity, or leave the whole row empty.';
    if (item.length > LIMITS.item) own.item = `Up to ${LIMITS.item} characters.`;
    const rate = rateText ? toCents(rateText) : null;
    if (rateText && (rate === null || rate > LIMITS.rateCents)) own.rate = 'Enter the rate, like 200 or 200.50.';
    const quantity = quantityText ? toCents(quantityText) : null; // hundredths
    if (quantityText && (quantity === null || quantity > LIMITS.quantityHundredths)) own.quantity = 'Enter the quantity, like 4 or 2.5.';
    const lineTotal = Object.keys(own).length ? 0 : lineTotalCents(rate, quantity);
    if (lineTotal > LIMITS.costCents) own.quantity = 'This line comes to more than 99,999,999.99. Check the rate and quantity.';
    if (Object.keys(own).length) { lineErrors[i] = own; return; }
    seen.add(date);
    lines.push({ position: lines.length + 1, kind: 'item', date, item, rate, quantity, lineTotal });
  });
  if (Object.keys(lineErrors).length) errors.lineErrors = lineErrors;
  else if (lines.length === 0) errors.lines = 'Enter at least one line: an item, its rate and quantity.';
  else if (lines.every((l) => l.lineTotal === 0)) errors.lines = 'At least one line must have an amount.';
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((l, i) => { l.position = i + 1; });
  return lines;
};

// An invoice as submitted for create or update. `type` is the invoice's type (on create it must match the vendor's billing type; the caller checks).
// Returns { invoiceNumber, type, vendorId, period, billTo, includeSignature, lines, totalCents }.
export const parseInvoice = (body = {}) => {
  const errors = {};
  const invoiceNumber = clean(body.invoiceNumber);
  if (!invoiceNumber) errors.invoiceNumber = 'Enter the invoice number.';
  else if (invoiceNumber.length > LIMITS.invoiceNumber || !INVOICE_NUMBER.test(invoiceNumber)) errors.invoiceNumber = `Use letters, numbers and dashes, up to ${LIMITS.invoiceNumber} characters.`;
  const type = body.type;
  if (!TYPES.includes(type)) errors.type = 'Choose Hourly or Item-based.';
  const vendorId = positiveId(body.vendorId);
  if (!vendorId) errors.vendorId = 'Choose a vendor.';

  const start = String(body.periodStart ?? '');
  const end = String(body.periodEnd ?? '');
  if (!isRealDate(start)) errors.periodStart = 'Choose the first day of the billing period.';
  if (!isRealDate(end)) errors.periodEnd = 'Choose the last day of the billing period.';
  let period = null;
  if (!errors.periodStart && !errors.periodEnd) {
    if (start > end) errors.periodEnd = 'The last day cannot be before the first day.';
    else if (dayNumber(end) - dayNumber(start) + 1 > LIMITS.periodDays) errors.periodEnd = `A billing period can be at most ${LIMITS.periodDays} days.`;
    else period = { start, end };
  }

  const billTo = billingBlock(body.billTo, errors, 'billTo.');
  let lines = [];
  if (type === 'hourly') lines = parseHourlyLines(body.lines, errors);
  else if (type === 'item') lines = period ? parseItemLines(body.lines, period, errors) : [];
  const totalCents = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  if (totalCents > LIMITS.costCents && !errors.lines && !errors.lineErrors) errors.lines = 'The invoice total is more than 99,999,999.99.';
  refuse(errors);
  return { invoiceNumber, type, vendorId, period, billTo, includeSignature: body.includeSignature !== false, lines, totalCents };
};

// Recording a payment that was already received outside NASA: the receipt date (not in the future in Chicago) and an optional reference.
export const parsePayment = (body = {}, today = chicagoToday()) => {
  const errors = {};
  const receivedOn = String(body.receivedOn ?? '');
  if (!isRealDate(receivedOn)) errors.receivedOn = 'Enter the date the payment was received.';
  else if (receivedOn > today) errors.receivedOn = 'The payment received date cannot be in the future.';
  const reference = clean(body.reference);
  if (reference.length > LIMITS.reference) errors.reference = `Up to ${LIMITS.reference} characters.`;
  const version = body.version === undefined ? null : positiveId(body.version);
  if (body.version !== undefined && !version) errors.version = 'Unknown version.';
  refuse(errors);
  return { receivedOn, reference: reference || null, version };
};

// The history's filters, sort and page. Only these words reach the query.
export const HISTORY_SORTS = Object.freeze(['invoice_date', 'payment_date', 'amount']);
export const HISTORY_PAGE_SIZE = 20;
export const parseHistoryQuery = (q = {}) => {
  const pick = (value, allowed, label) => {
    if (value === undefined || value === '') return '';
    if (!allowed.includes(value)) throw new InvoiceInputError(`Unknown ${label}`, { [label]: 'Unknown value.' });
    return value;
  };
  const date = (value, label) => {
    if (value === undefined || value === '') return '';
    if (!isRealDate(String(value))) throw new InvoiceInputError(`Unknown ${label}`, { [label]: 'Not a real date.' });
    return String(value);
  };
  const page = q.page === undefined ? 1 : Number(q.page);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new InvoiceInputError('Unknown page', { page: 'Unknown page.' });
  const vendorId = q.vendorId === undefined || q.vendorId === '' ? null : positiveId(q.vendorId);
  if (q.vendorId !== undefined && q.vendorId !== '' && !vendorId) throw new InvoiceInputError('Unknown vendor', { vendorId: 'Unknown vendor.' });
  const from = date(q.from, 'from');
  const to = date(q.to, 'to');
  if (from && to && from > to) throw new InvoiceInputError('The date range is reversed', { to: 'The last day cannot be before the first day.' });
  return {
    page,
    search: clean(q.search).slice(0, 80),
    vendorId,
    type: pick(q.type, TYPES, 'type'),
    status: pick(q.status, ['pending', 'paid'], 'status'),
    from,
    to,
    sort: pick(q.sort, HISTORY_SORTS, 'sort') || 'invoice_date',
    dir: pick(String(q.dir ?? '').toLowerCase() || undefined, ['asc', 'desc'], 'dir') || 'desc',
  };
};

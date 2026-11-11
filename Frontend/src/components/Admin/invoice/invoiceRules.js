import { MAX_ROWS } from "./invoiceTemplate.js";

// Pure rules for the invoice forms: what is allowed, how a number is read and printed, and how the item-based dates are laid out. No React, no PDF,
// no network. The server checks everything again and is the authority for every amount: the figures here are a preview of what it will save, worked
// out the same way (whole cents, rate x quantity rounded half up, subtotal = the sum of the rounded lines).

export const LIMITS = Object.freeze({
  invoiceNumber: 20, name: 80, address: 80, contactName: 80, email: 150, job: 40, item: 80, reference: 80, periodDays: 366,
  hours: 99999.99, cost: 99999999.99, costCents: 9999999999, rateCents: 999999999, quantityHundredths: 9999999,
});

const INVOICE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9\-_/ ]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86400000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
export const hasErrors = (errors) => Object.keys(errors).length > 0;

// "1,234.5" and " 12 " are read as numbers; anything else (a sign, a letter, a third decimal) is not. Returns a number or null.
export const readAmount = (value) => {
  const text = String(value ?? "").trim().replace(/,/g, "");
  return AMOUNT.test(text) ? Number(text) : null;
};

// "1,234.5" -> 123450 (cents, or hundredths of a quantity); anything else -> null. Never floating point.
export const toCents = (value) => {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!AMOUNT.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
};

// rate (cents) x quantity (hundredths) -> cents, rounded half up: $200.00 x 4 = $800.00, $0.33 x 0.5 = $0.17.
export const lineTotalCents = (rateCents, quantityHundredths) => Number((BigInt(rateCents) * BigInt(quantityHundredths) + 50n) / 100n);

// 146597 -> "$1,465.97"
export const moneyText = (cents) => `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
// "1465.97" (as the server sends money) -> "$1,465.97"
export const amountText = (value) => {
  const cents = toCents(value);
  return cents === null ? "" : moneyText(cents);
};

export const isRealDate = (iso) => {
  if (!DATE.test(iso ?? "")) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
export const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

// Every calendar date from start to end, both included, weekends too. Empty when the range is not a real, forward range of at most a year.
export const datesBetween = (start, end) => {
  if (!isRealDate(start) || !isRealDate(end) || start > end || dayNumber(end) - dayNumber(start) + 1 > LIMITS.periodDays) return [];
  const out = [];
  for (let d = dayNumber(start); d <= dayNumber(end); d += 1) out.push(new Date(d * DAY_MS).toISOString().slice(0, 10));
  return out;
};

// Today where NASA bills from (America/Chicago), as YYYY-MM-DD.
export const chicagoToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

// 2026-10-26 -> 10/26/2026, the way the invoice writes dates.
export const usDate = (iso) => (isRealDate(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
export const periodText = (start, end) => `${usDate(start)} - ${usDate(end)}`;

// 71.050 -> "71.05", 360 -> "360": no trailing zeros, as the template prints its hours.
export const hoursText = (n) => String(Number(n.toFixed(2)));
// 7543.37 -> "$7543.37": a dollar sign and two decimals, no thousands separator, as the hourly template prints its cost.
export const costText = (n) => `$${n.toFixed(2)}`;

// ---------- hourly ----------

export const blankRow = () => ({ job: "", reHours: "", overtime: "", totalHours: "", totalCost: "", totalTouched: false });

// Total hours follows RE hours + overtime until the person types a total of their own.
export const withDerivedTotal = (row) => {
  if (row.totalTouched) return row;
  const re = readAmount(row.reHours);
  const ot = row.overtime.trim() === "" ? 0 : readAmount(row.overtime);
  return { ...row, totalHours: re === null || ot === null ? "" : hoursText(re + ot) };
};

// A soft hint, never a block: the total is allowed to differ (a rounded or agreed figure), but it is usually RE hours plus overtime.
export const totalDiffers = (row) => {
  const re = readAmount(row.reHours);
  const ot = String(row.overtime ?? "").trim() === "" ? 0 : readAmount(row.overtime);
  const total = readAmount(row.totalHours);
  return re !== null && ot !== null && total !== null && Math.abs(re + ot - total) > 0.005;
};

export const isBlankHourly = (row) => !clean(row.job) && !clean(row.reHours) && !clean(row.overtime) && !clean(row.totalHours) && !clean(row.totalCost);

const checkHourly = (rows, errors) => {
  if (rows.length === 0) { errors.lines = "Add at least one job."; return; }
  if (rows.length > MAX_ROWS) { errors.lines = `An hourly invoice holds up to ${MAX_ROWS} jobs.`; return; }
  const lineErrors = {};
  rows.forEach((row, i) => {
    const own = {};
    const job = clean(row.job);
    if (!job) own.job = "Enter the job.";
    else if (job.length > LIMITS.job) own.job = `Up to ${LIMITS.job} characters.`;
    const re = readAmount(row.reHours);
    if (re === null || re > LIMITS.hours) own.reHours = "Enter the hours, like 360 or 71.05.";
    const overtime = String(row.overtime ?? "").trim() === "" ? 0 : readAmount(row.overtime);
    if (overtime === null || overtime > LIMITS.hours) own.overtime = "Enter the hours, like 71.05, or leave it empty.";
    const total = readAmount(row.totalHours);
    if (total === null || total > LIMITS.hours) own.totalHours = "Enter the hours, like 431.05.";
    const cost = readAmount(row.totalCost);
    if (cost === null || cost > LIMITS.cost) own.totalCost = "Enter the amount, like 7543.37.";
    if (hasErrors(own)) lineErrors[i] = own;
  });
  if (hasErrors(lineErrors)) errors.lineErrors = lineErrors;
};

export const hourlyTotalCents = (rows) => rows.reduce((sum, r) => sum + (toCents(r.totalCost) ?? 0), 0);

// ---------- item-based ----------

export const blankItem = (date) => ({ date, item: "", rate: "", quantity: "" });
export const isBlankItem = (row) => !clean(row.item) && !clean(row.rate) && !clean(row.quantity);
export const isPartialItem = (row) => !isBlankItem(row) && (!clean(row.item) || !clean(row.rate) || !clean(row.quantity));

// The line's money in cents, or null while the rate or quantity is missing or not a number.
export const itemLineCents = (row) => {
  const rate = toCents(row.rate);
  const quantity = toCents(row.quantity);
  return rate === null || quantity === null ? null : lineTotalCents(rate, quantity);
};
// The subtotal: the sum of the complete lines, each already rounded to the cent.
export const itemSubtotalCents = (rows) => rows.reduce((sum, r) => sum + (isPartialItem(r) || isBlankItem(r) ? 0 : itemLineCents(r) ?? 0), 0);

// The rows the item form shows: one per date from start to end, each with whatever was typed for that date (kept in `entries`, keyed by date, so
// moving the dates never loses what was typed for a date that is still, or again, in range).
export const itemRowsFor = (start, end, entries) => datesBetween(start, end).map((date) => ({ ...blankItem(date), ...(entries[date] ?? {}), date }));

// Dates that have something typed but fall outside start..end: they are not on the invoice, and saving drops them.
export const entriesOutside = (start, end, entries) => {
  const inRange = new Set(datesBetween(start, end));
  return Object.keys(entries).filter((date) => !inRange.has(date) && !isBlankItem(entries[date])).sort();
};

const checkItems = (rows, errors) => {
  const lineErrors = {};
  let valid = 0;
  let money = 0;
  rows.forEach((row, i) => {
    if (isBlankItem(row)) return;
    const own = {};
    if (isPartialItem(row)) own.row = "Fill in the item, rate and quantity, or leave the whole row empty.";
    const item = clean(row.item);
    if (item.length > LIMITS.item) own.item = `Up to ${LIMITS.item} characters.`;
    const rate = clean(row.rate) ? toCents(row.rate) : null;
    if (clean(row.rate) && (rate === null || rate > LIMITS.rateCents)) own.rate = "Enter the rate, like 200 or 200.50.";
    const quantity = clean(row.quantity) ? toCents(row.quantity) : null;
    if (clean(row.quantity) && (quantity === null || quantity > LIMITS.quantityHundredths)) own.quantity = "Enter the quantity, like 4 or 2.5.";
    if (!hasErrors(own) && lineTotalCents(rate, quantity) > LIMITS.costCents) own.quantity = "This line comes to more than 99,999,999.99. Check the rate and quantity.";
    if (hasErrors(own)) { lineErrors[i] = own; return; }
    valid += 1;
    money += lineTotalCents(rate, quantity);
  });
  if (hasErrors(lineErrors)) errors.lineErrors = lineErrors;
  else if (valid === 0) errors.lines = "Enter at least one line: an item, its rate and quantity.";
  else if (money === 0) errors.lines = "At least one line must have an amount.";
  else if (money > LIMITS.costCents) errors.lines = "The invoice total is more than 99,999,999.99.";
};

// ---------- the whole form ----------

// form: { invoiceNumber, vendorId, type, periodStart, periodEnd, billTo: { name, line1, line2, contactName, contactEmail }, includeSignature,
//         rows (hourly), entries (item, by date) }.
// Returns { errors, body }. `errors` uses the server's field names ("billTo.name", lineErrors by row index), so its answers are shown the same
// way; `body` is what is sent to save it (item rows: every date in the period, blank ones included, in date order, so row indexes match).
export const checkInvoice = (form) => {
  const errors = {};
  const invoiceNumber = clean(form.invoiceNumber);
  if (!invoiceNumber) errors.invoiceNumber = "Enter the invoice number.";
  else if (invoiceNumber.length > LIMITS.invoiceNumber || !INVOICE_NUMBER.test(invoiceNumber)) errors.invoiceNumber = `Use letters, numbers and dashes, up to ${LIMITS.invoiceNumber} characters.`;
  if (!form.vendorId) errors.vendorId = "Choose a vendor.";

  const { periodStart: start, periodEnd: end } = form;
  if (!isRealDate(start)) errors.periodStart = "Choose the first day of the billing period.";
  if (!isRealDate(end)) errors.periodEnd = "Choose the last day of the billing period.";
  if (!errors.periodStart && !errors.periodEnd) {
    if (start > end) errors.periodEnd = "The last day cannot be before the first day.";
    else if (dayNumber(end) - dayNumber(start) + 1 > LIMITS.periodDays) errors.periodEnd = `A billing period can be at most ${LIMITS.periodDays} days.`;
  }

  const b = form.billTo ?? {};
  const billTo = { name: clean(b.name), line1: clean(b.line1), line2: clean(b.line2), contactName: clean(b.contactName), contactEmail: clean(b.contactEmail) };
  if (!billTo.name) errors["billTo.name"] = "Enter the billing name.";
  else if (billTo.name.length > LIMITS.name) errors["billTo.name"] = `Up to ${LIMITS.name} characters.`;
  if (billTo.line1.length > LIMITS.address) errors["billTo.line1"] = `Up to ${LIMITS.address} characters.`;
  if (billTo.line2.length > LIMITS.address) errors["billTo.line2"] = `Up to ${LIMITS.address} characters.`;
  if (billTo.contactName.length > LIMITS.contactName) errors["billTo.contactName"] = `Up to ${LIMITS.contactName} characters.`;
  if (billTo.contactEmail && (billTo.contactEmail.length > LIMITS.email || !EMAIL.test(billTo.contactEmail))) errors["billTo.contactEmail"] = "Enter a valid email address, or leave it empty.";

  let lines = [];
  if (form.type === "hourly") {
    lines = (form.rows ?? []).map((r) => ({ job: r.job, reHours: r.reHours, overtime: r.overtime, totalHours: r.totalHours, totalCost: r.totalCost }));
    checkHourly(form.rows ?? [], errors);
  } else if (form.type === "item") {
    lines = itemRowsFor(start, end, form.entries ?? {}).map((r) => ({ date: r.date, item: r.item, rate: r.rate, quantity: r.quantity }));
    if (!errors.periodStart && !errors.periodEnd) checkItems(lines, errors);
  } else errors.type = "Choose a vendor to pick the invoice format.";

  return {
    errors,
    body: { invoiceNumber, vendorId: form.vendorId, type: form.type, periodStart: start, periodEnd: end, billTo, includeSignature: form.includeSignature !== false, lines },
  };
};

// A saved invoice, as the form holds it (to edit it, or to show it when it is paid).
export const formFromInvoice = (invoice) => {
  const base = {
    invoiceNumber: invoice.invoiceNumber, vendorId: invoice.vendorId, type: invoice.type, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd,
    billTo: { name: "", line1: "", line2: "", contactName: "", contactEmail: "", ...invoice.billTo }, includeSignature: invoice.includeSignature !== false,
    rows: [blankRow()], entries: {},
  };
  if (invoice.type === "hourly") {
    base.rows = invoice.lines.map((l) => {
      const row = { job: l.job, reHours: l.reHours, overtime: l.overtime === "0" ? "" : l.overtime, totalHours: l.totalHours, totalCost: l.totalCost };
      return { ...row, totalTouched: totalDiffers(row) };
    });
    if (base.rows.length === 0) base.rows = [blankRow()];
  } else {
    base.entries = Object.fromEntries(invoice.lines.map((l) => [l.date, { date: l.date, item: l.item, rate: l.rate, quantity: l.quantity }]));
  }
  return base;
};

export const fileNameFor = (invoiceNumber) => `NASA FD INVOICE ${clean(invoiceNumber).replace(/[^A-Za-z0-9\-_ ]/g, "")}.pdf`;

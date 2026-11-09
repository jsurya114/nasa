import { MAX_ROWS } from "./invoiceTemplate.js";

// Pure rules for the invoice form: what is allowed, how a number is read and how it is printed. No React, no PDF, no network.

export const LIMITS = Object.freeze({ invoiceNo: 20, name: 60, address: 60, job: 40, hours: 99999.99, cost: 99999999.99 });

const INVOICE_NO = /^[A-Za-z0-9][A-Za-z0-9\-_/ ]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

export const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

// "1,234.5" and " 12 " are read as numbers; anything else (a sign, a letter, a third decimal) is not. Returns a number or null.
export const readAmount = (value) => {
  const text = String(value ?? "").trim().replace(/,/g, "");
  return AMOUNT.test(text) ? Number(text) : null;
};

const realDate = (iso) => {
  if (!DATE.test(iso ?? "")) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

// 2026-10-26 -> 10/26/2026, the way the template writes its schedule.
export const usDate = (iso) => (realDate(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");

// 71.050 -> "71.05", 360 -> "360": no trailing zeros, as the template prints its hours.
export const hoursText = (n) => String(Number(n.toFixed(2)));
// 7543.37 -> "$7543.37": a dollar sign and two decimals, no thousands separator, as the template prints its cost.
export const costText = (n) => `$${n.toFixed(2)}`;

export const blankRow = () => ({ job: "", reHours: "", overtime: "", totalHours: "", totalCost: "", totalTouched: false });

// Total hours follows RE hours + overtime until the person types a total of their own.
export const withDerivedTotal = (row) => {
  if (row.totalTouched) return row;
  const re = readAmount(row.reHours);
  const ot = row.overtime.trim() === "" ? 0 : readAmount(row.overtime);
  return { ...row, totalHours: re === null || ot === null ? "" : hoursText(re + ot) };
};

// Checks the whole form. Returns { errors, invoice }: `errors` maps a field to a message (empty when the form is good) and `invoice` is the
// cleaned, ready-to-print version of it (only meaningful when there are no errors). Fields: invoiceNo, start, end, billName, billLine1,
// billLine2, rows[i].job / reHours / overtime / totalHours / totalCost.
export const checkInvoice = (form) => {
  const errors = {};
  const invoiceNo = clean(form.invoiceNo);
  if (!invoiceNo) errors.invoiceNo = "Enter the invoice number.";
  else if (invoiceNo.length > LIMITS.invoiceNo || !INVOICE_NO.test(invoiceNo)) errors.invoiceNo = `Use letters, numbers and dashes, up to ${LIMITS.invoiceNo} characters.`;

  if (!realDate(form.start)) errors.start = "Choose the first day of the schedule.";
  if (!realDate(form.end)) errors.end = "Choose the last day of the schedule.";
  if (!errors.start && !errors.end && form.start > form.end) errors.end = "The last day cannot be before the first day.";

  const billName = clean(form.billName);
  const billLine1 = clean(form.billLine1);
  const billLine2 = clean(form.billLine2);
  if (!billName) errors.billName = "Enter who the invoice is for.";
  else if (billName.length > LIMITS.name) errors.billName = `Up to ${LIMITS.name} characters.`;
  if (billLine1.length > LIMITS.address) errors.billLine1 = `Up to ${LIMITS.address} characters.`;
  if (billLine2.length > LIMITS.address) errors.billLine2 = `Up to ${LIMITS.address} characters.`;

  const sourceRows = Array.isArray(form.rows) ? form.rows : [];
  if (sourceRows.length === 0) errors.rows = "Add at least one job.";
  if (sourceRows.length > MAX_ROWS) errors.rows = `An invoice holds up to ${MAX_ROWS} jobs.`;
  const rowErrors = [];
  const rows = sourceRows.slice(0, MAX_ROWS).map((row) => {
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
    rowErrors.push(own);
    return { job, reHours: re, overtime, totalHours: total, totalCost: cost };
  });
  if (rowErrors.some((r) => Object.keys(r).length > 0)) errors.rowErrors = rowErrors;

  const invoice = {
    invoiceNo,
    schedule: `${usDate(form.start)} - ${usDate(form.end)}`,
    billTo: { name: billName, line1: billLine1, line2: billLine2 },
    rows: rows.map((r) => ({ job: r.job, reHours: hoursText(r.reHours ?? 0), overtime: hoursText(r.overtime ?? 0), totalHours: hoursText(r.totalHours ?? 0), totalCost: costText(r.totalCost ?? 0) })),
    includeSignature: form.includeSignature !== false,
  };
  return { errors, invoice };
};

export const hasErrors = (errors) => Object.keys(errors).length > 0;

// A soft hint, never a block: the total is allowed to differ (a rounded or agreed figure), but it is usually RE hours plus overtime.
export const totalDiffers = (row) => {
  const re = readAmount(row.reHours);
  const ot = String(row.overtime ?? "").trim() === "" ? 0 : readAmount(row.overtime);
  const total = readAmount(row.totalHours);
  return re !== null && ot !== null && total !== null && Math.abs(re + ot - total) > 0.005;
};

export const fileNameFor = (invoiceNo) => `NASA FD INVOICE ${clean(invoiceNo).replace(/[^A-Za-z0-9\-_ ]/g, "")}.pdf`;

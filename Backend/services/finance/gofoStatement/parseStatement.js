import { createHash } from 'node:crypto';
import { StatementError, centsOf, countOf, dayOf } from './statementMoney.js';

// Reads the carrier's (GOFO) weekly statement workbook into plain records (issue: GOFO revenue and margin, part 1). It is pure: the workbook has already been
// turned into rows of cells (readStatementWorkbook.js). Nothing is guessed. A cell that is not what it should be is recorded in `issues` with its sheet and row,
// the line is left out, and the statement is then refused by the reconciliation. Money is whole cents; a blank is missing (null), a 0 is a real zero.

const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const isBlankRow = (row) => !Array.isArray(row) || row.every((cell) => cell === null || cell === undefined || String(cell).trim() === '');

const SHEETS = Object.freeze({
  dsp: 'dsp summary', driver: 'driver summary', daily: 'driver daily summary', details: 'details of delivery fees', offsets: 'offset details',
  claims: 'claims detail', ledger: 'general ledger adjustment', prepaid: 'total prepaid to driver account', withdrawal: 'total withdrawal fees for drive',
});

// sheets: { [sheet name]: rows[][] } (row 1 is index 0). Finds a sheet by its normalised name or the start of it (Excel cuts long names).
const findSheet = (sheets, wanted) => {
  const key = Object.keys(sheets).find((name) => norm(name) === wanted) ?? Object.keys(sheets).find((name) => norm(name).startsWith(wanted));
  return key === undefined ? null : { name: key, rows: sheets[key] };
};

const headerMap = (row) => {
  const map = new Map();
  (row ?? []).forEach((cell, index) => { const name = norm(cell); if (name && !map.has(name)) map.set(name, index); });
  return map;
};

// Walks the data rows of a sheet. `firstRow` is the 0-based index of the first data row (2 for the three summaries, which have two header rows).
const eachRow = (sheet, firstRow, visit) => {
  const header = headerMap(sheet.rows[0]);
  for (let i = firstRow; i < sheet.rows.length; i += 1) {
    if (isBlankRow(sheet.rows[i])) continue;
    visit(sheet.rows[i], { header, ref: { sheet: sheet.name, row: i + 1 } });
  }
  return header;
};

export const parseStatement = (sheets) => {
  const issues = [];
  const flag = (ref, field, problem) => issues.push({ sheet: ref.sheet, row: ref.row, field, problem });
  const need = (name, label) => issues.push({ sheet: name, row: 1, field: label, problem: 'sheet is missing' });
  const cell = (row, header, column) => { const index = header.get(column); return index === undefined ? undefined : row[index]; };
  // Reads one field, turning any bad cell into an issue (and undefined) instead of an exception.
  const read = (ref, field, convert, row, header, column, { required = true } = {}) => {
    if (!header.has(column)) { if (required) flag(ref, field, 'column is missing'); return undefined; }
    try {
      const value = convert(cell(row, header, column));
      if (value === null && required) flag(ref, field, 'is blank');
      return value ?? null;
    } catch (error) {
      if (!(error instanceof StatementError)) throw error;
      flag(ref, field, error.message);
      return undefined;
    }
  };
  const text = (value) => (value === null || value === undefined ? null : String(value).trim() || null);
  const id = (value) => { const t = text(value); if (t !== null && !/^\d+$/.test(t)) throw new StatementError('not an ID'); return t; };

  const lines = (key, label) => {
    const sheet = findSheet(sheets, SHEETS[key]);
    if (!sheet) { need(label, label); return []; }
    const out = [];
    eachRow(sheet, 1, (row, { header, ref }) => {
      const signed = read(ref, 'Signing time', dayOf, row, header, 'signing time');
      const fee = read(ref, 'Fee', centsOf, row, header, 'the total expenses-exclusive of taxes');
      const deliveryId = read(ref, 'Delivery ID', id, row, header, 'delivery id');
      if (signed === undefined || fee === undefined || fee === null || deliveryId === undefined || deliveryId === null || signed === null) return;
      out.push({ ref, waybill: text(cell(row, header, 'waybill no')), courier: text(cell(row, header, 'courier')), deliveryId,
        route: text(cell(row, header, 'region/route')), signedOn: signed.day, feeCents: fee, weightRange: text(cell(row, header, 'billing weight range')) });
    });
    return out;
  };

  const summary = (key, label, columns, { daily = false } = {}) => {
    const sheet = findSheet(sheets, SHEETS[key]);
    if (!sheet) { need(label, label); return []; }
    const out = [];
    eachRow(sheet, 2, (row, { header, ref }) => {
      const record = { ref };
      for (const [name, [column, convert, optional]] of Object.entries(columns)) record[name] = read(ref, column, convert, row, header, norm(column), { required: !optional });
      if (daily) record.signDate = read(ref, 'sign date', dayOf, row, header, 'sign date')?.day ?? null;
      out.push(record);
    });
    return out;
  };

  const money = centsOf;
  const dspRows = summary('dsp', 'DSP Summary', {
    billNumber: ['Bill Number', text], provider: ['The full name of the service provider', text], fleet: ['Fleet', text], billingPeriod: ['Billing Period', text],
    billingPeriodRange: ['Billing period range', text], currency: ['Currency', text], remainingPayable: ['Remaining Payable This Period', money],
    prepaid: ['Total Amount Prepaid to Driver Accounts This Period', money, true], withdrawalFees: ['Total Withdrawal Fees for Drivers Exceeding 14 Days This Period', money, true],
    totalBilling: ['Total Billing Amount_untaxed', money], claims: ['Claim Amount- tax free', money], adjustments: ['Adjustment amount - amount exclusive of taxes', money],
    deliveries: ['Number of deliveries', countOf], deliveryFee: ['Delivery fee - amount exclusive of taxes', money], offsetTickets: ['Total Offset Tickets', countOf],
    offsetAmount: ['Total Offset Amount', money], firstCount: ['Total Count of First Shipments', countOf], firstAmount: ['Total Amount of First Shipments', money],
    subsequentCount: ['Total Count of Subsequent Shipments', countOf], subsequentAmount: ['Total Amount of Subsequent Shipments', money],
  });
  if (dspRows.length !== 1) issues.push({ sheet: 'DSP Summary', row: 3, field: 'statement row', problem: `expected exactly one statement row, found ${dspRows.length}` });

  const perDriver = {
    deliveryId: ['Delivery ID', id, true], courier: ['Courier', text, true], // blank on the row that carries the fleet-wide adjustment
    totalBill: ['Total Bill Amount (Excluding Tax) (Total Payable Amount for This Period)', money], claims: ['Claim Amount_tax excl.', money],
    adjustments: ['Adjustment amount - amount exclusive of taxes', money], deliveries: ['Number of deliveries', countOf],
    deliveryFee: ['Delivery fee - amount exclusive of taxes', money], offsetTickets: ['Total Offset Tickets', countOf], offsetAmount: ['Total Offset Amount', money],
  };

  const statement = {
    header: dspRows[0] ?? null,
    details: lines('details', 'Details of Delivery Fees'),
    offsets: lines('offsets', 'Offset Details'),
    driverSummary: summary('driver', 'Driver Summary', perDriver),
    dailySummary: summary('daily', 'Driver Daily Summary', perDriver, { daily: true }),
    claims: [], adjustments: [], prepaid: [], withdrawals: [],
    issues,
  };

  const claimsSheet = findSheet(sheets, SHEETS.claims);
  if (claimsSheet) eachRow(claimsSheet, 1, (row, { header, ref }) => {
    const amount = read(ref, 'Amount', money, row, header, 'the total expenses-exclusive of taxes');
    if (amount === undefined || amount === null) return;
    statement.claims.push({ ref, waybill: text(cell(row, header, 'waybill no.')), courier: text(cell(row, header, 'courier')), claimType: text(cell(row, header, 'claim type')),
      onDay: read(ref, 'Date', (v) => (text(v) === null ? null : dayOf(String(v)).day), row, header, 'date', { required: false }) ?? null, amountCents: amount, remarks: text(cell(row, header, 'remarks')) });
  }); else need('Claims Detail', 'Claims Detail');
  const ledgerSheet = findSheet(sheets, SHEETS.ledger);
  if (ledgerSheet) eachRow(ledgerSheet, 1, (row, { header, ref }) => {
    const amount = read(ref, 'Amount', money, row, header, 'adjustment amount_untaxed');
    if (amount === undefined || amount === null) return;
    statement.adjustments.push({ ref, expenseType: text(cell(row, header, 'expense type')), deliveryId: text(cell(row, header, 'delivery id')), amountCents: amount,
      description: text(cell(row, header, 'reconciliation description')) });
  }); else need('General Ledger Adjustment', 'General Ledger Adjustment');
  // Prepayments and withdrawal fees are kept apart from delivery revenue; they are read so they can be shown, never added to it.
  const prepaidSheet = findSheet(sheets, SHEETS.prepaid);
  if (prepaidSheet) eachRow(prepaidSheet, 1, (row, { header, ref }) => {
    const amount = read(ref, 'Prepaid amount', money, row, header, 'prepaid amount');
    if (amount !== undefined && amount !== null) statement.prepaid.push({ ref, courierId: text(cell(row, header, 'courier id')), amountCents: amount });
  });
  const withdrawalSheet = findSheet(sheets, SHEETS.withdrawal);
  if (withdrawalSheet) eachRow(withdrawalSheet, 1, (row, { header, ref }) => {
    const amount = read(ref, 'DSP bearing fee', money, row, header, 'dsp bearing fee amount');
    if (amount !== undefined && amount !== null) statement.withdrawals.push({ ref, courierId: text(cell(row, header, 'courier id')), amountCents: amount });
  });

  statement.fingerprint = fingerprintOf(statement);
  return statement;
};

// The same statement always gives the same fingerprint, whatever the order of its rows; a corrected statement (any money or day changed) gives another one.
const fingerprintOf = (statement) => {
  const keyed = (list, pick) => list.map(pick).sort();
  const canonical = JSON.stringify({
    bill: statement.header?.billNumber ?? null,
    details: keyed(statement.details, (l) => `${l.waybill}|${l.deliveryId}|${l.route}|${l.signedOn}|${l.feeCents}`),
    offsets: keyed(statement.offsets, (l) => `${l.waybill}|${l.deliveryId}|${l.route}|${l.signedOn}|${l.feeCents}`),
    claims: keyed(statement.claims, (c) => `${c.waybill}|${c.amountCents}`),
    adjustments: keyed(statement.adjustments, (a) => `${a.expenseType}|${a.deliveryId}|${a.amountCents}`),
    controls: statement.header ? [statement.header.totalBilling, statement.header.deliveryFee, statement.header.claims, statement.header.adjustments] : null,
  });
  return createHash('sha256').update(canonical).digest('hex');
};

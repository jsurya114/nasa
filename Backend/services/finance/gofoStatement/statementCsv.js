// CSV for the owner's statement exports (issue #252). Pure. Text that comes from a statement file (a bill number, a city, a route) could start with
// = + - @ and be run as a formula when the file is opened in a spreadsheet, so such text gets a leading apostrophe. Numbers that WE format are left alone.

const FORMULA_START = /^[=+\-@\t\r]/;

export const textCell = (value) => {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// A number we formatted ourselves ("-0.70", "19317.04"): written as it is, never treated as text.
export const numberCell = (value) => (value === null || value === undefined ? '' : String(value));

export const toCsv = (columns, rows) => {
  const header = columns.map((c) => textCell(c.header)).join(',');
  const lines = rows.map((row) => columns.map((c) => (c.number ? numberCell(row[c.key]) : textCell(row[c.key]))).join(','));
  return `${[header, ...lines].join('\r\n')}\r\n`;
};

export const STATEMENT_COLUMNS = [
  { header: 'City', key: 'city' }, { header: 'Billing week', key: 'billingWeek' }, { header: 'Week start', key: 'periodStart' }, { header: 'Week end', key: 'periodEnd' },
  { header: 'Bill number', key: 'billNumber' }, { header: 'Version', key: 'version', number: true }, { header: 'Status', key: 'status' },
  { header: 'Delivery revenue', key: 'deliveryRevenue', number: true }, { header: 'Matched revenue', key: 'matchedRevenue', number: true }, { header: 'Unallocated revenue', key: 'unallocatedRevenue', number: true },
  { header: 'Driver earnings', key: 'driverEarnings', number: true }, { header: 'Delivery margin', key: 'deliveryMargin', number: true },
  { header: 'Carrier claims', key: 'carrierClaims', number: true }, { header: 'Ledger adjustments', key: 'ledgerAdjustments', number: true },
  { header: 'Contribution', key: 'contribution', number: true }, { header: 'GOFO settlement payable', key: 'settlementPayable', number: true },
  { header: 'Insurance withheld', key: 'insuranceWithheld', number: true }, { header: 'Driver earnings after insurance', key: 'driverEarningsAfterInsurance', number: true },
  { header: 'NASA deliveries', key: 'nasaDeliveries', number: true }, { header: 'Carrier deliveries (includes offset tickets)', key: 'carrierDeliveries', number: true },
];

export const UNALLOCATED_COLUMNS = [
  { header: 'Delivery ID', key: 'deliveryId' }, { header: 'Signing day', key: 'day' }, { header: 'Route', key: 'route' }, { header: 'Why', key: 'reason' },
  { header: 'Revenue', key: 'revenue', number: true }, { header: 'Fee lines', key: 'lines', number: true }, { header: 'Offset lines', key: 'offsets', number: true },
];

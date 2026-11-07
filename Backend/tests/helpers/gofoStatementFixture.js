// Made-up carrier statement for tests: no real driver, carrier or amount.
import ExcelJS from 'exceljs';

// Two couriers, four delivery lines, one offset, one claim, one fleet-wide adjustment.
export const DETAIL = ['Waybill No', 'Destination city', 'Destination state', 'Recipient postal code', 'Transfer Center', 'Delivery station', 'Region/route', 'Type of signature confirmation',
  'Courier', 'Delivery ID', 'Time waiting for dispatch', 'Site check-in time', 'Signing time', 'Settlement weight kg', 'Settlement weight lb', 'The total expenses-exclusive of taxes', 'Billing Weight Range'];
export const line = (waybill, courier, id, route, signed, fee) => [waybill, null, 'XX', '00000', 'TC', 'TST-NLC', route, 'Door/Yard', courier, id, null, null, signed, 0.1, 0.2, fee, '0-1lb'];
const DSP = ['Bill Number', 'The full name of the service provider', 'Fleet', 'Billing Period', 'Billing period range', 'Currency', 'Remaining Payable This Period',
  'Total Amount Prepaid to Driver Accounts This Period', 'Total Withdrawal Fees for Drivers Exceeding 14 Days This Period', 'Total Billing Amount_untaxed', 'Claim Amount- tax free',
  'Adjustment amount - amount exclusive of taxes', 'Number of deliveries', 'Delivery fee - amount exclusive of taxes', 'Total Offset Tickets', 'Total Offset Amount',
  'Total Count of First Shipments', 'Total Amount of First Shipments', 'Total Count of Subsequent Shipments', 'Total Amount of Subsequent Shipments'];
const PER_DRIVER = ['Delivery ID', 'Courier', 'Total Bill Amount (Excluding Tax) (Total Payable Amount for This Period)', 'Claim Amount_tax excl.', 'Adjustment amount - amount exclusive of taxes',
  'Number of deliveries', 'Delivery fee - amount exclusive of taxes', 'Total Offset Tickets', 'Total Offset Amount'];
const DAILY = [PER_DRIVER[0], PER_DRIVER[1], 'sign date', ...PER_DRIVER.slice(2)];

export const statementSheets = ({ idA = '1001', idB = '1002', routeA = 'TS01-001', routeB = 'TS01-002', fleet = 'TST-NLC' } = {}) => structuredClone({ // a fresh copy each time: a test that changes a header must not change the next test
  'DSP Summary': [DSP, DSP, ['AP0000000001', 'TEST CARRIER LLC', fleet, 'Weekly settlement', 'Week 43-2026', 'USD', 2.21, '', '', 2.21, -0.7, -2, 5, 4.91, 1, -1.8, 3, 5.4, 1, 0.5]],
  'Driver Summary': [PER_DRIVER, PER_DRIVER, [`${idA} `, 'Driver One', 1.91, -0.7, 0, 2, 2.61, 1, -1.8], [`${idB} `, 'Driver Two', 2.3, 0, 0, 2, 2.3, 0, 0], [' ', null, -2, 0, -2, 0, 0, 0, 0]],
  'Driver Daily Summary': [DAILY, DAILY, [`${idA} `, 'Driver One', '10/19/2026', 1.91, -0.7, 0, 2, 2.61, 1, -1.8], [`${idB} `, 'Driver Two', '10/20/2026', 2.3, 0, 0, 2, 2.3, 0, 0],
    [' ', null, '10/27/2026', -2, 0, -2, 0, 0, 0, 0]],
  'Details of Delivery Fees': [DETAIL, line('W1', 'Driver One', idA, routeA, '10/19/2026 08:05:00', 1.8), line('W2', 'Driver One', idA, routeA, '10/19/2026 09:00:00', 2.61),
    line('W3', 'Driver Two', idB, routeB, '10/20/2026 10:00:00', 1.8), line('W4', 'Driver Two', idB, routeB, '10/20/2026 10:01:00', 0.5)],
  'Offset Details': [DETAIL, line('W9', 'Driver One', idA, routeA, '10/19/2026 04:46:32', -1.8)],
  'Claims Detail': [['date', 'Waybill No.', 'Courier', 'Postal code', 'Claim Type', 'Declared value (USD)', 'Tax Included', 'Tax Rate', 'Weight(KG)', 'Confirm date.', 'The total expenses-exclusive of taxes', 'Remarks'],
    ['10/19/2026 04:46:32', 'W1', 'Driver One', '00000', 'lost', 0.7, 'Excluding Tax', 0, 0.1, '10/19/2026', -0.7, 'Claim Penalty']],
  'General Ledger Adjustment recor': [['date', 'Expense Type', 'Delivery ID', 'Courier', 'Tax Included', 'Tax Rate', 'adjustment Amount_untaxed', 'Reconciliation Description'],
    ['10/27/2026', 'Driver Service Fee', '', '', 'Yes', '0%', '-2.00', 'Driver Insurance Premium']],
  'Total Withdrawal Fees for Drive': [['Withdrawal Transaction Number', 'Fleet Name', 'Courier ID', 'Courier Name', 'Withdrawal Amount', 'Withdrawal Date', 'x', 'Exceeds 14 Days or Not', 'DSP Bearing Fee Amount'], ['', '', '', '', '', '', '', '', '']],
  'Total Prepaid to Driver Account': [['Billing Date (Driver Delivery Confirmation Date)', 'Prepaid Amount', 'Courier ID', 'Courier Name', 'Recharge Completion Date', 'Deduction Accounting Period'], ['', '', '', '', '', '']],
});

// The same sheets as an .xlsx file's bytes.
export const statementWorkbook = async (sheets = statementSheets()) => {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    rows.forEach((row) => sheet.addRow(row));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

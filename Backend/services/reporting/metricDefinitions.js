/**
 * The one place that says what NASA's business numbers mean (issue #220, docs/INSIGHTS_MCP.md section 6).
 * The Insights page and the Claude connector both read this, so the words never drift apart. Data only: no database,
 * no Express, no MCP.
 *
 * These definitions describe rules that already exist. They do not change how anything is calculated or paid.
 */

export const DEFINITIONS_VERSION = '2026-11-06';
export const CURRENCY = 'USD';

export const METRIC_DEFINITIONS = Object.freeze([
  {
    id: 'completed_deliveries',
    label: 'Completed deliveries',
    unit: 'count',
    definition: 'The stored delivered count on eligible daily and weekly rows, using the same inclusion rules as the existing reports.',
    caveats: [
      'One database row is an aggregate, not one order. NASA does not hold order-level identifiers, so "unique orders" is never claimed.',
      'A record counts for its city only when its sequence numbers match the city type (daily cities have them, weekly cities do not): the Dashboard\'s own rule.',
      'Records still open (no stored amounts yet) are counted in deliveries but not in revenue or margin.',
    ],
  },
  {
    id: 'gross_driver_earnings',
    label: 'Gross driver earnings',
    unit: CURRENCY,
    definition: 'The stored driver payment on the same rows, before advances, insurance withholding, claims or debt recovery.',
    caveats: [],
  },
  {
    id: 'company_margin',
    label: 'Company margin',
    unit: CURRENCY,
    definition: 'The stored company earnings on the same rows: the company price minus the driver price, per delivery, as calculated when the row was stored.',
    caveats: ['This is the margin left after gross driver earnings. It is not total revenue.'],
  },
  {
    id: 'earned_delivery_revenue',
    label: 'Earned delivery revenue',
    unit: CURRENCY,
    definition: 'Gross driver earnings plus company margin, from exactly the same rows.',
    caveats: [
      'Only records with both amounts stored are included. A record with no stored amounts is disclosed in the warnings and is never treated as zero revenue.',
      'Revenue earned from deliveries. It is not proof that the carrier has paid NASA.',
      'Historical rows keep the amounts stored at the time. Nothing is recalculated from today\'s route rates.',
    ],
  },
  {
    id: 'gross_margin',
    label: 'Gross profit before overheads',
    unit: CURRENCY,
    definition: 'Company margin. Overheads and operating costs are not recorded in NASA.',
    caveats: ['Not net profit. Do not describe it as net profit.'],
  },
  {
    id: 'margin_percentage',
    label: 'Margin percentage',
    unit: 'percent',
    definition: 'Company margin divided by earned delivery revenue.',
    caveats: ['Not available (N/A) when revenue is zero.'],
  },
  {
    id: 'active_drivers',
    label: 'Active drivers',
    unit: 'count',
    definition: 'Distinct drivers with at least one delivery in the period.',
    caveats: [],
  },
  {
    id: 'deliveries_per_active_day',
    label: 'Deliveries per active day',
    unit: 'count',
    definition: 'Completed deliveries divided by the number of distinct driver-days that had deliveries.',
    caveats: [],
  },
  {
    id: 'claims',
    label: 'Carrier claims',
    unit: CURRENCY,
    definition: 'Claims from the carrier, shown as chargeable, exempt and unmatched, each counted and valued separately.',
    caveats: [
      'Exempt includes the agreed DFWGOFO + Tracking interruption exemption.',
      'Unmatched claims are never silently assigned to a driver or deducted.',
      'Carrier claims are part of penalty balances, as already approved.',
    ],
  },
  {
    id: 'driver_ranking',
    label: 'Driver ranking',
    unit: 'count',
    definition: 'Drivers ordered by completed deliveries in the period (or by deliveries per active day, among drivers with enough active days), with the city where they delivered most.',
    caveats: ['Ties are broken by driver id. Only names and cities are shown: no contact, bank, tax or login details.'],
  },
  {
    id: 'delivery_trend',
    label: 'Delivery trend and busiest weekdays',
    unit: 'count',
    definition: 'Deliveries, earned revenue and margin by day, week (starting Monday) or month, and the average deliveries on each weekday over the days that have records.',
    caveats: ['A day with no records is missing data, not a zero-delivery day. Buckets at the edge of the period are flagged when only partly inside it.'],
  },
  {
    id: 'delivery_forecast',
    label: 'Delivery forecast',
    unit: 'count (estimated)',
    definition: 'An estimate of deliveries for the coming days from the recent pattern of each weekday, tested on past weeks without using future data, with its historical error and a range when there are enough tests.',
    caveats: [
      'An estimate, not a promise: it ignores holidays, weather, new contracts and route changes.',
      'A partly imported latest week is left out of the pattern, and the answer is insufficient_data when history cannot support a useful forecast.',
      'There is no revenue forecast.',
    ],
  },
  {
    id: 'payment_overview',
    label: 'Payment overview',
    unit: CURRENCY,
    definition: 'Approved driver pay awaiting payment, payments processing or unconfirmed, and payments returned or failed, from the frozen pay-run records and the payment status records.',
    caveats: ['Current (as-of) figures, not period activity and not historical month-end balances.'],
  },
]);

export const REPORTING_LIMITATIONS = Object.freeze([
  'All money is USD and is returned as exact decimal strings.',
  'Delivery figures count stored delivered quantities. Weekly imports may record packages as completed deliveries, so no delivery success rate is reported without a reliable denominator.',
  'Missing data is reported as missing, never as zero.',
  'Historical deliveries stay with the city of the route they were recorded on, even if a driver later moves city.',
  'Balances and payment backlogs are as of the moment the answer was produced.',
  'Driver advances, debts and penalty balances are not available through this connector yet: Payroll is the authority for what a driver owes.',
]);

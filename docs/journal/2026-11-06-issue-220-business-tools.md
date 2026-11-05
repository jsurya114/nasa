# NASA Insights: the remaining business tools (trends, drivers, claims, payments, forecast)

- Date: 2026-11-06
- Author: Jasil (with Claude)
- Issue / PR: #220
- Branch: `feat/insights-business-tools` (stacked on `feat/insights-reporting-tools`, PR #224, which contains #222)
- Type and scope: feat(analytics), backend only

Completes the tool set the client needs for a conversation about the business.

- Add migration `2026-11-06-issue-220-reporting-claims-payments` (and rollback): views `reporting.claim_facts` (the latest version of
  each carrier claim with its decision) and `reporting.payment_facts` (pay statements of draft and approved runs, with the returned
  deposit flag when the Everee table exists). Granted to the read-only group role only.
- Add `get_delivery_trends` (day, week, month; busiest weekdays; peak dates), `rank_drivers` (names and main city only),
  `get_claim_exposure` (chargeable, exempt, unmatched; never assigns or deducts), `get_payment_overview` (pending, approved,
  processing, unconfirmed, failed, returned, paid; as-of; approved is not paid) and `forecast_deliveries`.
- Forecast: weekday pattern from recent complete weeks, three candidates compared by backtesting on the last 8 weeks using only
  earlier data, the best one used; partly imported weeks are left out (a gap in imports is not a fall in deliveries); a range only
  with at least 20 backtest points; `insufficient_data` with a reason when history cannot support it; labelled an estimate.
- Update the metric definitions (driver ranking, trend, forecast) and the setup guide.

Review follow-ups from #224: the reporting connection now verifies the database's TLS certificate by default (`REPORTING_DB_SSL=true`;
`REPORTING_DB_SSL_CA` for a private CA; switching it off needs `REPORTING_DB_SSL_VERIFY=false`, by name). Driver names in `rank_drivers`
were allowed by the owner's brief ("driver rankings can include names and cities"); contact, bank, tax and login details are never exposed.
The consent page now lists everything the connector can read.

Review fixes on #228: the payment view now says whether Everee data was available (`deposit_info_available`) and the payment overview
warns when returned deposits cannot be seen; the claims-and-payments migration must be re-run after the Everee migrations (stated in
its header, the setup guide and here, with a test that builds the view without the table). A malformed `start_date` is refused before
any data check, and that test no longer depends on how much history a database has. The reporting TLS opt-out is logged and refused
in production. Names and amounts of up to 20 failed, returned or unconfirmed payments are returned by the payment overview, as the
consent page says.

Not included, on purpose: driver advances, debts and penalty balances (their rules live in the Payroll statement services and are
intricate; Payroll stays the authority), route-level margin, a delivery success rate (no reliable denominator), a revenue forecast.
Database: two views, additive. Money calculations in NASA: unchanged; everything only reads.

Validation: 21 new tests. Pure forecast tests (steady pattern exact, a partly imported week and a gap week left out, too little
history, level shift, no future data in a prediction, input limits, few backtest points). Fixture tests in a rolled-back
transaction: every trend interval adds up to the summary (deliveries, revenue, margin), edge buckets and missing days, weekday
profile and peaks, driver ranking (main city, shares, per-day with minimum active days, city filter, adds up to the summary), claim
exposure (older versions ignored, a claim without a decision is unmatched, date and city filters, deductions in approved runs),
payment buckets (draft, approved, submitted, unconfirmed, failed, returned deposit not counted as paid, voided and discarded
excluded), and no change to any table. Over HTTP through the real sign-in: all nine tools listed with read-only annotations, bad
input refused, trends and drivers agree with the summary. Full backend suite passes (212 passed, 53 skipped without a database,
0 failed). **Not done:** staging and mobile, comparison with the Insights page, a PostgreSQL 14 run.

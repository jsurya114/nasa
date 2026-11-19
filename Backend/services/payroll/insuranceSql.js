// The insurance a pay row (payment_dashboard) is ACTUALLY charged, for every screen and report that shows it.
//
// The weekly upload puts $1.92 on each driver's working day, but a pay run may take less: a driver whose pay in the run is under the minimum pays none
// (payCalculator.js). Once a pay row is on a pay statement, the statement is the truth about what was charged:
//   - covered by an active earning line of a statement: the insurance lines that statement froze for the row (none = nothing was charged);
//   - not on a statement (work not drafted yet, or a draft that was discarded or voided): the stored `insurance_deduction`, exactly as before (null stays null).
// Statement lines are history (never rewritten), so a paid statement's insurance never changes. A row has at most one active earning line (unique index),
// so the amounts are never doubled, and each insurance line belongs to one row, so filtering part of a run never moves a deduction to another day.
//
// `alias` is the payment_dashboard alias in the query. The result is a SQL expression (numeric), usable in SELECT and inside SUM().
// The same rule is written out in migrations/2026-11-19-reporting-insurance-from-statement.sql for reporting.delivery_facts (which wraps it in COALESCE(..., 0) as that
// column always did): keep them equal. The result has the column's own format (two decimals).
export const effectiveInsuranceSql = (alias = 'pd') => `(CASE
    WHEN EXISTS (SELECT 1 FROM pay_statement_lines ie WHERE ie.payment_dashboard_id = ${alias}.id AND ie.active AND ie.line_type = 'earning')
    THEN COALESCE((SELECT -SUM(il.amount)
                     FROM pay_statement_lines ie JOIN pay_statement_lines il ON il.statement_id = ie.statement_id AND il.payment_dashboard_id = ie.payment_dashboard_id AND il.active AND il.line_type = 'insurance'
                    WHERE ie.payment_dashboard_id = ${alias}.id AND ie.active AND ie.line_type = 'earning'), 0)
    ELSE ${alias}.insurance_deduction
  END)::numeric(10,2)`;

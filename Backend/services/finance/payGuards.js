// Which Dashboard pay rows "Calculate Payment" must leave alone (issue #252). One definition, used by every recalculation of pay rows.
//
// A row is protected when recalculating it from today's route rates could change a figure that is already settled:
//   1. it is an earning on a pay statement (approved or paid pay runs freeze their earnings), or
//   2. it is part of a verified carrier statement AND already has a calculated driver payment: its figures were reconciled against the carrier's bill.
//      A row with no driver payment yet is open work and is never protected by a statement, so it can receive its first calculation.
// Everything else is recalculated exactly as before. Protected rows are counted and reported, never silently skipped.

const EARNING_ON_STATEMENT = `EXISTS (SELECT 1 FROM pay_statement_lines psl WHERE psl.payment_dashboard_id = pd.id AND psl.active AND psl.line_type = 'earning')`;

// A weekly row: no sequence numbers (the Dashboard's own rule).
const WEEKLY_ROW = `(pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0)`;

// A row that already has a calculated driver payment. A row that has none yet is still open work: it must be able to get its first calculation, or it can
// never close and enter a pay run, whatever week it falls in.
const ALREADY_CALCULATED = `(pd.closed IS TRUE AND pd.driver_payment IS NOT NULL)`;

const IN_VERIFIED_STATEMENT = `(
    ${ALREADY_CALCULATED} AND (
      EXISTS (SELECT 1 FROM carrier_statement_groups csg JOIN carrier_statements cs ON cs.id = csg.statement_id
               WHERE csg.payment_dashboard_id = pd.id AND cs.status = 'published')
      OR (${WEEKLY_ROW} AND EXISTS (SELECT 1 FROM carrier_statements cs2 JOIN routes csr ON csr.id = pd.route_id JOIN city csc ON csc.job = csr.job
                                     WHERE cs2.status = 'published' AND cs2.city_id = csc.id AND pd.journey_date BETWEEN cs2.period_start AND cs2.period_end))
    )
  )`;

// The SQL condition that is true for a protected row (the payment_dashboard table must be aliased `pd`). `db` is a pool or client: the carrier
// statement tables may not exist yet on an older database, and then only the pay statement rule applies.
export const protectedPayRowSql = async (db) => {
  const { rows } = await db.query("SELECT to_regclass('public.carrier_statements') IS NOT NULL AS has_statements, to_regclass('public.pay_statement_lines') IS NOT NULL AS has_lines");
  const parts = [];
  if (rows[0].has_lines) parts.push(EARNING_ON_STATEMENT);
  if (rows[0].has_statements) parts.push(IN_VERIFIED_STATEMENT);
  return parts.length > 0 ? `(${parts.join(' OR ')})` : 'FALSE';
};

export const PROTECTED_ROWS_NOTE = 'Rows that belong to an approved pay run or a verified carrier statement were left exactly as they are.';

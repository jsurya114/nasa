// What the driver is owed in pay right now: their closed, unpaid pay rows in the city (by the route's city, as the dashboard
// and pay runs read them), less insurance, that no live pay statement has taken yet. The Payroll page uses it for one rule:
// a penalty or advance bigger than this must say how it is repaid, on the next payday or by instalments.
// db is the pool or a transaction client. Returns a "12.34" string.

export const driverPayable = async (db, driverId, cityId) => {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(COALESCE(pd.driver_payment, 0) - COALESCE(pd.insurance_deduction, 0)), 0)::numeric(12,2)::text AS payable
       FROM payment_dashboard pd
       JOIN routes r ON r.id = pd.route_id
       JOIN city c ON c.job = r.job
      WHERE c.id = $1 AND pd.driver_id = $2 AND pd.closed = true AND COALESCE(pd.paid, false) = false
        AND NOT EXISTS (SELECT 1 FROM pay_statement_lines l WHERE l.payment_dashboard_id = pd.id AND l.active AND l.line_type = 'earning')`,
    [cityId, driverId]
  );
  return rows[0].payable;
};

// The types the Payroll page offers (advance and penalty) are the ones that need an arrangement when the amount is more than
// the driver's payment. An exempt claim owes nothing, so it needs none.
export const NEEDS_ARRANGEMENT_TYPES = Object.freeze(['advance', 'manual_claim']);
export const ARRANGEMENT_MESSAGE = (payable) =>
  `This is more than the driver's payment ($${payable}). Choose how it is repaid: all on the next payday, or fixed instalments.`;

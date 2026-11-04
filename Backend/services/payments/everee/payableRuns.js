import { PayrollError, isSuperAdmin } from '../../payroll/payRuns/payRunStore.js';

// The approved pay runs the Dashboard's filtered list can be paid from (issue #31): finalized runs that still have unpaid statements for the
// chosen city and/or driver. An approved run is independent of the delivery dates on the Dashboard, so dates are not part of this.
// Super admin only (the same rule as the preview and the confirm). Bounded; newest first.
const MAX_RUNS = 10;

const idOf = (value, name) => {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d{1,9}$/.test(String(value)) || Number(value) <= 0) throw new PayrollError(400, `${name} must be a number`);
  return Number(value);
};

export const listPayableRuns = async (db, admin, { cityId, driverId } = {}) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can pay through Everee');
  const city = idOf(cityId, 'cityId');
  const driver = idOf(driverId, 'driverId');
  const { rows } = await db.query(
    `SELECT r.id, r.city_id, c.job AS city, r.data_type, to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
            count(*)::int AS drivers, COALESCE(sum(s.net), 0)::text AS remaining,
            count(*) FILTER (WHERE s.payout_status IN ('submitted', 'unconfirmed'))::int AS processing
       FROM pay_runs r JOIN city c ON c.id = r.city_id JOIN pay_statements s ON s.pay_run_id = r.id
      WHERE r.status = 'finalized' AND s.payout_status <> 'paid' AND s.net > 0
        AND ($1::int IS NULL OR r.city_id = $1) AND ($2::int IS NULL OR s.driver_id = $2)
      GROUP BY r.id, c.job ORDER BY r.id DESC LIMIT ${MAX_RUNS}`, [city, driver]);
  return { runs: rows, driverId: driver, cityId: city };
};

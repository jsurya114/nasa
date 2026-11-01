import pool from '../../config/db.js';

/**
 * City checks for the admin journey actions (issue #12). A superadmin may act in
 * every city; any other admin only in the cities assigned to them in admin_city_ref.
 * The admin always comes from the verified token. A journey belongs to the city of
 * its driver, the same rule the journey lists already use.
 */

const isSuperAdmin = (user) => user?.role === 'superadmin';
const isId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;

export async function canAccessDriver(user, driverId) {
  if (isSuperAdmin(user)) return true;
  if (!isId(driverId) || !isId(user?.id)) return false;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM drivers d JOIN admin_city_ref acr ON acr.city_id = d.city_id
     WHERE d.id = $1 AND acr.admin_id = $2`,
    [driverId, user.id]
  );
  return rowCount > 0;
}

// A route belongs to a city through its job name.
export async function canAccessRoute(user, routeId) {
  if (isSuperAdmin(user)) return true;
  if (!isId(routeId) || !isId(user?.id)) return false;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM routes r
     JOIN city c ON c.job = r.job
     JOIN admin_city_ref acr ON acr.city_id = c.id
     WHERE r.id = $1 AND acr.admin_id = $2`,
    [routeId, user.id]
  );
  return rowCount > 0;
}

// The driver a stored journey belongs to, or null if the journey does not exist.
export async function getJourneyDriverId(journeyId) {
  if (!isId(journeyId)) return null;
  const { rows } = await pool.query('SELECT driver_id FROM dashboard_data WHERE id = $1', [journeyId]);
  return rows.length ? rows[0].driver_id : null;
}

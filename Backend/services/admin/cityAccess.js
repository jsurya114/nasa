import pool from '../../config/db.js';

/**
 * Which cities an admin may act in (issue #12).
 *
 * A superadmin may act in every city. Any other admin may act only in the cities
 * assigned to them in admin_city_ref. Identity always comes from the verified
 * token (`user`), never from the request body or URL.
 */

export const isSuperAdmin = (user) => user?.role === 'superadmin';

// A city id, or a job name, that is not a usable value is never allowed.
const toId = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);

export async function canAccessCityId(user, cityId) {
  if (isSuperAdmin(user)) return true;
  const id = toId(cityId);
  if (!id || !toId(user?.id)) return false;
  const { rowCount } = await pool.query(
    'SELECT 1 FROM admin_city_ref WHERE admin_id = $1 AND city_id = $2',
    [user.id, id]
  );
  return rowCount > 0;
}

// City given by its job name, as the driver and route forms send it.
export async function canAccessJob(user, job) {
  if (isSuperAdmin(user)) return true;
  if (typeof job !== 'string' || !job || !toId(user?.id)) return false;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM admin_city_ref acr JOIN city c ON c.id = acr.city_id
     WHERE acr.admin_id = $1 AND c.job = $2`,
    [user.id, job]
  );
  return rowCount > 0;
}

// The driver's current city. A driver with no city can be changed by a superadmin only.
export async function canAccessDriver(user, driverId) {
  if (isSuperAdmin(user)) return true;
  const id = toId(driverId);
  if (!id) return false;
  const { rows } = await pool.query('SELECT city_id FROM drivers WHERE id = $1', [id]);
  return rows.length > 0 && canAccessCityId(user, rows[0].city_id);
}

import pool from '../../config/db.js';

/**
 * City checks for the route actions (issue #12). A superadmin may act in every
 * city; any other admin only in the cities assigned to them in admin_city_ref.
 * The admin always comes from the verified token.
 */

const isSuperAdmin = (user) => user?.role === 'superadmin';
const isId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;

// A route belongs to a city through its job name.
export async function canAccessJob(user, job) {
  if (isSuperAdmin(user)) return true;
  if (typeof job !== 'string' || !job || !isId(user?.id)) return false;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM admin_city_ref acr JOIN city c ON c.id = acr.city_id
     WHERE acr.admin_id = $1 AND c.job = $2`,
    [user.id, job]
  );
  return rowCount > 0;
}

// The routes of a driver are the routes of the driver's city.
export async function canAccessDriverCity(user, driverId) {
  if (isSuperAdmin(user)) return true;
  if (!isId(driverId) || !isId(user?.id)) return false;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM drivers d JOIN admin_city_ref acr ON acr.city_id = d.city_id
     WHERE d.id = $1 AND acr.admin_id = $2`,
    [driverId, user.id]
  );
  return rowCount > 0;
}

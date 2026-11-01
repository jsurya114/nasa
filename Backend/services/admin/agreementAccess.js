import pool from '../../config/db.js';

/**
 * City check for the admin agreement actions (issue #12). A superadmin may act in
 * every city; any other admin only on drivers in the cities assigned to them in
 * admin_city_ref. The admin always comes from the verified token.
 */

export const isSuperAdmin = (user) => user?.role === 'superadmin';

const isId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;

// Result: 'missing' (no such driver), 'forbidden' (driver is in another city) or 'allowed'.
export async function checkDriverAccess(user, driverId) {
  const { rows } = await pool.query('SELECT city_id FROM drivers WHERE id = $1', [driverId]);
  if (rows.length === 0) return 'missing';
  if (isSuperAdmin(user)) return 'allowed';
  if (!isId(user?.id) || !rows[0].city_id) return 'forbidden';
  const { rowCount } = await pool.query(
    'SELECT 1 FROM admin_city_ref WHERE admin_id = $1 AND city_id = $2',
    [user.id, rows[0].city_id]
  );
  return rowCount > 0 ? 'allowed' : 'forbidden';
}

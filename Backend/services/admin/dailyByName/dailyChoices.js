import { NAME_KEY_SQL, cleanDriverName } from '../driverName.js';

// The remembered choices of the daily upload that finds drivers by name, per city: "this file name = this driver" and "on this main route this
// driver gets this sub-route". Admins see, change and undo them (undo deletes the entry). The caller checks the admin's cities first.

export class ChoiceError extends Error {}

export const listChoices = async (db, cityId) => {
  const names = (await db.query(
    `SELECT m.id, m.file_name, m.driver_id, d.name AS driver_name, m.set_at, a.name AS set_by
       FROM daily_name_matches m JOIN drivers d ON d.id = m.driver_id LEFT JOIN admin a ON a.id = m.set_by
      WHERE m.city_id = $1 ORDER BY m.file_name, m.id`, [cityId])).rows;
  const subRoutes = (await db.query(
    `SELECT ch.id, ch.driver_id, d.name AS driver_name, ch.main_route_id, m.route_code_in_string AS main_route, ch.sub_route_id,
            s.route_code_in_string AS sub_route, ch.source, ch.set_at, a.name AS set_by
       FROM daily_subroute_choices ch JOIN drivers d ON d.id = ch.driver_id JOIN routes m ON m.id = ch.main_route_id JOIN routes s ON s.id = ch.sub_route_id
       LEFT JOIN admin a ON a.id = ch.set_by
      WHERE ch.city_id = $1 ORDER BY m.route_code_in_string, d.name, ch.id`, [cityId])).rows;
  const drivers = (await db.query('SELECT id, name, enabled FROM drivers WHERE city_id = $1 ORDER BY name', [cityId])).rows;
  const routes = (await db.query(
    `SELECT r.id, r.route_code_in_string AS code, r.driver_route_price AS fs_price, r.driver_doublestop_price AS ds_price, r.enabled
       FROM routes r JOIN city c ON c.job = r.job WHERE c.id = $1 AND r.deleted_at IS NULL ORDER BY r.route_code_in_string`, [cityId])).rows;
  return { names, subRoutes, drivers, routes };
};

// The daily cities this admin may use (all daily cities for the super admin).
export const listDailyCities = async (db, allowedJobs) => (await db.query(
  `SELECT id, job FROM city WHERE city_type = 'DAILY' AND ($1::text[] IS NULL OR job = ANY($1::text[])) ORDER BY job`, [allowedJobs])).rows;

const cityJob = async (db, cityId) => (await db.query('SELECT job FROM city WHERE id = $1', [cityId])).rows[0]?.job ?? null;

const assertDriverInCity = async (db, driverId, cityId) => {
  const ok = (await db.query('SELECT 1 FROM drivers WHERE id = $1 AND city_id = $2', [driverId, cityId])).rowCount;
  if (!ok) throw new ChoiceError('That driver is not a driver of this city.');
};

export const saveNameMatch = async (db, { cityId, fileName, driverId, adminId }) => {
  const name = cleanDriverName(String(fileName ?? ''));
  if (!name || name.length > 200) throw new ChoiceError('Give the name as it is in the file (up to 200 characters).');
  await assertDriverInCity(db, driverId, cityId);
  const { rows } = await db.query(
    `INSERT INTO daily_name_matches (city_id, name_key, file_name, driver_id, set_by, set_at) VALUES ($1, ${NAME_KEY_SQL('$2::text')}, $2, $3, $4, now())
     ON CONFLICT (city_id, name_key) DO UPDATE SET file_name = EXCLUDED.file_name, driver_id = EXCLUDED.driver_id, set_by = EXCLUDED.set_by, set_at = now()
     RETURNING id`, [cityId, name, driverId, adminId]);
  return rows[0].id;
};

export const saveSubRouteChoice = async (db, { cityId, mainRouteId, driverId, subRouteId, adminId }) => {
  await assertDriverInCity(db, driverId, cityId);
  const job = await cityJob(db, cityId);
  const { rows: pair } = await db.query(
    `SELECT m.id FROM routes m JOIN routes s ON s.id = $2 AND s.job = m.job AND split_part(s.route_code_in_string, ':', 1) = m.route_code_in_string
      WHERE m.id = $1 AND m.job = $3 AND s.route_code_in_string LIKE '%:%' AND m.deleted_at IS NULL AND s.deleted_at IS NULL`, [mainRouteId, subRouteId, job]);
  if (!pair.length) throw new ChoiceError('That sub-route is not a sub-route of that main route in this city.');
  const { rows } = await db.query(
    `INSERT INTO daily_subroute_choices (city_id, main_route_id, driver_id, sub_route_id, source, set_by, set_at) VALUES ($1, $2, $3, $4, 'admin', $5, now())
     ON CONFLICT (city_id, main_route_id, driver_id) DO UPDATE SET sub_route_id = EXCLUDED.sub_route_id, source = 'admin', set_by = EXCLUDED.set_by, set_at = now()
     RETURNING id`, [cityId, mainRouteId, driverId, subRouteId, adminId]);
  return rows[0].id;
};

// Undo. Returns the city of the deleted entry (so the caller can check it first with cityOfChoice), or null when there was none.
export const cityOfChoice = async (db, kind, id) => {
  const table = kind === 'names' ? 'daily_name_matches' : 'daily_subroute_choices';
  return (await db.query(`SELECT city_id FROM ${table} WHERE id = $1`, [id])).rows[0]?.city_id ?? null;
};
export const deleteChoice = async (db, kind, id) => {
  const table = kind === 'names' ? 'daily_name_matches' : 'daily_subroute_choices';
  return (await db.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rowCount;
};

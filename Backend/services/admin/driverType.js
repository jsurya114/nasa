import pool from '../../config/db.js';
import { isSuperAdmin } from './cityAccess.js';

// Driver type (Local or Desi) and the bulk "Change" action of the Drivers table. A driver with no type yet is NULL ("not set").

export const DRIVER_TYPES = ['LOCAL', 'DESI'];
export const MAX_DRIVERS_PER_CHANGE = 500;
const MAX_DRIVER_ID = 2147483647; // drivers.id is an integer column

// The optional driverType of the Add and Edit driver forms: left out (or empty) means "no choice" (null: a new driver is created with no
// type, an edited driver keeps the one they have). Returns { driverType } (a type or null) or { error }.
export const parseOptionalDriverType = (value) => {
  if (value === undefined || value === null || value === '') return { driverType: null };
  if (!DRIVER_TYPES.includes(value)) return { error: `Driver type must be one of: ${DRIVER_TYPES.join(', ')}` };
  return { driverType: value };
};

// Checks the request body. Returns { driverIds, driverType } (ids de-duplicated, in the order given) or { error }.
export const parseTypeChange = (body) => {
  const ids = body?.driverIds;
  if (!Array.isArray(ids) || ids.length === 0) return { error: 'Select at least one driver' };
  if (ids.length > MAX_DRIVERS_PER_CHANGE) return { error: `Select at most ${MAX_DRIVERS_PER_CHANGE} drivers at a time` };
  if (!ids.every((id) => Number.isInteger(id) && id > 0 && id <= MAX_DRIVER_ID)) return { error: 'Every driver ID must be a positive whole number' };
  if (!DRIVER_TYPES.includes(body?.driverType)) return { error: `Driver type must be one of: ${DRIVER_TYPES.join(', ')}` };
  return { driverIds: [...new Set(ids)], driverType: body.driverType };
};

// Sets the type of every listed driver in one transaction: all of them change, or none do. Admins may change only drivers in their own
// cities (a driver with no city: super admin only). Drivers that already have the type are left untouched, so nothing is rewritten for
// them. Returns { updated, unchanged } or { error: { status, message } }.
export async function setDriverTypes(user, driverIds, driverType, db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, city_id, driver_type FROM drivers WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [driverIds]);
    if (rows.length !== driverIds.length) {
      await client.query('ROLLBACK');
      return { error: { status: 404, message: 'One or more of the selected drivers do not exist' } };
    }
    if (!isSuperAdmin(user)) {
      const mine = await client.query('SELECT city_id FROM admin_city_ref WHERE admin_id = $1', [user?.id]);
      const cities = new Set(mine.rows.map((r) => r.city_id));
      if (rows.some((r) => !cities.has(r.city_id))) {
        await client.query('ROLLBACK');
        return { error: { status: 403, message: 'You can only manage drivers in your assigned cities' } };
      }
    }
    const toChange = rows.filter((r) => r.driver_type !== driverType).map((r) => r.id);
    if (toChange.length > 0) await client.query('UPDATE drivers SET driver_type = $1 WHERE id = ANY($2::int[])', [driverType, toChange]);
    await client.query('COMMIT');
    return { updated: toChange.length, unchanged: driverIds.length - toChange.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

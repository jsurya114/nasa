// Driver names must be unique ignoring case and extra spaces (issue #177), because carrier claims name the driver only by
// the Courier column and are matched to a driver by that name. One name has to mean one driver.

export const MAX_DRIVER_NAME = 100;

// The name as it is stored: no space at either end, any run of spaces or tabs collapsed to one. Case is kept for display.
export const cleanDriverName = (name) => (typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '');

// The same expression the database index uses (migrations/2026-11-04-issue-177-driver-name-unique.sql). Keep them in step.
export const NAME_KEY_SQL = (column) => `lower(regexp_replace(btrim(${column}), '\\s+', ' ', 'g'))`;

// Checks a name from a form. Returns { name } (cleaned) or { error }.
export const parseDriverName = (value) => {
  const name = cleanDriverName(value);
  if (name === '') return { error: 'Driver name is required' };
  if (name.length > MAX_DRIVER_NAME) return { error: `Driver name must be at most ${MAX_DRIVER_NAME} characters` };
  return { name };
};

// The driver who already has this name, or undefined. db is the pool or a transaction client. excludeId leaves one driver out,
// so a driver can be saved with the name they already have.
export const findDriverByName = async (db, name, excludeId = null) => {
  const { rows } = await db.query(
    `SELECT id, name, city_id FROM drivers WHERE ${NAME_KEY_SQL('name')} = ${NAME_KEY_SQL('$1::text')} AND ($2::int IS NULL OR id <> $2) LIMIT 1`,
    [name, excludeId]
  );
  return rows[0];
};

export const NAME_TAKEN = 'A driver with this name already exists';

// The unique index (or the older exact unique constraint) refused a name at the last moment, for example two admins saving the
// same name at once.
export const isNameConflict = (error) => error?.code === '23505' && /drivers_name/.test(error.constraint ?? '');

// Driver names must be unique ignoring case and extra spaces (issue #177), because carrier claims name the driver only by
// the Courier column and are matched to a driver by that name. One name has to mean one driver.

export const MAX_DRIVER_NAME = 100;

// Which characters count as whitespace in a driver name. The database uses exactly the same set (NAME_KEY_SQL and the migration), so
// the key of a stored name and the key of a name from a form agree for every name, including old ones that were never rewritten:
// a space, tab, newline, carriage return, form feed, vertical tab, and the no-break space that pasted Excel text often carries.
export const WHITESPACE = '[ \\t\\n\\r\\f\\v\\u00a0]+';
const WHITESPACE_RE = new RegExp(WHITESPACE, 'g');

// The name as it is stored: every run of those characters becomes one space, then a space at either end is removed. Collapsing comes
// first so a tab or newline at an end becomes a space and is then trimmed. Case is kept for display. This is not String.trim(), which
// removes more kinds of whitespace than the database does.
export const cleanDriverName = (name) => (typeof name === 'string' ? name.replace(WHITESPACE_RE, ' ').replace(/^ | $/g, '') : '');

// The key two names are compared by: cleaned, put in Unicode normal form NFC (so "é" typed as one character or as "e" plus an accent is
// one name), then lower case with full Unicode rules. Identical to NAME_KEY_SQL on the database side.
export const driverNameKey = (name) => cleanDriverName(name).normalize('NFC').toLowerCase();

// The same expression the database index uses (migrations/2026-11-04-issue-177-driver-name-unique.sql). Keep them in step: collapse
// whitespace, trim spaces, NFC, then lower case. The case step names the ICU collation "und-x-icu" on purpose: plain lower() follows
// the database's own locale, which under the C locale lowers only ASCII letters, so "Émile" and "émile" would get different keys
// there. With this collation every database gives the same answer. The migration checks that UTF8 and the collation are available.
export const NAME_KEY_SQL = (column) =>
  `lower((normalize(btrim(regexp_replace(${column}, '${WHITESPACE}', ' ', 'g'), ' '), NFC)) COLLATE "und-x-icu")`;

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

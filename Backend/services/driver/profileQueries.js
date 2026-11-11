import { findDriverByName, isNameConflict } from '../admin/driverName.js';

// A driver's own profile: full name, email and phone number. All SQL for the profile lives here.

// A refusal the driver can act on. `field` is the form field it belongs to (null when it is about the account), `code` a key under `profile.`.
export class ProfileError extends Error {
  constructor(status, code, field = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

const toProfile = (row) => ({ name: row.name, email: row.email, phoneNumber: row.phone_number ?? '' });

export const getOwnProfile = async (db, driverId) => {
  const { rows } = await db.query('SELECT name, email, phone_number FROM drivers WHERE id = $1', [driverId]);
  return rows[0] ? toProfile(rows[0]) : null;
};

const emailTakenByAnother = async (db, email, driverId) => {
  const { rows } = await db.query('SELECT 1 FROM drivers WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1', [email, driverId]);
  return rows.length > 0;
};

// The database refused at the last moment (two people saving the same name or email at once).
const asProfileError = (error) => {
  if (isNameConflict(error)) return new ProfileError(409, 'nameTaken', 'name');
  if (error?.code === '23505' && /drivers_email/.test(error.constraint ?? '')) return new ProfileError(409, 'emailTaken', 'email');
  return null;
};

// Saves the three fields of the driver `driverId` (the id comes from the verified token, never from the request). `values` come from parseProfile.
// The driver's row is locked while checking and saving, so two saves cannot interleave. Nothing is written when nothing changed.
// Returns { profile, changed } where `changed` lists the field names that were saved (names only, never the values).
export const saveOwnProfile = async (pool, driverId, values) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [current] } = await client.query('SELECT name, email, phone_number, enabled FROM drivers WHERE id = $1 FOR UPDATE', [driverId]);
    if (!current) throw new ProfileError(404, 'driverNotFound');
    if (!current.enabled) throw new ProfileError(403, 'accountDisabled');

    // Claims and weekly reports are matched to a driver by name (#177), and email is the sign-in, so neither may belong to two drivers.
    if (await findDriverByName(client, values.name, driverId)) throw new ProfileError(409, 'nameTaken', 'name');
    if (await emailTakenByAnother(client, values.email, driverId)) throw new ProfileError(409, 'emailTaken', 'email');

    const changed = [];
    if (values.name !== current.name) changed.push('name');
    if (values.email !== current.email) changed.push('email');
    if (values.phoneNumber !== (current.phone_number ?? '')) changed.push('phoneNumber');
    if (changed.length === 0) {
      await client.query('COMMIT');
      return { profile: toProfile(current), changed };
    }

    const { rows: [saved] } = await client.query(
      'UPDATE drivers SET name = $1, email = $2, phone_number = $3 WHERE id = $4 RETURNING name, email, phone_number',
      [values.name, values.email, values.phoneNumber, driverId]
    );
    await client.query('COMMIT');
    return { profile: toProfile(saved), changed };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw asProfileError(error) ?? error;
  } finally {
    client.release();
  }
};

import bcrypt from 'bcrypt';
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

// Two saves of the same email (in any letter case) at once would both pass the check below, so the check runs one at a time per email. The database
// index on lower(email) (2026-11-11-driver-contact-review.sql) is the last line of defence once every legacy duplicate is fixed.
export const EMAIL_LOCK_NAMESPACE = 424243;
const lockEmail = (client, email) => client.query('SELECT pg_advisory_xact_lock($1, hashtext(lower($2)))', [EMAIL_LOCK_NAMESPACE, email]);

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
// Changing the email (the sign-in) needs the driver's current password, so a stolen session alone cannot take the account over.
// Changing the email or phone also sets contact_changed_at: Everee and QuickBooks match people by exact email or phone, so a super admin must
// confirm the new details before this driver can be linked to a payroll record (see contactReview.js).
// Returns { profile, changed } where `changed` lists the field names that were saved (names only, never the values).
export const saveOwnProfile = async (pool, driverId, values, currentPassword = '', attempts = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [current] } = await client.query('SELECT name, email, phone_number, enabled, password FROM drivers WHERE id = $1 FOR UPDATE', [driverId]);
    if (!current) throw new ProfileError(404, 'driverNotFound');
    if (!current.enabled) throw new ProfileError(403, 'accountDisabled');

    const changed = [];
    if (values.name !== current.name) changed.push('name');
    if (values.email !== current.email) changed.push('email');
    if (values.phoneNumber !== (current.phone_number ?? '')) changed.push('phoneNumber');

    if (changed.includes('email')) {
      if (typeof currentPassword !== 'string' || !currentPassword) throw new ProfileError(400, 'passwordRequired', 'currentPassword');
      // Guesses are limited per driver; past the limit the password is not even compared (so a right guess cannot get through either).
      if (attempts && !(await attempts.allow())) throw new ProfileError(429, 'tooManyAttempts', 'currentPassword');
      // A refusal is a 403, not a 401: a 401 would make the app try to refresh the session.
      if (!current.password || !(await bcrypt.compare(currentPassword, current.password))) throw new ProfileError(403, 'passwordWrong', 'currentPassword');
      if (attempts) await attempts.passed();
      await lockEmail(client, values.email);
    }

    // Claims and weekly reports are matched to a driver by name (#177), and email is the sign-in, so neither may belong to two drivers.
    if (await findDriverByName(client, values.name, driverId)) throw new ProfileError(409, 'nameTaken', 'name');
    if (changed.includes('email') && await emailTakenByAnother(client, values.email, driverId)) throw new ProfileError(409, 'emailTaken', 'email');
    if (changed.length === 0) {
      await client.query('COMMIT');
      return { profile: toProfile(current), changed };
    }

    const contactChanged = changed.includes('email') || changed.includes('phoneNumber');
    const { rows: [saved] } = await client.query(
      `UPDATE drivers SET name = $1, email = $2, phone_number = $3, contact_changed_at = CASE WHEN $5 THEN now() ELSE contact_changed_at END
        WHERE id = $4 RETURNING name, email, phone_number`,
      [values.name, values.email, values.phoneNumber, driverId, contactChanged]
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

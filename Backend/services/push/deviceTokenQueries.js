import pool from '../../config/db.js';

export const USER_TYPES = { DRIVER: 'driver', ADMIN: 'admin' };

// A person rarely uses more than a couple of phones. Beyond this the least recently seen are switched off,
// so a runaway client cannot grow the table or make one sign-in fan out to many devices.
export const MAX_ACTIVE_DEVICES_PER_USER = 5;

// Registrations for the same person run one after another. Without this, two overlapping registrations each count
// the phones that were committed before they started, both see room for theirs, and both commit: six phones on.
// The lock is held until the transaction ends, so the second one starts from the first one's result. It is keyed
// by person (the class number is just this feature's own number space), so different people never wait.
const DEVICE_LOCK_CLASS = 220000;
const USER_TYPE_LOCK_ID = { [USER_TYPES.DRIVER]: 1, [USER_TYPES.ADMIN]: 2 };

// Registering and removing for one person take the same lock, so they are always handled one after the other.
const lockPerson = (client, userType, userId) =>
  client.query('SELECT pg_advisory_xact_lock($1, $2)', [DEVICE_LOCK_CLASS + USER_TYPE_LOCK_ID[userType], userId]);

// Removals are kept for a day. An access token lasts minutes, so an older removal could never refuse anything.
const REMOVAL_MEMORY = "interval '1 day'";

const deviceTokenQueries = {
  // Registers a phone for a person. A token belongs to one person at a time: if it was registered for someone
  // else (a different person signed in on the same phone), it moves to this person and is switched on again.
  register: async ({ userType, userId, token, platform, appVersion, issuedAt }, db = pool) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await lockPerson(client, userType, userId);
      // The page may have given up on this request (its timeout) and signed out, and the removal sent at sign-out may
      // already be here. A registration made with an access token issued at or before that removal belongs to the
      // finished sign-in, so it is refused. A later sign-in has a newer token and goes through. A token with no issue
      // time cannot be compared and is accepted as before.
      if (Number.isFinite(issuedAt)) {
        const { rowCount } = await client.query(
          `SELECT 1 FROM device_token_removals
            WHERE user_type = $1 AND user_id = $2 AND push_token = $3
              AND floor(extract(epoch FROM removed_at)) >= $4`,
          [userType, userId, token, issuedAt]
        );
        if (rowCount > 0) {
          await client.query('ROLLBACK');
          return { registered: false, reason: 'stale' };
        }
      }
      await client.query(
        `INSERT INTO device_tokens (user_type, user_id, push_token, platform, app_version)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (push_token) DO UPDATE
           SET user_type = EXCLUDED.user_type,
               user_id = EXCLUDED.user_id,
               platform = EXCLUDED.platform,
               app_version = EXCLUDED.app_version,
               last_seen_at = now(),
               revoked_at = NULL`,
        [userType, userId, token, platform, appVersion]
      );
      await client.query(
        `UPDATE device_tokens SET revoked_at = now()
          WHERE id IN (
            SELECT id FROM device_tokens
             WHERE user_type = $1 AND user_id = $2 AND revoked_at IS NULL
             ORDER BY last_seen_at DESC, id DESC
            OFFSET $3
          )`,
        [userType, userId, MAX_ACTIVE_DEVICES_PER_USER]
      );
      await client.query('COMMIT');
      return { registered: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  // Switches off a token, but only when it belongs to this person. Returns how many rows changed, so a token
  // that is not theirs looks the same as one that is already off (nothing is revealed about other people).
  // The removal is also remembered (even for a phone not registered yet, or owned by someone else now), so that a
  // registration of this person that is still on its way cannot undo it. It takes the same lock as registering.
  revoke: async ({ userType, userId, token }, db = pool) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await lockPerson(client, userType, userId);
      // clock_timestamp(), not now(): now() is the time the transaction started, before the wait for the lock.
      await client.query(
        `INSERT INTO device_token_removals (user_type, user_id, push_token, removed_at)
         VALUES ($1, $2, $3, clock_timestamp())
         ON CONFLICT (user_type, user_id, push_token) DO UPDATE SET removed_at = EXCLUDED.removed_at`,
        [userType, userId, token]
      );
      await client.query(`DELETE FROM device_token_removals WHERE removed_at < now() - ${REMOVAL_MEMORY}`);
      const { rowCount } = await client.query(
        `UPDATE device_tokens SET revoked_at = now()
          WHERE push_token = $1 AND user_type = $2 AND user_id = $3 AND revoked_at IS NULL`,
        [token, userType, userId]
      );
      await client.query('COMMIT');
      return rowCount;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },
};

export default deviceTokenQueries;

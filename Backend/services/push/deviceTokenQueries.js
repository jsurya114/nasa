import pool from '../../config/db.js';

export const USER_TYPES = { DRIVER: 'driver', ADMIN: 'admin' };

// A person rarely uses more than a couple of phones. Beyond this the least recently seen are switched off,
// so a runaway client cannot grow the table or make one sign-in fan out to many devices.
export const MAX_ACTIVE_DEVICES_PER_USER = 5;

const deviceTokenQueries = {
  // Registers a phone for a person. A token belongs to one person at a time: if it was registered for someone
  // else (a different person signed in on the same phone), it moves to this person and is switched on again.
  register: async ({ userType, userId, token, platform, appVersion }, db = pool) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
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
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  // Switches off a token, but only when it belongs to this person. Returns how many rows changed, so a token
  // that is not theirs looks the same as one that is already off (nothing is revealed about other people).
  revoke: async ({ userType, userId, token }, db = pool) => {
    const { rowCount } = await db.query(
      `UPDATE device_tokens SET revoked_at = now()
        WHERE push_token = $1 AND user_type = $2 AND user_id = $3 AND revoked_at IS NULL`,
      [token, userType, userId]
    );
    return rowCount;
  },
};

export default deviceTokenQueries;

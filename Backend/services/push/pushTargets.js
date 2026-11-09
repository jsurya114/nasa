import pool from '../../config/db.js';

// Who gets a notification is decided here, from the database. The app never says who should be notified.
// Every query returns [{ pushToken, language }] for active tokens only.

const DEFAULT_LANGUAGE = 'en';

const toRecipient = (row) => ({ pushToken: row.push_token, language: row.language || DEFAULT_LANGUAGE });

// Active phones of the given drivers. A driver who has been switched off gets nothing.
export const tokensForDrivers = async (driverIds, db = pool) => {
  if (driverIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT dt.push_token, d.preferred_language AS language
       FROM device_tokens dt
       JOIN drivers d ON d.id = dt.user_id
      WHERE dt.user_type = 'driver'
        AND dt.revoked_at IS NULL
        AND d.id = ANY($1::int[])
        AND d.enabled IS NOT FALSE`,
    [driverIds]
  );
  return rows.map(toRecipient);
};

// Driver names are unique, and "mark as paid" works by name.
export const tokensForDriverName = async (driverName, db = pool) => {
  const { rows } = await db.query(
    `SELECT dt.push_token, d.preferred_language AS language
       FROM device_tokens dt
       JOIN drivers d ON d.id = dt.user_id
      WHERE dt.user_type = 'driver'
        AND dt.revoked_at IS NULL
        AND d.name = $1
        AND d.enabled IS NOT FALSE`,
    [driverName]
  );
  return rows.map(toRecipient);
};

// Active admins who work in the driver's city, and every active super admin. Admins have no language setting.
export const tokensForAdminsOfDriver = async (driverId, db = pool) => {
  const { rows } = await db.query(
    `SELECT dt.push_token
       FROM device_tokens dt
       JOIN admin a ON a.id = dt.user_id
      WHERE dt.user_type = 'admin'
        AND dt.revoked_at IS NULL
        AND a.is_active IS NOT FALSE
        AND (
          a.role = 'superadmin'
          OR EXISTS (
            SELECT 1
              FROM admin_city_ref acr
              JOIN drivers d ON d.city_id = acr.city_id
             WHERE acr.admin_id = a.id AND d.id = $1
          )
        )`,
    [driverId]
  );
  return rows.map(toRecipient);
};

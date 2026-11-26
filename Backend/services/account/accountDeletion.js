import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import pool from '../../config/db.js';

// Account deletion (docs/ACCOUNT_DELETION.md). A person asks in the app; a super admin completes it, by hand, within
// COMPLETION_DAYS. Completing it:
//   - switches the account off and replaces its sign-in email and password, so nobody can sign in to it again;
//   - removes the phone number (drivers) and city access (admins), and switches off every registered phone for push;
//   - keeps the account row and its id, the name, deliveries, pay statements, payments, claims and history, which are
//     business and accounting records. Nothing is cascade-deleted.
// The completion period is NASA's own commitment, not a legal period (owner to confirm).

export const COMPLETION_DAYS = 30;
export const USER_TYPES = ['driver', 'admin'];

const fail = (code) => Object.assign(new Error(code), { code });
const placeholderEmail = (userType, userId) => `deleted-${userType}-${userId}@deleted.invalid`;
const unusablePassword = () => bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

const shape = (row) => (row ? {
  id: Number(row.id),
  status: row.status,
  requestedAt: row.requested_at,
  completedAt: row.completed_at,
  cancelledAt: row.cancelled_at,
  dueBy: new Date(new Date(row.requested_at).getTime() + COMPLETION_DAYS * 86400000).toISOString(),
} : null);

const activeSuperAdmins = async (db, exceptId) => (await db.query(
  `SELECT count(*)::int AS n FROM admin WHERE role = 'superadmin' AND is_active = true AND id <> $1`, [exceptId],
)).rows[0].n;

// The latest request of this person, or null.
export const getRequest = async (userType, userId, db = pool) => shape((await db.query(
  `SELECT * FROM account_deletion_requests WHERE user_type = $1 AND user_id = $2 ORDER BY requested_at DESC, id DESC LIMIT 1`,
  [userType, userId],
)).rows[0]);

// Opens a request (or returns the one already open). The last active super admin cannot ask: someone must stay able to
// run NASA, and their request would have no one to complete it.
export const requestDeletion = async (userType, userId, db = pool) => {
  if (!USER_TYPES.includes(userType)) throw fail('bad_request');
  if (userType === 'admin') {
    const me = (await db.query('SELECT role, is_active FROM admin WHERE id = $1', [userId])).rows[0];
    if (!me) throw fail('not_found');
    if (me.role === 'superadmin' && (await activeSuperAdmins(db, userId)) === 0) throw fail('last_super_admin');
  }
  await db.query(
    `INSERT INTO account_deletion_requests (user_type, user_id) VALUES ($1, $2)
     ON CONFLICT (user_type, user_id) WHERE status = 'requested' DO NOTHING`,
    [userType, userId],
  );
  return getRequest(userType, userId, db);
};

// Withdraws an open request. Returns the request as it now stands.
export const cancelRequest = async (userType, userId, db = pool) => {
  await db.query(
    `UPDATE account_deletion_requests SET status = 'cancelled', cancelled_at = now()
     WHERE user_type = $1 AND user_id = $2 AND status = 'requested'`,
    [userType, userId],
  );
  return getRequest(userType, userId, db);
};

// Open requests, oldest first, for the super admin's list. Shows who asked; nothing financial.
export const listOpen = async (db = pool) => (await db.query(
  `SELECT r.id, r.user_type, r.user_id, r.requested_at,
          COALESCE(d.name, a.name) AS name, COALESCE(d.email, a.email) AS email
     FROM account_deletion_requests r
     LEFT JOIN drivers d ON r.user_type = 'driver' AND d.id = r.user_id
     LEFT JOIN admin a ON r.user_type = 'admin' AND a.id = r.user_id
    WHERE r.status = 'requested'
    ORDER BY r.requested_at, r.id`,
)).rows.map((row) => ({
  id: Number(row.id), userType: row.user_type, userId: row.user_id, name: row.name, email: row.email,
  requestedAt: row.requested_at,
  dueBy: new Date(new Date(row.requested_at).getTime() + COMPLETION_DAYS * 86400000).toISOString(),
}));

// Completes one request, in one transaction. byAdminId is the super admin doing it; they cannot complete their own.
export const completeRequest = async (requestId, byAdminId, db = pool) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const request = (await client.query('SELECT * FROM account_deletion_requests WHERE id = $1 FOR UPDATE', [requestId])).rows[0];
    if (!request) throw fail('not_found');
    if (request.status !== 'requested') throw fail('not_open');
    const { user_type: userType, user_id: userId } = request;
    const password = await unusablePassword();

    if (userType === 'admin') {
      if (userId === byAdminId) throw fail('own_request');
      const target = (await client.query('SELECT id, role FROM admin WHERE id = $1 FOR UPDATE', [userId])).rows[0];
      if (!target) throw fail('not_found');
      // Lock every super admin row, so two completions at once cannot remove the last two together
      await client.query(`SELECT id FROM admin WHERE role = 'superadmin' ORDER BY id FOR UPDATE`);
      if (target.role === 'superadmin' && (await activeSuperAdmins(client, userId)) === 0) throw fail('last_super_admin');
      await client.query(
        `UPDATE admin SET email = $2, password = $3, is_active = false, can_use_invoices = false WHERE id = $1`,
        [userId, placeholderEmail('admin', userId), password],
      );
      await client.query('DELETE FROM admin_city_ref WHERE admin_id = $1', [userId]);
    } else {
      const target = (await client.query('SELECT id FROM drivers WHERE id = $1 FOR UPDATE', [userId])).rows[0];
      if (!target) throw fail('not_found');
      await client.query(
        `UPDATE drivers SET email = $2, password = $3, phone_number = NULL, enabled = false WHERE id = $1`,
        [userId, placeholderEmail('driver', userId), password],
      );
    }

    await client.query(
      `UPDATE device_tokens SET revoked_at = now() WHERE user_type = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [userType, userId],
    );
    await client.query(
      `UPDATE account_deletion_requests SET status = 'completed', completed_at = now(), completed_by = $2 WHERE id = $1`,
      [requestId, byAdminId],
    );
    await client.query('COMMIT');
    return { id: Number(requestId), userType, userId, status: 'completed' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

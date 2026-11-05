/**
 * Database access for the connector's sign-in records (issue #220). Only the mcp_oauth_* tables, plus one read of the
 * admin table to confirm the owner is still an active super admin. Every function takes `db` (a pool or a client), so
 * tests can run inside a rolled-back transaction. Codes and tokens are stored only as SHA-256 hashes.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');

const seconds = (n) => `${Math.max(0, Math.floor(n))} seconds`;

// The only accounts that may use the connector: an existing, active super admin.
export const ELIGIBLE_ADMIN_SQL = "a.is_active = true AND a.role = 'superadmin'";

export async function adminEligible(db, adminId) {
  const { rowCount } = await db.query(`SELECT 1 FROM admin a WHERE a.id = $1 AND ${ELIGIBLE_ADMIN_SQL}`, [adminId]);
  return rowCount === 1;
}

export async function findEligibleAdminByEmail(db, email) {
  const { rows } = await db.query(`SELECT a.id, a.password FROM admin a WHERE a.email = $1`, [email]);
  const row = rows[0];
  if (!row) return null;
  const { rowCount } = await db.query(`SELECT 1 FROM admin a WHERE a.id = $1 AND ${ELIGIBLE_ADMIN_SQL}`, [row.id]);
  return { id: row.id, password: row.password, eligible: rowCount === 1 };
}

// ---------- clients ----------
export async function getClientRow(db, clientId) {
  const { rows } = await db.query('SELECT client_id, client_name, redirect_uris FROM mcp_oauth_clients WHERE client_id = $1', [clientId]);
  return rows[0];
}

export async function countClients(db) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM mcp_oauth_clients');
  return rows[0].n;
}

// Clients that never completed a sign-in are removed after a day, so open registration cannot grow the table.
export async function pruneUnusedClients(db) {
  await db.query(`DELETE FROM mcp_oauth_clients c WHERE c.created_at < now() - interval '1 day'
    AND NOT EXISTS (SELECT 1 FROM mcp_oauth_grants g WHERE g.client_id = c.client_id)`);
}

export async function insertClient(db, { clientId, clientName, redirectUris }) {
  await db.query('INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)', [clientId, clientName, redirectUris]);
}

// ---------- pending sign-ins ----------
export async function createRequest(db, { clientId, redirectUri, codeChallenge, state, scope, resource, ttlSeconds }) {
  const id = newSecret();
  await db.query(
    `INSERT INTO mcp_oauth_requests (request_hash, client_id, redirect_uri, code_challenge, state, scope, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8::interval)`,
    [sha256(id), clientId, redirectUri, codeChallenge, state ?? null, scope, resource, seconds(ttlSeconds)]
  );
  return id;
}

export async function getRequest(db, id) {
  const { rows } = await db.query(
    `SELECT r.request_hash, r.client_id, r.redirect_uri, r.code_challenge, r.state, r.scope, r.resource, c.client_name
       FROM mcp_oauth_requests r JOIN mcp_oauth_clients c ON c.client_id = r.client_id
      WHERE r.request_hash = $1 AND r.expires_at > now()`,
    [sha256(id)]
  );
  return rows[0];
}

// Deletes the pending sign-in and returns it: a request can be used once, by whoever deletes it first.
export async function consumeRequest(db, id) {
  const { rows } = await db.query(
    `DELETE FROM mcp_oauth_requests WHERE request_hash = $1 AND expires_at > now()
     RETURNING request_hash, client_id, redirect_uri, code_challenge, state, scope, resource`,
    [sha256(id)]
  );
  return rows[0];
}

export async function recordFailedAttempt(db, id) {
  const { rows } = await db.query('UPDATE mcp_oauth_requests SET failed_attempts = failed_attempts + 1 WHERE request_hash = $1 RETURNING failed_attempts', [sha256(id)]);
  return rows[0]?.failed_attempts ?? Infinity;
}

// ---------- grants and tokens ----------
export async function createGrant(db, { adminId, clientId, scope, resource }) {
  const id = randomUUID();
  await db.query('INSERT INTO mcp_oauth_grants (id, admin_id, client_id, scope, resource) VALUES ($1, $2, $3, $4, $5)', [id, adminId, clientId, scope, resource]);
  return id;
}

export async function insertToken(db, { grantId, kind, ttlSeconds, codeChallenge = null, redirectUri = null }) {
  const raw = newSecret();
  await db.query(
    `INSERT INTO mcp_oauth_tokens (token_hash, grant_id, kind, expires_at, code_challenge, redirect_uri)
     VALUES ($1, $2, $3, now() + $4::interval, $5, $6)`,
    [sha256(raw), grantId, kind, seconds(ttlSeconds), codeChallenge, redirectUri]
  );
  return raw;
}

// A code or refresh token works once. Marks it used and returns its grant, or nothing if it was used, expired or unknown.
export async function useToken(db, raw, kind) {
  const { rows } = await db.query(
    `UPDATE mcp_oauth_tokens t SET used_at = now()
       FROM mcp_oauth_grants g
      WHERE t.token_hash = $1 AND t.kind = $2 AND t.used_at IS NULL AND t.expires_at > now()
        AND g.id = t.grant_id AND g.revoked_at IS NULL
      RETURNING t.grant_id, t.code_challenge, t.redirect_uri, g.admin_id, g.client_id, g.scope, g.resource, g.created_at`,
    [sha256(raw), kind]
  );
  return rows[0];
}

// Looks a token up without using it (for PKCE checks and for spotting a reused token).
export async function peekToken(db, raw, kind) {
  const { rows } = await db.query(
    `SELECT t.grant_id, t.code_challenge, t.used_at, t.expires_at > now() AS live, g.client_id, g.revoked_at
       FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id = t.grant_id
      WHERE t.token_hash = $1 AND t.kind = $2`,
    [sha256(raw), kind]
  );
  return rows[0];
}

export async function findAnyToken(db, raw) {
  const { rows } = await db.query(
    `SELECT t.grant_id, g.client_id FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id = t.grant_id
      WHERE t.token_hash = $1 AND t.kind IN ('access', 'refresh')`,
    [sha256(raw)]
  );
  return rows[0];
}

// The check made on every call to /mcp: a live access token, on a live grant, for an account that is still an active super admin.
export async function verifyAccess(db, raw) {
  const { rows } = await db.query(
    `SELECT extract(epoch FROM t.expires_at)::bigint AS expires_at, g.id AS grant_id, g.client_id, g.scope, g.resource, g.admin_id,
            (g.last_used_at IS NULL OR g.last_used_at < now() - interval '1 minute') AS stale
       FROM mcp_oauth_tokens t
       JOIN mcp_oauth_grants g ON g.id = t.grant_id
       JOIN admin a ON a.id = g.admin_id
      WHERE t.token_hash = $1 AND t.kind = 'access' AND t.expires_at > now()
        AND g.revoked_at IS NULL AND ${ELIGIBLE_ADMIN_SQL}`,
    [sha256(raw)]
  );
  return rows[0];
}

export async function touchGrant(db, grantId) {
  await db.query('UPDATE mcp_oauth_grants SET last_used_at = now() WHERE id = $1', [grantId]);
}

export async function revokeGrant(db, grantId, reason) {
  const { rowCount } = await db.query('UPDATE mcp_oauth_grants SET revoked_at = now(), revoke_reason = $2 WHERE id = $1 AND revoked_at IS NULL', [grantId, reason]);
  return rowCount;
}

export async function revokeGrantsForAdmin(db, adminId, reason) {
  const { rowCount } = await db.query('UPDATE mcp_oauth_grants SET revoked_at = now(), revoke_reason = $2 WHERE admin_id = $1 AND revoked_at IS NULL', [adminId, reason]);
  return rowCount;
}

export async function revokeAllGrants(db, reason) {
  const { rowCount } = await db.query('UPDATE mcp_oauth_grants SET revoked_at = now(), revoke_reason = $1 WHERE revoked_at IS NULL', [reason]);
  return rowCount;
}

export async function listActiveGrants(db) {
  const { rows } = await db.query(
    `SELECT g.id, g.admin_id, a.email, c.client_name, g.scope, g.created_at, g.last_used_at
       FROM mcp_oauth_grants g JOIN admin a ON a.id = g.admin_id JOIN mcp_oauth_clients c ON c.client_id = g.client_id
      WHERE g.revoked_at IS NULL ORDER BY g.created_at`
  );
  return rows;
}

// Housekeeping: removes records that can no longer be used. Called now and then, never on the hot path of /mcp.
export async function pruneExpired(db) {
  await db.query("DELETE FROM mcp_oauth_requests WHERE expires_at < now()");
  await db.query("DELETE FROM mcp_oauth_tokens WHERE expires_at < now() - interval '1 day'");
  await db.query("DELETE FROM mcp_oauth_grants WHERE revoked_at < now() - interval '90 days'");
  await pruneUnusedClients(db);
}

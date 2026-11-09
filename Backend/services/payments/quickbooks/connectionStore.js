import { createHash, randomBytes } from 'node:crypto';
import { decryptToken, encryptToken } from './tokenCrypto.js';
import { exchangeCode, refreshTokens, QuickbooksError } from './quickbooksClient.js';

// The QuickBooks connection record (quickbooks_connection): the company and its encrypted tokens. Access tokens last about an hour and the refresh token
// (about 100 days) is REPLACED on refresh, so a refresh happens under a row lock and both new tokens are saved in the same transaction. That is what
// stops two requests from each using the old refresh token.

const STATE_MINUTES = 10;
const REFRESH_EARLY_MS = 2 * 60 * 1000;
export const STATE_PATTERN = /^[0-9a-f]{64}$/;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// A pool has connect(); a client already in a transaction (tests) is used as it is, so callers work with either.
const inTransaction = async (db, fn) => {
  if (typeof db.connect !== 'function' || typeof db.release === 'function') return fn(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

// Starts a connect: a random state for the redirect, kept only as a hash and valid for ten minutes.
export const createConnectState = async (db, { adminId, environment }, now = new Date()) => {
  const state = randomBytes(32).toString('hex');
  await db.query('DELETE FROM quickbooks_connect_state WHERE expires_at < $1', [now]);
  await db.query('INSERT INTO quickbooks_connect_state (state_hash, admin_id, environment, expires_at) VALUES ($1, $2, $3, $4)',
    [sha256(state), adminId, environment, new Date(now.getTime() + STATE_MINUTES * 60_000)]);
  return state;
};

// Uses a state once (deleting it). Returns { adminId, environment } or null when it is unknown, used or too old.
export const consumeConnectState = async (db, state, now = new Date()) => {
  if (!STATE_PATTERN.test(String(state ?? ''))) return null;
  const { rows: [row] } = await db.query('DELETE FROM quickbooks_connect_state WHERE state_hash = $1 RETURNING admin_id, environment, expires_at', [sha256(state)]);
  if (!row || new Date(row.expires_at) < now) return null;
  return { adminId: row.admin_id, environment: row.environment };
};

const expiries = (answer, now) => ({
  accessExpiresAt: new Date(now.getTime() + Number(answer.expires_in ?? 3600) * 1000),
  refreshExpiresAt: new Date(now.getTime() + Number(answer.x_refresh_token_expires_in ?? 100 * 24 * 3600) * 1000),
});

// Finishes a connect: swaps the code QuickBooks sent back for tokens and stores them for this company. A different company replaces the old record
// (the vendor links of the old company then no longer match and are ignored by realm_id).
export const completeConnect = async (db, config, { code, realmId, adminId }, { fetchImpl, now = new Date() } = {}) => {
  if (!/^[0-9]{5,20}$/.test(String(realmId ?? ''))) throw new QuickbooksError('QuickBooks did not say which company was connected');
  const answer = await exchangeCode(config, code, { fetchImpl });
  const { accessExpiresAt, refreshExpiresAt } = expiries(answer, now);
  await db.query(
    `INSERT INTO quickbooks_connection (environment, realm_id, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at, connected_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (environment) DO UPDATE SET realm_id = EXCLUDED.realm_id, access_token_enc = EXCLUDED.access_token_enc, refresh_token_enc = EXCLUDED.refresh_token_enc,
       access_expires_at = EXCLUDED.access_expires_at, refresh_expires_at = EXCLUDED.refresh_expires_at, connected_by = EXCLUDED.connected_by, connected_at = now(), updated_at = now()`,
    [config.environment, realmId, encryptToken(answer.access_token, config.tokenKey), encryptToken(answer.refresh_token, config.tokenKey), accessExpiresAt, refreshExpiresAt, adminId]);
  return { environment: config.environment, realmId };
};

// What may be shown: whether a company is connected and when the connection needs attention. Never a token.
export const connectionSummary = async (db, config, now = new Date()) => {
  const { rows: [row] } = await db.query('SELECT realm_id, connected_at, refresh_expires_at FROM quickbooks_connection WHERE environment = $1', [config.environment]);
  if (!row) return { connected: false };
  const daysLeft = Math.floor((new Date(row.refresh_expires_at) - now) / 86_400_000);
  return { connected: new Date(row.refresh_expires_at) > now, realmId: row.realm_id, connectedAt: row.connected_at, refreshExpiresInDays: daysLeft, needsReconnect: daysLeft < 14 };
};

// The token to use now: the saved one, or a refreshed one if it is about to expire. Throws QuickbooksError when there is no connection or it has lapsed.
export const getAuth = async (db, config, { fetchImpl, now = new Date() } = {}) => inTransaction(db, async (tx) => {
  const { rows: [row] } = await tx.query('SELECT realm_id, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at FROM quickbooks_connection WHERE environment = $1 FOR UPDATE', [config.environment]);
  if (!row) throw new QuickbooksError('QuickBooks is not connected; connect it first');
  if (new Date(row.refresh_expires_at) <= now) throw new QuickbooksError('the QuickBooks connection has expired; reconnect QuickBooks');
  if (new Date(row.access_expires_at).getTime() - now.getTime() > REFRESH_EARLY_MS) {
    return { accessToken: decryptToken(row.access_token_enc, config.tokenKey), realmId: row.realm_id };
  }
  const answer = await refreshTokens(config, decryptToken(row.refresh_token_enc, config.tokenKey), { fetchImpl });
  const { accessExpiresAt, refreshExpiresAt } = expiries(answer, now);
  await tx.query(
    `UPDATE quickbooks_connection SET access_token_enc = $2, refresh_token_enc = $3, access_expires_at = $4, refresh_expires_at = $5, updated_at = now() WHERE environment = $1`,
    [config.environment, encryptToken(answer.access_token, config.tokenKey), encryptToken(answer.refresh_token, config.tokenKey), accessExpiresAt, refreshExpiresAt]);
  return { accessToken: answer.access_token, realmId: row.realm_id };
});

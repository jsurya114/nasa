/**
 * The separate, restricted database connection for reports (issue #220). It uses its own PostgreSQL login that can only read
 * the `reporting` views (see migration 2026-11-06-issue-220-reporting-views.sql). It never falls back to the application's
 * database login: without its own REPORTING_DB_* settings, reporting is simply off.
 *
 *   REPORTING_DB_HOST, REPORTING_DB_NAME, REPORTING_DB_USER, REPORTING_DB_PASSWORD   all required
 *   REPORTING_DB_PORT (default 5432), REPORTING_DB_SSL ("true" to use TLS and verify the server certificate),
 *   REPORTING_DB_SSL_CA (the database's CA certificate in PEM text, when it is not publicly trusted),
 *   REPORTING_DB_SSL_VERIFY ("false" only if the certificate cannot be verified; not recommended), REPORTING_DB_POOL_MAX (1 to 5, default 3),
 *   REPORTING_DB_TIMEOUT_MS (query time limit, 1000 to 30000, default 10000)
 *
 * Every report runs in a READ ONLY transaction with a statement time limit, on a small pool, so reporting cannot slow payroll
 * or change data even if a query were wrong. A cancelled request cancels its query and frees its connection.
 */
import pg from 'pg';

const clamp = (value, low, high, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback;
};

export function createReportingDb(env = process.env, { Pool = pg.Pool, Client = pg.Client } = {}) {
  const missing = ['REPORTING_DB_HOST', 'REPORTING_DB_NAME', 'REPORTING_DB_USER', 'REPORTING_DB_PASSWORD'].filter((key) => !env[key]);
  if (missing.length > 0) return { enabled: false, reason: `reporting database is not configured (missing ${missing.join(', ')})` };
  if (env.DB_USER && env.REPORTING_DB_USER === env.DB_USER) {
    return { enabled: false, reason: 'REPORTING_DB_USER must be a different, read-only login, not the application login' };
  }

  const timeoutMs = clamp(env.REPORTING_DB_TIMEOUT_MS, 1000, 30000, 10000);
  const settings = {
    host: env.REPORTING_DB_HOST,
    port: clamp(env.REPORTING_DB_PORT, 1, 65535, 5432),
    database: env.REPORTING_DB_NAME,
    user: env.REPORTING_DB_USER,
    password: env.REPORTING_DB_PASSWORD,
    // TLS checks the server's certificate by default. Switching the check off must be asked for by name (and is logged).
    ssl: env.REPORTING_DB_SSL === 'true'
      ? { rejectUnauthorized: env.REPORTING_DB_SSL_VERIFY !== 'false', ...(env.REPORTING_DB_SSL_CA ? { ca: env.REPORTING_DB_SSL_CA } : {}) }
      : undefined,
    connectionTimeoutMillis: 5000,
    application_name: 'nasa_insights',
    options: `-c default_transaction_read_only=on -c statement_timeout=${timeoutMs} -c idle_in_transaction_session_timeout=15000`,
  };
  const pool = new Pool({ ...settings, max: clamp(env.REPORTING_DB_POOL_MAX, 1, 5, 3), idleTimeoutMillis: 30000 });
  pool.on('error', () => {}); // an idle connection that drops is replaced on next use

  // Cancels a running query from a short-lived connection of its own. Using the pool would wait behind the very query it
  // is meant to stop. The same login may cancel only its own sessions.
  async function cancelBackend(pid) {
    const canceller = new Client(settings);
    canceller.on('error', () => {});
    try {
      await canceller.connect();
      await canceller.query('SELECT pg_cancel_backend($1)', [pid]);
    } catch {
      // The statement time limit still ends the query.
    } finally {
      await canceller.end().catch(() => {});
    }
  }

  // Runs `job` with `{ query }` inside one read-only transaction. `signal` cancels the running query.
  async function run(job, { signal } = {}) {
    if (signal?.aborted) throw new Error('The request was cancelled');
    const client = await pool.connect();
    let finished = false;
    let broken = false;
    const cancel = () => {
      if (!finished) cancelBackend(client.processID);
    };
    try {
      await client.query('BEGIN READ ONLY');
      signal?.addEventListener('abort', cancel, { once: true });
      const result = await job({ query: (sql, params) => client.query(sql, params) });
      await client.query('ROLLBACK');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => { broken = true; });
      if (signal?.aborted) throw new Error('The request was cancelled');
      throw error;
    } finally {
      finished = true;
      signal?.removeEventListener('abort', cancel);
      client.release(broken);
    }
  }

  return { enabled: true, run, close: () => pool.end(), timeoutMs };
}

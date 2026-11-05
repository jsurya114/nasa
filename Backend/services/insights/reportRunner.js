/**
 * Runs a report for the Insights page (issue #227): the same plain `(db, filters) -> result` functions the Claude connector uses, in a READ ONLY
 * transaction with a time limit. When the separate restricted reporting login is configured (REPORTING_DB_*), the report runs on it; otherwise on a
 * connection of the application's pool, still read only. Reports only SELECT either way. A cancelled request cancels its query and frees the connection.
 */
import { createReportingDb } from '../reporting/reportingDb.js';

export const REPORT_TIMEOUT_MS = 10000;

export function createReportRunner({ pool, env = process.env, createReporting = createReportingDb, timeoutMs = REPORT_TIMEOUT_MS } = {}) {
  const reporting = createReporting(env);

  async function runOnPool(job, { signal } = {}) {
    if (signal?.aborted) throw new Error('The request was cancelled');
    const client = await pool.connect();
    let finished = false;
    let broken = false;
    // Cancels the running query from another pooled connection; the statement time limit still ends it if that fails.
    const cancel = () => {
      if (!finished) pool.query('SELECT pg_cancel_backend($1)', [client.processID]).catch(() => {});
    };
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
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

  return {
    restrictedLogin: reporting.enabled === true,
    run: (job, options) => (reporting.enabled ? reporting.run(job, options) : runOnPool(job, options)),
  };
}

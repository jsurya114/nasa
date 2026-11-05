/**
 * Runs a report for the Insights page (issue #227): the same plain `(db, filters) -> result` functions the Claude connector uses, in a READ ONLY
 * transaction with a time limit. When the separate restricted reporting login is configured (REPORTING_DB_*), the report runs on it; otherwise on the
 * application's database login, still read only. Reports only SELECT either way.
 *
 * On the application's login a report gets its OWN connection, never one borrowed from the shared pool, and a request the caller drops cancels its
 * query with a statement that can only ever match that connection: the process id AND a random name set for this request only. So a cancel that
 * arrives late can never reach another request's query, even if the process id were reused. At most MAX_CONCURRENT reports run at once.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createReportingDb } from '../reporting/reportingDb.js';

export const REPORT_TIMEOUT_MS = 10000;
export const MAX_CONCURRENT = 3;

// Cancels the query of the connection called `name`, from a short-lived connection of its own. The statement matches the process id and the name
// together, so it does nothing if that connection has already ended, even if the process id now belongs to another session.
export async function cancelReportBackend(pool, pid, name) {
  const canceller = new pg.Client({ ...pool.options, application_name: 'nasa_insights_cancel' });
  canceller.on('error', () => {});
  try {
    await canceller.connect();
    await canceller.query('SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid = $1 AND application_name = $2', [pid, name]);
  } catch {
    // The statement time limit still ends the query.
  } finally {
    await canceller.end().catch(() => {});
  }
}

export function createReportRunner({ pool, env = process.env, createReporting = createReportingDb, timeoutMs = REPORT_TIMEOUT_MS, maxConcurrent = MAX_CONCURRENT } = {}) {
  const reporting = createReporting(env);

  // A small queue: reports beyond the limit wait their turn, so reporting cannot take the database from payroll.
  let active = 0;
  const waiting = [];
  const acquire = () => {
    if (active < maxConcurrent) { active += 1; return Promise.resolve(); }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const free = () => {
    const next = waiting.shift();
    if (next) next(); else active -= 1;
  };

  async function runOnApplicationLogin(job, { signal } = {}) {
    if (signal?.aborted) throw new Error('The request was cancelled');
    await acquire();
    let finished = false;
    let client = null;
    try {
      if (signal?.aborted) throw new Error('The request was cancelled');
      const name = `nasa_insights_${randomBytes(6).toString('hex')}`;
      client = new pg.Client({ ...pool.options, application_name: name });
      client.on('error', () => {});
      await client.connect();
      const cancel = () => { if (!finished) cancelReportBackend(pool, client.processID, name); };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        await client.query('BEGIN READ ONLY');
        await client.query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
        const result = await job({ query: (sql, params) => client.query(sql, params) });
        await client.query('ROLLBACK');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (signal?.aborted) throw new Error('The request was cancelled');
        throw error;
      } finally {
        finished = true;
        signal?.removeEventListener('abort', cancel);
      }
    } finally {
      if (client) await client.end().catch(() => {});
      free();
    }
  }

  return {
    restrictedLogin: reporting.enabled === true,
    run: (job, options) => (reporting.enabled ? reporting.run(job, options) : runOnApplicationLogin(job, options)),
  };
}

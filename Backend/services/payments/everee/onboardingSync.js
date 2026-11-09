import { readEvereeConfig, driverOnboardingGate } from './evereeConfig.js';
import { createEvereeClient, EvereeError } from './evereeClient.js';
import { recoverOnboarding } from './driverOnboarding.js';

const ABSENT_MAX_SECONDS = 6 * 3600; // the longest wait between two looks at a worker Everee does not know

// Bounded, read-only provider reconciliation. A session lock serializes all server instances;
// retry timing survives restarts. No session URL, profile, worker create or payment is issued here.
export const syncOnboarding = async (pool, deps = {}) => {
  const env = deps.env ?? process.env;
  const config = readEvereeConfig(env);
  const enabled = env.EVEREE_ONBOARDING_SYNC_ENABLED === 'true' && driverOnboardingGate(config, env).enabled;
  if (!enabled) return { checked: 0, reason: 'switched_off' };
  const db = await pool.connect();
  const key = `${config.environment}:${config.tenantId}`;
  let locked = false;
  try {
    locked = (await db.query('SELECT pg_try_advisory_lock(242243, hashtext($1)) AS locked', [key])).rows[0].locked;
    if (!locked) return { checked: 0, reason: 'already_running' };
    await db.query('INSERT INTO everee_onboarding_job (environment, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [config.environment, config.tenantId]);
    const job = (await db.query('SELECT retry_at > now() AS cooling FROM everee_onboarding_job WHERE environment = $1 AND tenant_id = $2', [config.environment, config.tenantId])).rows[0];
    if (job.cooling) return { checked: 0, reason: 'backoff' };
    await db.query(`INSERT INTO everee_onboarding_sync (driver_id, environment, tenant_id)
      SELECT d.id, $1, $2 FROM drivers d
      WHERE d.enabled AND d.driver_type = 'LOCAL' AND d.agreement_signed AND (
        EXISTS (SELECT 1 FROM everee_workers w WHERE w.driver_id = d.id AND w.environment = $1 AND w.tenant_id = $2 AND w.unlinked_at IS NULL AND NOT w.onboarding_complete)
        OR EXISTS (SELECT 1 FROM everee_onboarding o WHERE o.driver_id = d.id AND o.environment = $1 AND o.tenant_id = $2 AND o.state IN ('creating', 'verifying', 'in_progress')))
      ON CONFLICT DO NOTHING`, [config.environment, config.tenantId]);
    const limit = Math.min(25, Math.max(1, Number.isInteger(deps.limit) ? deps.limit : 10));
    const { rows } = await db.query(`SELECT s.driver_id, s.failures FROM everee_onboarding_sync s JOIN drivers d ON d.id = s.driver_id
      WHERE s.environment = $1 AND s.tenant_id = $2 AND s.next_check_at <= now()
        AND d.enabled AND d.driver_type = 'LOCAL' AND d.agreement_signed
        AND (EXISTS (SELECT 1 FROM everee_workers w WHERE w.driver_id = d.id AND w.environment = $1 AND w.tenant_id = $2 AND w.unlinked_at IS NULL AND NOT w.onboarding_complete)
          OR EXISTS (SELECT 1 FROM everee_onboarding o WHERE o.driver_id = d.id AND o.environment = $1 AND o.tenant_id = $2 AND o.state IN ('creating', 'verifying', 'in_progress') AND (o.lease_until IS NULL OR o.lease_until <= now())
            AND NOT EXISTS (SELECT 1 FROM everee_workers w WHERE w.driver_id = d.id AND w.environment = $1 AND w.unlinked_at IS NULL)))
      ORDER BY s.next_check_at, s.driver_id LIMIT $3`, [config.environment, config.tenantId, limit]);
    let pause = null;
    const raw = deps.client ?? createEvereeClient(config, { timeoutMs: 5000 });
    // Observe quota on successes too. Stop BEFORE the next call when a response exhausts the quota.
    const client = Object.fromEntries(['getWorker', 'searchWorkers'].map((method) => [method, async (...args) => {
      if (pause !== null) throw new EvereeError('waiting for provider quota', { status: 429, retryAfterSeconds: pause });
      try {
        const answer = await raw[method](...args);
        if (answer.rateLimit?.remaining === 0) pause = Math.max(1, answer.rateLimit.resetSeconds ?? 5);
        return answer;
      } catch (error) {
        if (error instanceof EvereeError && [401, 403, 429].includes(error.status)) pause = Math.max(1, error.retryAfterSeconds ?? (error.status === 429 ? 60 : 900));
        throw error;
      }
    }]));
    const started = Date.now();
    let checked = 0;
    for (const row of rows) {
      if (pause !== null || Date.now() - started > 35000) break;
      let outcome;
      try { outcome = (await recoverOnboarding(pool, row.driver_id, { env, client })).outcome; }
      catch { outcome = 'unavailable'; } // no provider payload or personal details in logs/state
      const failed = outcome === 'unavailable';
      // A worker Everee does not know (the driver pressed Start and never came back) is asked about less and less often, so it cannot keep using the quota.
      const absent = outcome === 'not_found';
      const failures = failed || absent ? Math.min(row.failures + 1, 10) : 0;
      let wait = 300;
      if (failed) wait = Math.min(3600, 60 * 2 ** failures) + Math.floor(Math.random() * 30);
      else if (absent) wait = Math.min(ABSENT_MAX_SECONDS, 300 * 2 ** failures);
      if (pause !== null) wait = pause;
      await db.query(`UPDATE everee_onboarding_sync SET attempted_at = now(), failures = $4,
        next_check_at = now() + make_interval(secs => $5) WHERE driver_id = $1 AND environment = $2 AND tenant_id = $3`, [row.driver_id, config.environment, config.tenantId, failures, wait]);
      checked += 1;
    }
    if (pause !== null) await db.query('UPDATE everee_onboarding_job SET retry_at = now() + make_interval(secs => $3) WHERE environment = $1 AND tenant_id = $2', [config.environment, config.tenantId, pause]);
    return { checked, reason: pause !== null ? 'provider_backoff' : 'checked' };
  } finally {
    try { if (locked) await db.query('SELECT pg_advisory_unlock(242243, hashtext($1))', [key]); }
    finally { db.release(); }
  }
};

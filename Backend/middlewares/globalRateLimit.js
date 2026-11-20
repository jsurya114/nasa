import logger from '../utils/logger.js';

// The global per-address limit applied to every request. Production always uses the default.
export const GLOBAL_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_GLOBAL_MAX = 1000;
// A staging load test sends all its traffic from one load generator, which is one address. The override lets that
// address make more requests, but never more than this, and only on a server that says it is staging.
export const STAGING_GLOBAL_MAX_CEILING = 100000;

/**
 * How many requests one address may make per window.
 *
 * The override needs BOTH settings, so production cannot pick it up by accident:
 *  - NASA_ENVIRONMENT exactly "staging"
 *  - STAGING_GLOBAL_RATE_LIMIT_MAX a whole number between DEFAULT_GLOBAL_MAX and STAGING_GLOBAL_MAX_CEILING
 * Anything else (missing, malformed, out of range, or a server that is not staging) gives the default.
 */
export function globalRateLimitMax(env = process.env) {
  const raw = env.STAGING_GLOBAL_RATE_LIMIT_MAX;
  if (raw === undefined || raw === '') return { max: DEFAULT_GLOBAL_MAX, override: false };
  if (env.NASA_ENVIRONMENT !== 'staging') {
    return { max: DEFAULT_GLOBAL_MAX, override: false, ignored: 'STAGING_GLOBAL_RATE_LIMIT_MAX is ignored: NASA_ENVIRONMENT is not "staging"' };
  }
  const text = String(raw).trim();
  const value = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value) || value < DEFAULT_GLOBAL_MAX || value > STAGING_GLOBAL_MAX_CEILING) {
    return { max: DEFAULT_GLOBAL_MAX, override: false, ignored: `STAGING_GLOBAL_RATE_LIMIT_MAX must be a whole number from ${DEFAULT_GLOBAL_MAX} to ${STAGING_GLOBAL_MAX_CEILING}` };
  }
  return { max: value, override: true };
}

// The options for the global rateLimit middleware, with one start-up log line when the default is not used.
export function globalRateLimitOptions(env = process.env, log = logger) {
  const { max, override, ignored } = globalRateLimitMax(env);
  if (ignored) log.warn(ignored);
  if (override) log.warn('Staging global rate limit in use', { max, windowMinutes: GLOBAL_WINDOW_MS / 60000 });
  return { windowMs: GLOBAL_WINDOW_MS, max };
}

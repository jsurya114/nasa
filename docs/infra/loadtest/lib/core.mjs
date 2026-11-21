// Pure parts of the NASA load test: response checks, the recorder and the verdict. No network here, so the failure
// fixtures in ../test can exercise every rule directly.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const positiveId = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0;

// What a successful body looks like for each endpoint. A 2xx with any other body counts as an error.
export const VALIDATORS = {
  driverLogin: (b) => isObject(b) && typeof b.accessToken === 'string' && b.accessToken.length > 20 && isObject(b.driver) && positiveId(b.driver.id),
  adminLogin: (b) => isObject(b) && typeof b.accessToken === 'string' && b.accessToken.length > 20,
  successData: (b) => isObject(b) && b.success === true && 'data' in b,
  successProfile: (b) => isObject(b) && b.success === true && isObject(b.profile),
  array: (b) => Array.isArray(b),
  statements: (b) => isObject(b) && Array.isArray(b.statements),
  object: (b) => isObject(b) && b.success !== false && !('errors' in b),
  health: (b) => isObject(b) && b.status === 'ok',
};

// Each kind of failure is counted separately so the report says WHY a run failed, not only that it did.
export function classify({ status, body, validator, timedOut = false, networkError = false }) {
  if (timedOut) return 'timeout';
  if (networkError) return 'network';
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (!(status >= 200 && status < 300)) return 'http';
  if (body === undefined) return 'invalid_body';
  const check = VALIDATORS[validator];
  if (!check) return 'invalid_body';
  return check(body) ? 'ok' : 'invalid_body';
}

export function createRecorder() {
  const endpoints = new Map();
  return {
    record(name, ms, status, outcome) {
      let s = endpoints.get(name);
      if (!s) endpoints.set(name, (s = { ok: [], all: 0, outcomes: {}, statuses: {} }));
      s.all += 1;
      s.outcomes[outcome] = (s.outcomes[outcome] || 0) + 1;
      s.statuses[status] = (s.statuses[status] || 0) + 1;
      if (outcome === 'ok') s.ok.push(ms);
    },
    endpoints,
  };
}

export const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null);

export function summarise(recorder) {
  const rows = {};
  const totals = { requests: 0, ok: 0, outcomes: {} };
  for (const [name, s] of [...recorder.endpoints].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...s.ok].sort((a, b) => a - b);
    const r = (v) => (v === null ? null : Math.round(v));
    rows[name] = { requests: s.all, ok: s.ok.length, p50: r(percentile(sorted, 50)), p95: r(percentile(sorted, 95)), p99: r(percentile(sorted, 99)), max: r(sorted.at(-1) ?? null), outcomes: s.outcomes, statuses: s.statuses };
    totals.requests += s.all;
    totals.ok += s.ok.length;
    for (const [k, v] of Object.entries(s.outcomes)) totals.outcomes[k] = (totals.outcomes[k] || 0) + v;
  }
  return { rows, totals };
}

/**
 * The verdict. Every rule must hold; the reasons list says which ones did not.
 *  plan: { expectedLogins, endpoints: [{ name, p95Ms, minOk }], minRequests, maxErrorRate, completed }
 */
export function verdict(summary, plan, { successfulLogins }) {
  const reasons = [];
  const { rows, totals } = summary;
  if (!plan.completed) reasons.push('the run did not finish (interrupted or crashed)');
  if (successfulLogins !== plan.expectedLogins) reasons.push(`successful logins ${successfulLogins} of ${plan.expectedLogins}`);
  for (const ep of plan.endpoints) {
    const row = rows[ep.name];
    const ok = row?.ok ?? 0;
    if (ok < ep.minOk) reasons.push(`${ep.name}: ${ok} successful responses, needs at least ${ep.minOk}`);
    else if (ep.p95Ms && row.p95 > ep.p95Ms) reasons.push(`${ep.name}: p95 ${row.p95} ms above ${ep.p95Ms} ms`);
  }
  const unplanned = Object.keys(rows).filter((n) => !plan.endpoints.some((e) => e.name === n) && !n.startsWith('login '));
  if (unplanned.length) reasons.push(`requests to endpoints outside the plan: ${unplanned.join(', ')}`);
  if (totals.requests < plan.minRequests) reasons.push(`only ${totals.requests} requests, the workload needed at least ${plan.minRequests}`);
  const errors = totals.requests - totals.ok;
  const errorRate = totals.requests ? errors / totals.requests : 1;
  if (errorRate > plan.maxErrorRate) reasons.push(`error rate ${(errorRate * 100).toFixed(2)}% above ${(plan.maxErrorRate * 100).toFixed(2)}%`);
  for (const zeroTolerance of ['rate_limited', 'timeout']) {
    if (totals.outcomes[zeroTolerance]) reasons.push(`${totals.outcomes[zeroTolerance]} ${zeroTolerance} responses (none allowed)`);
  }
  return { pass: reasons.length === 0, reasons, requests: totals.requests, ok: totals.ok, errorRate: +errorRate.toFixed(4), successfulLogins, expectedLogins: plan.expectedLogins };
}

// Expected request count for a closed workload: each active user makes one request per (response time + think time).
// Responses are taken as zero here, so this is an upper bound; the plan asks for a share of it (default 70%).
export function expectedRequests({ users, durationS, thinkMinS, thinkMaxS }) {
  const meanThink = (thinkMinS + thinkMaxS) / 2;
  return Math.floor(users * (durationS / Math.max(meanThink, 0.001)));
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith('--')) throw new Error(`unexpected argument ${x}`);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[x.slice(2)] = next; i++; } else out[x.slice(2)] = true;
  }
  return out;
}

export function numberArg(args, name, fallback, { min = 0, integer = false } = {}) {
  const raw = args[name] ?? fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || (integer && !Number.isInteger(v))) throw new Error(`--${name} must be ${integer ? 'a whole number' : 'a number'} of at least ${min}`);
  return v;
}

// Accounts: distinct emails, a password each, and enough of them that no two virtual users share one.
export function checkAccounts(list, needed, label) {
  if (!Array.isArray(list)) throw new Error(`${label}: must be a JSON array`);
  if (list.length < needed) throw new Error(`${label}: ${needed} accounts needed, ${list.length} given (each virtual user needs its own)`);
  const emails = new Set();
  for (const a of list.slice(0, needed)) {
    if (!isObject(a) || typeof a.email !== 'string' || !a.email || typeof a.password !== 'string' || !a.password) throw new Error(`${label}: every account needs an email and a password`);
    const key = a.email.toLowerCase();
    if (emails.has(key)) throw new Error(`${label}: duplicate account ${key}`);
    emails.add(key);
  }
  return list.slice(0, needed);
}

// Every nasaroutes.com name is production except this one staging name, if it is ever created.
export const PRODUCTION_HOST = /(^|\.)nasaroutes\.com\.?$/i;
export const ALLOWED_STAGING_HOST = 'api-staging.nasaroutes.com';
export function assertNotProduction(base) {
  const host = new URL(base).hostname.toLowerCase();
  if (PRODUCTION_HOST.test(host) && host !== ALLOWED_STAGING_HOST) throw new Error(`refusing to load-test ${host}: that is production`);
  return host;
}

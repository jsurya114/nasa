#!/usr/bin/env node
// Load test: a day of driver-app traffic. Zero dependencies (Node 20+).
//
//   node loadtest/driver-day.mjs --base https://staging-api.example.com --users loadtest/users.json \
//        --vus 300 --ramp 120 --duration 600 --out report.json
//
// Safety: refuses to run against the production host. Run it against staging (or a copy of production data) only,
// ideally from a separate machine in the same region, so the test machine is not the bottleneck.
// By default it only READS. Add --writes to also post availability (changes test accounts' data).

import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => {
  if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return a;
}, []));

const BASE = String(args.base || '').replace(/\/+$/, '');
const VUS = Number(args.vus || 300);
const RAMP_S = Number(args.ramp || 120);
const DURATION_S = Number(args.duration || 600);
const THINK_MIN = Number(args['think-min'] || 3);
const THINK_MAX = Number(args['think-max'] || 12);
const WRITES = Boolean(args.writes);
const P95_LIMIT_MS = Number(args['p95-ms'] || 800);
const ERROR_LIMIT = Number(args['error-rate'] || 0.01);
const TIMEZONE = args.timezone || 'America/Chicago';

if (!BASE || !args.users) {
  console.error('Usage: node driver-day.mjs --base <url> --users <users.json> [--vus 300 --ramp 120 --duration 600 --writes --out report.json]');
  process.exit(2);
}
const PRODUCTION = /(^|\.)nasaroutes\.com$/i;
const host = new URL(BASE).hostname;
if (PRODUCTION.test(host) && !args['i-know-this-is-production']) {
  console.error(`Refusing to load-test ${host}: that is production. Use a staging host.`);
  process.exit(2);
}

const pool = JSON.parse(readFileSync(args.users, 'utf8')); // [{ "email": "...", "password": "..." }, ...]
if (!Array.isArray(pool) || pool.length === 0) throw new Error('users file must be a non-empty JSON array');
if (pool.length < VUS) console.warn(`Only ${pool.length} test accounts for ${VUS} users: accounts will be shared (more logins per account than real life).`);

const stats = new Map(); // endpoint -> { ms: [], codes: Map, errors }
const rec = (name, ms, code, error) => {
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { ms: [], codes: new Map(), errors: 0 }));
  s.ms.push(ms);
  s.codes.set(code, (s.codes.get(code) || 0) + 1);
  if (error || code >= 500 || code === 0 || code === 429) s.errors++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

async function call(name, path, { method = 'GET', token, body } = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json().catch(() => null);
    rec(name, performance.now() - t0, res.status, false);
    return { status: res.status, json };
  } catch {
    rec(name, performance.now() - t0, 0, true);
    return { status: 0, json: null };
  }
}

// What a driver does in a session, weighted by how often (a guess: adjust from real access logs).
const ACTIONS = [
  { w: 30, run: (c) => call('GET /driver/availability', '/driver/availability', c) },
  { w: 25, run: (c) => call('GET /driver/profile', '/driver/profile', c) },
  { w: 20, run: (c) => call('GET /driver/deliveries/:id', `/driver/deliveries/${c.driverId}`, c) },
  { w: 15, run: (c) => call('GET /driver/payroll/statements', '/driver/payroll/statements', c) },
  { w: 10, run: (c) => call('GET /driver/payroll/balances', '/driver/payroll/balances', c) },
];
if (WRITES) ACTIONS.push({ w: 5, run: (c) => call('POST /driver/availability', '/driver/availability', { ...c, method: 'POST', body: { availability: [] } }) });
const TOTAL_W = ACTIONS.reduce((s, a) => s + a.w, 0);
const pick = () => { let r = Math.random() * TOTAL_W; for (const a of ACTIONS) if ((r -= a.w) < 0) return a; return ACTIONS[0]; };

const endAt = Date.now() + (RAMP_S + DURATION_S) * 1000;
let active = 0;

async function vu(i) {
  await sleep((i / VUS) * RAMP_S * 1000); // spread the logins over the ramp-up
  const account = pool[i % pool.length];
  const login = await call('POST /driver/login', '/driver/login', { method: 'POST', body: { email: account.email, password: account.password, timezone: TIMEZONE } });
  if (login.status !== 200 || !login.json?.accessToken) return;
  const ctx = { token: login.json.accessToken, driverId: login.json.driver?.id };
  active++;
  while (Date.now() < endAt) {
    await pick().run(ctx);
    await sleep(rnd(THINK_MIN, THINK_MAX) * 1000);
  }
  active--;
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
function summary() {
  const rows = {};
  let all = 0, bad = 0;
  for (const [name, s] of [...stats].sort()) {
    const sorted = [...s.ms].sort((a, b) => a - b);
    rows[name] = { count: s.ms.length, errors: s.errors, p50: +pct(sorted, 50).toFixed(0), p95: +pct(sorted, 95).toFixed(0), p99: +pct(sorted, 99).toFixed(0), max: +(sorted.at(-1) || 0).toFixed(0), codes: Object.fromEntries(s.codes) };
    all += s.ms.length; bad += s.errors;
  }
  return { rows, all, bad };
}

const ticker = setInterval(() => {
  const { all, bad } = summary();
  console.log(`[${new Date().toISOString().slice(11, 19)}] users active ${active}/${VUS}  requests ${all}  errors ${bad}`);
}, 10_000);

await Promise.all(Array.from({ length: VUS }, (_, i) => vu(i)));
clearInterval(ticker);

const { rows, all, bad } = summary();
console.table(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { count: v.count, errors: v.errors, 'p50 ms': v.p50, 'p95 ms': v.p95, 'p99 ms': v.p99, 'max ms': v.max }])));
const errorRate = all ? bad / all : 1;
const worstP95 = Math.max(0, ...Object.entries(rows).filter(([k]) => k !== 'POST /driver/login').map(([, v]) => v.p95));
const verdict = { requests: all, errorRate: +errorRate.toFixed(4), worstP95Ms: worstP95, pass: all > 0 && errorRate <= ERROR_LIMIT && worstP95 <= P95_LIMIT_MS };
console.log(JSON.stringify(verdict));
if (args.out) writeFileSync(args.out, JSON.stringify({ args: { base: BASE, vus: VUS, ramp: RAMP_S, duration: DURATION_S, writes: WRITES }, verdict, rows }, null, 2));
process.exit(verdict.pass ? 0 : 1);

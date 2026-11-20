#!/usr/bin/env node
// NASA staging load test. Zero dependencies (Node 20+). Read docs/infra/loadtest/README.md first.
//
//   node nasa-load.mjs --base https://<staging> --drivers drivers.json --admins admins.json \
//        --driver-vus 25 --admin-vus 2 --ramp 60 --duration 600 --stage 25-drivers --out results/25.json
//
// Optional: --upload weekly.xlsx (sent once by the first admin halfway through the run), --workload workload.json,
// --min-share 0.7 (share of the ideal request count that must be reached), --max-error-rate 0.01, --timeout-ms 15000.
// Exit code: 0 pass, 1 fail, 2 refused to start. Never point it at production: it refuses nasaroutes.com hosts.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNotProduction, checkAccounts, classify, createRecorder, expectedRequests, numberArg, parseArgs, summarise, verdict } from './lib/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TIMEZONE = 'America/Chicago';

function fail(msg) {
  console.error(`Refusing to start: ${msg}`);
  process.exit(2);
}

let args, BASE, DRIVER_VUS, ADMIN_VUS, RAMP_S, DURATION_S, TIMEOUT_MS, MIN_SHARE, MAX_ERROR_RATE, workload, drivers, admins;
try {
  args = parseArgs(process.argv.slice(2));
  BASE = String(args.base || '').replace(/\/+$/, '');
  if (!BASE) throw new Error('--base is required');
  assertNotProduction(BASE);
  DRIVER_VUS = numberArg(args, 'driver-vus', 0, { integer: true });
  ADMIN_VUS = numberArg(args, 'admin-vus', 0, { integer: true });
  if (DRIVER_VUS + ADMIN_VUS === 0) throw new Error('at least one of --driver-vus and --admin-vus must be above 0');
  RAMP_S = numberArg(args, 'ramp', 60);
  DURATION_S = numberArg(args, 'duration', 600, { min: 0.05 });
  TIMEOUT_MS = numberArg(args, 'timeout-ms', 15000, { min: 100 });
  MIN_SHARE = numberArg(args, 'min-share', 0.7);
  MAX_ERROR_RATE = numberArg(args, 'max-error-rate', 0.01);
  workload = JSON.parse(readFileSync(args.workload || `${here}/workload.json`, 'utf8'));
  if (args['think-scale']) {
    const k = numberArg(args, 'think-scale', 1, { min: 0.0001 });
    for (const role of ['driver', 'admin']) workload[role].thinkSeconds = workload[role].thinkSeconds.map((s) => s * k);
  }
  drivers = DRIVER_VUS ? checkAccounts(JSON.parse(readFileSync(args.drivers || '', 'utf8')), DRIVER_VUS, 'drivers') : [];
  admins = ADMIN_VUS || args.upload ? checkAccounts(JSON.parse(readFileSync(args.admins || '', 'utf8')), Math.max(ADMIN_VUS, 1), 'admins') : [];
} catch (error) {
  fail(error.message);
}

// The last 28 days in the drivers' time zone, so the date-range endpoints read a realistic window.
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const DATES = { to: ymd(new Date()), from: ymd(new Date(Date.now() - 27 * 86400000)) };
const fill = (path, ctx) => path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(ctx[k] ?? DATES[k] ?? ''));

const recorder = createRecorder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

async function call(name, path, validator, { method = 'GET', token, json, form } = {}) {
  const t0 = performance.now();
  let status = 0, body, timedOut = false, networkError = false;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: json ? JSON.stringify(json) : form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = undefined; }
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') timedOut = true; else networkError = true;
  }
  const outcome = classify({ status, body, validator, timedOut, networkError });
  recorder.record(name, performance.now() - t0, status, outcome);
  return { outcome, body };
}

function picker(endpoints) {
  const total = endpoints.reduce((s, e) => s + e.weight, 0);
  return () => { let r = Math.random() * total; for (const e of endpoints) if ((r -= e.weight) < 0) return e; return endpoints.at(-1); };
}

let successfulLogins = 0;
const active = { driver: 0, admin: 0 };
const startAt = Date.now();
const endAt = startAt + (RAMP_S + DURATION_S) * 1000;

async function user(role, index, count, account) {
  await sleep(count > 1 ? (index / count) * RAMP_S * 1000 : 0);
  const spec = workload[role];
  const login = await call(`login ${role}`, spec.loginPath, role === 'driver' ? 'driverLogin' : 'adminLogin', { method: 'POST', json: { email: account.email, password: account.password, timezone: TIMEZONE } });
  if (login.outcome !== 'ok') return null;
  successfulLogins++;
  const ctx = { token: login.body.accessToken, driverId: login.body.driver?.id };
  // A city admin cannot open super-admin pages (Insights, pay runs), exactly as in the UI; only the super admin calls them.
  let tokenRole = null;
  try { tokenRole = JSON.parse(Buffer.from(ctx.token.split('.')[1], 'base64url').toString()).role ?? null; } catch {}
  const endpoints = spec.endpoints.filter((e) => !e.superadminOnly || tokenRole === 'superadmin');
  active[role]++;
  // Every endpoint once first, so a broken endpoint is always seen even in a short run.
  for (const e of endpoints) await call(e.name, fill(e.path, ctx), e.validator, { token: ctx.token });
  const pick = picker(endpoints);
  while (Date.now() < endAt) {
    await sleep(rnd(...spec.thinkSeconds) * 1000);
    if (Date.now() >= endAt) break;
    const e = pick();
    await call(e.name, fill(e.path, ctx), e.validator, { token: ctx.token });
  }
  active[role]--;
  return ctx;
}

async function uploadOnce(account) {
  await sleep((RAMP_S + DURATION_S / 2) * 1000);
  const login = await call('login admin', workload.admin.loginPath, 'adminLogin', { method: 'POST', json: { email: account.email, password: account.password } });
  if (login.outcome !== 'ok') return;
  successfulLogins++;
  const form = new FormData();
  const type = args.upload.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; // what a browser sends
  form.append('file', new Blob([readFileSync(args.upload)], { type }), basename(args.upload));
  const t0 = performance.now();
  const res = await call('POST weekly upload', args['upload-path'] || '/admin/doubleStop/weekly-upload', 'object', { method: 'POST', token: login.body.accessToken, form });
  if (args['upload-expect']) {
    // The upload must report exactly the totals the fixture was built with, or the run fails.
    const expected = JSON.parse(readFileSync(args['upload-expect'], 'utf8'));
    const got = res.body?.data ?? {};
    const keys = ['recordsProcessed', 'recordsSkipped', 'recordsInserted'];
    uploadCheck = Object.fromEntries(keys.map((k) => [k, { expected: expected[k], got: got[k] ?? null }]));
    const match = res.outcome === 'ok' && keys.every((k) => got[k] === expected[k]);
    recorder.record('upload totals match fixture', performance.now() - t0, match ? 200 : 0, match ? 'ok' : 'invalid_body');
  }
}
let uploadCheck = null;

let interrupted = false;
process.on('SIGINT', () => { interrupted = true; console.error('Interrupted: the run will be reported as failed.'); });

const health = await call('preflight /healthz', '/healthz', 'health');
if (health.outcome !== 'ok') fail(`GET ${BASE}/healthz did not answer {"status":"ok"} (${health.outcome})`);
recorder.endpoints.delete('preflight /healthz');

const ticker = setInterval(() => {
  const { totals } = summarise(recorder);
  console.log(`[${new Date().toISOString().slice(11, 19)}] drivers ${active.driver}/${DRIVER_VUS} admins ${active.admin}/${ADMIN_VUS} requests ${totals.requests} not-ok ${totals.requests - totals.ok}`);
}, 10_000);

const tasks = [
  ...drivers.map((a, i) => user('driver', i, DRIVER_VUS, a)),
  ...admins.slice(0, ADMIN_VUS).map((a, i) => user('admin', i, ADMIN_VUS, a)),
];
if (args.upload) tasks.push(uploadOnce(admins[0]));
await Promise.allSettled(tasks);
clearInterval(ticker);

const summary = summarise(recorder);
const plannedEndpoints = [
  ...(DRIVER_VUS ? workload.driver.endpoints : []),
  ...(ADMIN_VUS ? workload.admin.endpoints : []),
].map((e) => ({ name: e.name, p95Ms: e.p95Ms, minOk: 1 }));
if (args.upload) plannedEndpoints.push({ name: 'POST weekly upload', p95Ms: null, minOk: 1 });
if (args.upload && args['upload-expect']) plannedEndpoints.push({ name: 'upload totals match fixture', p95Ms: null, minOk: 1 });
const ideal = expectedRequests({ users: DRIVER_VUS, durationS: DURATION_S, thinkMinS: workload.driver.thinkSeconds[0], thinkMaxS: workload.driver.thinkSeconds[1] })
  + expectedRequests({ users: ADMIN_VUS, durationS: DURATION_S, thinkMinS: workload.admin.thinkSeconds[0], thinkMaxS: workload.admin.thinkSeconds[1] });
const plan = {
  expectedLogins: DRIVER_VUS + ADMIN_VUS + (args.upload ? 1 : 0),
  endpoints: plannedEndpoints,
  minRequests: Math.max(plannedEndpoints.length, Math.floor(ideal * MIN_SHARE)),
  maxErrorRate: MAX_ERROR_RATE,
  completed: !interrupted,
};
const result = verdict(summary, plan, { successfulLogins });
const elapsedS = (Date.now() - startAt) / 1000;

console.table(Object.fromEntries(Object.entries(summary.rows).map(([k, v]) => [k, { requests: v.requests, ok: v.ok, 'p50 ms': v.p50, 'p95 ms': v.p95, 'p99 ms': v.p99, 'max ms': v.max, notOk: JSON.stringify(Object.fromEntries(Object.entries(v.outcomes).filter(([o]) => o !== 'ok'))) }])));
console.log(JSON.stringify({ stage: args.stage || null, ...result, okPerSecond: +(summary.totals.ok / elapsedS).toFixed(2), outcomes: summary.totals.outcomes }));
if (!result.pass) for (const r of result.reasons) console.log(`FAIL: ${r}`);
if (args.out) {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify({
    stage: args.stage || null, startedAt: new Date(startAt).toISOString(), elapsedS: +elapsedS.toFixed(1),
    config: { base: BASE, driverVus: DRIVER_VUS, adminVus: ADMIN_VUS, rampS: RAMP_S, durationS: DURATION_S, timeoutMs: TIMEOUT_MS, minShare: MIN_SHARE, upload: args.upload ? basename(args.upload) : null, thinkSeconds: { driver: workload.driver.thinkSeconds, admin: workload.admin.thinkSeconds } },
    plan, verdict: result, uploadCheck, okPerSecond: +(summary.totals.ok / elapsedS).toFixed(2), rows: summary.rows,
  }, null, 2));
}
process.exit(result.pass ? 0 : 1);

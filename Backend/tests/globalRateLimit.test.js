import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_GLOBAL_MAX, GLOBAL_WINDOW_MS, STAGING_GLOBAL_MAX_CEILING, globalRateLimitMax, globalRateLimitOptions } from '../middlewares/globalRateLimit.js';

const silent = { warn() {} };

test('production and unset settings keep the 1,000 requests per 15 minutes limit', () => {
  assert.deepEqual(globalRateLimitMax({}), { max: DEFAULT_GLOBAL_MAX, override: false });
  assert.deepEqual(globalRateLimitOptions({ NODE_ENV: 'production' }, silent), { windowMs: 15 * 60 * 1000, max: 1000 });
  assert.equal(GLOBAL_WINDOW_MS, 15 * 60 * 1000);
});

test('the override is ignored unless the server says it is staging', () => {
  for (const NASA_ENVIRONMENT of [undefined, '', 'prod', 'production', 'Staging', 'staging ']) {
    const result = globalRateLimitMax({ NASA_ENVIRONMENT, STAGING_GLOBAL_RATE_LIMIT_MAX: '50000' });
    assert.equal(result.max, DEFAULT_GLOBAL_MAX, `NASA_ENVIRONMENT=${NASA_ENVIRONMENT}`);
    assert.equal(result.override, false);
    assert.match(result.ignored, /NASA_ENVIRONMENT/);
  }
});

test('staging accepts only a whole number inside the allowed range', () => {
  const staging = (v) => globalRateLimitMax({ NASA_ENVIRONMENT: 'staging', STAGING_GLOBAL_RATE_LIMIT_MAX: v });
  assert.deepEqual(staging('50000'), { max: 50000, override: true });
  assert.deepEqual(staging(' 1000 '), { max: 1000, override: true });
  assert.deepEqual(staging(String(STAGING_GLOBAL_MAX_CEILING)), { max: STAGING_GLOBAL_MAX_CEILING, override: true });
  for (const bad of ['999', '100001', '-5', '1e5', '5000.5', 'abc', 'Infinity', '0x2000']) {
    const result = staging(bad);
    assert.equal(result.max, DEFAULT_GLOBAL_MAX, bad);
    assert.equal(result.override, false, bad);
    assert.match(result.ignored, /whole number/, bad);
  }
  assert.deepEqual(staging(''), { max: DEFAULT_GLOBAL_MAX, override: false });
});

test('an override or an ignored setting is logged once at start-up, without the value of any other setting', () => {
  const lines = [];
  const log = { warn: (msg, meta) => lines.push([msg, meta]) };
  globalRateLimitOptions({ NASA_ENVIRONMENT: 'staging', STAGING_GLOBAL_RATE_LIMIT_MAX: '20000', JWT_SECRET: 'not-logged' }, log);
  assert.deepEqual(lines, [['Staging global rate limit in use', { max: 20000, windowMinutes: 15 }]]);
  lines.length = 0;
  globalRateLimitOptions({ STAGING_GLOBAL_RATE_LIMIT_MAX: '20000' }, log);
  assert.equal(lines.length, 1);
  assert.doesNotMatch(JSON.stringify(lines), /not-logged/);
});

test('app.js builds the global limit from these options', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /app\.use\(rateLimit\(globalRateLimitOptions\(\)\)\)/);
  assert.doesNotMatch(app, /rateLimit\(\{ windowMs: 15 \* 60 \* 1000, max: 1000 \}\)/);
});

test('app.js answers GET /healthz before the rate limit, with no database call', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const health = app.indexOf("app.get('/healthz'");
  assert.ok(health > 0, 'health route exists');
  assert.ok(health < app.indexOf('app.use(rateLimit('), 'health route is mounted before the global rate limit');
  const line = app.slice(health, app.indexOf('\n', health));
  assert.doesNotMatch(line, /pool|query|await/);
});

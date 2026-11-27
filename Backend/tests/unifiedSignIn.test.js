import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.JWT_SECRET ??= 'test-access-secret-not-real';
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-not-real';
// The controller imports the database and Redis modules, but these tests pass fakes and never reach them.
process.env.DB_HOST ??= '127.0.0.1';

const { resolveSignIn, firstScreen } = await import('../services/auth/signIn.js');
const { makeSignIn } = await import('../controllers/authController.js');
const { verifyToken, verifyRefreshToken } = await import('../services/jwtservice.js');

// Made-up accounts. A "hash" here is just "hash:<password>", checked by the fake below.
const ADMIN = { id: 7, email: 'city.admin@example.test', name: 'Test City Admin', role: 'admin', is_active: true, password: 'hash:admin-pass' };
const SUPER = { id: 1, email: 'owner@example.test', name: 'Test Owner', role: 'superadmin', is_active: true, password: 'hash:owner-pass' };
const DRIVER = { id: 42, email: 'driver@example.test', name: 'Test Driver', enabled: true, agreement_signed: true, timezone: 'America/Chicago', password: 'hash:driver-pass' };

const fakeDeps = ({ admins = [], drivers = [] } = {}) => {
  const calls = { checks: 0, dummy: 0, timezone: [] };
  return {
    calls,
    findAdmin: async (email) => admins.find((a) => a.email === email),
    findDriver: async (email) => drivers.find((d) => d.email === email),
    checkPassword: async (password, hash) => { calls.checks += 1; return hash === `hash:${password}`; },
    dummyCheck: async () => { calls.dummy += 1; return false; },
    updateTimezone: async (id, tz) => { calls.timezone.push([id, tz]); },
  };
};

const call = async (deps, body) => {
  const out = {};
  const res = { status(code) { out.status = code; return this; }, json(payload) { out.body = payload; return this; } };
  await makeSignIn(deps)({ body }, res);
  out.locals = res.locals;
  return out;
};

test('an admin, the super admin and a driver all sign in on the same route and get their own area and first screen', async () => {
  const deps = fakeDeps({ admins: [ADMIN, SUPER], drivers: [DRIVER] });

  const admin = await call(deps, { email: ADMIN.email, password: 'admin-pass' });
  assert.equal(admin.status, 200);
  assert.equal(admin.locals.signedArea, 'admin', 'the limits learn which area was signed in to');
  assert.equal(admin.body.area, 'admin');
  assert.equal(admin.body.next, '/admin/dashboard');
  assert.equal(admin.body.admin.password, undefined, 'the hash never leaves the server');
  assert.equal(verifyToken(admin.body.accessToken).role, 'admin');
  assert.equal(verifyRefreshToken(admin.body.refreshToken).id, ADMIN.id);

  const owner = await call(deps, { email: SUPER.email, password: 'owner-pass' });
  assert.equal(owner.body.area, 'admin');
  assert.equal(verifyToken(owner.body.accessToken).role, 'superadmin');

  const driver = await call(deps, { email: DRIVER.email, password: 'driver-pass', timezone: 'America/Denver' });
  assert.equal(driver.status, 200);
  assert.equal(driver.body.area, 'driver');
  assert.equal(driver.body.next, '/driver/dashboard');
  assert.equal(verifyToken(driver.body.accessToken).role, 'driver');
  assert.deepEqual(deps.calls.timezone, [[42, 'America/Denver']]);
  assert.equal(driver.body.driver.password, undefined);
});

test('a driver who has not signed the agreement is sent to the agreement first', async () => {
  const unsigned = { ...DRIVER, agreement_signed: false };
  const out = await call(fakeDeps({ drivers: [unsigned] }), { email: DRIVER.email, password: 'driver-pass' });
  assert.equal(out.body.next, '/driver/agreement');
  assert.equal(firstScreen('driver', { agreement_signed: true }), '/driver/dashboard');
});

test('wrong password, unknown email and wrong-kind passwords all get the same answer, with a password check every time', async () => {
  const deps = fakeDeps({ admins: [ADMIN], drivers: [DRIVER] });
  const answers = [
    await call(deps, { email: ADMIN.email, password: 'nope' }),
    await call(deps, { email: 'nobody@example.test', password: 'nope' }),
    await call(deps, { email: DRIVER.email, password: 'admin-pass' }),
  ];
  for (const out of answers) {
    assert.equal(out.status, 401);
    assert.deepEqual(out.body, { code: 'invalid_credentials', message: 'The email or password is not correct.' });
  }
  assert.equal(deps.calls.checks, 2, 'a real check for each existing account');
  assert.equal(deps.calls.dummy, 1, 'a dummy check for the unknown email, so it is not faster');
});

test('a disabled account is reported only after its correct password, and gets no tokens', async () => {
  const deps = fakeDeps({ admins: [{ ...ADMIN, is_active: false }], drivers: [{ ...DRIVER, enabled: false }] });
  for (const [email, good] of [[ADMIN.email, 'admin-pass'], [DRIVER.email, 'driver-pass']]) {
    const wrong = await call(deps, { email, password: 'nope' });
    assert.equal(wrong.status, 401, 'a wrong password says nothing about the block');
    const right = await call(deps, { email, password: good });
    assert.equal(right.status, 403);
    assert.equal(right.body.code, 'account_disabled');
    assert.equal(right.body.accessToken, undefined);
  }
});

test('the same email on an admin and a driver account: the right password picks that one; both passwords matching asks the person', async () => {
  const shared = 'both@example.test';
  const admin = { ...ADMIN, email: shared, password: 'hash:same-pass' };
  const driverOwn = { ...DRIVER, email: shared, password: 'hash:driver-only' };

  const different = fakeDeps({ admins: [admin], drivers: [driverOwn] });
  assert.equal((await call(different, { email: shared, password: 'driver-only' })).body.area, 'driver');
  assert.equal((await call(different, { email: shared, password: 'same-pass' })).body.area, 'admin');

  const same = fakeDeps({ admins: [admin], drivers: [{ ...driverOwn, password: 'hash:same-pass' }] });
  const ask = await call(same, { email: shared, password: 'same-pass' });
  assert.equal(ask.status, 409);
  assert.deepEqual(ask.body.areas, ['admin', 'driver']);
  assert.equal(ask.body.accessToken, undefined, 'nothing is chosen for the person');

  const chosen = await call(same, { email: shared, password: 'same-pass', area: 'driver' });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.area, 'driver');
  assert.equal(verifyToken(chosen.body.accessToken).role, 'driver');

  // Naming an area never helps a wrong password, and an unknown area is just invalid
  assert.equal((await call(same, { email: shared, password: 'nope', area: 'admin' })).status, 401);
  assert.equal((await call(same, { email: shared, password: 'same-pass', area: 'superadmin' })).status, 401);
});

test('missing or oversized fields are refused before any lookup', async () => {
  const deps = fakeDeps({ admins: [ADMIN] });
  assert.equal((await call(deps, { email: '', password: 'x' })).status, 400);
  assert.equal((await call(deps, { email: ADMIN.email })).status, 400);
  assert.equal((await call(deps, { email: { $ne: 1 }, password: 'x' })).status, 400);
  assert.equal((await call(deps, { email: ADMIN.email, password: 'x'.repeat(2000) })).status, 401);
  assert.equal(deps.calls.checks + deps.calls.dummy, 0);
});

test('an account row without a password hash never opens and is checked like an unknown one', async () => {
  const out = await resolveSignIn({ email: ADMIN.email, password: '' }, fakeDeps({ admins: [{ ...ADMIN, password: null }] }));
  assert.equal(out.kind, 'invalid');
});

test('the route is limited by both existing login limits and mounted before the area routers', () => {
  const routes = readFileSync(new URL('../routes/authRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /router\.post\('\/login', loginRateLimit\('admin', SHARED\), loginRateLimit\('driver', SHARED\), authController\.Login\)/);
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf("app.use('/auth'") > -1 && app.indexOf("app.use('/auth'") < app.indexOf("app.use('/admin', (req"));
});

// Needs a Redis server (the limiter module connects when it is imported). Run with REDIS_TEST=1 and a local Redis.
test('on the shared route a success gives back only the signed-in area\'s counters', { skip: process.env.REDIS_TEST !== '1' && 'set REDIS_TEST=1 with a local Redis to run' }, async () => {
  const { loginRateLimit } = await import('../middlewares/loginRateLimit.js');
  const { EventEmitter } = await import('node:events');
  const attempt = async (area, signedArea, status) => {
    const res = Object.assign(new EventEmitter(), { statusCode: status, locals: {}, set() {}, status() { return this; }, json() { return this; } });
    await loginRateLimit(area, { sharedRoute: true, windowSeconds: 60 })({ body: { email: 'limit@example.test' }, ip: '10.9.9.9' }, res, () => {});
    res.locals.signedArea = signedArea;
    res.emit('finish');
  };
  const { bump } = await import('../middlewares/loginRateLimit.js');
  for (let i = 0; i < 3; i += 1) await attempt('admin', undefined, 401);
  await attempt('admin', 'driver', 200); // signed in to the driver area: the admin counter is not reset
  const after = await bump('rl:login:admin:acct:10.9.9.9:limit@example.test', 60);
  assert.equal(after.count, 5, 'four attempts kept, plus this one');
  const { clear } = await import('../middlewares/loginRateLimit.js');
  await clear('rl:login:admin:acct:10.9.9.9:limit@example.test');
  await clear('rl:login:driver:acct:10.9.9.9:limit@example.test');
  await (await import('../config/redis.js')).default.quit();
});

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Needs a throwaway PostgreSQL database whose name ends in "_test" (never production). Run with
// ACCOUNT_DELETION_TEST_DB=1 and DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT pointing at it. The database has no
// real schema, so the test makes small stand-ins for the tables the deletion touches and applies the real migrations.
const hasDb = process.env.ACCOUNT_DELETION_TEST_DB === '1' && /_test$/.test(process.env.DB_NAME ?? '');
const dbTest = (name, fn) => test(name, { skip: !hasDb && 'set ACCOUNT_DELETION_TEST_DB=1 and a *_test database to run' }, fn);
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

let pool;
let deletion;
let controllers;

const call = async (handler, { body = {}, params = {}, driver, user } = {}) => {
  const out = {};
  const res = { status(code) { out.status = code; return this; }, json(payload) { out.body = payload; return this; } };
  await handler({ body, params, driver, user }, res);
  return out;
};

before(async () => {
  if (!hasDb) return;
  process.env.JWT_SECRET ??= 'x';
  pool = (await import('../config/db.js')).default;
  deletion = await import('../services/account/accountDeletion.js');
  controllers = await import('../controllers/accountDeletionController.js');
  const bcrypt = (await import('bcrypt')).default;
  await pool.query(`
    DROP TABLE IF EXISTS payments_stub, account_deletion_requests, device_tokens, admin_city_ref, drivers, admin CASCADE;
    CREATE TABLE admin (id serial PRIMARY KEY, name text, email text UNIQUE, password text, role text, is_active boolean DEFAULT true, can_use_invoices boolean DEFAULT false);
    CREATE TABLE admin_city_ref (admin_id integer REFERENCES admin(id) ON DELETE CASCADE, city_id integer);
    CREATE TABLE drivers (id serial PRIMARY KEY, name text, email text UNIQUE, password text, phone_number text, enabled boolean DEFAULT true, driver_code text);
    -- Stands in for deliveries, statements and payments: cascades on a driver delete, so a deleted row would show
    CREATE TABLE payments_stub (id serial PRIMARY KEY, driver_id integer REFERENCES drivers(id) ON DELETE CASCADE, amount numeric);
  `);
  await pool.query(migration('2026-11-02-issue-022-device-tokens.sql'));
  await pool.query(migration('2026-11-27-account-deletion.sql'));
  await pool.query(migration('2026-11-27-account-deletion.sql')); // safe twice
  const hash = await bcrypt.hash('right-pass', 4);
  await pool.query(`INSERT INTO admin (id, name, email, password, role) VALUES
    (1, 'Owner One', 'owner1@example.test', $1, 'superadmin'), (2, 'Owner Two', 'owner2@example.test', $1, 'superadmin'),
    (3, 'City Admin', 'city@example.test', $1, 'admin')`, [hash]);
  await pool.query(`INSERT INTO admin_city_ref VALUES (3, 10), (3, 11)`);
  await pool.query(`INSERT INTO drivers (id, name, email, password, phone_number, driver_code) VALUES (42, 'Test Driver', 'driver@example.test', $1, '+15550000000', 'T42')`, [hash]);
  await pool.query(`INSERT INTO payments_stub (driver_id, amount) VALUES (42, 120.50), (42, 80.25)`);
  await pool.query(`INSERT INTO device_tokens (user_type, user_id, push_token, platform) VALUES ('driver', 42, 'ExponentPushToken[deletion-test-aaaaaa]', 'ios')`);
});

after(async () => { if (hasDb) await pool.end(); });

dbTest('a driver asks with their password, sees the request, can withdraw it, and asking twice keeps one', async () => {
  const self = controllers.makeSelfService('driver', pool);
  const wrong = await call(self.request, { driver: { id: 42 }, body: { password: 'nope' } });
  assert.equal(wrong.status, 403);
  assert.equal((await call(self.status, { driver: { id: 42 } })).body.request, null);

  const asked = await call(self.request, { driver: { id: 42 }, body: { password: 'right-pass' } });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.request.status, 'requested');
  assert.ok(asked.body.request.dueBy);
  await call(self.request, { driver: { id: 42 }, body: { password: 'right-pass' } });
  assert.equal((await pool.query(`SELECT count(*)::int n FROM account_deletion_requests WHERE status = 'requested'`)).rows[0].n, 1);

  assert.equal((await call(self.cancel, { driver: { id: 42 } })).body.request.status, 'cancelled');
  assert.equal((await call(self.request, { driver: { id: 42 }, body: { password: 'right-pass' } })).body.request.status, 'requested');
});

dbTest('completing a driver request removes sign-in, contact and push, and keeps every pay record and the name', async () => {
  const review = controllers.makeAdminReview(pool);
  const [open] = (await call(review.list, { user: { id: 1 } })).body.requests;
  assert.equal(open.userType, 'driver');
  const before = (await pool.query('SELECT count(*)::int n, sum(amount)::text total FROM payments_stub WHERE driver_id = 42')).rows[0];

  const done = await call(review.complete, { user: { id: 1 }, params: { id: String(open.id) } });
  assert.equal(done.status, 200);
  const row = (await pool.query('SELECT * FROM drivers WHERE id = 42')).rows[0];
  assert.equal(row.email, 'deleted-driver-42@deleted.invalid');
  assert.equal(row.phone_number, null);
  assert.equal(row.enabled, false);
  assert.equal(row.name, 'Test Driver', 'kept for the accounting records (owner decision pending)');
  const bcrypt = (await import('bcrypt')).default;
  assert.equal(await bcrypt.compare('right-pass', row.password), false, 'the old password no longer opens it');
  const afterPay = (await pool.query('SELECT count(*)::int n, sum(amount)::text total FROM payments_stub WHERE driver_id = 42')).rows[0];
  assert.deepEqual(afterPay, before, 'pay records unchanged');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM device_tokens WHERE user_id = 42 AND revoked_at IS NULL`)).rows[0].n, 0);
  assert.equal((await call(review.complete, { user: { id: 1 }, params: { id: String(open.id) } })).status, 409, 'not twice');
});

dbTest('a city admin request removes city access; super admins cannot leave NASA without one, nor complete their own', async () => {
  const cityAdmin = controllers.makeSelfService('admin', pool);
  await call(cityAdmin.request, { user: { id: 3 }, body: { password: 'right-pass' } });
  const review = controllers.makeAdminReview(pool);
  const { id } = (await call(review.list, { user: { id: 1 } })).body.requests[0];
  assert.equal((await call(review.complete, { user: { id: 1 }, params: { id: String(id) } })).status, 200);
  assert.equal((await pool.query('SELECT count(*)::int n FROM admin_city_ref WHERE admin_id = 3')).rows[0].n, 0);
  assert.equal((await pool.query('SELECT is_active FROM admin WHERE id = 3')).rows[0].is_active, false);

  const owner2 = controllers.makeSelfService('admin', pool);
  assert.equal((await call(owner2.request, { user: { id: 2 }, body: { password: 'right-pass' } })).status, 200, 'another super admin exists');
  const mine = (await call(review.list, { user: { id: 2 } })).body.requests[0];
  assert.equal((await call(review.complete, { user: { id: 2 }, params: { id: String(mine.id) } })).body.code, 'own_request');
  assert.equal((await call(review.complete, { user: { id: 1 }, params: { id: String(mine.id) } })).status, 200);

  const last = await call(controllers.makeSelfService('admin', pool).request, { user: { id: 1 }, body: { password: 'right-pass' } });
  assert.equal(last.status, 409);
  assert.equal(last.body.code, 'last_super_admin');
});

test('the routes need sign-in, and only a super admin lists or completes requests', () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
  const admin = read('../routes/adminRoutes.js');
  assert.ok(admin.indexOf("router.use(adminAuth)") < admin.indexOf("'/account-deletion'"));
  assert.match(admin, /router\.get\('\/account-deletions', superAdminAuth, deletionReview\.list\)/);
  assert.match(admin, /router\.post\('\/account-deletions\/:id\/complete', superAdminAuth, deletionReview\.complete\)/);
  const driver = read('../routes/driverRoutes.js');
  assert.ok(driver.indexOf('router.use(driverAuth)') < driver.indexOf("'/account-deletion'"));
});

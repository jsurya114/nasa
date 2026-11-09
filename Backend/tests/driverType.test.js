import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DRIVER_TYPES, MAX_DRIVERS_PER_CHANGE, parseOptionalDriverType, parseTypeChange, setDriverTypes } from '../services/admin/driverType.js';

// The request checks run before anything touches the database, so the first tests need none. The transaction tests need a
// disposable PostgreSQL copy that has the driver_type migration (never production): set PAYROLL_TEST_DB=1 and the DB_* variables.

const call = async (handler, req) => {
  let out;
  const res = { status(code) { out = { code }; return this; }, json(body) { out.body = body; return this; } };
  await handler(req, res);
  return out;
};

test('the allowed types are exactly LOCAL and DESI', () => {
  assert.deepEqual(DRIVER_TYPES, ['LOCAL', 'DESI']);
});

test('a type change needs 1 to 500 whole-number driver IDs and a known type; repeated IDs count once', () => {
  assert.deepEqual(parseTypeChange({ driverIds: [3, 1, 3], driverType: 'DESI' }), { driverIds: [3, 1], driverType: 'DESI' });
  assert.deepEqual(parseTypeChange({ driverIds: [7], driverType: 'LOCAL' }), { driverIds: [7], driverType: 'LOCAL' });
  const bad = [
    {}, null, undefined, { driverType: 'LOCAL' },
    { driverIds: [], driverType: 'LOCAL' },
    { driverIds: 5, driverType: 'LOCAL' },
    { driverIds: ['5'], driverType: 'LOCAL' },
    { driverIds: [1.5], driverType: 'LOCAL' },
    { driverIds: [0], driverType: 'LOCAL' },
    { driverIds: [-2], driverType: 'LOCAL' },
    { driverIds: [2147483648], driverType: 'LOCAL' },
    { driverIds: [null], driverType: 'LOCAL' },
    { driverIds: [1], driverType: 'local' },
    { driverIds: [1], driverType: 'Desi' },
    { driverIds: [1], driverType: 'OTHER' },
    { driverIds: [1] },
    { driverIds: Array.from({ length: MAX_DRIVERS_PER_CHANGE + 1 }, (_, i) => i + 1), driverType: 'LOCAL' },
  ];
  for (const body of bad) assert.ok(parseTypeChange(body).error, `should refuse ${JSON.stringify(body)?.slice(0, 60)}`);
  assert.equal(parseTypeChange({ driverIds: Array.from({ length: MAX_DRIVERS_PER_CHANGE }, (_, i) => i + 1), driverType: 'LOCAL' }).error, undefined);
});

test('the Add and Edit driver forms may leave the type out; a wrong one is refused', () => {
  for (const none of [undefined, null, '']) assert.deepEqual(parseOptionalDriverType(none), { driverType: null });
  assert.deepEqual(parseOptionalDriverType('LOCAL'), { driverType: 'LOCAL' });
  assert.deepEqual(parseOptionalDriverType('DESI'), { driverType: 'DESI' });
  for (const bad of ['local', 'Desi', 'OTHER', 0, false, {}, ['LOCAL']]) assert.ok(parseOptionalDriverType(bad).error, `should refuse ${JSON.stringify(bad)}`);
});

test('creating or editing a driver with a wrong type is a 400, before anything else is checked', async () => {
  const { createUsers, updateUser } = await import('../controllers/admin/addUserController.js');
  const body = { name: 'Test Driver', email: 'a@example.com', password: 'secret1', driver_code: 123456, city: 'Test City', enabled: true, driverType: 'local' };
  const created = await call(createUsers, { body, user: { id: 1, role: 'superadmin' } });
  assert.equal(created.code, 400);
  assert.match(created.body.message, /LOCAL, DESI/);
  const edited = await call(updateUser, { params: { id: '5' }, body, user: { id: 1, role: 'superadmin' } });
  assert.equal(edited.code, 400);
  assert.match(edited.body.message, /LOCAL, DESI/);
});

test('the controller answers a bad request with 400 and a clear message, before any database call', async () => {
  const { changeDriverTypes } = await import('../controllers/admin/driverTypeController.js');
  const out = await call(changeDriverTypes, { body: { driverIds: [], driverType: 'LOCAL' }, user: { id: 1, role: 'admin' } });
  assert.equal(out.code, 400);
  assert.match(out.body.message, /at least one driver/);
  const out2 = await call(changeDriverTypes, { body: { driverIds: [1], driverType: 'x' }, user: { id: 1, role: 'admin' } });
  assert.equal(out2.code, 400);
  assert.match(out2.body.message, /LOCAL, DESI/);
});

test('the route sits behind the admin sign-in and is one bulk call', async () => {
  const { readFileSync } = await import('node:fs');
  const routes = readFileSync(new URL('../routes/adminRoutes.js', import.meta.url), 'utf8');
  assert.ok(routes.indexOf('router.use(adminAuth)') < routes.indexOf("router.patch('/drivers/type', changeDriverTypes)"));
});

const hasDb = process.env.PAYROLL_TEST_DB === '1';

test('bulk type change: all or nothing, own cities only, no rewrite of drivers already of that type', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const pool = new pg.Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, database: process.env.DB_NAME, password: process.env.DB_PASSWORD });
  const tag = randomUUID().slice(0, 8);
  const made = { drivers: [], admin: null, cities: [] };
  const city = async (n) => (await pool.query('INSERT INTO city (job, city_code) VALUES ($1, $2) RETURNING id', [`T-${tag}-${n}`, `T${tag}${n}`])).rows[0].id;
  const driver = async (n, cityId, type = null) => (await pool.query(
    'INSERT INTO drivers (name, email, driver_code, password, city_id, driver_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [`T-${tag}-d${n}`, `t-${tag}-${n}@example.test`, 900000000 + Math.floor(Math.random() * 90000000), 'x', cityId, type],
  )).rows[0].id;
  const typeOf = async (ids) => Object.fromEntries((await pool.query('SELECT id, driver_type FROM drivers WHERE id = ANY($1)', [ids])).rows.map((r) => [r.id, r.driver_type]));
  try {
    const mine = await city('mine');
    const other = await city('other');
    made.cities = [mine, other];
    const [a, b, c] = [await driver(1, mine), await driver(2, mine, 'DESI'), await driver(3, mine, 'LOCAL')];
    const outsider = await driver(4, other, 'DESI');
    const nocity = await driver(5, null);
    made.drivers = [a, b, c, outsider, nocity];
    made.admin = (await pool.query("INSERT INTO admin (name, email, password, role) VALUES ($1, $2, 'x', 'admin') RETURNING id", [`T-${tag}-admin`, `t-${tag}-admin@example.test`])).rows[0].id;
    await pool.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [made.admin, mine]);
    const admin = { id: made.admin, role: 'admin' };
    const superAdmin = { id: 1, role: 'superadmin' };

    await t.test('a driver with no type starts as not set (NULL), never silently classified', async () => {
      assert.equal((await typeOf([a]))[a], null);
      assert.equal((await typeOf([nocity]))[nocity], null);
    });

    await t.test('a mixed selection changes in one call, and drivers already of that type are not counted as updated', async () => {
      const r = await setDriverTypes(admin, [a, b, c], 'DESI', pool);
      assert.deepEqual(r, { updated: 2, unchanged: 1 });
      assert.deepEqual(await typeOf([a, b, c]), { [a]: 'DESI', [b]: 'DESI', [c]: 'DESI' });
    });

    await t.test('choosing the type every selected driver already has changes nothing', async () => {
      const before = (await pool.query('SELECT xmin::text FROM drivers WHERE id = ANY($1) ORDER BY id', [[a, b, c]])).rows;
      const r = await setDriverTypes(admin, [a, b, c], 'DESI', pool);
      assert.deepEqual(r, { updated: 0, unchanged: 3 });
      const after = (await pool.query('SELECT xmin::text FROM drivers WHERE id = ANY($1) ORDER BY id', [[a, b, c]])).rows;
      assert.deepEqual(after, before, 'unchanged rows were not rewritten');
    });

    await t.test('one driver outside the admin\'s cities refuses the whole change: nobody is updated', async () => {
      const r = await setDriverTypes(admin, [a, b, outsider], 'LOCAL', pool);
      assert.equal(r.error.status, 403);
      assert.deepEqual(await typeOf([a, b, outsider]), { [a]: 'DESI', [b]: 'DESI', [outsider]: 'DESI' });
    });

    await t.test('a driver with no city can be changed by the super admin only', async () => {
      assert.equal((await setDriverTypes(admin, [nocity], 'LOCAL', pool)).error.status, 403);
      assert.deepEqual(await setDriverTypes(superAdmin, [nocity, outsider], 'LOCAL', pool), { updated: 2, unchanged: 0 });
      assert.deepEqual(await typeOf([nocity, outsider]), { [nocity]: 'LOCAL', [outsider]: 'LOCAL' });
    });

    await t.test('one unknown driver ID refuses the whole change: nobody is updated', async () => {
      const r = await setDriverTypes(superAdmin, [a, 2147483000], 'LOCAL', pool);
      assert.equal(r.error.status, 404);
      assert.equal((await typeOf([a]))[a], 'DESI');
    });

    await t.test('a failure in the middle rolls everything back', async () => {
      const failing = { connect: async () => {
        // A wrapper, not a change to the pooled connection itself, so the fault cannot leak into the next test.
        const client = await pool.connect();
        return {
          query: (sql, ...rest) => (typeof sql === 'string' && sql.startsWith('UPDATE drivers') ? Promise.reject(new Error('boom')) : client.query(sql, ...rest)),
          release: () => client.release(),
        };
      } };
      await assert.rejects(setDriverTypes(superAdmin, [a, b], 'LOCAL', failing), /boom/);
      assert.deepEqual(await typeOf([a, b]), { [a]: 'DESI', [b]: 'DESI' });
    });

    await t.test('a driver created with a type stores it; created without one stays not set', async () => {
      const { dbService } = await import('../services/admin/dbQueries.js');
      const withType = await dbService.insertUser({ name: `T-${tag}-new1`, email: `t-${tag}-new1@example.test`, driver_code: 800000000 + Math.floor(Math.random() * 90000000), password: 'secret1', city: `T-${tag}-mine`, enabled: true, driverType: 'DESI' });
      const without = await dbService.insertUser({ name: `T-${tag}-new2`, email: `t-${tag}-new2@example.test`, driver_code: 800000000 + Math.floor(Math.random() * 90000000), password: 'secret1', city: `T-${tag}-mine`, enabled: true });
      made.drivers.push(withType.id, without.id);
      assert.equal(withType.driver_type, 'DESI');
      assert.equal(without.driver_type, null);
    });

    await t.test('editing a driver keeps their type when none is sent, and changes it when one is, with or without a new password', async () => {
      const { dbService } = await import('../services/admin/dbQueries.js');
      const row = (await pool.query('SELECT id, name, email, driver_code FROM drivers WHERE id = $1', [b])).rows[0];
      const edit = (extra) => dbService.updateDriver(b, { name: row.name, email: row.email, city: `T-${tag}-mine`, enabled: true, phoneNumber: null, driver_code: row.driver_code, ...extra });
      assert.equal((await edit({ driverType: null })).driver_type, 'DESI', 'no type sent: kept');
      assert.equal((await edit({ driverType: 'LOCAL' })).driver_type, 'LOCAL', 'a type sent: changed');
      assert.equal((await edit({ driverType: null, password: 'newsecret1' })).driver_type, 'LOCAL', 'with a password, no type sent: kept');
      assert.equal((await edit({ driverType: 'DESI', password: 'newsecret1' })).driver_type, 'DESI', 'with a password, a type sent: changed');
    });

    await t.test('the database itself refuses any value but LOCAL, DESI or NULL', async () => {
      await assert.rejects(pool.query("UPDATE drivers SET driver_type = 'local' WHERE id = $1", [a]), /drivers_driver_type_check/);
      await assert.rejects(pool.query("UPDATE drivers SET driver_type = '' WHERE id = $1", [a]), /drivers_driver_type_check/);
      await pool.query('UPDATE drivers SET driver_type = NULL WHERE id = $1', [a]);
    });
  } finally {
    await pool.query('DELETE FROM drivers WHERE id = ANY($1)', [made.drivers]).catch(() => {});
    if (made.admin) {
      await pool.query('DELETE FROM admin_city_ref WHERE admin_id = $1', [made.admin]).catch(() => {});
      await pool.query('DELETE FROM admin WHERE id = $1', [made.admin]).catch(() => {});
    }
    await pool.query('DELETE FROM city WHERE id = ANY($1)', [made.cities]).catch(() => {});
    await pool.end();
  }
});

test.after(async () => { (await import('../config/db.js')).default.end().catch(() => {}); });

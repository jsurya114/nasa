import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { payrollActorOf, requirePayrollAccess } from '../middlewares/requirePayrollAccess.js';
import { dbService } from '../services/admin/dbQueries.js';
import { toggleAdminPayroll } from '../controllers/admin/addAdminController.js';
import { createEntry, listEntries } from '../services/payroll/ledger/ledgerStore.js';
import { parseNewEntry } from '../services/payroll/ledger/ledgerRules.js';

// The Payroll page for selected admins. The database part needs a PostgreSQL copy (never production): PAYROLL_TEST_DB=1 and the DB_* variables, in one
// transaction that is always rolled back. Synthetic admins, cities and drivers only.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const res = () => ({ code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const fakeDb = (rows) => ({ query: async (_sql, [id]) => ({ rows: rows[id] ? [rows[id]] : [] }) });

test('who may use Payroll: the database decides (super admin, or an active admin switched on), never the token alone', async () => {
  const db = fakeDb({
    1: { id: 1, role: 'superadmin', is_active: true, can_use_payroll: false },
    2: { id: 2, role: 'admin', is_active: true, can_use_payroll: true },
    3: { id: 3, role: 'admin', is_active: true, can_use_payroll: false },
    4: { id: 4, role: 'admin', is_active: false, can_use_payroll: true },
    5: { id: 5, role: 'admin', is_active: true, can_use_payroll: true },
  });
  assert.deepEqual(await payrollActorOf({ id: 1, role: 'superadmin' }, db), { id: 1, role: 'superadmin' });
  assert.deepEqual(await payrollActorOf({ id: 2, role: 'admin' }, db), { id: 2, role: 'admin' });
  assert.equal(await payrollActorOf({ id: 3, role: 'admin' }, db), null, 'switched off');
  assert.equal(await payrollActorOf({ id: 4, role: 'admin' }, db), null, 'disabled');
  assert.equal(await payrollActorOf({ id: 99, role: 'admin' }, db), null, 'unknown');
  assert.equal(await payrollActorOf({ id: 2, role: 'driver' }, db), null, 'a driver token');
  assert.deepEqual(await payrollActorOf({ id: 5, role: 'superadmin' }, db), { id: 5, role: 'admin' }, 'an old super admin token gets the role saved now');
});

test('the access check refuses with 403, and passes the database role on to the services', async () => {
  const refused = res();
  let passed = false;
  await requirePayrollAccess({ admin: { id: 'x', role: 'admin' } }, refused, () => { passed = true; });
  assert.deepEqual([refused.code, refused.body, passed], [403, { message: 'FORBIDDEN' }, false]);
});

test('the super admin switches Payroll on or off for an ordinary admin: the wanted value, only while a super admin in the database', async () => {
  const real = [dbService.getAdminById, dbService.setPayrollAccessOfAdmin];
  const stored = { 5: false };
  const people = { 1: { id: 1, role: 'superadmin', is_active: true }, 2: { id: 2, role: 'admin', is_active: true }, 5: { id: 5, role: 'admin' }, 6: { id: 6, role: 'superadmin' } };
  const call = async (user, id, body = { enabled: true }) => { const r = res(); await toggleAdminPayroll({ user, params: { id }, body }, r); return r; };
  const boss = { id: 1, role: 'superadmin' };
  try {
    dbService.getAdminById = async (id) => people[id];
    dbService.setPayrollAccessOfAdmin = async (id, enabled) => { stored[id] = enabled; return { id, can_use_payroll: enabled }; };
    assert.equal((await call({ id: 2, role: 'admin' }, '5')).code, 403);
    assert.equal((await call({ id: 2, role: 'superadmin' }, '5')).code, 403, 'a token that still says super admin');
    assert.equal(stored[5], false);
    assert.equal((await call(boss, 'abc')).code, 404);
    assert.equal((await call(boss, '6')).code, 400, 'a super admin already has it');
    for (const body of [{}, { enabled: 'true' }, { enabled: 1 }]) assert.equal((await call(boss, '5', body)).code, 400);
    const on = await call(boss, '5', { enabled: true });
    assert.deepEqual([on.code, on.body.data, on.body.message, stored[5]], [200, { id: 5, can_use_payroll: true }, 'Payroll switched on', true]);
    const off = await call(boss, '5', { enabled: false });
    assert.deepEqual([off.code, off.body.message, stored[5]], [200, 'Payroll switched off', false]);
  } finally {
    [dbService.getAdminById, dbService.setPayrollAccessOfAdmin] = real;
  }
});

test('an admin switched on: the switch is saved, and the ledger works for their own city only', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-142-driver-ledger.sql', '2026-11-27-admin-payroll-access.sql', '2026-11-27-admin-payroll-access.sql']) await db.query(migration(m));
    const tag = randomBytes(3).toString('hex');
    const city = (n) => one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'DAILY') RETURNING id", [`PA ${n} ${tag}`, `PA${n}${tag}`]);
    const [mine, other] = [await city('A'), await city('B')];
    const adm = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'admin') RETURNING id, can_use_payroll", [`PA adm ${tag}`, `pa-adm-${tag}@example.test`]);
    assert.equal(adm.can_use_payroll, false, 'off by default');
    await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [adm.id, mine.id]);
    assert.equal(await payrollActorOf({ id: adm.id, role: 'admin' }, db), null);
    assert.deepEqual(await dbService.setPayrollAccessOfAdmin(adm.id, true, db), { id: adm.id, can_use_payroll: true });
    const actor = await payrollActorOf({ id: adm.id, role: 'admin' }, db);
    assert.deepEqual(actor, { id: adm.id, role: 'admin' });

    let code = 710000000 + Math.floor(Math.random() * 9000000);
    const driver = (cityId) => one(`INSERT INTO drivers (password, name, email, driver_code, city_id, enabled) VALUES ('x', $1, $2, $3, $4, true) RETURNING id`,
      [`PA Driver ${code}`, `pa-${(code += 1)}-${tag}@example.test`, code, cityId]);
    const [ownDriver, otherDriver] = [await driver(mine.id), await driver(other.id)];
    const entry = (driverId, cityId) => {
      const parsed = parseNewEntry({ requestId: randomUUID(), driverId, cityId, type: 'manual_claim', amount: '20.00', reason: 'damaged parcel',
        effectiveDate: '2026-11-20', claimType: 'Damaged parcel', recoveryPlan: 'full_next_payday' });
      assert.equal(parsed.errors, undefined, JSON.stringify(parsed.errors));
      return parsed.entry;
    };
    const made = await createEntry(db, actor, entry(ownDriver.id, mine.id));
    assert.ok(made.entry?.id ?? made.id, 'an entry in their own city is saved');
    await assert.rejects(createEntry(db, actor, entry(otherDriver.id, other.id)), (e) => e.status === 403, 'another city is refused');
    await assert.rejects(listEntries(db, actor, { cityId: other.id, driverId: null }), (e) => e.status === 403);
    assert.ok((await listEntries(db, actor, { cityId: mine.id, driverId: null })).entries.length >= 1);
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await pool.end();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanDriverName, findDriverByName, isNameConflict, parseDriverName } from '../services/admin/driverName.js';

test('a driver name is trimmed and its spaces collapsed; a blank or very long name is refused', () => {
  assert.equal(cleanDriverName('  Sai   Venkat\t Kotuvala '), 'Sai Venkat Kotuvala');
  assert.equal(cleanDriverName(null), '');
  assert.deepEqual(parseDriverName('  Sai  Venkat '), { name: 'Sai Venkat' });
  assert.ok(parseDriverName('   ').error);
  assert.ok(parseDriverName(undefined).error);
  assert.ok(parseDriverName(42).error);
  assert.ok(parseDriverName('x'.repeat(101)).error);
  assert.deepEqual(parseDriverName('x'.repeat(100)), { name: 'x'.repeat(100) });
});

test('only a unique-name violation of the drivers table counts as a name conflict', () => {
  assert.equal(isNameConflict({ code: '23505', constraint: 'drivers_name_key' }), true);
  assert.equal(isNameConflict({ code: '23505', constraint: 'drivers_name_normalized_key' }), true);
  assert.equal(isNameConflict({ code: '23505', constraint: 'drivers_email_key' }), false);
  assert.equal(isNameConflict({ code: '23503', constraint: 'drivers_name_key' }), false);
  assert.equal(isNameConflict(new Error('x')), false);
});

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables.
// Everything, the migration included, runs in one transaction that is always rolled back. All drivers are made up.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('driver names are unique ignoring case and spaces', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const savepoint = async (fn) => {
    await db.query('SAVEPOINT s');
    try { return await fn(); } finally { await db.query('ROLLBACK TO SAVEPOINT s'); }
  };
  try {
    await db.query('BEGIN');
    const city = (await db.query("INSERT INTO city (job, city_code, city_type) VALUES ('Test Name City', 'TSTNM', 'DAILY') RETURNING id")).rows[0].id;
    let code = 8800000 + Math.floor(Math.random() * 90000);
    const driver = async (name) => {
      const tag = randomUUID();
      code += 1;
      return (await db.query(
        "INSERT INTO drivers (password, name, email, driver_code, city_id, enabled) VALUES ('x', $1, $2, $3, $4, true) RETURNING id", [name, `${tag}@example.com`, code, city])).rows[0].id;
    };
    // A copy may already hold names that clash only by case or spaces: the migration must refuse then. Set those aside inside this
    // transaction so the rest can be checked.
    const KEY = "lower(regexp_replace(btrim(%s), '\\s+', ' ', 'g'))";
    const key = (c) => KEY.replace('%s', c);
    const setAsideExisting = () => db.query(`UPDATE drivers d SET name = d.name || ' set-aside ' || d.id
       WHERE EXISTS (SELECT 1 FROM drivers o WHERE o.id < d.id AND ${key('o.name')} = ${key('d.name')})`);

    await t.test('the migration refuses to run, and changes nothing, while two drivers clash ignoring case and spaces', async () => {
      await savepoint(async () => {
        const a = await driver('Zed Testname');
        const b = await driver('zed   testname'); // allowed today: the old constraint is exact
        await assert.rejects(db.query(migration('2026-11-04-issue-177-driver-name-unique.sql')), (e) => /driver names clash/.test(e.message) && e.message.includes(`${a}, ${b}`));
      });
      assert.equal((await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'drivers_name_normalized_key'")).rows.length, 0, 'no index was made');
    });

    await setAsideExisting();
    await db.query(migration('2026-11-04-issue-177-driver-name-unique.sql'));
    await db.query(migration('2026-11-04-issue-177-driver-name-unique.sql')); // safe to run twice

    await t.test('once clean, the database refuses a name that differs only by case or spaces, and allows a different name', async () => {
      const first = await driver('Ana Testname');
      for (const clash of ['ana testname', 'ANA TESTNAME', '  Ana   Testname ', 'Ana Testname']) {
        await savepoint(() => assert.rejects(driver(clash), (e) => e.code === '23505' && isNameConflict(e)));
      }
      assert.ok(await driver('Ana Testname Two'), 'a different name is fine');
      assert.ok(first);
    });

    await t.test('findDriverByName finds a clash ignoring case and spaces, and lets a driver keep their own name', async () => {
      const id = await driver('Bo Testname');
      assert.equal((await findDriverByName(db, 'bo   TESTNAME'))?.id, id);
      assert.equal(await findDriverByName(db, 'Bo Testname', id), undefined, 'excluding the driver themselves');
      assert.equal(await findDriverByName(db, 'Bo Testname Other'), undefined);
      const other = await driver('Cy Testname');
      assert.equal((await findDriverByName(db, 'cy testname', id))?.id, other, 'but another driver is still found');
    });

    await t.test('renaming a driver to a name another driver has is refused; a name they keep, or a new one, is fine', async () => {
      const a = await driver('Di Testname');
      await driver('Ed Testname');
      await savepoint(() => assert.rejects(db.query("UPDATE drivers SET name = 'ED TESTNAME' WHERE id = $1", [a]), (e) => isNameConflict(e)));
      await db.query("UPDATE drivers SET name = 'Di Testname Renamed' WHERE id = $1", [a]);
      await db.query("UPDATE drivers SET name = 'Di Testname Renamed' WHERE id = $1", [a]);
    });

    await t.test('the rollback script removes only the new index; the exact constraint stays', async () => {
      await db.query(migration('2026-11-04-issue-177-driver-name-unique.rollback.sql'));
      assert.equal((await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'drivers_name_normalized_key'")).rows.length, 0);
      assert.equal((await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'drivers_name_key'")).rows.length, 1);
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});

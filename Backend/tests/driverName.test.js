import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanDriverName, findDriverByName, isNameConflict, NAME_KEY_SQL, parseDriverName } from '../services/admin/driverName.js';

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

test('tabs, newlines and no-break spaces count as spaces: they are collapsed, and removed at the ends', () => {
  assert.equal(cleanDriverName('\tSai Venkat\n'), 'Sai Venkat');
  assert.equal(cleanDriverName('\n\t Sai\u00a0\u00a0Venkat \r\n'), 'Sai Venkat');
  assert.equal(cleanDriverName('Sai\vVenkat\fKotuvala'), 'Sai Venkat Kotuvala');
  assert.equal(cleanDriverName('   '), '');
  assert.equal(cleanDriverName('\t\n'), '');
  assert.equal(cleanDriverName('Sai Venkat'), 'Sai Venkat', 'an already clean name is unchanged');
  assert.equal(cleanDriverName('Sai Venkat').length, 'Sai Venkat'.length);
  // only the supported characters: an em space is left alone, the same as in the database, so the two keys cannot disagree
  assert.equal(cleanDriverName('Sai\u2003Venkat'), 'Sai\u2003Venkat');
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

    // The database key of a name and the application's key for the same name (clean, then lower case) must be the same for every name.
    await t.test('the database key equals the application key for plain, padded, tabbed, newlined and no-break-spaced names', async () => {
      const names = ['Sai Venkat', 'sai venkat', ' Sai Venkat ', '\tSai Venkat', 'Sai Venkat\n', '\n\tSai \t Venkat \r\n', 'Sai\u00a0Venkat', '\u00a0Sai Venkat\u00a0',
        'Sai\vVenkat', 'Sai\fVenkat', '   ', '\t\n', 'A', 'Sai\u2003Venkat', 'ÉMILE Ray', 'Émile  Ray'];
      for (const name of names) {
        const { rows } = await db.query(`SELECT ${NAME_KEY_SQL('$1::text')} AS k`, [name]);
        assert.equal(rows[0].k, cleanDriverName(name).toLowerCase(), JSON.stringify(name));
      }
    });

    await t.test('legacy names padded with a tab, newline or no-break space clash with the clean name: the migration refuses', async () => {
      for (const [padded, clean] of [['\tLeo Legacy', 'Leo Legacy'], ['Mia Legacy\n', 'Mia Legacy'], ['\u00a0Nia Legacy', 'nia legacy'], ['Ola\t\tLegacy', 'Ola Legacy']]) {
        await savepoint(async () => {
          const a = await driver(padded);
          const b = await driver(clean); // allowed today: the old constraint is exact
          await assert.rejects(db.query(migration('2026-11-04-issue-177-driver-name-unique.sql')), (e) => /driver names clash/.test(e.message) && e.message.includes(`${a}, ${b}`), JSON.stringify(padded));
        });
      }
    });

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

    await t.test('a legacy padded name is found by the clean name, and the index refuses a clean copy; rename and create agree', async () => {
      // Existing names are not rewritten: these are stored with their tab, newline or no-break space.
      const legacy = [['\tPia Legacy ', 'Pia Legacy'], ['Quin Legacy\n', 'quin legacy'], ['\u00a0Rae\u00a0Legacy', 'Rae Legacy']];
      // (the migration already ran, so a padded name cannot be inserted next to a clean one; add the padded ones one at a time)
      for (const [padded, clean] of legacy) {
        const id = await driver(padded);
        assert.equal((await findDriverByName(db, clean))?.id, id, `lookup ${JSON.stringify(clean)}`);
        assert.equal(await findDriverByName(db, clean, id), undefined, 'a driver may keep their own name');
        await savepoint(() => assert.rejects(driver(clean), (e) => isNameConflict(e)));            // a canonical create is refused by the index
        await savepoint(() => assert.rejects(driver(cleanDriverName(padded)), (e) => isNameConflict(e)));
        const other = await driver(`Other ${id}`);
        await savepoint(() => assert.rejects(db.query('UPDATE drivers SET name = $1 WHERE id = $2', [clean, other]), (e) => isNameConflict(e))); // rename is refused too
      }
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Adding a driver whose name is the same as, or only punctuation away from, an existing record (the old, disabled one included) tells the admin which
// record to review. Needs a PostgreSQL copy (never production): PAYROLL_TEST_DB=1 and the DB_* variables. Made-up drivers are created and removed again.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const call = async (handler, req) => {
  let out;
  const res = { status(code) { out = { code }; return this; }, json(body) { out.body = body; return this; } };
  await handler({ headers: {}, query: {}, ...req }, res);
  return out;
};

test('adding a driver with an existing or near-identical name points at the existing record', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const { createUsers } = await import('../controllers/admin/addUserController.js');
  const tag = randomBytes(3).toString('hex');
  const city = (await pool.query('SELECT id, job FROM city WHERE enabled ORDER BY id LIMIT 1')).rows[0];
  const created = [];
  try {
    const old = (await pool.query(
      "INSERT INTO drivers (password, name, email, driver_code, enabled, phone_number, city_id) VALUES ('x', $1, $2, $3, false, '903-405-8843', $4) RETURNING id, driver_code",
      [`Zed Zebra ${tag}`, `zz-${tag}@example.test`, 800000000 + Math.floor(Math.random() * 9000000), city.id])).rows[0];
    created.push(old.id);
    const superAdmin = { id: 1, role: 'superadmin' };
    const add = (over) => call(createUsers, { user: superAdmin, body: { name: `Zed Zebra ${tag}`, email: `new-${tag}-${Math.random().toString(36).slice(2)}@example.test`, password: 'secret1', driver_code: 810000000 + Math.floor(Math.random() * 9000000), city: city.job, enabled: true, phoneNumber: '903-405-1111', ...over } });

    // the same name: refused, and the existing record is named (code and whether it is disabled)
    const exact = await add({ name: ` zed  ZEBRA ${tag} ` });
    assert.equal(exact.code, 409);
    assert.match(exact.body.message, new RegExp(`already exists \\(driver code ${old.driver_code}, disabled\\)\\. Review that record`));

    // a name that differs only by punctuation: a question first, then it can be confirmed
    const similar = await add({ name: `Zed Zebra ${tag}..` });
    assert.deepEqual([similar.code, similar.body.code, similar.body.similar], [409, 'similar_driver', [{ driverCode: old.driver_code, enabled: false }]]);
    const confirmed = await add({ name: `Zed Zebra ${tag}..`, confirmSimilar: true });
    assert.equal(confirmed.code, 200, JSON.stringify(confirmed.body));
    created.push(confirmed.body.insertUser.id);

    // an unrelated name is not questioned
    const other = await add({ name: `Completely Different ${tag}` });
    assert.equal(other.code, 200, JSON.stringify(other.body));
    created.push(other.body.insertUser.id);
  } finally {
    for (const id of created) await pool.query('DELETE FROM drivers WHERE id = $1', [id]);
    await pool.end();
    (await import('../config/redis.js')).default.quit().catch(() => {});
  }
});

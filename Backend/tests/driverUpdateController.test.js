import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Needs a PostgreSQL copy (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. The controller uses the shared pool, so two made-up drivers
// are created and removed again at the end.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const call = async (handler, req) => {
  let out;
  const res = { status(code) { out = { code }; return this; }, json(body) { out.body = body; return this; } };
  await handler(req, res);
  return out;
};

test('editing a driver: every ordinary mistake gets a message that says what to change, and a good edit saves', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const { updateUser } = await import('../controllers/admin/addUserController.js');
  const tag = randomBytes(3).toString('hex');
  const city = (await pool.query('SELECT id, job FROM city WHERE enabled ORDER BY id LIMIT 1')).rows[0];
  const make = async (label, code) => (await pool.query(
    "INSERT INTO drivers (password, name, email, driver_code, city_id, enabled, phone_number) VALUES ('x', $1, $2, $3, $4, true, '903-405-8843') RETURNING id, name, email, driver_code",
    [`Upd ${label} ${tag}`, `upd-${label}-${tag}@example.test`, code, city.id])).rows[0];
  let a; let b;
  try {
    a = await make('a', 700000000 + Math.floor(Math.random() * 90000000));
    b = await make('b', 790000000 + Math.floor(Math.random() * 90000000));
    const edit = (over) => call(updateUser, { params: { id: String(a.id) }, user: { id: 1, role: 'superadmin' },
      body: { name: a.name, email: a.email, city: city.job, enabled: true, phoneNumber: '903-405-8843', driver_code: String(a.driver_code), ...over } });

    const saved = await edit({ phoneNumber: '903-405-0000' });
    assert.equal(saved.code, 200, JSON.stringify(saved.body));
    assert.equal((await pool.query('SELECT phone_number FROM drivers WHERE id = $1', [a.id])).rows[0].phone_number, '903-405-0000');

    const sameEmail = await edit({ email: b.email });
    assert.deepEqual([sameEmail.code, sameEmail.body.message], [409, 'Another driver already uses this email']);
    const sameCode = await edit({ driver_code: String(b.driver_code) });
    assert.deepEqual([sameCode.code, sameCode.body.message], [409, 'Driver code already exists']);
    for (const phoneNumber of ['1'.repeat(21), '', '  ', '12345', undefined]) {
      const refused = await edit({ phoneNumber });
      assert.equal(refused.code, 400, JSON.stringify(phoneNumber));
      assert.match(refused.body.message, /Phone number is required/);
    }
    const badCode = await edit({ driver_code: '12ab' });
    assert.equal(badCode.code, 400);
    assert.match(badCode.body.message, /Driver code must be a whole number/);
    const noEmail = await edit({ email: '  ' });
    assert.deepEqual([noEmail.code, noEmail.body.message], [400, 'Email is required']);
    const noCity = await edit({ city: 'No Such City' });
    assert.equal(noCity.code, 400);
    assert.match(noCity.body.message, /city is disabled/);

    // a form that leaves enabled or the code out keeps what the driver has, instead of failing on an empty column
    const partial = await edit({ enabled: undefined, driver_code: '' });
    assert.equal(partial.code, 200, JSON.stringify(partial.body));
    const row = (await pool.query('SELECT enabled, driver_code FROM drivers WHERE id = $1', [a.id])).rows[0];
    assert.deepEqual([row.enabled, row.driver_code], [true, a.driver_code]);
    // adding a driver without a phone is refused before anything is written
    const { createUsers } = await import('../controllers/admin/addUserController.js');
    const before = Number((await pool.query('SELECT count(*) AS n FROM drivers')).rows[0].n);
    const add = (phoneNumber) => call(createUsers, { user: { id: 1, role: 'superadmin' },
      body: { name: `Upd new ${tag}`, email: `upd-new-${tag}@example.test`, password: 'secret1', driver_code: 810000000 + Math.floor(Math.random() * 1000000), city: city.job, enabled: true, phoneNumber } });
    for (const phoneNumber of [undefined, '', '12345']) {
      const refused = await add(phoneNumber);
      assert.equal(refused.code, 400, JSON.stringify(phoneNumber));
      assert.match(refused.body.message, /Phone number is required/);
    }
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM drivers')).rows[0].n), before, 'no driver was added');
    const added = await add('(903) 405 8843');
    assert.equal(added.code, 200, JSON.stringify(added.body));
    await pool.query('DELETE FROM drivers WHERE email = $1', [`upd-new-${tag}@example.test`]);
    // the failed attempts changed nothing
    assert.equal((await pool.query('SELECT email FROM drivers WHERE id = $1', [a.id])).rows[0].email, a.email);
  } finally {
    await pool.query('DELETE FROM drivers WHERE id = ANY($1::int[])', [[a?.id, b?.id].filter(Boolean)]);
    await pool.end();
  }
});

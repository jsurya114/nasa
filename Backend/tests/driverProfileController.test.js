import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Needs a PostgreSQL copy (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Two made-up drivers are created and removed again at the end.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const call = async (handler, req) => {
  let out;
  const res = { status(code) { out = { code }; return this; }, json(body) { out.body = body; return this; } };
  await handler({ headers: {}, query: {}, ...req }, res);
  return out;
};

test('a driver edits only their own name, email and phone, and stays signed in afterwards', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const { default: profileController } = await import('../controllers/driver/profileController.js');
  const { default: driverController } = await import('../controllers/driver/driverController.js');
  const { generateToken, generateRefreshToken } = await import('../services/jwtservice.js');
  const tag = randomBytes(3).toString('hex');
  const make = async (label, code, enabled = true) => (await pool.query(
    "INSERT INTO drivers (password, name, email, driver_code, enabled, phone_number) VALUES ('x', $1, $2, $3, $4, '903-405-8843') RETURNING id, name, email, driver_code",
    [`Prof ${label} ${tag}`, `prof-${label}-${tag}@example.test`, code, enabled])).rows[0];
  const row = async (id) => (await pool.query('SELECT name, email, phone_number, driver_code, enabled FROM drivers WHERE id = $1', [id])).rows[0];
  let a; let b; let off;
  try {
    a = await make('a', 720000000 + Math.floor(Math.random() * 9000000));
    b = await make('b', 730000000 + Math.floor(Math.random() * 9000000));
    off = await make('off', 740000000 + Math.floor(Math.random() * 9000000), false);
    const me = { id: a.id, email: a.email, name: a.name, role: 'driver' };
    const save = (over, who = me) => call(profileController.updateProfile, { driver: who, body: { name: a.name, email: a.email, phoneNumber: '903-405-8843', ...over } });

    // read
    const read = await call(profileController.getProfile, { driver: me });
    assert.deepEqual([read.code, read.body.profile], [200, { name: a.name, email: a.email, phoneNumber: '903-405-8843' }]);

    // a good edit of all three, with extra spaces cleaned
    const sign = { accessToken: generateToken(me), refreshToken: generateRefreshToken(me) }; // issued BEFORE the edit, with the old email in them
    const newName = `Prof  New ${tag} `;
    const saved = await save({ name: newName, email: ` NEW-${a.email} `, phoneNumber: '(903) 405-0000' });
    assert.equal(saved.code, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.profile, { name: `Prof New ${tag}`, email: `NEW-${a.email}`, phoneNumber: '(903) 405-0000' });
    const stored = await row(a.id);
    assert.deepEqual([stored.name, stored.email, stored.phone_number], [`Prof New ${tag}`, `NEW-${a.email}`, '(903) 405-0000']);
    assert.deepEqual([stored.driver_code, stored.enabled], [a.driver_code, true], 'nothing else on the driver changed');

    // still signed in: the old token (old email inside) still finds the driver, and shows the new name and email
    const access = await call(driverController.getDriver, { headers: { authorization: `Bearer ${sign.accessToken}` } });
    assert.equal(access.code, 200, JSON.stringify(access.body));
    assert.deepEqual([access.body.driver.name, access.body.driver.email], [`Prof New ${tag}`, `NEW-${a.email}`]);
    const refreshed = await call(driverController.RefreshToken, { body: { refreshToken: sign.refreshToken } });
    assert.equal(refreshed.code, 200, JSON.stringify(refreshed.body));

    // saving the same values again writes nothing
    const noChange = await call(profileController.updateProfile, { driver: me, body: saved.body.profile });
    assert.equal(noChange.code, 200);

    // refused: bad values name the field
    const bad = await save({ name: '', email: 'nope', phoneNumber: '12' });
    assert.equal(bad.code, 400);
    assert.deepEqual(Object.keys(bad.body.errors).sort(), ['email', 'name', 'phoneNumber']);
    const spanish = await call(profileController.updateProfile, { driver: me, headers: { 'x-language': 'es' }, body: { name: '', email: 'x@y.co', phoneNumber: '903-405-8843' } });
    assert.equal(spanish.body.errors.name, 'El nombre completo es obligatorio');

    // refused: another driver's name (ignoring case and spaces) or email (ignoring case)
    const sameName = await save({ name: `  ${b.name.toUpperCase()}  ` });
    assert.deepEqual([sameName.code, Object.keys(sameName.body.errors)], [409, ['name']]);
    const sameEmail = await save({ email: b.email.toUpperCase() });
    assert.deepEqual([sameEmail.code, Object.keys(sameEmail.body.errors)], [409, ['email']]);
    // ...but a driver may change only the capital letters of their own name and email
    const caseOnly = await save({ name: `PROF NEW ${tag}`, email: `new-${a.email}` });
    assert.equal(caseOnly.code, 200, JSON.stringify(caseOnly.body));

    // only their own row: an id in the body or the URL means nothing, the token decides
    const before = await row(b.id);
    const sneaky = await call(profileController.updateProfile, { driver: me, params: { id: String(b.id) }, body: { id: b.id, driverId: b.id, name: `PROF NEW ${tag}`, email: `new-${a.email}`, phoneNumber: '903-405-1111' } });
    assert.equal(sneaky.code, 200);
    assert.deepEqual(await row(b.id), before, 'another driver is untouched');
    assert.equal((await row(a.id)).phone_number, '903-405-1111');

    // a disabled account cannot change its profile; an unknown driver gets a 404
    const blocked = await call(profileController.updateProfile, { driver: { id: off.id, role: 'driver' }, body: { name: off.name, email: off.email, phoneNumber: '903-405-8843' } });
    assert.equal(blocked.code, 403);
    const ghost = await call(profileController.getProfile, { driver: { id: 2147483000, role: 'driver' } });
    assert.equal(ghost.code, 404);
  } finally {
    for (const d of [a, b, off]) if (d) await pool.query('DELETE FROM drivers WHERE id = $1', [d.id]);
    await pool.end();
    (await import('../config/redis.js')).default.quit().catch(() => {}); // the controller module opens a Redis connection that would keep the test process alive
  }
});

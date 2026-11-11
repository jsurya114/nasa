import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';

// The current password is checked on two driver routes (Profile email change and Change password). Both share one limit per driver, so the second route
// cannot be used to keep guessing. Needs a PostgreSQL copy (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. One made-up driver, removed again.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const call = async (handler, req) => {
  let out;
  const res = { status(code) { out = { code }; return this; }, json(body) { out.body = body; return this; } };
  await handler({ headers: {}, query: {}, ...req }, res);
  return out;
};

test('guessing the current password is limited per driver across Change password and Profile', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const { default: passwordController } = await import('../controllers/driver/updatepasswordController.js');
  const { default: profileController } = await import('../controllers/driver/profileController.js');
  const tag = randomBytes(3).toString('hex');
  const PASSWORD = 'right-pass-1';
  let driver;
  try {
    driver = (await pool.query(
      "INSERT INTO drivers (password, name, email, driver_code, enabled, phone_number) VALUES ($1, $2, $3, $4, true, '903-405-8843') RETURNING id, name, email",
      [bcrypt.hashSync(PASSWORD, 4), `Pwd ${tag}`, `pwd-${tag}@example.test`, 780000000 + Math.floor(Math.random() * 9000000)])).rows[0];
    const me = { id: driver.id, role: 'driver' };
    const change = (oldPassword) => call(passwordController.updatePassword, { driver: me, body: { oldPassword, newPassword: 'brand-new-2', confirmPassword: 'brand-new-2' } });
    for (let i = 0; i < 5; i++) assert.equal((await change(`guess-${i}`)).code, 401);

    // past the limit nothing is compared: not on Change password, and not on Profile either
    const locked = await change(PASSWORD);
    assert.deepEqual([locked.code, Object.keys(locked.body.errors)], [429, ['oldPassword']]);
    assert.equal(bcrypt.compareSync(PASSWORD, (await pool.query('SELECT password FROM drivers WHERE id = $1', [driver.id])).rows[0].password), true, 'the password did not change');
    const viaProfile = await call(profileController.updateProfile, { driver: me, body: { name: driver.name, email: `new-${driver.email}`, phoneNumber: '903-405-8843', currentPassword: PASSWORD } });
    assert.deepEqual([viaProfile.code, Object.keys(viaProfile.body.errors)], [429, ['currentPassword']]);
  } finally {
    if (driver) await pool.query('DELETE FROM drivers WHERE id = $1', [driver.id]);
    await pool.end();
    (await import('../config/redis.js')).default.quit().catch(() => {});
  }
});

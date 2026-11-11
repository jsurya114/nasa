import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Editing an admin or super admin with a new password used to save everything except the password, so signing in with the new one said
// "Invalid password". Needs a PostgreSQL copy (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Two made-up admins are created and removed.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const call = async (handler, req) => {
  let out;
  const res = { status(code) { out = { code }; return this; }, json(body) { out.body = body; return this; } };
  await handler({ headers: {}, query: {}, ...req }, res);
  return out;
};

test('editing an admin with a new password lets them sign in with it; a blank password keeps the old one', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const { updateAdmin } = await import('../controllers/admin/addAdminController.js');
  const { default: adminController } = await import('../controllers/admin/adminController.js');
  const { dbService } = await import('../services/admin/dbQueries.js');
  const tag = randomBytes(3).toString('hex');
  const city = (await pool.query('SELECT id, job FROM city WHERE enabled ORDER BY id LIMIT 1')).rows[0];
  const cities = [{ value: city.id, label: city.job }];
  const ids = [];
  try {
    for (const role of ['admin', 'superadmin']) {
      const made = await dbService.insertAdmin({ name: `Adm ${role} ${tag}`, email: `adm-${role}-${tag}@example.test`, password: 'old-secret-1', role, city: role === 'admin' ? cities : [] });
      ids.push(made.id);
      const edit = (over) => call(updateAdmin, { params: { id: String(made.id) }, user: { id: 1, role: 'superadmin' },
        body: { name: made.admin_name, email: made.admin_email, role, cities: role === 'admin' ? cities : [], ...over } });
      const signIn = (password) => call(adminController.Login, { body: { email: made.admin_email, password } });
      const stored = async () => (await pool.query('SELECT password FROM admin WHERE id = $1', [made.id])).rows[0].password;

      assert.equal((await signIn('old-secret-1')).code, 200, `${role}: the original password works`);

      // no password, a blank one, or null: the current password is kept
      for (const password of [undefined, '', '   ', null]) {
        const kept = await edit({ password, name: `${made.admin_name} edited` });
        assert.equal(kept.code, 200, `${role}: ${JSON.stringify(password)} ${JSON.stringify(kept.body)}`);
        assert.equal((await signIn('old-secret-1')).code, 200, `${role}: ${JSON.stringify(password)} keeps the old password`);
      }
      assert.equal((await pool.query('SELECT name FROM admin WHERE id = $1', [made.id])).rows[0].name, `${made.admin_name} edited`, 'the other fields were saved');

      // something that is not text is refused and nothing changes
      const before = await stored();
      for (const password of [123456, { a: 1 }, ['x']]) {
        const refused = await edit({ password });
        assert.deepEqual([refused.code, refused.body.message], [400, 'Password must be text'], JSON.stringify(password));
      }
      assert.equal(await stored(), before);

      // a new password: the admin signs in with it, the old one no longer works, and it is stored hashed, exactly as typed
      const saved = await edit({ password: ' new secret 2 ' });
      assert.equal(saved.code, 200, JSON.stringify(saved.body));
      const after = await stored();
      assert.notEqual(after, ' new secret 2 ');
      assert.match(after, /^\$2[aby]\$/);
      assert.equal((await signIn(' new secret 2 ')).code, 200, `${role}: the new password works`);
      assert.equal((await signIn('new secret 2')).code, 401, `${role}: the trimmed text is a different password`);
      const old = await signIn('old-secret-1');
      assert.deepEqual([old.code, old.body.errors.password], [401, 'Invalid password'], `${role}: the old password is gone`);
      assert.equal((await pool.query('SELECT role, is_active FROM admin WHERE id = $1', [made.id])).rows[0].role, role, 'role unchanged');
    }
  } finally {
    for (const id of ids) {
      await pool.query('DELETE FROM admin_city_ref WHERE admin_id = $1', [id]);
      await pool.query('DELETE FROM admin WHERE id = $1', [id]);
    }
    await pool.end();
    (await import('../config/redis.js')).default.quit().catch(() => {}); // the controller modules open a Redis connection that would keep the test process alive
  }
});

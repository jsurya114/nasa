import test from 'node:test';
import assert from 'node:assert/strict';

// The name checks run before anything touches the database, so these need none (issue #177). The duplicate check itself is
// covered against a real database in driverName.test.js.
const call = async (handler, req) => {
  let out;
  const res = { status(code) { out = { code }; return this; }, json(body) { out.body = body; return this; } };
  await handler(req, res);
  return out;
};

const base = { email: 'a@example.com', password: 'secret1', driver_code: 123456, city: 'Test City', enabled: true };

test('creating a driver without a usable name is a 400 that says so, before anything else is checked', async () => {
  const { createUsers } = await import('../controllers/admin/addUserController.js');
  for (const name of [undefined, '', '   ', 42, 'x'.repeat(101)]) {
    const out = await call(createUsers, { body: { ...base, name }, user: { id: 1, role: 'superadmin' } });
    assert.equal(out.code, 400, `name ${JSON.stringify(name)}`);
    assert.match(out.body.message, /Driver name/);
  }
});

test('renaming a driver to a blank name is a 400', async () => {
  const { updateUser } = await import('../controllers/admin/addUserController.js');
  const out = await call(updateUser, { params: { id: '5' }, body: { ...base, name: '  ' }, user: { id: 1, role: 'superadmin' } });
  assert.equal(out.code, 400);
  assert.match(out.body.message, /Driver name is required/);
});

test.after(async () => { (await import('../config/db.js')).default.end().catch(() => {}); });

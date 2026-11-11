import test from 'node:test';
import assert from 'node:assert/strict';

// The Users page endpoint must answer with the Everee status, counts and total from driverList.js, and refuse an unknown choice with a 400 before the
// database is asked. The second test needs a PostgreSQL copy (never production): PAYROLL_TEST_DB=1 and the DB_* variables. It only reads.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const call = async (handler, req) => {
  let out;
  const res = { status(code) { out = { code }; return this; }, json(body) { out.body = body; return this; } };
  await handler(req, res);
  return out;
};

test('an unknown filter, sort or page is a 400 that says so', async () => {
  const { getUsers } = await import('../controllers/admin/addUserController.js');
  for (const query of [{ type: 'local' }, { status: 'done' }, { sort: 'password' }, { dir: 'sideways' }, { page: '0' }]) {
    const answer = await call(getUsers, { query, user: { id: 1, role: 'superadmin' } });
    assert.equal(answer.code, 400, JSON.stringify(query));
    assert.match(answer.body.message, /^Unknown /);
  }
});

test('the list endpoint returns each driver with an Everee status, and the counts for the status chips', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const { getUsers } = await import('../controllers/admin/addUserController.js');
  try {
    const answer = await call(getUsers, { query: { sort: 'status', dir: 'desc' }, user: { id: 1, role: 'superadmin' } });
    assert.equal(answer.code, 200, JSON.stringify(answer.body));
    const { drivers, page, total, totalPages, counts, everee } = answer.body;
    assert.equal(page, 1);
    assert.equal(totalPages, Math.ceil(total / 10));
    assert.equal(counts.all, total);
    assert.ok(everee && typeof everee.configured === 'boolean');
    for (const d of drivers) {
      assert.ok(typeof d.everee_status === 'string' && Array.isArray(d.everee_needs), `driver ${d.id} has an Everee status`);
    }
  } finally {
    await pool.end();
  }
});

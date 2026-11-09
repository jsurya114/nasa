import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resetWeeklyCompanyPrices } from '../controllers/admin/routeController.js';

// The request checks that run before any database work, and that only the owner can reach the route. No database.
const answer = async (body) => {
  const out = {};
  const res = { status(code) { out.code = code; return this; }, json(data) { out.body = data; return this; } };
  await resetWeeklyCompanyPrices({ body, user: { id: 1 } }, res, (error) => { throw error; });
  return out;
};

test('a missing, blank, non-text or over-long city is a 400 and nothing runs', async () => {
  for (const body of [undefined, {}, { job: '' }, { job: '   ' }, { job: 5 }, { job: ['Lafayette GOFO'] }, { job: 'x'.repeat(101) }]) {
    const out = await answer(body);
    assert.equal(out.code, 400, JSON.stringify(body));
    assert.equal(out.body.error, 'Choose the city to reset.');
  }
});

test('the reset route is behind the owner-only check', () => {
  const source = readFileSync(fileURLToPath(new URL('../routes/adminRoutes.js', import.meta.url)), 'utf8');
  assert.match(source, /router\.post\("\/routes\/reset-company-prices", superAdminAuth, resetWeeklyCompanyPrices\)/);
});

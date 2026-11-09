import test from 'node:test';
import assert from 'node:assert/strict';
import { routeStatementPrices } from '../services/finance/routeStatementPrices.js';

// The per-delivery figure a weekly route shows on the Routes page. No database: a stand-in that returns the rows the SQL would.
const dbWith = (rows) => { const calls = []; return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows }; } }; };

test('a route gets the latest statement\'s fee per delivery, rounded to the cent, with its billing week', async () => {
  const db = dbWith([{ route_id: 7, billing_week: 'Week 43-2026', cents: '1048790', deliveries: 6453 }, { route_id: 9, billing_week: 'Week 43-2026', cents: '160', deliveries: 1 }]);
  const prices = await routeStatementPrices(db, [7, 9, 11]);
  assert.deepEqual(prices.get(7), { perDelivery: '1.63', deliveries: 6453, week: 'Week 43-2026' });
  assert.equal(prices.get(9).perDelivery, '1.60');
  assert.equal(prices.has(11), false, 'a route with no statement figure has none');
  assert.deepEqual(db.calls[0].params, [[7, 9, 11]]);
});

test('only published statements, weekly cities and fee lines are used, and nothing is written', async () => {
  const db = dbWith([]);
  await routeStatementPrices(db, [1]);
  const sql = db.calls[0].sql;
  assert.match(sql, /city_type = 'WEEKLY'/);
  assert.match(sql, /s\.status = 'published'/);
  assert.match(sql, /cl\.kind = 'fee'/);
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE)\b/);
});

test('no routes means no query, and a database without the statement tables gives no figures', async () => {
  const db = dbWith([]);
  assert.equal((await routeStatementPrices(db, [])).size, 0);
  assert.equal(db.calls.length, 0);
  const old = { query: async () => { const e = new Error('no table'); e.code = '42P01'; throw e; } };
  assert.equal((await routeStatementPrices(old, [1])).size, 0);
  const broken = { query: async () => { throw new Error('boom'); } };
  await assert.rejects(() => routeStatementPrices(broken, [1]), /boom/);
});

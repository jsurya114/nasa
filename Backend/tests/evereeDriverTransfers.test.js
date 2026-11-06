import test from 'node:test';
import assert from 'node:assert/strict';
import { listOwnTransfers } from '../services/payments/everee/driverTransfers.js';

test('the transfer freshness summary uses chronological order for PostgreSQL Date values', async () => {
  const older = new Date('2026-11-05T12:00:00Z'); // Thursday sorts after Friday as text.
  const newer = new Date('2026-11-06T12:00:00Z');
  const db = { query: async () => ({ rows: [older, newer].map((last_checked_at, i) => ({ id: i + 1, status: 'submitted', amount: '10.00', last_checked_at })) }) };
  const result = await listOwnTransfers(db, 1);
  assert.equal(result.lastCheckedAt.getTime(), newer.getTime());
});

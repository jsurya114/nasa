import test from 'node:test';
import assert from 'node:assert/strict';
import { matchAfterWeeklyAdd } from '../services/finance/gofoStatement/matchAfterWeeklyAdd.js';

// The match that follows a weekly add must never fail the add. A fake connection records what the helper sends, so this runs without a database.
const connection = ({ held = 2, updateError = null } = {}) => {
  const sent = [];
  return {
    sent,
    query: async (sql) => {
      sent.push(sql.trim().split('\n')[0].slice(0, 40));
      if (/WITH open_groups/.test(sql)) { if (updateError) throw updateError; return { rows: [{ statement_id: '5' }, { statement_id: '5' }] }; }
      if (/WITH held AS/.test(sql)) return { rows: [{ expected: 2, held }] };
      return { rows: [] };
    },
  };
};
const logs = () => { const out = { warn: [], error: [] }; return { out, warn: (m) => out.warn.push(m), error: (m) => out.error.push(m) }; };

test('when every attached journey still holds, the match is kept and counted', async () => {
  const client = connection();
  const log = logs();
  assert.equal(await matchAfterWeeklyAdd(client, log), 2);
  assert.equal(client.sent.at(-1), 'RELEASE SAVEPOINT statement_rematch');
  assert.deepEqual([log.out.warn.length, log.out.error.length], [0, 0]);
});

test('when a journey changed under the match, the match is undone, the add is not failed, and it is logged as a warning', async () => {
  const client = connection({ held: 1 });
  const log = logs();
  assert.equal(await matchAfterWeeklyAdd(client, log), 0, 'nothing matched, and no exception reaches the weekly add');
  assert.equal(client.sent.at(-1), 'ROLLBACK TO SAVEPOINT statement_rematch');
  assert.deepEqual([log.out.warn.length, log.out.error.length], [1, 0]);
});

test('any other failure is also undone without failing the add; an older database without the statement tables is skipped quietly', async () => {
  const broken = connection({ updateError: new Error('boom') });
  const log = logs();
  assert.equal(await matchAfterWeeklyAdd(broken, log), 0);
  assert.equal(broken.sent.at(-1), 'ROLLBACK TO SAVEPOINT statement_rematch');
  assert.equal(log.out.error.length, 1);
  const older = connection({ updateError: Object.assign(new Error('relation does not exist'), { code: '42P01' }) });
  const quiet = logs();
  assert.equal(await matchAfterWeeklyAdd(older, quiet), 0);
  assert.deepEqual([quiet.out.warn.length, quiet.out.error.length], [0, 0]);
});

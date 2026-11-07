import test from 'node:test';
import assert from 'node:assert/strict';
import { orderFiles, runBackfill } from '../services/finance/gofoStatement/backfill.js';

// The backfill's decisions, with the preview and publish steps replaced by stand-ins (no database). All values are made up.
const ready = (week, label, kind = 'new') => ({ status: 'ready', period: { start: week, label }, city: { name: 'Test City' }, outcome: { kind }, matching: { matchedRevenue: '10.00', unallocatedRevenue: '1.00' } });
const files = ['c.xlsx', 'a.xlsx', 'b.xlsx', 'd.xlsx', 'e.xlsx'].map((name) => ({ name, buffer: Buffer.from(name) }));
const previews = {
  'c.xlsx': ready('2026-10-19', 'Week 43-2026'),
  'a.xlsx': ready('2026-09-28', 'Week 40-2026'),
  'b.xlsx': { status: 'rejected', reasons: ['Check failed: total billing'], period: null },
  'd.xlsx': ready('2026-10-05', 'Week 41-2026', 'already_published'),
  'e.xlsx': ready('2026-10-12', 'Week 42-2026', 'older_version'),
};
const preview = async (buffer) => previews[buffer.toString()];

test('files are handled oldest week first, files without a week last, then by name', () => {
  const order = orderFiles(files.map((f) => ({ name: f.name, week: previews[f.name].period?.start ?? null }))).map((f) => f.name);
  assert.deepEqual(order, ['a.xlsx', 'd.xlsx', 'e.xlsx', 'c.xlsx', 'b.xlsx']);
});

test('a dry run stores nothing and says what it would do; a rejected file is reported, never published', async () => {
  let published = 0;
  const report = await runBackfill({ files, preview, publish: async () => { published += 1; return { status: 'published' }; } });
  assert.equal(published, 0);
  assert.equal(report.committed, false);
  assert.deepEqual(report.results.map((r) => [r.file, r.outcome]), [
    ['a.xlsx', 'would_publish_new'], ['d.xlsx', 'already_published'], ['e.xlsx', 'older_version'], ['c.xlsx', 'would_publish_new'], ['b.xlsx', 'rejected'],
  ]);
  assert.deepEqual(report.results.at(-1).reasons, ['Check failed: total billing']);
  assert.equal(report.failed, 2, 'a rejected file and an older version are failures to look at');
});

test('with commit the good files are published oldest first with their file name as the label, and the rest are skipped', async () => {
  const seen = [];
  const report = await runBackfill({
    files, commit: true, preview,
    publish: async (buffer, options) => { seen.push([buffer.toString(), options.sourceLabel]); return { status: 'published', version: 1, matching: { matchedRevenue: '10.00', unallocatedRevenue: '1.00' } }; },
  });
  assert.deepEqual(seen, [['a.xlsx', 'a.xlsx'], ['c.xlsx', 'c.xlsx']]);
  assert.equal(report.committed, true);
  assert.deepEqual(report.results.filter((r) => r.outcome === 'published').map((r) => [r.file, r.billingWeek, r.version]), [['a.xlsx', 'Week 40-2026', 1], ['c.xlsx', 'Week 43-2026', 1]]);
});

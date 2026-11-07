// Backfills older carrier (GOFO) weekly statements from a folder (issue #252). Reporting only: the statements are stored in the carrier statement tables and
// nothing in payroll, pay runs, rates or the Dashboard is written. DRY RUN by default: it reads, reconciles and matches every .xlsx in the folder and prints what it
// would do. Add --commit to store them (oldest week first). It prints amounts and file names only, never a driver name.
//
//   From Backend:  node scripts/gofoStatementBackfill.js --dir "path/to/statements"
//                  node scripts/gofoStatementBackfill.js --dir "path/to/statements" --commit [--admin 7]
// Run it on a copy first, after a backup. --admin is the super admin's id, kept as "imported by" in the audit trail.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { runBackfill } from '../services/finance/gofoStatement/backfill.js';
import { previewStatement, publishStatement } from '../services/finance/gofoStatement/publishStatement.js';

const MAX_BYTES = 25 * 1024 * 1024;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };

const usage = () => { console.error('usage: node scripts/gofoStatementBackfill.js --dir <folder> [--commit] [--admin <id>]'); process.exitCode = 1; };

const dir = value('--dir');
const adminId = value('--admin') === undefined ? null : Number(value('--admin'));
if (!dir || (adminId !== null && !Number.isInteger(adminId))) {
  usage();
} else {
  const { default: pool } = await import('../config/db.js');
  try {
    const files = readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.xlsx') && !name.startsWith('~$'))
      .filter((name) => { const size = statSync(join(dir, name)).size; if (size > MAX_BYTES) console.error(`Skipped ${name}: larger than 25 MB`); return size <= MAX_BYTES; })
      .map((name) => ({ name, buffer: readFileSync(join(dir, name)) }));
    if (files.length === 0) throw new Error('no .xlsx files');
    const report = await runBackfill({
      files, commit: flag('--commit'),
      preview: (buffer) => previewStatement(pool, buffer),
      publish: (buffer, { sourceLabel }) => publishStatement(pool, buffer, { user: { id: adminId }, sourceLabel, origin: 'backfill' }),
    });
    console.log(JSON.stringify({ mode: report.committed ? 'committed' : 'dry run (nothing stored; add --commit to store)', note: 'Only the carrier statement tables are written. No payroll, pay run, rate or Dashboard row changes.', ...report }, null, 2));
    if (report.failed > 0) process.exitCode = 2;
  } catch (error) {
    console.error(error.message === 'no .xlsx files' ? 'No .xlsx files in that folder.' : 'The backfill could not run. Check the folder and the database settings.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

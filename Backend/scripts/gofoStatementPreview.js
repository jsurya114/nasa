// Reads a carrier (GOFO) weekly statement workbook and prints whether it reconciles. Read-only: no database, no network, nothing is stored.
// It prints amounts, counts and the failed checks only, never driver names. From Backend: node scripts/gofoStatementPreview.js --file "path/to/statement.xlsx"
import { readFileSync } from 'node:fs';
import { readStatementWorkbook } from '../services/finance/gofoStatement/readStatementWorkbook.js';
import { parseStatement } from '../services/finance/gofoStatement/parseStatement.js';
import { reconcileStatement } from '../services/finance/gofoStatement/reconcileStatement.js';
import { centsToText } from '../services/finance/gofoStatement/statementMoney.js';

const args = process.argv.slice(2);
try {
  if (args.length !== 2 || args[0] !== '--file') throw new Error('usage');
  const result = reconcileStatement(parseStatement(await readStatementWorkbook(readFileSync(args[1]))));
  console.log(JSON.stringify({
    status: result.status, identity: result.identity, amounts: result.amounts, detailLines: result.totals.detailLines, offsetLines: result.totals.offsetLines,
    failedChecks: result.failed.map((c) => ({ name: c.name, expected: typeof c.expected === 'number' ? centsToText(c.expected) : c.expected, actual: typeof c.actual === 'number' ? centsToText(c.actual) : c.actual })),
    issues: result.issues.slice(0, 20), issueCount: result.issues.length, fingerprint: result.fingerprint,
  }, null, 2));
  if (result.status !== 'reconciled') process.exitCode = 2;
} catch {
  console.error('The statement could not be read. Check the file and run: node scripts/gofoStatementPreview.js --file "path/to/statement.xlsx"');
  process.exitCode = 1;
}

import { readStatementWorkbook } from './readStatementWorkbook.js';
import { parseStatement } from './parseStatement.js';
import { reconcileStatement } from './reconcileStatement.js';
import { StatementError, centsToText } from './statementMoney.js';
import { billingWeekDates } from './statementPeriod.js';
import { groupStatementLines, matchGroups } from './matchStatement.js';
import * as store from './statementStore.js';

// Reviews and publishes one carrier (GOFO) weekly statement (issue #252). The order is fixed:
//   1. read and reconcile the workbook against its own controls (no database),
//   2. work out the fleet's city from the routes and match the statement to NASA's recorded work,
//   3. only a statement that reconciles with no problem and belongs to exactly one city can be published.
// Publishing is idempotent: the same statement again changes nothing; a corrected statement for the same fleet and week becomes a new version
// that supersedes the old one, and the old rows stay for the audit trail. Nothing here writes to payment_dashboard or any payroll table.

const CARRIER = 'gofo';
const WEEK_LOCK_KEY = 41290252;
const MAX_REASONS = 20;

const text = (cents) => centsToText(cents);
const cityToken = (value) => String(value ?? '').trim().split(/[\s-]+/)[0].toUpperCase();

// A statement that cannot be published, with every reason. Nothing was stored.
const rejected = (reasons, extra = {}) => ({ status: 'rejected', reasons: reasons.slice(0, MAX_REASONS), ...extra });

// Step 1: the workbook on its own. Returns { statement, reconciliation, week } or a rejection.
export const readAndReconcile = async (buffer) => {
  let statement;
  try {
    statement = parseStatement(await readStatementWorkbook(buffer));
  } catch (error) {
    if (error instanceof StatementError) return rejected([error.message]);
    throw error;
  }
  const reconciliation = reconcileStatement(statement);
  const reasons = [
    ...reconciliation.failed.map((c) => `Check failed: ${c.name}`),
    ...reconciliation.issues.slice(0, 10).map((i) => `${i.sheet} row ${i.row} (${i.field}): ${i.problem}`),
  ];
  let week = null;
  if (statement.header) {
    try { week = billingWeekDates(statement.header.billingPeriodRange); } catch (error) { reasons.push(error.message); }
  }
  if (week) {
    const outside = statement.details.filter((l) => l.signedOn < week.start || l.signedOn > week.end).length;
    if (outside > 0) reasons.push(`${outside} delivery line${outside === 1 ? ' is' : 's are'} signed outside ${week.label} (${week.start} to ${week.end})`);
  }
  if (reconciliation.status !== 'reconciled' || reasons.length > 0) {
    return rejected(reasons.length > 0 ? reasons : ['The statement did not reconcile.'], { reconciliation: summaryOf(reconciliation), week });
  }
  return { status: 'ok', statement, reconciliation, week };
};

const summaryOf = (reconciliation) => ({
  identity: reconciliation.identity, amounts: reconciliation.amounts, fingerprint: reconciliation.fingerprint,
  detailLines: reconciliation.totals.detailLines, offsetLines: reconciliation.totals.offsetLines,
  failedChecks: reconciliation.failed.map((c) => c.name), issueCount: reconciliation.issues.length,
});

// Step 2: the fleet's city and the matching. The fleet must belong to exactly one NASA city, and that city's code must start with the fleet's.
const planStatement = async (db, { statement, reconciliation, week }) => {
  const lines = [...statement.details, ...statement.offsets];
  const routeCodes = [...new Set(lines.map((l) => l.route).filter(Boolean))];
  const routes = await store.loadRoutes(db, routeCodes);
  const cityIds = [...new Set([...routes.values()].map((r) => r.cityId))];
  if (cityIds.length === 0) return rejected(['None of the statement\'s routes is set up in NASA, so the city cannot be found.'], { reconciliation: summaryOf(reconciliation), week });
  if (cityIds.length > 1) return rejected(['The statement\'s routes belong to more than one NASA city. A statement is for one fleet and one city.'], { reconciliation: summaryOf(reconciliation), week });
  const city = [...routes.values()].find((r) => r.cityId === cityIds[0]);
  const fleet = statement.header.fleet;
  if (cityToken(fleet) !== cityToken(city.cityCode)) {
    return rejected([`The statement is for fleet ${fleet}, but its routes belong to ${city.cityName}. Check that the right file was chosen.`], { reconciliation: summaryOf(reconciliation), week });
  }
  const groups = groupStatementLines(statement.details, statement.offsets);
  const [drivers, nasaRows] = await Promise.all([
    store.loadDrivers(db, [...new Set(groups.map((g) => g.deliveryId))]),
    store.loadNasaRows(db, { cityId: city.cityId, from: week.start, to: week.end }),
  ]);
  const match = matchGroups({ groups, routes, drivers, nasaRows, cityId: city.cityId });
  // Whatever is matched or not, every cent of delivery revenue must still be accounted for.
  if (match.totals.matchedCents + match.totals.unallocatedCents !== reconciliation.totals.deliveryRevenue) {
    return rejected(['The matching did not account for every cent of delivery revenue. Nothing was stored.'], { reconciliation: summaryOf(reconciliation), week });
  }
  return { status: 'ready', city, fleet, match };
};

const describe = (reviewed, plan) => {
  const { reconciliation, statement, week } = reviewed;
  const t = plan.match.totals;
  return {
    identity: reconciliation.identity, fingerprint: reconciliation.fingerprint, city: { id: plan.city.cityId, name: plan.city.cityName },
    period: { start: week.start, end: week.end, label: week.label },
    amounts: reconciliation.amounts,
    carrierDeliveries: statement.header.deliveries,
    counts: { detailLines: reconciliation.totals.detailLines, offsetLines: reconciliation.totals.offsetLines, groups: plan.match.groups.length },
    matching: {
      matchedRevenue: text(t.matchedCents), unallocatedRevenue: text(t.unallocatedCents),
      states: Object.fromEntries(Object.entries(t.byState).map(([state, v]) => [state, { groups: v.groups, revenue: text(v.feeCents) }])),
      nasaOnly: { rows: t.nasaOnlyRows, driverEarnings: text(t.nasaOnlyDriverCents) },
    },
  };
};

// What would happen if this exact statement were published now.
const outcomeOf = (existing, fingerprint) => {
  const current = existing.find((s) => s.status === 'published');
  if (current?.fingerprint === fingerprint) return { kind: 'already_published', statementId: current.id, version: current.version };
  const older = existing.find((s) => s.status === 'superseded' && s.fingerprint === fingerprint);
  if (older) return { kind: 'older_version', statementId: older.id, version: older.version, currentVersion: current?.version ?? null };
  return current ? { kind: 'correction', replaces: current.id, replacesVersion: current.version } : { kind: 'new' };
};

// Read-only: everything publishing would check, and what it would do. Stores nothing.
export const previewStatement = async (db, buffer) => {
  const reviewed = await readAndReconcile(buffer);
  if (reviewed.status !== 'ok') return reviewed;
  const plan = await planStatement(db, reviewed);
  if (plan.status !== 'ready') return plan;
  const existing = await db.query('SELECT id, version, status, fingerprint FROM carrier_statements WHERE carrier = $1 AND fleet = $2 AND period_start = $3::date ORDER BY version DESC',
    [CARRIER, plan.fleet, reviewed.week.start]);
  return { status: 'ready', ...describe(reviewed, plan), outcome: outcomeOf(existing.rows, reviewed.reconciliation.fingerprint) };
};

// pool: a pg Pool. user: { id }. origin: 'upload' or 'backfill'.
export const publishStatement = async (pool, buffer, { user, sourceLabel, origin = 'upload' }) => {
  const reviewed = await readAndReconcile(buffer);
  if (reviewed.status !== 'ok') return reviewed;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [WEEK_LOCK_KEY]);
    const plan = await planStatement(client, reviewed);
    if (plan.status !== 'ready') { await client.query('ROLLBACK'); return plan; }
    const { statement, reconciliation, week } = reviewed;
    const existing = await store.lockWeek(client, { carrier: CARRIER, fleet: plan.fleet, periodStart: week.start });
    const outcome = outcomeOf(existing, reconciliation.fingerprint);
    if (outcome.kind === 'already_published' || outcome.kind === 'older_version') {
      await client.query('ROLLBACK');
      return { status: outcome.kind, ...describe(reviewed, plan), outcome };
    }
    if (outcome.kind === 'correction') await store.markSuperseded(client, outcome.replaces);
    const totals = reconciliation.totals;
    const id = await store.insertStatement(client, {
      carrier: CARRIER, fleet: plan.fleet, cityId: plan.city.cityId, periodStart: week.start, periodEnd: week.end, billingWeek: week.label,
      billNumber: statement.header.billNumber, currency: statement.header.currency, fingerprint: reconciliation.fingerprint,
      version: (existing[0]?.version ?? 0) + 1, origin, detailFeeCents: totals.detailFees, offsetCents: totals.offsets, claimsCents: totals.claims,
      adjustmentsCents: totals.adjustments, settlementPayableCents: totals.settlementPayable, prepaidCents: totals.prepaid, withdrawalFeeCents: totals.withdrawalFees,
      detailLines: totals.detailLines, offsetLines: totals.offsetLines, carrierDeliveries: statement.header.deliveries, sourceLabel: String(sourceLabel || 'statement.xlsx').slice(0, 200),
      importedBy: user?.id, supersedesId: outcome.kind === 'correction' ? outcome.replaces : null,
    });
    await store.insertLines(client, id, 'fee', statement.details);
    await store.insertLines(client, id, 'offset', statement.offsets);
    await store.insertItems(client, id, 'claim', statement.claims.map((c) => ({ ...c, label: c.claimType })));
    await store.insertItems(client, id, 'adjustment', statement.adjustments.map((a) => ({ ...a, label: a.expenseType })));
    await store.insertItems(client, id, 'prepaid', statement.prepaid);
    await store.insertItems(client, id, 'withdrawal', statement.withdrawals);
    await store.insertGroups(client, id, plan.match.groups);
    if (outcome.kind === 'correction') await store.addEvent(client, outcome.replaces, 'superseded', user?.id, `Replaced by version ${(existing[0]?.version ?? 0) + 1}`);
    await store.addEvent(client, id, 'published', user?.id, `${origin}: ${reconciliation.identity.billNumber}`);
    await client.query('COMMIT');
    return { status: 'published', statementId: id, version: (existing[0]?.version ?? 0) + 1, ...describe(reviewed, plan), outcome };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

// Read-only pay statements and balances (issue #145). Nothing here writes or recalculates money: every amount is
// read from the frozen statement rows that payRunStore.js wrote with payCalculator.js.
//
// Drivers: only their own statements, and only from finalized or voided runs (a draft is not approved yet).
// Admins: drivers' statements in their own cities, drafts included. The driver ID always comes from the token or a
// city check, never from trust in the request.

import { fromCents, toCents } from '../payRuns/payCalculator.js';
import { assertCityAllowed, isSuperAdmin, loadOverRecovered, NET_COLLECTED_SQL, PayrollError } from '../payRuns/payRunStore.js';

export const DRIVER_RUN_STATUSES = Object.freeze(['finalized', 'voided']);
export const ADMIN_RUN_STATUSES = Object.freeze(['draft', 'finalized', 'voided']);
const LIST_LIMIT = 100;

// One word for where a statement stands, so pending, approved, submitted and paid are never mixed up.
export const statementState = (runStatus, payoutStatus) => {
  if (runStatus === 'draft') return 'pending';
  if (runStatus !== 'finalized') return runStatus; // voided or discarded
  return payoutStatus === 'not_submitted' ? 'approved' : payoutStatus; // submitted | paid | failed | unconfirmed
};

const STATEMENT_SQL = `
  SELECT s.id, s.pay_run_id, s.driver_id, r.city_id, c.job AS city, r.data_type, r.status AS run_status,
         to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
         r.finalized_at, s.gross, s.insurance, s.reimbursements, s.claim_deductions, s.recoveries, s.net, s.carried_forward,
         s.flags, s.payout_status, s.payout_reference, s.paid_at
    FROM pay_statements s
    JOIN pay_runs r ON r.id = s.pay_run_id
    JOIN city c ON c.id = r.city_id`;

const withState = (s) => ({ ...s, state: statementState(s.run_status, s.payout_status) });

// cityIds: null for every city, or the cities the reader may see.
const listStatements = async (db, driverId, statuses, cityIds) => {
  const { rows } = await db.query(
    `${STATEMENT_SQL}
      WHERE s.driver_id = $1 AND r.status = ANY($2::text[]) AND ($3::int[] IS NULL OR r.city_id = ANY($3::int[]))
      ORDER BY r.period_end DESC, s.id DESC
      LIMIT ${LIST_LIMIT}`,
    [driverId, statuses, cityIds]
  );
  return rows.map(withState);
};

// Every line with what it came from: the day and route, the carrier's charge, or the ledger entry and its reason.
const loadLines = async (db, statementId) => {
  const { rows } = await db.query(
    `SELECT l.id, l.line_type, l.amount, to_char(l.journey_date, 'YYYY-MM-DD') AS journey_date, l.active,
            rt.name AS route_name,
            cc.courier, cc.waybill, cc.claim_type, to_char(cc.claim_at, 'YYYY-MM-DD HH24:MI') AS claim_at,
            cc.original_charge AS source_charge, cc.version AS claim_version,
            e.id AS entry_id, e.entry_type, e.reason, e.amount AS entry_amount, e.recovery_plan, e.installment_amount
       FROM pay_statement_lines l
       LEFT JOIN payment_dashboard pd ON pd.id = l.payment_dashboard_id
       LEFT JOIN routes rt ON rt.id = pd.route_id
       LEFT JOIN courier_claims cc ON cc.id = l.claim_id
       LEFT JOIN driver_ledger_entries e ON e.id = l.ledger_entry_id
      WHERE l.statement_id = $1
      ORDER BY CASE l.line_type WHEN 'earning' THEN 1 WHEN 'insurance' THEN 2 WHEN 'reimbursement' THEN 3 WHEN 'claim' THEN 4 ELSE 5 END,
               l.journey_date NULLS LAST, l.id`,
    [statementId]
  );
  return rows;
};

const statementWithLines = async (db, where, params) => {
  const { rows } = await db.query(`${STATEMENT_SQL} WHERE ${where}`, params);
  if (!rows[0]) return null;
  return { ...withState(rows[0]), lines: await loadLines(db, rows[0].id) };
};

// Pay runs that took money for each entry or claim (active lines only; a voided run released its lines).
// Callers limit the lines to this driver's own statements in the reader's cities: claim versions share a claim_key,
// so an earlier version could sit on another driver's or city's statement.
const RUNS_JSON = `COALESCE(json_agg(json_build_object(
    'statementId', s.id, 'runId', r.id, 'runStatus', r.status, 'amount', l.amount::text,
    'periodStart', to_char(r.period_start, 'YYYY-MM-DD'), 'periodEnd', to_char(r.period_end, 'YYYY-MM-DD'))
    ORDER BY r.period_end, r.id), '[]'::json)`;

const sumFinalized = (runs) => runs.filter((r) => r.runStatus === 'finalized').reduce((sum, r) => sum + Math.abs(toCents(r.amount)), 0);

const loadLedgerBalances = async (db, driverId, statuses, cityIds) => {
  const { rows } = await db.query(
    `SELECT e.id, e.city_id, e.entry_type, e.direction, e.amount, e.reason, to_char(e.effective_date, 'YYYY-MM-DD') AS effective_date,
            e.exempt, e.recovery_plan, e.installment_amount, x.pay_runs
       FROM driver_ledger_entries e
       CROSS JOIN LATERAL (
         SELECT ${RUNS_JSON} AS pay_runs
           FROM pay_statement_lines l JOIN pay_statements s ON s.id = l.statement_id JOIN pay_runs r ON r.id = s.pay_run_id
          WHERE l.ledger_entry_id = e.id AND l.active AND r.status = ANY($2::text[]) AND s.driver_id = $1
            AND ($3::int[] IS NULL OR r.city_id = ANY($3::int[]))) x
      WHERE e.driver_id = $1 AND e.entry_type <> 'void'
        AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id)
        AND ($3::int[] IS NULL OR e.city_id = ANY($3::int[]))
      ORDER BY e.effective_date DESC, e.id DESC`,
    [driverId, statuses, cityIds]
  );
  return rows.map((e) => {
    const applied = e.entry_type === 'advance_repayment' ? toCents(e.amount) : sumFinalized(e.pay_runs);
    const outstanding = e.exempt || e.entry_type === 'advance_repayment' ? 0 : Math.max(0, toCents(e.amount) - applied);
    return { ...e, applied: fromCents(applied), outstanding: fromCents(outstanding) };
  });
};

// Matched claims only: an unmatched claim belongs to nobody yet and is never shown to a driver.
const loadClaimBalances = async (db, driverId, statuses, cityIds) => {
  const { rows } = await db.query(
    `SELECT c.id, m.city_id, c.courier, c.waybill, c.claim_type, to_char(c.claim_at, 'YYYY-MM-DD HH24:MI') AS claim_at,
            c.original_charge AS source_charge, m.status, m.eligible_deduction, x.pay_runs,
            -- What has really been collected for any version from anyone, net of finalized refunds: the same figure pay
            -- runs use, so this balance and the next deduction agree. Only the total: no other driver's statement is shown.
            ${NET_COLLECTED_SQL('c')}::text AS net_collected
       FROM courier_claim_matches m
       JOIN courier_claims c ON c.id = m.claim_id
       CROSS JOIN LATERAL (
         SELECT ${RUNS_JSON} AS pay_runs
           FROM pay_statement_lines l JOIN courier_claims cv ON cv.id = l.claim_id
           JOIN pay_statements s ON s.id = l.statement_id JOIN pay_runs r ON r.id = s.pay_run_id
          WHERE cv.claim_key = c.claim_key AND l.active AND r.status = ANY($2::text[]) AND s.driver_id = $1
            AND ($3::int[] IS NULL OR r.city_id = ANY($3::int[]))) x
      WHERE m.driver_id = $1 AND m.status IN ('chargeable', 'exempt') AND c.superseded_at IS NULL
        AND ($3::int[] IS NULL OR m.city_id = ANY($3::int[]))
      ORDER BY c.claim_at DESC, c.id DESC`,
    [driverId, statuses, cityIds]
  );
  return rows.map(({ net_collected: netCollected, ...c }) => {
    const applied = sumFinalized(c.pay_runs);
    const outstanding = c.status === 'exempt' ? 0 : Math.max(0, toCents(c.eligible_deduction ?? '0') - toCents(netCollected));
    return { ...c, applied: fromCents(applied), outstanding: fromCents(outstanding) };
  });
};

// Spreads repayments made outside payroll over what is owed, oldest first (the driver's ledger debts, then carrier
// claims), so the amounts by kind always add up to the total: nothing is counted twice or lost. Penalties are the
// hand-entered claims (ledger type manual_claim). All amounts are whole cents.
export const allocateOwed = (entries, claims, repaidCents) => {
  const byDate = (key) => (a, b) => (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : Number(a.id) - Number(b.id));
  const items = [
    ...entries.filter((e) => e.direction === 'debit').sort(byDate('effective_date')).map((e) => ({ owed: toCents(e.outstanding), penalty: e.entry_type === 'manual_claim' })),
    ...[...claims].sort(byDate('claim_at')).map((c) => ({ owed: toCents(c.outstanding), penalty: false })),
  ];
  let pool = repaidCents;
  const left = { penalties: 0, other: 0 };
  for (const item of items) {
    const used = Math.min(item.owed, pool);
    pool -= used;
    left[item.penalty ? 'penalties' : 'other'] += item.owed - used;
  }
  return { ...left, total: left.penalties + left.other };
};

// owedByDriver: still to be recovered, after repayments made outside payroll. owedToDriver: reimbursements not yet paid.
// refundsDue (admin, one city): claims this driver paid more for than they now owe, in that city, with what a linked
// credit correction needs (courier, waybill, claim type, amount). The same list pay runs flag as claim_over_recovered.
const balances = async (db, driverId, statuses, cityIds, { withRefunds = false } = {}) => {
  const entries = await loadLedgerBalances(db, driverId, statuses, cityIds);
  const claims = await loadClaimBalances(db, driverId, statuses, cityIds);
  const debitCents = entries.filter((e) => e.direction === 'debit').reduce((sum, e) => sum + toCents(e.outstanding), 0)
    + claims.reduce((sum, c) => sum + toCents(c.outstanding), 0);
  const repaidCents = entries.filter((e) => e.entry_type === 'advance_repayment').reduce((sum, e) => sum + toCents(e.amount), 0);
  const owed = allocateOwed(entries, claims, repaidCents);
  const creditCents = entries.filter((e) => e.direction === 'credit' && e.entry_type !== 'advance_repayment')
    .reduce((sum, e) => sum + toCents(e.outstanding), 0);
  const refundsDue = withRefunds && cityIds?.length === 1
    ? (await loadOverRecovered(db, cityIds[0], [driverId])).map((r) => ({ claimId: r.claim_id, courier: r.courier, waybill: r.waybill, claimType: r.claim_type, amount: fromCents(toCents(r.over)) }))
    : undefined;
  return {
    ...(refundsDue && { refundsDue }),
    entries,
    claims,
    // owedPenalties + owedOther always equals owedByDriver (hand-entered penalties apart from everything else owed).
    totals: { owedByDriver: fromCents(Math.max(0, debitCents - repaidCents)), owedPenalties: fromCents(owed.penalties), owedOther: fromCents(owed.other), owedToDriver: fromCents(creditCents) },
  };
};

// ---------- driver (ID from the verified token) ----------

export const listMyStatements = (db, driverId) => listStatements(db, driverId, DRIVER_RUN_STATUSES, null);

export const getMyStatement = async (db, driverId, statementId) => {
  const statement = await statementWithLines(db, 's.id = $1 AND s.driver_id = $2 AND r.status = ANY($3::text[])', [statementId, driverId, DRIVER_RUN_STATUSES]);
  // Someone else's statement and a missing one look the same.
  if (!statement) throw new PayrollError(404, 'statement not found');
  return statement;
};

export const getMyBalances = (db, driverId) => balances(db, driverId, DRIVER_RUN_STATUSES, null);

// ---------- admin ----------

// A city admin must name one of their cities; a super admin may leave it out to see every city.
const adminCities = async (db, admin, cityId) => {
  if (cityId === null) {
    if (!isSuperAdmin(admin)) throw new PayrollError(400, 'choose a city');
    return null;
  }
  await assertCityAllowed(db, admin, cityId);
  return [cityId];
};

export const listDriverStatements = async (db, admin, driverId, cityId) =>
  listStatements(db, driverId, ADMIN_RUN_STATUSES, await adminCities(db, admin, cityId));

export const getStatement = async (db, admin, statementId) => {
  const { rows } = await db.query('SELECT r.city_id FROM pay_statements s JOIN pay_runs r ON r.id = s.pay_run_id WHERE s.id = $1', [statementId]);
  if (!rows[0]) throw new PayrollError(404, 'statement not found');
  await assertCityAllowed(db, admin, rows[0].city_id);
  return statementWithLines(db, 's.id = $1', [statementId]);
};

export const getDriverBalances = async (db, admin, driverId, cityId) =>
  balances(db, driverId, ADMIN_RUN_STATUSES, await adminCities(db, admin, cityId), { withRefunds: true });

// Pay runs (issue #143): make a draft for one city and period, freeze it, or release it.
// Tables: migrations/2026-11-03-issue-143-pay-runs.sql. The money rules live only in payCalculator.js.
// Nothing here marks pay rows paid or sends money: payout is #31 and manual marking is #144.
// Call every write inside a transaction (withTransaction in claimsStore.js).

import { calculateStatement, fromCents, RECOVERY_LIMIT_TYPES, toCents } from './payCalculator.js';
import { LedgerError as PayrollError } from '../ledger/ledgerStore.js';
import { lockCityPayroll } from '../claims/claimsStore.js';
import { CLAIM_TYPE_KEY_SQL } from '../claims/claimRefunds.js';

export { PayrollError };

export const isSuperAdmin = (admin) => admin?.role === 'superadmin';

export const assertCityAllowed = async (db, admin, cityId) => {
  if (isSuperAdmin(admin)) return;
  const { rows } = await db.query('SELECT 1 FROM admin_city_ref WHERE admin_id = $1 AND city_id = $2', [admin?.id, cityId]);
  if (rows.length === 0) throw new PayrollError(403, 'you do not have access to this city');
};

// ---------- settings ----------

export const getRecoveryLimit = async (db) => {
  const { rows } = await db.query("SELECT value FROM payroll_settings WHERE key = 'recovery_limit'");
  return rows[0]?.value ?? null;
};

// Super admin only. value: null (no automatic recovery) or { type, value }. Every change is kept with its reason.
export const setRecoveryLimit = async (db, admin, value, reason) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can change payroll settings');
  if (typeof reason !== 'string' || reason.trim().length < 3) throw new PayrollError(400, 'give a reason for the change');
  if (value !== null) {
    const ok = value && RECOVERY_LIMIT_TYPES.includes(value.type) &&
      (value.type === 'percent_of_available' ? Number.isFinite(value.value) && value.value >= 0 && value.value <= 100
        : /^\d{1,5}(\.\d{1,2})?$/.test(String(value.value)));
    if (!ok) throw new PayrollError(400, 'recovery limit must be null, a percent from 0 to 100, or a fixed amount');
    value = { type: value.type, value: value.type === 'fixed_amount' ? fromCents(toCents(String(value.value))) : value.value };
  }
  const { rows } = await db.query("SELECT value FROM payroll_settings WHERE key = 'recovery_limit' FOR UPDATE");
  await db.query("UPDATE payroll_settings SET value = $1, changed_by = $2, changed_at = now() WHERE key = 'recovery_limit'", [JSON.stringify(value), admin.id]);
  await db.query(
    "INSERT INTO payroll_settings_history (key, old_value, new_value, reason, changed_by) VALUES ('recovery_limit', $1, $2, $3, $4)",
    [JSON.stringify(rows[0]?.value ?? null), JSON.stringify(value), reason.trim(), admin.id]
  );
  return value;
};

// ---------- gathering a driver's inputs ----------

const DATA_TYPE_SQL = `CASE WHEN pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0 THEN 'weekly' ELSE 'daily' END`;

// Closed, unpaid pay rows of the city (by the route's city, as the dashboard does) not already on a live statement.
export const loadEarnings = async (db, run) => {
  const { rows } = await db.query(
    `SELECT pd.id, pd.driver_id, to_char(pd.journey_date, 'YYYY-MM-DD') AS journey_date, pd.route_id,
            COALESCE(pd.driver_payment, 0)::text AS gross, COALESCE(pd.insurance_deduction, 0)::text AS insurance
       FROM payment_dashboard pd
       JOIN routes r ON r.id = pd.route_id
       JOIN city c ON c.job = r.job
      WHERE c.id = $1 AND pd.closed = true AND COALESCE(pd.paid, false) = false
        AND pd.journey_date BETWEEN $2 AND $3 AND ${DATA_TYPE_SQL} = $4
        AND NOT EXISTS (SELECT 1 FROM pay_statement_lines l WHERE l.payment_dashboard_id = pd.id AND l.active AND l.line_type = 'earning')
      ORDER BY pd.driver_id, pd.journey_date, pd.id`,
    [run.city_id, run.period_start, run.period_end, run.data_type]
  );
  return rows;
};

export { CLAIM_TYPE_KEY_SQL };

// What has really been collected for one claim, all versions and every driver, for SQL where the current claim row is
// `alias`. It is each driver's live deductions less the refunds paid to that driver for this claim (a credit correction
// naming it, #142) whose payout is confirmed paid, never below zero per driver. Deductions held by drafts count, so
// nothing is taken twice. A refund counts only once its money has reached the driver: finalized is approval, not
// settlement, and a submitted, failed or unconfirmed payout releases nothing. Until payouts are recorded (#31), the
// liable driver is therefore never charged for a reassigned claim, which is the safe side.
// Example: A was wrongly charged 40 and the claim now belongs to B. B owes nothing until A's 40 refund is paid, then
// B owes 40, exactly once. Shared with the statement view (#145) so both show the same figure.
// Contract for #31: a payout recorded as paid is final here. If paid money comes back (a return), it must be
// reconciled before the statement leaves "paid", because a later run may already have charged the liable driver.
export const NET_COLLECTED_SQL = (alias = 'c') => `(
  SELECT COALESCE(SUM(GREATEST(t.taken - COALESCE(rf.refunded, 0), 0)), 0)
    FROM (SELECT s.driver_id, SUM(-l.amount) AS taken
            FROM pay_statement_lines l
            JOIN courier_claims cv ON cv.id = l.claim_id
            JOIN pay_statements s ON s.id = l.statement_id
           WHERE cv.claim_key = ${alias}.claim_key AND l.active AND l.line_type = 'claim'
           GROUP BY s.driver_id) t
    LEFT JOIN (SELECT e.driver_id, SUM(l.amount) AS refunded
                 FROM pay_statement_lines l
                 JOIN driver_ledger_entries e ON e.id = l.ledger_entry_id
                 JOIN pay_statements s ON s.id = l.statement_id
                 JOIN pay_runs r ON r.id = s.pay_run_id
                WHERE l.active AND l.line_type = 'reimbursement' AND r.status = 'finalized' AND s.payout_status = 'paid'
                  AND e.entry_type = 'correction' AND e.direction = 'credit'
                  AND e.claim_courier = ${alias}.courier AND e.waybill = ${alias}.waybill
                  AND ${CLAIM_TYPE_KEY_SQL('e.claim_type')} = ${alias}.claim_type_key
                GROUP BY e.driver_id) rf ON rf.driver_id = t.driver_id)`;

// Matched, chargeable claims of these drivers in this city with something still owed. Locked so two runs cannot
// both take the same claim.
// lock: false for a read-only preview (the dashboard), which must not hold rows that a real run takes.
export const loadClaims = async (db, cityId, driverIds, lock = true) => {
  const { rows } = await db.query(
    `SELECT m.claim_id, m.driver_id, to_char(c.claim_at, 'YYYY-MM-DD HH24:MI:SS') AS claim_at,
            -- What is still owed: the eligible amount less what has really been collected for any version from anyone.
            (m.eligible_deduction - ${NET_COLLECTED_SQL('c')})::text AS outstanding
       FROM courier_claim_matches m
       JOIN courier_claims c ON c.id = m.claim_id
      WHERE m.status = 'chargeable' AND m.city_id = $1 AND m.driver_id = ANY($2::int[]) AND c.superseded_at IS NULL
      ORDER BY m.claim_id
      ${lock ? 'FOR UPDATE OF m' : ''}`,
    [cityId, driverIds]
  );
  return rows.filter((r) => toCents(r.outstanding) > 0);
};

// Ledger entries of these drivers in this city that still stand, with what each still has to recover. Locked.
// recovered_in_overlap: a live run whose period overlaps this one already recovered from the entry. Recovery is at most
// once per pay period, so a supplemental or overlapping run (daily and weekly, or a second run of the same week)
// never takes a second instalment. Runs of one city are built one at a time (lockCityPayroll), so this holds.
export const loadLedger = async (db, run, driverIds, lock = true) => {
  const { rows } = await db.query(
    `SELECT e.id, e.driver_id, e.entry_type, e.direction, e.amount::text AS amount, e.exempt, e.recovery_plan,
            e.installment_amount::text AS installment_amount,
            to_char(e.effective_date, 'YYYY-MM-DD') AS effective_date, to_char(e.intended_payday, 'YYYY-MM-DD') AS intended_payday,
            (e.amount + COALESCE((SELECT SUM(l.amount) FROM pay_statement_lines l WHERE l.ledger_entry_id = e.id AND l.active AND l.line_type = 'recovery'), 0)
              - COALESCE((SELECT SUM(CASE WHEN st.kind = 'reversal' THEN -st.amount ELSE st.amount END)
                            FROM driver_ledger_settlements st WHERE st.entry_id = e.id), 0))::text AS outstanding,
            EXISTS (SELECT 1 FROM pay_statement_lines l WHERE l.ledger_entry_id = e.id AND l.active AND l.line_type = 'reimbursement') AS reimbursed,
            e.disbursed_outside_payroll,
            EXISTS (SELECT 1 FROM pay_statement_lines l
                      JOIN pay_statements s ON s.id = l.statement_id JOIN pay_runs r ON r.id = s.pay_run_id
                     WHERE l.ledger_entry_id = e.id AND l.active AND l.line_type = 'recovery' AND r.id <> $3
                       AND r.period_start <= $5 AND r.period_end >= $4) AS recovered_in_overlap
       FROM driver_ledger_entries e
      WHERE e.city_id = $1 AND e.driver_id = ANY($2::int[]) AND e.entry_type <> 'void'
        AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id)
      ORDER BY e.id
      ${lock ? 'FOR UPDATE OF e' : ''}`,
    [run.city_id, driverIds, run.id, run.period_start, run.period_end]
  );
  return rows;
};

// Claims where these drivers had more deducted than they now owe: the carrier lowered the claim, made it exempt, or it
// now belongs to another driver. Counted per driver who was actually charged, less any credit correction recorded for
// that claim (#142 corrections may name the waybill and claim type). Only decided claims count: while an amended
// version is still unresolved, nothing is concluded. These are flagged for an approved correction, never refunded here.
// Only this city's runs and corrections count, so a city's run never reads another city's pay. A claim later matched
// to another city is still flagged here, where it was deducted.
export const loadOverRecovered = async (db, cityId, driverIds) => {
  const { rows } = await db.query(
    `WITH taken AS (
       SELECT cv.claim_key, s.driver_id, SUM(-l.amount) AS taken
         FROM pay_statement_lines l
         JOIN courier_claims cv ON cv.id = l.claim_id
         JOIN pay_statements s ON s.id = l.statement_id
         JOIN pay_runs r ON r.id = s.pay_run_id
        WHERE l.active AND l.line_type = 'claim' AND s.driver_id = ANY($1::int[]) AND r.city_id = $2 AND r.status = 'finalized'
        GROUP BY cv.claim_key, s.driver_id)
     SELECT t.driver_id, c.id AS claim_id, c.courier, c.waybill, c.claim_type,
            (t.taken
              - CASE WHEN m.status = 'chargeable' AND m.driver_id = t.driver_id AND m.city_id = $2 THEN m.eligible_deduction ELSE 0 END
              - COALESCE((SELECT SUM(e.amount) FROM driver_ledger_entries e
                           WHERE e.entry_type = 'correction' AND e.direction = 'credit' AND e.driver_id = t.driver_id AND e.city_id = $2
                             AND e.claim_courier = c.courier AND e.waybill = c.waybill
                             AND ${CLAIM_TYPE_KEY_SQL('e.claim_type')} = c.claim_type_key
                             AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id)), 0))::text AS over
       FROM taken t
       JOIN courier_claims c ON c.claim_key = t.claim_key AND c.superseded_at IS NULL
       JOIN courier_claim_matches m ON m.claim_id = c.id
      WHERE m.status IN ('chargeable', 'exempt')`,
    [driverIds, cityId]
  );
  return rows.filter((r) => toCents(r.over) > 0);
};

const holdFor = (e) => {
  if (e.entry_type === 'advance' && !e.disbursed_outside_payroll) return 'advance_not_disbursed';
  if (e.recovered_in_overlap) return 'already_recovered_this_period';
  return undefined;
};

export const inputsFor = (driverId, run, earnings, claims, ledger, overRecovered) => {
  const mine = ledger.filter((e) => e.driver_id === driverId);
  const dueBy = (e) => e.effective_date <= run.period_end && (!e.intended_payday || e.intended_payday <= run.period_end);
  return {
    periodEnd: run.period_end,
    recoveryLimit: run.recovery_limit,
    earnings: earnings.filter((e) => e.driver_id === driverId)
      .map((e) => ({ paymentId: e.id, journeyDate: e.journey_date, routeId: e.route_id, gross: e.gross, insurance: e.insurance })),
    claims: claims.filter((c) => c.driver_id === driverId).map((c) => ({ claimId: c.claim_id, claimAt: c.claim_at, outstanding: c.outstanding })),
    // Reimbursements and credit corrections are paid to the driver once, when due.
    reimbursements: mine.filter((e) => e.direction === 'credit' && e.entry_type !== 'advance_repayment' && !e.reimbursed && dueBy(e))
      .map((e) => ({ entryId: e.id, amount: e.amount })),
    debits: mine.filter((e) => e.direction === 'debit' && !e.exempt)
      .map((e) => ({ entryId: e.id, effectiveDate: e.effective_date, intendedPayday: e.intended_payday, plan: e.recovery_plan,
        installmentAmount: e.installment_amount, outstanding: e.outstanding, hold: holdFor(e) })),
    // A repayment counts only once it has taken effect, by the same date rules as a reimbursement.
    repayments: mine.filter((e) => e.entry_type === 'advance_repayment' && dueBy(e)).map((e) => ({ entryId: e.id, amount: e.amount })),
    overRecovered: overRecovered.filter((o) => o.driver_id === driverId).map((o) => ({ claimId: o.claim_id, amount: fromCents(toCents(o.over)) })),
  };
};

// ---------- runs ----------

const RUN_COLUMNS = `id, request_id, city_id, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
  data_type, status, recovery_limit, created_by, created_at, finalized_by, finalized_at, closed_by, closed_at, close_reason`;

const loadRun = async (db, runId, lock = false) => {
  const { rows } = await db.query(`SELECT ${RUN_COLUMNS} FROM pay_runs WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [runId]);
  if (!rows[0]) throw new PayrollError(404, 'pay run not found');
  return rows[0];
};

// Makes a draft run. request: { requestId, cityId, periodStart, periodEnd, dataType }. Returns { run, replay }.
// The same request ID again returns the first run, so a retried click cannot make a second run.
export const generateRun = async (db, admin, request) => {
  await assertCityAllowed(db, admin, request.cityId);
  const { rows: before } = await db.query(`SELECT ${RUN_COLUMNS} FROM pay_runs WHERE request_id = $1`, [request.requestId]);
  if (before[0]) {
    const same = before[0].city_id === request.cityId && before[0].period_start === request.periodStart && before[0].period_end === request.periodEnd && before[0].data_type === request.dataType;
    if (!same || before[0].created_by !== Number(admin.id)) throw new PayrollError(409, 'this request ID was already used for a different pay run');
    return { run: before[0], replay: true };
  }

  // One run is built at a time per city, so two admins cannot take the same rows or deductions.
  await lockCityPayroll(db, request.cityId);
  const recoveryLimit = await getRecoveryLimit(db);
  const { rows } = await db.query(
    `INSERT INTO pay_runs (request_id, city_id, period_start, period_end, data_type, recovery_limit, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${RUN_COLUMNS}`,
    [request.requestId, request.cityId, request.periodStart, request.periodEnd, request.dataType, JSON.stringify(recoveryLimit), admin.id]
  );
  const run = rows[0];

  const earnings = await loadEarnings(db, run);
  const driverIds = [...new Set(earnings.map((e) => e.driver_id))];
  // Imported GOFO carrier claims come only from the weekly report, so only a weekly run takes them (client decision, 4 Nov 2026). A
  // daily (SpeedX) run uses manual advances and penalties and never consumes a carrier claim. The dashboard estimate follows the same rule.
  const claims = driverIds.length && run.data_type === 'weekly' ? await loadClaims(db, run.city_id, driverIds) : [];
  const ledger = driverIds.length ? await loadLedger(db, run, driverIds) : [];
  const overRecovered = driverIds.length ? await loadOverRecovered(db, run.city_id, driverIds) : [];

  for (const driverId of driverIds) {
    const { lines, totals, flags } = calculateStatement(inputsFor(driverId, run, earnings, claims, ledger, overRecovered));
    const { rows: st } = await db.query(
      `INSERT INTO pay_statements (pay_run_id, driver_id, gross, insurance, reimbursements, claim_deductions, recoveries, net, carried_forward, flags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [run.id, driverId, totals.gross, totals.insurance, totals.reimbursements, totals.claimDeductions, totals.recoveries, totals.net, totals.carriedForward, JSON.stringify(flags)]
    );
    for (const line of lines) {
      await db.query(
        `INSERT INTO pay_statement_lines (statement_id, line_type, amount, payment_dashboard_id, claim_id, ledger_entry_id, journey_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [st[0].id, line.type, line.amount, line.paymentId ?? null, line.claimId ?? null, line.entryId ?? null, line.journeyDate ?? null]
      );
    }
  }
  return { run, replay: false };
};

// A run with its statements, lines, and what is waiting outside it (pending claims, entries needing review).
export const getRun = async (db, admin, runId) => {
  const run = await loadRun(db, runId);
  await assertCityAllowed(db, admin, run.city_id);
  const { rows: statements } = await db.query(
    `SELECT s.*, d.name AS driver_name FROM pay_statements s JOIN drivers d ON d.id = s.driver_id WHERE s.pay_run_id = $1 ORDER BY d.name, s.id`, [runId]);
  const { rows: lines } = await db.query(
    `SELECT l.id, l.statement_id, l.line_type, l.amount, l.payment_dashboard_id, l.claim_id, l.ledger_entry_id,
            to_char(l.journey_date, 'YYYY-MM-DD') AS journey_date, l.active
       FROM pay_statement_lines l JOIN pay_statements s ON s.id = l.statement_id WHERE s.pay_run_id = $1 ORDER BY l.id`, [runId]);
  const { rows: waiting } = await db.query(
    `SELECT (SELECT count(*) FROM courier_claim_matches m JOIN courier_claims c ON c.id = m.claim_id
              WHERE c.import_city_id = $1 AND c.superseded_at IS NULL AND m.status IN ('unresolved', 'ambiguous', 'review'))::int AS pending_claims,
            (SELECT count(*) FROM driver_ledger_entries e WHERE e.city_id = $1 AND e.entry_type = 'advance' AND NOT e.disbursed_outside_payroll
              AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id))::int AS advances_not_paid_out,
            (SELECT count(*) FROM driver_ledger_entries e WHERE e.city_id = $1 AND e.direction = 'debit' AND e.entry_type <> 'void'
              AND NOT e.exempt AND e.recovery_plan IS NULL
              AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id))::int AS entries_needing_review`,
    [run.city_id]
  );
  const totals = statements.reduce((acc, s) => {
    for (const k of ['gross', 'insurance', 'reimbursements', 'claim_deductions', 'recoveries', 'net', 'carried_forward']) acc[k] += toCents(s[k]);
    return acc;
  }, { gross: 0, insurance: 0, reimbursements: 0, claim_deductions: 0, recoveries: 0, net: 0, carried_forward: 0 });
  return {
    run,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, fromCents(v)])),
    statements: statements.map((s) => ({ ...s, lines: lines.filter((l) => l.statement_id === s.id) })),
    waiting: waiting[0],
  };
};

export const listRuns = async (db, admin, cityId) => {
  if (cityId === null && !isSuperAdmin(admin)) throw new PayrollError(400, 'choose a city');
  if (cityId !== null) await assertCityAllowed(db, admin, cityId);
  const { rows } = await db.query(
    `SELECT ${RUN_COLUMNS} FROM pay_runs WHERE ($1::int IS NULL OR city_id = $1) ORDER BY created_at DESC, id DESC LIMIT 200`, [cityId]);
  return rows;
};

// Freezes a draft. A run with a statement below zero cannot be finalized. Finalizing twice is harmless.
export const finalizeRun = async (db, admin, runId) => {
  const run = await loadRun(db, runId, true);
  await assertCityAllowed(db, admin, run.city_id);
  if (run.status === 'finalized') return { run, replay: true };
  if (run.status !== 'draft') throw new PayrollError(409, `a ${run.status} run cannot be finalized`);
  const { rows: negative } = await db.query('SELECT count(*)::int AS n FROM pay_statements WHERE pay_run_id = $1 AND net < 0', [runId]);
  if (negative[0].n > 0) throw new PayrollError(409, 'a statement is below zero; review it before finalizing');
  const { rows } = await db.query(
    `UPDATE pay_runs SET status = 'finalized', finalized_by = $2, finalized_at = now() WHERE id = $1 AND status = 'draft' RETURNING ${RUN_COLUMNS}`,
    [runId, admin.id]
  );
  return { run: rows[0], replay: false };
};

const releaseLines = (db, runId) => db.query(
  `UPDATE pay_statement_lines SET active = false
    WHERE active AND statement_id IN (SELECT id FROM pay_statements WHERE pay_run_id = $1)`, [runId]);

// Throws away a draft and releases everything it held.
export const discardRun = async (db, admin, runId, reason) => {
  const run = await loadRun(db, runId, true);
  await assertCityAllowed(db, admin, run.city_id);
  if (run.status === 'discarded') return { run, replay: true };
  if (run.status !== 'draft') throw new PayrollError(409, 'only a draft can be discarded; a finalized run is voided by a super admin');
  await releaseLines(db, runId);
  const { rows } = await db.query(
    `UPDATE pay_runs SET status = 'discarded', closed_by = $2, closed_at = now(), close_reason = $3 WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
    [runId, admin.id, reason]);
  return { run: rows[0], replay: false };
};

// Super admin only. Voids a finalized run whose money has not left: every statement must be not submitted or failed.
// A submitted, paid or unconfirmed payout must be reconciled first (#31), so a deduction is never released twice.
export const voidRun = async (db, admin, runId, reason) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can void a finalized pay run');
  const run = await loadRun(db, runId, true);
  if (run.status === 'voided') return { run, replay: true };
  if (run.status !== 'finalized') throw new PayrollError(409, 'only a finalized run can be voided; discard a draft instead');
  const { rows: moving } = await db.query(
    "SELECT count(*)::int AS n FROM pay_statements WHERE pay_run_id = $1 AND payout_status NOT IN ('not_submitted', 'failed')", [runId]);
  if (moving[0].n > 0) throw new PayrollError(409, 'some payouts are submitted, paid or unconfirmed; reconcile them before voiding');
  // Serialised with pay runs: a run builds under its city's payroll lock and locks the claim matches it reads, so take
  // the same city lock and lock the matches of every claim this run refunds before checking. A run building at this
  // moment (in any city) either finishes first, so its deduction is seen below, or waits and then sees no refund.
  await lockCityPayroll(db, run.city_id);
  await db.query(
    `SELECT m.claim_id
       FROM pay_statement_lines rl
       JOIN pay_statements rs ON rs.id = rl.statement_id
       JOIN driver_ledger_entries e ON e.id = rl.ledger_entry_id
       JOIN courier_claims cv ON cv.courier = e.claim_courier AND cv.waybill = e.waybill AND cv.claim_type_key = ${CLAIM_TYPE_KEY_SQL('e.claim_type')}
       JOIN courier_claim_matches m ON m.claim_id = cv.id
      WHERE rs.pay_run_id = $1 AND rl.active AND rl.line_type = 'reimbursement' AND e.claim_type IS NOT NULL
      ORDER BY m.claim_id
      FOR UPDATE OF m`,
    [runId]
  );
  // A claim refund paid on this run may already have let a later run charge the driver now liable for that claim.
  // Voiding would take the refund back while that charge stands, so the claim would be collected twice.
  const { rows: relied } = await db.query(
    `SELECT 1
       FROM pay_statement_lines rl
       JOIN pay_statements rs ON rs.id = rl.statement_id
       JOIN driver_ledger_entries e ON e.id = rl.ledger_entry_id
       JOIN courier_claims cv ON cv.courier = e.claim_courier AND cv.waybill = e.waybill AND cv.claim_type_key = ${CLAIM_TYPE_KEY_SQL('e.claim_type')}
       JOIN pay_statement_lines cl ON cl.claim_id = cv.id AND cl.active AND cl.line_type = 'claim'
       JOIN pay_statements cs ON cs.id = cl.statement_id
       JOIN pay_runs cr ON cr.id = cs.pay_run_id
      WHERE rs.pay_run_id = $1 AND rl.active AND rl.line_type = 'reimbursement'
        AND e.entry_type = 'correction' AND e.claim_type IS NOT NULL
        AND cr.id > $1 -- any run made after this one: stricter than "after it was finalized", never looser
      LIMIT 1`,
    [runId]
  );
  if (relied.length) throw new PayrollError(409, 'a later pay run relied on a claim refund in this run; reconcile that claim before voiding');
  // The other direction: a refund recorded for a claim charged on this run depends on that charge. Voiding the charge
  // while the refund stands would pay the driver back money that is no longer taken. Void the refund first.
  const { rows: refunded } = await db.query(
    `SELECT 1
       FROM pay_statement_lines cl
       JOIN pay_statements cs ON cs.id = cl.statement_id
       JOIN courier_claims cv ON cv.id = cl.claim_id
       JOIN driver_ledger_entries e ON e.entry_type = 'correction' AND e.direction = 'credit' AND e.driver_id = cs.driver_id
            AND e.claim_courier = cv.courier AND e.waybill = cv.waybill AND ${CLAIM_TYPE_KEY_SQL('e.claim_type')} = cv.claim_type_key
      WHERE cs.pay_run_id = $1 AND cl.active AND cl.line_type = 'claim'
        AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id)
      LIMIT 1`,
    [runId]
  );
  if (refunded.length) throw new PayrollError(409, 'a refund is recorded for a claim charged on this run; void that refund first');
  await releaseLines(db, runId);
  const { rows } = await db.query(
    `UPDATE pay_runs SET status = 'voided', closed_by = $2, closed_at = now(), close_reason = $3 WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
    [runId, admin.id, reason]);
  return { run: rows[0], replay: false };
};

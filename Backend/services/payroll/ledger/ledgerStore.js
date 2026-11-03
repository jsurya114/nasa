// Database side of the manual driver ledger (issue #142). Table: migrations/2026-11-03-issue-142-driver-ledger.sql.
// Every function takes the signed-in admin from the verified token and checks city access itself, so a screen
// that filters by city cannot be bypassed. Call createEntry and voidEntry inside a transaction.

import { claimTypeKey, isExempt } from '../claims/claimRules.js';
import { entryFingerprint, rowFingerprint } from './ledgerRules.js';
import { refundableForClaim } from '../claims/claimRefunds.js';
import { lockCityPayroll, lockClaimSubject, releaseHeldClaims } from '../claims/claimsStore.js';

export class LedgerError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.name = 'LedgerError';
    this.status = status;
    if (errors) this.errors = errors; // field -> message, for a form
  }
}

export const isSuperAdmin = (admin) => admin?.role === 'superadmin';

export const assertCityAllowed = async (db, admin, cityId) => {
  if (isSuperAdmin(admin)) return;
  const { rows } = await db.query('SELECT 1 FROM admin_city_ref WHERE admin_id = $1 AND city_id = $2', [admin?.id, cityId]);
  if (rows.length === 0) throw new LedgerError(403, 'you do not have access to this city');
};

export const ENTRY_COLUMNS = `id, request_id, driver_id, city_id, entry_type, direction, amount, reason,
  to_char(effective_date, 'YYYY-MM-DD') AS effective_date, to_char(intended_payday, 'YYYY-MM-DD') AS intended_payday,
  disbursed_outside_payroll, claim_type, waybill, claim_courier, exempt, recovery_plan, installment_amount, voids_entry_id, created_by, created_at,
  (direction = 'debit' AND entry_type <> 'void' AND NOT exempt AND recovery_plan IS NULL) AS needs_review`;

// Same form sent twice: return the first result. Same request ID for something else: refuse.
const replayOrConflict = async (db, admin, requestId, matches) => {
  const { rows } = await db.query(`SELECT ${ENTRY_COLUMNS} FROM driver_ledger_entries WHERE request_id = $1`, [requestId]);
  if (rows.length === 0) return null;
  if (rows[0].created_by === Number(admin.id) && matches(rows[0])) return { entry: rows[0], replay: true };
  throw new LedgerError(409, 'this request ID was already used for a different entry');
};

// Records one entry. entry comes from parseNewEntry. Returns { entry, replay }.
export const createEntry = async (db, admin, entry) => {
  // City access first, before anything is read from the ledger.
  await assertCityAllowed(db, admin, entry.cityId);
  // The same comparison here and after a lost insert race below: every saved field must match.
  const sameEntry = (row) => rowFingerprint(row) === entryFingerprint(entry);
  const replay = await replayOrConflict(db, admin, entry.requestId, sameEntry);
  if (replay) return replay;

  const { rows: found } = await db.query(
    'SELECT d.city_id AS driver_city, c.job AS city_name FROM drivers d CROSS JOIN city c WHERE d.id = $1 AND c.id = $2',
    [entry.driverId, entry.cityId]
  );
  if (found.length === 0) throw new LedgerError(404, 'driver or city not found');
  if (found[0].driver_city !== entry.cityId) throw new LedgerError(400, 'this driver does not belong to the chosen city');

  let exempt = false;
  if (entry.type === 'manual_claim') {
    exempt = isExempt(found[0].city_name, entry.claimType);
    if (entry.waybill) {
      // A claim the carrier already sent is applied from the import (#141). Recording it again would charge twice.
      // The lock (shared with the import) stops two submissions, or a submission and an import, from both passing
      // this check at the same moment. It is released when the transaction ends.
      await lockClaimSubject(db, entry.waybill, claimTypeKey(entry.claimType));
      // Claim types are compared by the same key the carrier import uses (claimTypeKey), never by a looser rule.
      const typeKey = claimTypeKey(entry.claimType);
      const { rows: carrier } = await db.query(
        "SELECT 'carrier' AS source FROM courier_claims WHERE waybill = $1 AND claim_type_key = $2 AND superseded_at IS NULL LIMIT 1",
        [entry.waybill, typeKey]
      );
      const { rows: manual } = await db.query(
        `SELECT 'manual' AS source, e.claim_type FROM driver_ledger_entries e
          WHERE e.entry_type = 'manual_claim' AND e.waybill = $1
            AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id)`,
        [entry.waybill]
      );
      const dup = [...carrier, ...manual.filter((m) => claimTypeKey(m.claim_type) === typeKey)];
      if (dup.length) {
        throw new LedgerError(409, dup[0].source === 'carrier'
          ? 'this claim was already imported from the carrier; it will be applied from there'
          : 'this claim is already recorded; void the earlier entry first if it was wrong');
      }
    }
  }

  // A refund for a claim may not exceed what is still refundable to this driver for it. Checked under the city's
  // payroll lock and then the claim's lock (the order pay runs and voids use), so two admins or two stale forms cannot
  // both refund the same over-recovery, and a refund cannot be recorded while the run that made the charge is being
  // voided: whichever comes second sees the other.
  if (entry.type === 'correction' && entry.claimType) {
    const typeKey = claimTypeKey(entry.claimType);
    await lockCityPayroll(db, entry.cityId);
    await lockClaimSubject(db, entry.waybill, typeKey);
    const { refundable, reason } = await refundableForClaim(db, {
      driverId: entry.driverId, cityId: entry.cityId, courier: entry.claimCourier, waybill: entry.waybill, typeKey,
    });
    if (Number(entry.amount) > Number(refundable)) {
      throw new LedgerError(409, Number(refundable) > 0 ? `only ${refundable} is still refundable to this driver for this claim` : reason);
    }
  }

  const { rows } = await db.query(
    `INSERT INTO driver_ledger_entries
       (request_id, driver_id, city_id, entry_type, direction, amount, reason, effective_date, intended_payday,
        disbursed_outside_payroll, claim_type, waybill, claim_courier, exempt, recovery_plan, installment_amount, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (request_id) DO NOTHING
     RETURNING ${ENTRY_COLUMNS}`,
    [entry.requestId, entry.driverId, entry.cityId, entry.type, entry.direction, entry.amount, entry.reason,
      entry.effectiveDate, entry.intendedPayday, entry.disbursedOutsidePayroll, entry.claimType, entry.waybill, entry.claimCourier ?? null, exempt,
      entry.recoveryPlan ?? null, entry.installmentAmount ?? null, admin.id]
  );
  if (rows.length) return { entry: rows[0], replay: false };
  // Another request with the same ID won the race a moment ago.
  return replayOrConflict(db, admin, entry.requestId, sameEntry);
};

// Voids an entry with a later reversing entry. Returns { entry, replay }.
export const voidEntry = async (db, admin, request) => {
  const replay = await replayOrConflict(db, admin, request.requestId,
    (row) => String(row.voids_entry_id) === String(request.entryId) && row.reason === request.reason);
  if (replay) return replay;

  // Take the city's payroll lock before anything else, the same one a pay run is built under, so a void and a run
  // being built cannot pass each other: the run either sees the void, or the void sees the run's lines.
  const { rows: where } = await db.query('SELECT city_id FROM driver_ledger_entries WHERE id = $1', [request.entryId]);
  if (!where[0]) throw new LedgerError(404, 'entry not found');
  await assertCityAllowed(db, admin, where[0].city_id);
  await lockCityPayroll(db, where[0].city_id);
  const { rows } = await db.query(`SELECT ${ENTRY_COLUMNS} FROM driver_ledger_entries WHERE id = $1 FOR UPDATE`, [request.entryId]);
  const original = rows[0];
  if (original.entry_type === 'void') throw new LedgerError(400, 'a void cannot be voided; record a correction instead');
  const { rows: already } = await db.query('SELECT id FROM driver_ledger_entries WHERE voids_entry_id = $1', [original.id]);
  if (already.length) throw new LedgerError(409, 'this entry is already voided');
  // Once a pay run has used an entry, it stays; fix it with a correction entry (or discard/void that run first).
  // (The pay run tables arrive with the #143 migration; until then no entry can be on a run.)
  const { rows: tables } = await db.query("SELECT to_regclass('pay_statement_lines') IS NOT NULL AS ready");
  if (tables[0].ready) {
    const { rows: used } = await db.query('SELECT 1 FROM pay_statement_lines WHERE ledger_entry_id = $1 AND active LIMIT 1', [original.id]);
    if (used.length) throw new LedgerError(409, 'this entry is already on a pay run; record a correction instead');
  }
  const { rows: settledOutside } = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'reversal' THEN -amount ELSE amount END), 0) AS net FROM driver_ledger_settlements WHERE entry_id = $1`, [original.id]);
  if (Number(settledOutside[0].net) > 0) throw new LedgerError(409, 'part of this entry was repaid or waived; reverse that first, or record a correction');
  // Taken before the void is written, so a carrier import of the same claim waits and then sees this entry voided.
  const heldSubject = original.entry_type === 'manual_claim' && original.waybill ? claimTypeKey(original.claim_type) : null;
  if (heldSubject) await lockClaimSubject(db, original.waybill, heldSubject);

  const { rows: inserted } = await db.query(
    `INSERT INTO driver_ledger_entries
       (request_id, driver_id, city_id, entry_type, direction, amount, reason, effective_date, voids_entry_id, created_by)
     VALUES ($1, $2, $3, 'void', $4, $5, $6, CURRENT_DATE, $7, $8)
     RETURNING ${ENTRY_COLUMNS}`,
    [request.requestId, original.driver_id, original.city_id, original.direction === 'debit' ? 'credit' : 'debit',
      original.amount, request.reason, original.id, admin.id]
  );
  // A carrier claim held because this hand-entered claim covered it can now be matched and applied instead.
  if (heldSubject) await releaseHeldClaims(db, original.waybill, heldSubject);
  return { entry: inserted[0], replay: false };
};

// What pay runs did with each entry: settled by finalized runs, reserved by drafts (released if a draft is discarded),
// and the runs themselves. Recovery and reimbursement lines move money; repayment lines are audit only.
const RUN_USE_SQL = `
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(abs(l.amount)) FILTER (WHERE r.status = 'finalized' AND l.line_type IN ('recovery', 'reimbursement')), 0)::numeric(12,2)::text AS settled,
           COALESCE(SUM(abs(l.amount)) FILTER (WHERE r.status = 'draft' AND l.line_type IN ('recovery', 'reimbursement')), 0)::numeric(12,2)::text AS reserved,
           COALESCE((SELECT SUM(CASE WHEN st.kind = 'reversal' THEN -st.amount ELSE st.amount END)
                       FROM driver_ledger_settlements st WHERE st.entry_id = e.id), 0)::numeric(12,2)::text AS settled_outside,
           COALESCE(json_agg(json_build_object('runId', r.id, 'runStatus', r.status, 'lineType', l.line_type, 'amount', l.amount::text,
             'periodStart', to_char(r.period_start, 'YYYY-MM-DD'), 'periodEnd', to_char(r.period_end, 'YYYY-MM-DD')) ORDER BY r.period_end, r.id)
             FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS pay_runs
      FROM pay_statement_lines l
      JOIN pay_statements s ON s.id = l.statement_id
      JOIN pay_runs r ON r.id = s.pay_run_id
     WHERE l.ledger_entry_id = e.id AND l.active) x`;

const cents = (v) => Math.round(Number(v) * 100);
const money = (c) => (c / 100).toFixed(2);

// What is still to settle on one entry, from the driver's side. A void, a voided entry and an exempt claim settle
// nothing; a repayment made outside payroll lowers the driver's total instead (see balances).
const outstandingOf = (e) => {
  if (e.entry_type === 'void' || e.voided_by || e.exempt || e.entry_type === 'advance_repayment') return 0;
  return Math.max(0, cents(e.amount) - cents(e.settled) - cents(e.settled_outside));
};

// Entries for one city (and optionally one driver), newest first, each with what pay runs settled or reserved and
// what is still outstanding, plus each driver's balance. A city admin must name one of their cities; a super admin
// may leave it out. Balance: positive, the driver owes NASA; negative, NASA owes the driver. It counts only what
// finalized runs settled, never what a draft merely reserved.
export const listEntries = async (db, admin, { cityId = null, driverId = null } = {}) => {
  if (cityId === null && !isSuperAdmin(admin)) throw new LedgerError(400, 'choose a city');
  if (cityId !== null) await assertCityAllowed(db, admin, cityId);

  const { rows } = await db.query(
    `SELECT ${ENTRY_COLUMNS},
            (SELECT v.id FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id) AS voided_by,
            x.settled, x.reserved, x.settled_outside, x.pay_runs
       FROM driver_ledger_entries e
       ${RUN_USE_SQL}
      WHERE ($1::int IS NULL OR e.city_id = $1) AND ($2::int IS NULL OR e.driver_id = $2)
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 500`,
    [cityId, driverId]
  );
  const entries = rows.map((e) => ({ ...e, outstanding: money(outstandingOf(e)) }));

  // Over all standing entries, not only the 500 listed.
  const { rows: standing } = await db.query(
    `SELECT e.driver_id, e.entry_type, e.direction, e.amount, e.exempt, NULL AS voided_by, x.settled, x.settled_outside
       FROM driver_ledger_entries e
       ${RUN_USE_SQL}
      WHERE e.entry_type <> 'void'
        AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id)
        AND ($1::int IS NULL OR e.city_id = $1) AND ($2::int IS NULL OR e.driver_id = $2)`,
    [cityId, driverId]
  );
  const totals = {};
  for (const e of standing) {
    let change = 0;
    if (e.entry_type === 'advance_repayment') change = -cents(e.amount);
    else if (e.direction === 'debit') change = outstandingOf(e);
    else change = -outstandingOf(e);
    totals[e.driver_id] = (totals[e.driver_id] ?? 0) + change;
  }
  return { entries, balances: Object.fromEntries(Object.entries(totals).map(([id, c]) => [id, money(c)])) };
};

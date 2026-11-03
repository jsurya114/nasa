// Database side of the manual driver ledger (issue #142). Table: migrations/2026-11-03-issue-142-driver-ledger.sql.
// Every function takes the signed-in admin from the verified token and checks city access itself, so a screen
// that filters by city cannot be bypassed. Call createEntry and voidEntry inside a transaction.

import { claimTypeKey, isExempt } from '../claims/claimRules.js';
import { entryFingerprint, rowFingerprint } from './ledgerRules.js';
import { lockClaimSubject, releaseHeldClaims } from '../claims/claimsStore.js';

export class LedgerError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'LedgerError';
    this.status = status;
  }
}

const isSuperAdmin = (admin) => admin?.role === 'superadmin';

const assertCityAllowed = async (db, admin, cityId) => {
  if (isSuperAdmin(admin)) return;
  const { rows } = await db.query('SELECT 1 FROM admin_city_ref WHERE admin_id = $1 AND city_id = $2', [admin?.id, cityId]);
  if (rows.length === 0) throw new LedgerError(403, 'you do not have access to this city');
};

const ENTRY_COLUMNS = `id, request_id, driver_id, city_id, entry_type, direction, amount, reason,
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

  const { rows } = await db.query(`SELECT ${ENTRY_COLUMNS} FROM driver_ledger_entries WHERE id = $1 FOR UPDATE`, [request.entryId]);
  const original = rows[0];
  if (!original) throw new LedgerError(404, 'entry not found');
  await assertCityAllowed(db, admin, original.city_id);
  if (original.entry_type === 'void') throw new LedgerError(400, 'a void cannot be voided; record a correction instead');
  const { rows: already } = await db.query('SELECT id FROM driver_ledger_entries WHERE voids_entry_id = $1', [original.id]);
  if (already.length) throw new LedgerError(409, 'this entry is already voided');
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

// Entries for one city (and optionally one driver), newest first, with each driver's balance.
// A city admin must name one of their cities; a super admin may leave it out.
export const listEntries = async (db, admin, { cityId = null, driverId = null } = {}) => {
  if (cityId === null && !isSuperAdmin(admin)) throw new LedgerError(400, 'choose a city');
  if (cityId !== null) await assertCityAllowed(db, admin, cityId);

  const { rows } = await db.query(
    `SELECT ${ENTRY_COLUMNS},
            (SELECT v.id FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id) AS voided_by
       FROM driver_ledger_entries e
      WHERE ($1::int IS NULL OR e.city_id = $1) AND ($2::int IS NULL OR e.driver_id = $2)
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 500`,
    [cityId, driverId]
  );

  // Over all entries, not only the listed ones. A voided entry and its void cancel out, so only entries that still
  // stand count; an exempt claim counts as zero. Positive: the driver owes NASA. Negative: NASA owes the driver.
  const { rows: totals } = await db.query(
    `SELECT e.driver_id,
            SUM(CASE WHEN e.exempt THEN 0 WHEN e.direction = 'debit' THEN e.amount ELSE -e.amount END)::numeric(12,2)::text AS balance
       FROM driver_ledger_entries e
      WHERE e.entry_type <> 'void'
        AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id)
        AND ($1::int IS NULL OR e.city_id = $1) AND ($2::int IS NULL OR e.driver_id = $2)
      GROUP BY e.driver_id`,
    [cityId, driverId]
  );
  return { entries: rows, balances: Object.fromEntries(totals.map((t) => [t.driver_id, t.balance])) };
};

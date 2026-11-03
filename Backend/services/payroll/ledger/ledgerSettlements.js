// Settling one ledger debit outside payroll (issue #166): the driver repaid it, or NASA waived it, in whole or in part.
// Each row names the exact entry, so the amount can never also be recovered by a pay run (payRunStore subtracts it
// before recovering). Rows are never changed: a mistake is undone by a reversal. Call inside a transaction.

import { lockCityPayroll } from '../claims/claimsStore.js';
import { assertCityAllowed, isSuperAdmin, LedgerError } from './ledgerStore.js';

const SETTLEMENT_COLUMNS = `id, request_id, entry_id, driver_id, city_id, kind, amount, to_char(settled_on, 'YYYY-MM-DD') AS settled_on,
  reference, reason, reverses_settlement_id, created_by, created_at`;
const cents = (v) => Math.round(Number(v) * 100);
const money = (c) => (c / 100).toFixed(2);

const findByRequest = async (db, requestId) =>
  (await db.query(`SELECT ${SETTLEMENT_COLUMNS} FROM driver_ledger_settlements WHERE request_id = $1`, [requestId])).rows[0] ?? null;

// Same request again by the same admin for the same thing: return the first result. Anything else: refuse.
const replayOrConflict = async (db, admin, requestId, matches) => {
  const row = await findByRequest(db, requestId);
  if (!row) return null;
  if (row.created_by === Number(admin.id) && matches(row)) return { settlement: row, replay: true };
  throw new LedgerError(409, 'this request ID was already used for a different settlement');
};

// What is left on an entry after pay runs (draft or finalized recoveries) and earlier settlements.
const remainingOn = async (db, entryId) => {
  const { rows } = await db.query(
    `SELECT (e.amount
              + COALESCE((SELECT SUM(l.amount) FROM pay_statement_lines l WHERE l.ledger_entry_id = e.id AND l.active AND l.line_type = 'recovery'), 0)
              - COALESCE((SELECT SUM(CASE WHEN s.kind = 'reversal' THEN -s.amount ELSE s.amount END)
                            FROM driver_ledger_settlements s WHERE s.entry_id = e.id), 0))::text AS remaining
       FROM driver_ledger_entries e WHERE e.id = $1`, [entryId]);
  return cents(rows[0].remaining);
};

export const settleEntry = async (db, admin, request) => {
  const sameRequest = (row) => row.kind === request.kind && String(row.entry_id) === String(request.entryId)
    && Number(row.amount) === Number(request.amount) && row.settled_on === request.settledOn
    && (row.reference ?? null) === request.reference && row.reason === request.reason;
  const replay = await replayOrConflict(db, admin, request.requestId, sameRequest);
  if (replay) return replay;

  const { rows: where } = await db.query('SELECT city_id FROM driver_ledger_entries WHERE id = $1', [request.entryId]);
  if (!where[0]) throw new LedgerError(404, 'entry not found');
  await assertCityAllowed(db, admin, where[0].city_id);
  // A waiver forgives money, so only a super admin may record one.
  if (request.kind === 'waiver' && !isSuperAdmin(admin)) throw new LedgerError(403, 'only a super admin can waive an amount');
  // The lock a pay run and a void are built under: a settlement and a run cannot pass each other.
  await lockCityPayroll(db, where[0].city_id);
  const { rows } = await db.query('SELECT id, entry_type, direction, exempt FROM driver_ledger_entries WHERE id = $1 FOR UPDATE', [request.entryId]);
  const entry = rows[0];
  if (entry.direction !== 'debit' || entry.entry_type === 'void' || entry.exempt) throw new LedgerError(400, 'only an amount the driver owes can be repaid or waived');
  const { rows: voided } = await db.query('SELECT 1 FROM driver_ledger_entries WHERE voids_entry_id = $1', [entry.id]);
  if (voided.length) throw new LedgerError(409, 'this entry was voided');

  const left = await remainingOn(db, entry.id);
  if (cents(request.amount) > left) {
    throw new LedgerError(409, left > 0 ? `only ${money(left)} is still outstanding on this entry` : 'nothing is outstanding on this entry');
  }
  const { rows: saved } = await db.query(
    `INSERT INTO driver_ledger_settlements (request_id, entry_id, driver_id, city_id, kind, amount, settled_on, reference, reason, created_by)
     SELECT $1, e.id, e.driver_id, e.city_id, $3, $4, $5, $6, $7, $8 FROM driver_ledger_entries e WHERE e.id = $2
     ON CONFLICT (request_id) DO NOTHING
     RETURNING ${SETTLEMENT_COLUMNS}`,
    [request.requestId, entry.id, request.kind, request.amount, request.settledOn, request.reference, request.reason, admin.id]
  );
  if (saved.length) return { settlement: saved[0], replay: false };
  return replayOrConflict(db, admin, request.requestId, sameRequest);
};

// Undoes one settlement with a reversal row of the same amount. A reversal cannot be reversed; settle again instead.
export const reverseSettlement = async (db, admin, request) => {
  const sameRequest = (row) => String(row.reverses_settlement_id) === String(request.settlementId) && row.reason === request.reason;
  const replay = await replayOrConflict(db, admin, request.requestId, sameRequest);
  if (replay) return replay;

  const { rows: where } = await db.query('SELECT city_id FROM driver_ledger_settlements WHERE id = $1', [request.settlementId]);
  if (!where[0]) throw new LedgerError(404, 'settlement not found');
  await assertCityAllowed(db, admin, where[0].city_id);
  await lockCityPayroll(db, where[0].city_id);
  const { rows } = await db.query('SELECT id, kind FROM driver_ledger_settlements WHERE id = $1', [request.settlementId]);
  if (rows[0].kind === 'reversal') throw new LedgerError(400, 'a reversal cannot be reversed; record a new settlement instead');
  if (rows[0].kind === 'waiver' && !isSuperAdmin(admin)) throw new LedgerError(403, 'only a super admin can reverse a waiver');
  const { rows: already } = await db.query('SELECT 1 FROM driver_ledger_settlements WHERE reverses_settlement_id = $1', [rows[0].id]);
  if (already.length) throw new LedgerError(409, 'this settlement was already reversed');

  const { rows: saved } = await db.query(
    `INSERT INTO driver_ledger_settlements (request_id, entry_id, driver_id, city_id, kind, amount, settled_on, reference, reason, reverses_settlement_id, created_by)
     SELECT $1, s.entry_id, s.driver_id, s.city_id, 'reversal', s.amount, CURRENT_DATE, NULL, $3, s.id, $4 FROM driver_ledger_settlements s WHERE s.id = $2
     ON CONFLICT (request_id) DO NOTHING
     RETURNING ${SETTLEMENT_COLUMNS}`,
    [request.requestId, rows[0].id, request.reason, admin.id]
  );
  if (saved.length) return { settlement: saved[0], replay: false };
  return replayOrConflict(db, admin, request.requestId, sameRequest);
};

// Editing a ledger entry without losing it (issue #166). An edit is one action: the original is voided and a
// corrected entry is recorded, and driver_ledger_edits ties the two together with the reason, the admin and the time.
// The original always stays. An entry already on a pay run, or with a repayment or waiver, is refused by the void
// (record a correction or reverse the settlement instead): a statement or paid history is never rewritten.
// Call inside a transaction.

import { createHash } from 'node:crypto';
import { lockCityPayroll } from '../claims/claimsStore.js';
import { parseNewEntry } from './ledgerRules.js';
import { assertCityAllowed, createEntry, ENTRY_COLUMNS, LedgerError, voidEntry } from './ledgerStore.js';

// A second request ID for the void, made from the edit's own so a retry makes the same one.
const derivedId = (requestId) => {
  const h = createHash('sha256').update(`void:${requestId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const EDIT_COLUMNS = 'id, original_entry_id, void_entry_id, replacement_entry_id, driver_id, city_id, reason, created_by, created_at';

// The original's saved fields, as the form would send them, with the requested changes on top.
const merged = (original, edit) => {
  const c = edit.changes;
  const pick = (key, current) => (Object.hasOwn(c, key) ? c[key] : current);
  return {
    requestId: edit.requestId, driverId: original.driver_id, cityId: original.city_id, type: original.entry_type, direction: original.direction,
    amount: pick('amount', original.amount), reason: pick('entryReason', original.reason),
    effectiveDate: pick('effectiveDate', original.effective_date), intendedPayday: pick('intendedPayday', original.intended_payday),
    disbursedOutsidePayroll: pick('disbursedOutsidePayroll', original.disbursed_outside_payroll),
    recoveryPlan: pick('recoveryPlan', original.recovery_plan), installmentAmount: pick('installmentAmount', original.installment_amount),
    claimType: pick('claimType', original.claim_type), waybill: pick('waybill', original.waybill), claimCourier: original.claim_courier,
  };
};

// edit comes from parseEdit. Returns { entry, edit, replay }: the corrected entry and the link row.
export const editEntry = async (db, admin, edit) => {
  const found = await db.query(`SELECT ${EDIT_COLUMNS} FROM driver_ledger_edits WHERE request_id = $1`, [edit.requestId]);
  if (found.rows[0]) {
    const row = found.rows[0];
    if (row.created_by !== Number(admin.id) || String(row.original_entry_id) !== String(edit.entryId) || row.reason !== edit.reason) {
      throw new LedgerError(409, 'this request ID was already used for a different edit');
    }
    const { rows } = await db.query(`SELECT ${ENTRY_COLUMNS} FROM driver_ledger_entries WHERE id = $1`, [row.replacement_entry_id]);
    return { entry: rows[0], edit: row, replay: true };
  }

  const { rows: where } = await db.query('SELECT city_id FROM driver_ledger_entries WHERE id = $1', [edit.entryId]);
  if (!where[0]) throw new LedgerError(404, 'entry not found');
  await assertCityAllowed(db, admin, where[0].city_id);
  await lockCityPayroll(db, where[0].city_id);
  const { rows } = await db.query(`SELECT ${ENTRY_COLUMNS} FROM driver_ledger_entries WHERE id = $1 FOR UPDATE`, [edit.entryId]);
  const original = rows[0];
  if (original.entry_type === 'void') throw new LedgerError(400, 'a void cannot be edited');

  // Check the corrected entry as a whole before touching anything.
  const parsed = parseNewEntry(merged(original, edit));
  if (parsed.errors) throw new LedgerError(400, 'check the highlighted fields', parsed.errors);

  // The void checks everything an edit must respect: already voided, already on a pay run, repaid or waived.
  const voided = await voidEntry(db, admin, { entryId: original.id, requestId: derivedId(edit.requestId), reason: `Edited: ${edit.reason}` });
  const created = await createEntry(db, admin, parsed.entry);
  const { rows: link } = await db.query(
    `INSERT INTO driver_ledger_edits (request_id, original_entry_id, void_entry_id, replacement_entry_id, driver_id, city_id, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${EDIT_COLUMNS}`,
    [edit.requestId, original.id, voided.entry.id, created.entry.id, original.driver_id, original.city_id, edit.reason, admin.id]
  );
  return { entry: created.entry, edit: link[0], replay: false };
};

const versionOf = (entry, edit) => ({ entry, edit: edit ?? null });

// Everything that happened to one entry, oldest version first: each version with the edit that created it, then the
// settlements, pay-run lines and void of the entry asked for. Read-only.
export const getEntryHistory = async (db, admin, entryId) => {
  const { rows: where } = await db.query('SELECT city_id FROM driver_ledger_entries WHERE id = $1', [entryId]);
  if (!where[0]) throw new LedgerError(404, 'entry not found');
  await assertCityAllowed(db, admin, where[0].city_id);

  const entryById = async (id) => (await db.query(
    `SELECT ${ENTRY_COLUMNS}, (SELECT v.id FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id) AS voided_by FROM driver_ledger_entries e WHERE id = $1`, [id])).rows[0];
  const editInto = async (id) => (await db.query(`SELECT ${EDIT_COLUMNS} FROM driver_ledger_edits WHERE replacement_entry_id = $1`, [id])).rows[0];
  const editFrom = async (id) => (await db.query(`SELECT ${EDIT_COLUMNS} FROM driver_ledger_edits WHERE original_entry_id = $1`, [id])).rows[0];

  // Walk back to the first version, then forward to the latest. A chain is short; the limit only guards bad data.
  const versions = [];
  let edit = await editInto(entryId);
  let current = await entryById(entryId);
  const backward = [versionOf(current, edit)];
  for (let i = 0; edit && i < 100; i += 1) {
    current = await entryById(edit.original_entry_id);
    edit = await editInto(current.id);
    backward.unshift(versionOf(current, edit));
  }
  versions.push(...backward);
  let next = await editFrom(entryId);
  for (let i = 0; next && i < 100; i += 1) {
    versions.push(versionOf(await entryById(next.replacement_entry_id), next));
    next = await editFrom(next.replacement_entry_id);
  }

  const ids = versions.map((v) => v.entry.id);
  const { rows: settlements } = await db.query(
    `SELECT id, entry_id, kind, amount, to_char(settled_on, 'YYYY-MM-DD') AS settled_on, reference, reason, reverses_settlement_id, created_by, created_at
       FROM driver_ledger_settlements WHERE entry_id = ANY($1::bigint[]) ORDER BY id`, [ids]);
  const { rows: payRuns } = await db.query(
    `SELECT l.ledger_entry_id AS entry_id, r.id AS run_id, r.status AS run_status, l.line_type, l.amount,
            to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end
       FROM pay_statement_lines l JOIN pay_statements s ON s.id = l.statement_id JOIN pay_runs r ON r.id = s.pay_run_id
      WHERE l.ledger_entry_id = ANY($1::bigint[]) AND l.active ORDER BY r.period_end, r.id`, [ids]);
  return { entryId: Number(entryId), versions, settlements, payRuns };
};

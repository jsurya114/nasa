import { createHash } from 'node:crypto';
import logger from '../../../utils/logger.js';
import { previewStatement, publishStatement } from './publishStatement.js';

// One GOFO upload (issue #252). The weekly workbook an admin uploads under File Upload -> Weekly Upload is also the carrier's statement. This module keeps one
// "import" row per weekly upload and ties the statement to it:
//   stageImport    inside the upload's own transaction: the file is saved and becomes the import tied to the staged weekly data.
//   reviewImport   after the upload committed: the statement is checked (read-only). A failed check never touches the weekly workflow.
//   settleImport   after the weekly apply committed: an owner's import is published; anything that needs a person is left open for the owner.
//   publishImport / dismissImport   the owner's review of a saved import, without uploading the file again.
// The statement code (reading, reconciling, matching, versions, voids, audit events) is the existing code: publishing here is publishStatement on the saved bytes.
// Nothing here writes to payment_dashboard or any payroll table, and every function answers instead of throwing, so the weekly workflow is never failed by revenue.

const SAVEPOINT = 'carrier_statement_import';
const UNDEFINED_TABLE = '42P01';
const MAX_REASONS = 10;
const OWNER_ROLE = 'superadmin';
const OPEN = ['staged', 'needs_review'];

export const REVENUE_STATE = Object.freeze({
  ready: 'ready', updated: 'updated', alreadyImported: 'already_imported', needsReview: 'needs_review', unavailable: 'unavailable',
});

const MESSAGE = {
  ready: 'Revenue checked. It is published when the weekly data is added to the dashboard.',
  readyForOwner: 'Revenue checked. An owner publishes it after the weekly data is added to the dashboard.',
  updated: 'Revenue updated',
  already_imported: 'Already imported',
  needs_review: 'Revenue needs review',
  unavailable: 'Revenue could not be checked. The weekly upload itself is unaffected.',
};

const isOwner = (user) => user?.role === OWNER_ROLE;
const reasonsOf = (list) => (Array.isArray(list) ? list : [list]).filter(Boolean).map((r) => String(r).slice(0, 300)).slice(0, MAX_REASONS);

// What the browser is told. Company figures are for the owner only: a city admin sees the state and the reasons, never the amounts.
const present = (row, user) => {
  const review = row.review ?? {};
  const state = row.status === 'published' ? REVENUE_STATE.updated
    : row.status === 'already_imported' ? REVENUE_STATE.alreadyImported
    : row.status === 'needs_review' ? REVENUE_STATE.needsReview
    : row.status === 'staged' ? REVENUE_STATE.ready : REVENUE_STATE.unavailable;
  const owner = isOwner(user);
  const message = row.status === 'staged' && !owner ? MESSAGE.readyForOwner : MESSAGE[state === 'ready' ? 'ready' : state];
  return {
    state, message, importId: owner ? String(row.id) : null, reasonKind: row.reason_kind ?? null, reasons: reasonsOf(review.reasons ?? []),
    ...(owner && review.city ? { city: review.city, week: review.week, billNumber: review.billNumber, deliveryRevenue: review.deliveryRevenue, settlementPayable: review.settlementPayable,
      matchedRevenue: review.matchedRevenue, unallocatedRevenue: review.unallocatedRevenue, outcome: review.outcome ?? null } : {}),
  };
};

const summaryOf = (result) => ({
  city: result.city?.name ?? null, week: result.period?.label ?? null, billNumber: result.identity?.billNumber ?? null,
  deliveryRevenue: result.amounts?.deliveryRevenue ?? null, settlementPayable: result.amounts?.settlementPayable ?? null,
  matchedRevenue: result.matching?.matchedRevenue ?? null, unallocatedRevenue: result.matching?.unallocatedRevenue ?? null,
  outcome: result.outcome ? { kind: result.outcome.kind, version: result.outcome.version ?? result.outcome.replacesVersion ?? null } : null,
});

const unavailable = (reason) => ({ state: REVENUE_STATE.unavailable, message: MESSAGE.unavailable, importId: null, reasonKind: null, reasons: reasonsOf(reason), });

// Inside the upload's transaction (after BEGIN, with the upload lock held). In a savepoint: if the import cannot be saved (for example the migration has not
// been run yet) the pay upload carries on exactly as before. Returns { id } or { id: null, reason }.
export const stageImport = async (client, { buffer, fileName, user, assignmentImportId = null }) => {
  await client.query(`SAVEPOINT ${SAVEPOINT}`);
  try {
    // The weekly staging table is replaced by this upload, so the import tied to the old data is no longer the current one. An unapplied, unchecked import is
    // replaced; one waiting for an owner stays open for the owner.
    await client.query("UPDATE carrier_statement_imports SET is_current = false WHERE is_current");
    await client.query("UPDATE carrier_statement_imports SET status = 'replaced', file = NULL, resolved_at = now(), resolve_reason = 'A newer weekly upload replaced it before it was applied.' WHERE status = 'staged'");
    const { rows } = await client.query(
      `INSERT INTO carrier_statement_imports (report_hash, source_label, uploaded_by, uploaded_by_role, assignment_import_id, status, is_current, file)
       VALUES ($1, $2, $3, $4, $5, 'staged', true, $6) RETURNING id`,
      [createHash('sha256').update(buffer).digest('hex'), String(fileName || 'weekly.xlsx').slice(0, 200), user?.id ?? null, user?.role ?? null, assignmentImportId, buffer]
    );
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return { id: rows[0].id };
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    return { id: null, reason: error.code === UNDEFINED_TABLE ? 'Revenue import is not set up in the database yet.' : 'The revenue import could not be saved.' };
  }
};

const load = async (db, id, { forUpdate = false } = {}) => {
  const { rows } = await db.query(`SELECT * FROM carrier_statement_imports WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
};

const close = (db, id, fields) => {
  const { status, reasonKind = null, review = null, statementId = null, userId = null, reason = null, keepFile = false, applied = false } = fields;
  return db.query(
    `UPDATE carrier_statement_imports
        SET status = $2::text, reason_kind = $3::text, review = COALESCE($4::jsonb, review), statement_id = COALESCE($5::bigint, statement_id), file = CASE WHEN $6::boolean THEN file ELSE NULL END,
            resolved_by = CASE WHEN $2::text IN ('staged', 'needs_review') THEN NULL ELSE $7::integer END, resolved_at = CASE WHEN $2::text IN ('staged', 'needs_review') THEN NULL ELSE now() END,
            resolve_reason = $8::text, is_current = CASE WHEN $9::boolean THEN false ELSE is_current END, applied_at = CASE WHEN $9::boolean THEN COALESCE(applied_at, now()) ELSE applied_at END
      WHERE id = $1`,
    [id, status, reasonKind, review ? JSON.stringify(review) : null, statementId, keepFile, userId, reason, applied]
  );
};

// After the upload committed: check the statement without storing anything, and record what was found. Never throws.
export const reviewImport = async (pool, importId, buffer, user) => {
  if (!importId) return unavailable('Revenue import is not set up in the database yet.');
  try {
    const preview = await previewStatement(pool, buffer);
    const row = await load(pool, importId);
    if (!row) return unavailable('The saved import was not found.');
    if (preview.status === 'rejected') {
      await close(pool, importId, { status: 'needs_review', reasonKind: 'check_failed', review: { reasons: reasonsOf(preview.reasons) }, keepFile: true });
    } else {
      const outcome = preview.outcome ?? {};
      const review = { ...summaryOf(preview), reasons: [] };
      if (outcome.kind === 'already_published') await close(pool, importId, { status: 'already_imported', review, statementId: outcome.statementId, reason: 'The same statement already stands.' });
      else if (outcome.kind === 'older_version') await close(pool, importId, { status: 'needs_review', reasonKind: 'older_version', review: { ...review, reasons: [`This is an older version (${outcome.version}) of a statement that was replaced by version ${outcome.currentVersion}.`] }, keepFile: true });
      else if (outcome.kind === 'correction') await close(pool, importId, { status: 'needs_review', reasonKind: 'correction', review: { ...review, reasons: [`This corrects the statement that stands for ${review.city} ${review.week} (version ${outcome.replacesVersion}). An owner confirms a correction.`] }, keepFile: true });
      else await close(pool, importId, { status: 'staged', review, keepFile: true });
    }
    return present(await load(pool, importId), user);
  } catch (error) {
    logger.error('The weekly upload\'s statement could not be checked', { import: String(importId), code: error?.code, message: error?.message });
    return unavailable('The statement could not be checked.');
  }
};

// Read just before the weekly apply: the import tied to the staged weekly data. Null when there is none (or the table does not exist yet).
export const currentImportId = async (pool) => {
  try {
    const { rows } = await pool.query('SELECT id FROM carrier_statement_imports WHERE is_current');
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
};

// After the weekly apply committed, for the import that was current before it. Publishes for an owner; leaves everything that needs a person open for the owner.
// Never throws, and a problem here never undoes the weekly apply. Returns null when no import was tied to the data that was just applied.
export const settleImport = async (pool, user, importId) => {
  if (!importId) return null;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const row = await load(client, importId, { forUpdate: true });
    if (!row) { await client.query('COMMIT'); return null; }
    if (!row.is_current) {
      // A newer upload replaced it between the apply and now, or it was already settled. Report what it is; never publish a file whose data was not the data just applied.
      await client.query('COMMIT');
      return row.applied_at ? present(row, user) : unavailable('A newer weekly upload replaced this one before its revenue was settled. Check the GOFO import history.');
    }
    if (row.status !== 'staged') {
      await close(client, row.id, { status: row.status, reasonKind: row.reason_kind, keepFile: row.status === 'needs_review', applied: true, reason: row.resolve_reason });
      await client.query('COMMIT');
      return present(await load(pool, row.id), user);
    }
    // Revenue is published automatically only when an owner both uploaded the file and adds its data. A file a city admin uploaded is never published as a side effect of
    // someone else's weekly add (the staged data is shared): the owner reviews it and publishes it from the import history.
    if (!isOwner(user) || row.uploaded_by_role !== OWNER_ROLE) {
      const reason = isOwner(user)
        ? 'This file was uploaded by a city admin. An owner reviews it and publishes it from the import history; nothing needs to be uploaded again.'
        : 'Only an owner publishes company revenue. The saved import is waiting for the owner; nothing needs to be uploaded again.';
      await close(client, row.id, { status: 'needs_review', reasonKind: 'owner_required', review: { ...row.review, reasons: [reason] }, keepFile: true, applied: true });
      await client.query('COMMIT');
      return present(await load(pool, row.id), user);
    }
    // The row stays locked while the statement is checked and published on its own connection, so a second apply waits and then finds it settled.
    let outcome;
    try {
      const result = await publishStatement(pool, row.file, { user: { id: user.id }, sourceLabel: row.source_label, importId: row.id, allowCorrection: false });
      outcome = interpret(result);
    } catch {
      outcome = { status: 'needs_review', reasonKind: 'publish_failed', review: { ...row.review, reasons: ['Publishing the revenue did not finish. Nothing was changed; an owner can try again from the saved import.'] }, keepFile: true };
    }
    await close(client, row.id, { ...outcome, userId: user.id, applied: true });
    await client.query('COMMIT');
    return present(await load(pool, row.id), user);
  } catch (error) {
    logger.error('The weekly upload\'s revenue could not be settled', { import: String(importId), code: error?.code, message: error?.message });
    if (client) await client.query('ROLLBACK').catch(() => {});
    return unavailable('The revenue could not be settled. The weekly data was added.');
  } finally {
    client?.release();
  }
};

// publishStatement's answer -> how the import is closed.
const interpret = (result) => {
  const review = result.identity ? { ...summaryOf(result), reasons: [] } : { reasons: reasonsOf(result.reasons ?? []) };
  switch (result.status) {
    case 'published': return { status: 'published', review, statementId: result.statementId, reason: `Published as version ${result.version}.` };
    case 'already_published': return { status: 'already_imported', review, statementId: result.outcome?.statementId, reason: 'The same statement already stands.' };
    case 'older_version': return { status: 'needs_review', reasonKind: 'older_version', review: { ...review, reasons: [`This is an older version (${result.outcome?.version}) of a statement that was replaced by version ${result.outcome?.currentVersion}.`] }, keepFile: true };
    case 'needs_confirmation': return { status: 'needs_review', reasonKind: 'correction', review: { ...review, reasons: [`This corrects the statement that stands for ${review.city} ${review.week} (version ${result.outcome?.replacesVersion}). An owner confirms a correction.`] }, keepFile: true };
    default: return { status: 'needs_review', reasonKind: 'check_failed', review: { reasons: reasonsOf(result.reasons ?? ['The statement did not pass its checks.']) }, keepFile: true };
  }
};

// The owner's list: imports waiting for a decision, newest first. No file, no driver names.
export const listOpenImports = async (pool, { limit = 50 } = {}) => {
  const { rows } = await pool.query(
    `SELECT id, source_label, uploaded_at, status, reason_kind, review, (file IS NOT NULL) AS has_file
       FROM carrier_statement_imports WHERE status = 'needs_review' ORDER BY id DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: String(r.id), sourceLabel: r.source_label, uploadedAt: r.uploaded_at, reasonKind: r.reason_kind, canPublish: r.has_file,
    reasons: reasonsOf(r.review?.reasons ?? []), city: r.review?.city ?? null, week: r.review?.week ?? null, billNumber: r.review?.billNumber ?? null,
    deliveryRevenue: r.review?.deliveryRevenue ?? null, settlementPayable: r.review?.settlementPayable ?? null, outcome: r.review?.outcome ?? null,
  }));
};

// The owner publishes a saved import (or confirms its correction) without uploading the file again. The statement is checked again from the saved bytes.
export const publishImport = async (pool, id, { user, confirmCorrection = false }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await load(client, id, { forUpdate: true });
    if (!row) { await client.query('ROLLBACK'); return { status: 'not_found' }; }
    if (row.status !== 'needs_review' || !row.file) { await client.query('ROLLBACK'); return { status: 'not_open' }; }
    const result = await publishStatement(pool, row.file, { user: { id: user.id }, sourceLabel: row.source_label, importId: row.id, allowCorrection: confirmCorrection === true });
    const outcome = interpret(result);
    if (outcome.status === 'needs_review') {
      // Still not publishable (or a correction not yet confirmed): keep it open with what was found now.
      await close(client, row.id, { ...outcome, keepFile: true });
    } else {
      await close(client, row.id, { ...outcome, userId: user.id });
    }
    await client.query('COMMIT');
    return { status: outcome.status === 'needs_review' ? (outcome.reasonKind === 'correction' ? 'needs_confirmation' : 'rejected') : outcome.status, reasons: outcome.review?.reasons ?? [], statementId: outcome.statementId ?? null, version: result.version ?? null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const dismissImport = async (pool, id, { user, reason }) => {
  const { rowCount } = await pool.query(
    `UPDATE carrier_statement_imports SET status = 'dismissed', file = NULL, resolved_by = $2, resolved_at = now(), resolve_reason = $3, is_current = false
      WHERE id = $1 AND status = 'needs_review'`, [id, user.id, String(reason).slice(0, 300)]);
  return rowCount === 1;
};

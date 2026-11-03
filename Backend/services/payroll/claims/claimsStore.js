// Saves parsed courier claims and keeps their match results (issue #141). Tables: see
// migrations/2026-11-03-issue-141-courier-claims.sql. Nothing here deducts pay: applying a chargeable claim to a
// pay run, exactly once, is issue #143.

import { CLAIM_RULES_VERSION, claimTypeKey, resolveClaim } from './claimRules.js';

const OPEN = ['unresolved', 'ambiguous'];

// Runs fn(client) inside one transaction on a client from the pool.
export const withTransaction = async (pool, fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// One lock per waybill and claim type, held until the transaction ends. The manual driver ledger (#142) takes the
// same lock, so a carrier import and a hand-entered claim for the same waybill cannot both be recorded at once.
export const lockClaimSubject = (db, waybill, typeKey) =>
  db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 138))', [`${waybill}|${typeKey}`]);

// One lock per city for payroll, held until the transaction ends. A pay run is built under it (#143) and a ledger void
// takes it first (#142), so the two cannot interleave.
export const lockCityPayroll = (db, cityId) =>
  db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 143))', [`city:${cityId}`]);

const sameFacts = (row, claim) =>
  Number(row.original_charge).toFixed(2) === Number(claim.charge).toFixed(2) &&
  row.claim_at === claim.claimAt &&
  (row.confirmed_at ?? null) === (claim.confirmedAt ?? null) &&
  row.claim_type === claim.claimType;

// A live hand-entered claim (#142) for the same waybill and claim type, or null. The ledger table arrives with the
// #142 migration; before it exists there can be none.
const liveManualClaim = async (db, waybill, typeKey) => {
  const { rows: ready } = await db.query("SELECT to_regclass('driver_ledger_entries') IS NOT NULL AS ready");
  if (!ready[0].ready) return null;
  const { rows } = await db.query(
    `SELECT e.id, e.claim_type FROM driver_ledger_entries e
      WHERE e.entry_type = 'manual_claim' AND e.waybill = $1
        AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id)
      ORDER BY e.id`,
    [waybill]
  );
  return rows.find((r) => claimTypeKey(r.claim_type) === typeKey) ?? null;
};

// A new version starts unresolved, or on hold ("review") when a hand-entered claim already covers it: the carrier's
// evidence is kept, but only one of the two can ever be recovered.
const insertVersion = async (db, claim, version, source, manual) => {
  const { rows } = await db.query(
    `INSERT INTO courier_claims
       (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, confirmed_at,
        original_charge, deduction_amount, declared_value, remarks, import_city_id,
        source_file, source_sheet, source_row, imported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [claim.courier, claim.key, version, claim.waybill, claim.claimType, claim.claimTypeKey, claim.claimAt, claim.confirmedAt,
      claim.charge, claim.deduction, claim.declaredValue, claim.remarks, source.importCityId,
      source.sourceFile, source.sourceSheet, claim.sourceRow, source.importedBy ?? null]
  );
  await db.query(
    `INSERT INTO courier_claim_matches (claim_id, status, reason, rule_version) VALUES ($1, $2, $3, $4)`,
    [rows[0].id, manual ? 'review' : 'unresolved',
      manual ? `on hold: hand-entered claim (ledger entry ${manual.id}) covers this waybill and claim type; void it to apply the carrier's claim instead`
        : 'waiting for delivery history',
      CLAIM_RULES_VERSION]
  );
  return rows[0].id;
};

// Puts claims held for a hand-entered claim back into matching, once that entry is voided (#142 calls this under the
// same subject lock). Returns how many were released.
export const releaseHeldClaims = async (db, waybill, typeKey) => {
  const { rowCount } = await db.query(
    `UPDATE courier_claim_matches m SET status = 'unresolved', reason = 'released: the hand-entered claim was voided', matched_at = now()
       FROM courier_claims c
      WHERE c.id = m.claim_id AND m.status = 'review' AND c.superseded_at IS NULL AND c.waybill = $1 AND c.claim_type_key = $2`,
    [waybill, typeKey]
  );
  return rowCount;
};

// Saves the claims from one parsed file. Call inside a transaction (see withTransaction).
// source: { importCityId, sourceFile, sourceSheet, importedBy }.
// Returns { inserted, duplicates, amended, held }, each a list of { claimId, sourceRow } (amended also has previousId).
// held lists the new versions put on hold because a hand-entered claim already covers them.
// - A claim seen before with the same facts is a duplicate: nothing is written, so it can never charge twice.
// - A claim seen before with different facts becomes a new version; the old one is marked superseded.
//   If the old version was already applied to a pay run, #143 must correct it with a later entry.
export const importClaims = async (db, claims, source) => {
  if (!Number.isInteger(source?.importCityId)) throw new Error('importCityId is required');
  if (!source.sourceFile || !source.sourceSheet) throw new Error('sourceFile and sourceSheet are required');
  const result = { inserted: [], duplicates: [], amended: [], held: [] };

  for (const claim of claims) {
    // Two uploads of the same claim at the same moment wait for each other here.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 141))', [claim.key]);
    await lockClaimSubject(db, claim.waybill, claim.claimTypeKey);
    const { rows } = await db.query(
      `SELECT id, version, original_charge, claim_type,
              to_char(claim_at, 'YYYY-MM-DD HH24:MI:SS') AS claim_at,
              to_char(confirmed_at, 'YYYY-MM-DD HH24:MI:SS') AS confirmed_at
         FROM courier_claims WHERE claim_key = $1 AND superseded_at IS NULL`,
      [claim.key]
    );
    const current = rows[0];
    if (current && sameFacts(current, claim)) {
      result.duplicates.push({ claimId: current.id, sourceRow: claim.sourceRow });
      continue;
    }
    // Checked under the subject lock, so a hand-entered claim cannot be recorded between this check and the insert.
    const manual = await liveManualClaim(db, claim.waybill, claim.claimTypeKey);
    let claimId;
    if (!current) {
      claimId = await insertVersion(db, claim, 1, source, manual);
      result.inserted.push({ claimId, sourceRow: claim.sourceRow });
    } else {
      await db.query('UPDATE courier_claims SET superseded_at = now() WHERE id = $1', [current.id]);
      claimId = await insertVersion(db, claim, current.version + 1, source, manual);
      result.amended.push({ claimId, previousId: current.id, sourceRow: claim.sourceRow });
    }
    if (manual) result.held.push({ claimId, sourceRow: claim.sourceRow, ledgerEntryId: manual.id });
  }
  return result;
};

// Tries again to match one batch of current claims that are still unresolved or ambiguous, in claim order after
// `afterId`. findCandidates({ courier, waybill }) must return the delivery history for that waybill, from history
// only: [{ driverId, cityId, cityName, carrierDeliveryId, routeId, journeyDate }]. It is supplied by the GOFO
// waybill history (#140). Claims already chargeable, exempt or held for review are never changed here.
// waybills: limit the batch to these waybills (for example the ones an assignment import just added), or null.
// Call inside a transaction. Returns { counts, nextAfterId }; nextAfterId is null when there is nothing after this batch.
export const rematchOpenClaims = async (db, findCandidates, { limit = 500, afterId = 0, waybills = null } = {}) => {
  const { rows } = await db.query(
    `SELECT c.id, c.courier, c.waybill, c.claim_type, c.deduction_amount, c.import_city_id
       FROM courier_claims c
       JOIN courier_claim_matches m ON m.claim_id = c.id
      WHERE c.superseded_at IS NULL AND m.status = ANY($1::text[]) AND c.id > $3
        AND ($4::text[] IS NULL OR c.waybill = ANY($4::text[]))
      ORDER BY c.id
      LIMIT $2
      FOR UPDATE OF m SKIP LOCKED`,
    [OPEN, limit, afterId, waybills]
  );

  const counts = { chargeable: 0, exempt: 0, unresolved: 0, ambiguous: 0 };
  for (const row of rows) {
    const candidates = await findCandidates({ courier: row.courier, waybill: row.waybill });
    const match = resolveClaim({ claimType: row.claim_type, deduction: Number(row.deduction_amount).toFixed(2) }, candidates, row.import_city_id);
    await db.query(
      `UPDATE courier_claim_matches
          SET status = $2, driver_id = $3, city_id = $4, carrier_delivery_id = $5, route_id = $6, journey_date = $7,
              eligible_deduction = $8, reason = $9, rule_version = $10, matched_at = now()
        WHERE claim_id = $1 AND status = ANY($11::text[])`,
      [row.id, match.status, match.driverId, match.cityId, match.carrierDeliveryId, match.routeId, match.journeyDate,
        match.eligibleDeduction, match.reason, CLAIM_RULES_VERSION, OPEN]
    );
    counts[match.status] += 1;
  }
  return { counts, nextAfterId: rows.length === limit ? rows[rows.length - 1].id : null };
};

// One fair pass over every open claim (or only `waybills`), batch after batch. Claims that stay unresolved at the
// front no longer stop later claims from being matched. Returns the summed counts.
export const rematchAllOpenClaims = async (db, findCandidates, { batch = 500, waybills = null } = {}) => {
  const total = { chargeable: 0, exempt: 0, unresolved: 0, ambiguous: 0 };
  let afterId = 0;
  do {
    const { counts, nextAfterId } = await rematchOpenClaims(db, findCandidates, { limit: batch, afterId, waybills });
    for (const key of Object.keys(total)) total[key] += counts[key];
    afterId = nextAfterId;
  } while (afterId !== null);
  return total;
};

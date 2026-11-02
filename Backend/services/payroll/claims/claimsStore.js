// Saves parsed courier claims and keeps their match results (issue #141). Tables: see
// migrations/2026-11-03-issue-141-courier-claims.sql. Nothing here deducts pay: applying a chargeable claim to a
// pay run, exactly once, is issue #143.

import { CLAIM_RULES_VERSION, resolveClaim } from './claimRules.js';

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

const sameFacts = (row, claim) =>
  Number(row.original_charge).toFixed(2) === Number(claim.charge).toFixed(2) &&
  row.claim_at === claim.claimAt &&
  (row.confirmed_at ?? null) === (claim.confirmedAt ?? null) &&
  row.claim_type === claim.claimType;

const insertVersion = async (db, claim, version, source) => {
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
    `INSERT INTO courier_claim_matches (claim_id, status, reason, rule_version)
     VALUES ($1, 'unresolved', 'waiting for delivery history', $2)`,
    [rows[0].id, CLAIM_RULES_VERSION]
  );
  return rows[0].id;
};

// Saves the claims from one parsed file. Call inside a transaction (see withTransaction).
// source: { importCityId, sourceFile, sourceSheet, importedBy }.
// Returns { inserted, duplicates, amended }, each a list of { claimId, sourceRow } (amended also has previousId).
// - A claim seen before with the same facts is a duplicate: nothing is written, so it can never charge twice.
// - A claim seen before with different facts becomes a new version; the old one is marked superseded.
//   If the old version was already applied to a pay run, #143 must correct it with a later entry.
export const importClaims = async (db, claims, source) => {
  if (!Number.isInteger(source?.importCityId)) throw new Error('importCityId is required');
  if (!source.sourceFile || !source.sourceSheet) throw new Error('sourceFile and sourceSheet are required');
  const result = { inserted: [], duplicates: [], amended: [] };

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
    if (!current) {
      result.inserted.push({ claimId: await insertVersion(db, claim, 1, source), sourceRow: claim.sourceRow });
    } else if (sameFacts(current, claim)) {
      result.duplicates.push({ claimId: current.id, sourceRow: claim.sourceRow });
    } else {
      await db.query('UPDATE courier_claims SET superseded_at = now() WHERE id = $1', [current.id]);
      const claimId = await insertVersion(db, claim, current.version + 1, source);
      result.amended.push({ claimId, previousId: current.id, sourceRow: claim.sourceRow });
    }
  }
  return result;
};

// Tries again to match every current claim that is still unresolved or ambiguous.
// findCandidates({ courier, waybill }) must return the delivery history for that waybill, from history only:
// [{ driverId, cityId, cityName, carrierDeliveryId, routeId, journeyDate }]. It is supplied by the GOFO
// waybill history (#140). Claims already chargeable or exempt are never changed here.
// Call inside a transaction. Returns counts by new status.
export const rematchOpenClaims = async (db, findCandidates, { limit = 500 } = {}) => {
  const { rows } = await db.query(
    `SELECT c.id, c.courier, c.waybill, c.claim_type, c.deduction_amount, c.import_city_id
       FROM courier_claims c
       JOIN courier_claim_matches m ON m.claim_id = c.id
      WHERE c.superseded_at IS NULL AND m.status = ANY($1::text[])
      ORDER BY c.id
      LIMIT $2
      FOR UPDATE OF m SKIP LOCKED`,
    [OPEN, limit]
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
  return counts;
};

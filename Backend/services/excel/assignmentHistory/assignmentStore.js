// Saves and looks up the carrier's waybill -> Delivery ID -> route evidence (issue #140). Tables: see
// migrations/2026-11-03-issue-140-carrier-assignment-history.sql. Nothing here touches pay.
//
// Every function takes `db`, a pool client that is already inside a transaction (see recordReport's note), so a
// caller can keep the history and its own writes together.

import { CARRIER, normalizeWaybill } from './assignmentRules.js';

const BATCH_SIZE = 2000;
// Any fixed number; only this module takes it. Two imports of the same evidence wait for each other.
const IMPORT_LOCK_KEY = 140;

const chunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const REPORT_HASH = /^[0-9a-f]{64}$/;

const cleanLabel = (value) => {
  const base = String(value ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '').trim();
  return (base || 'report').slice(0, 200);
};

// Fills in the driver, route and city of facts that were recorded without them, using only what the fact itself
// says: the Delivery ID is compared with NASA's driver codes and the Region/route with NASA's route codes.
// The driver's current city is never consulted. A fact that is already resolved is never changed (the table
// refuses it). Safe to call at any time; call it after drivers or routes are added.
// Returns { drivers, routes }: how many facts were resolved now.
export const refreshOpenAssignments = async (db) => {
  const drivers = await db.query(
    `UPDATE carrier_package_assignments a
        SET driver_id = d.id, driver_state = 'resolved', resolved_at = COALESCE(a.resolved_at, now())
       FROM drivers d
      WHERE a.driver_state = 'unknown_driver' AND d.driver_code::text = a.external_delivery_id`
  );
  const routes = await db.query(
    `UPDATE carrier_package_assignments a
        SET route_id = r.id, city_id = c.id, route_state = 'resolved', resolved_at = COALESCE(a.resolved_at, now())
       FROM routes r
       JOIN city c ON c.job = r.job
      WHERE a.route_state = 'unknown_route' AND r.route_code_in_string = a.route_code`
  );
  return { drivers: drivers.rowCount, routes: routes.rowCount };
};

// Routes in the report that NASA knows, with their city's name (city.job).
const knownRoutes = async (db, routeCodes) => {
  if (routeCodes.length === 0) return new Map();
  const { rows } = await db.query(
    'SELECT route_code_in_string AS code, job FROM routes WHERE route_code_in_string = ANY($1::text[])',
    [routeCodes]
  );
  return new Map(rows.map((row) => [row.code, row.job]));
};

const insertAssignments = async (db, facts, importId) => {
  let recorded = 0;
  for (const batch of chunks(facts, BATCH_SIZE)) {
    const { rowCount } = await db.query(
      `INSERT INTO carrier_package_assignments
         (carrier, identity_hash, waybill, waybill_key, external_delivery_id, id_form, route_code, signed_at, signed_on,
          driver_state, route_state, first_import_id)
       SELECT $1, t.hash, t.waybill, t.key, t.delivery_id, t.form, t.route, t.signed_at, t.signed_on,
              CASE WHEN t.form = 'canonical' THEN 'unknown_driver' ELSE 'unusable_id' END,
              CASE WHEN t.route IS NULL THEN 'no_route' ELSE 'unknown_route' END,
              $2
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::timestamp[], $10::date[])
              AS t(hash, waybill, key, delivery_id, form, route, signed_at, signed_on)
       ON CONFLICT (identity_hash) DO NOTHING`,
      [
        CARRIER, importId,
        batch.map((f) => f.identityHash), batch.map((f) => f.waybill), batch.map((f) => f.waybillKey),
        batch.map((f) => f.deliveryId), batch.map((f) => f.idForm), batch.map((f) => f.routeCode),
        batch.map((f) => f.signedAt), batch.map((f) => f.signedOn),
      ]
    );
    recorded += rowCount;
  }
  return recorded;
};

const insertSightings = async (db, rows, importId) => {
  for (const batch of chunks(rows, BATCH_SIZE)) {
    await db.query(
      `INSERT INTO carrier_assignment_sightings (assignment_id, import_id, source_sheet, source_row)
       SELECT a.id, $1, t.sheet, t.source_row
         FROM unnest($2::text[], $3::text[], $4::int[]) AS t(hash, sheet, source_row)
         JOIN carrier_package_assignments a ON a.identity_hash = t.hash
       ON CONFLICT DO NOTHING`,
      [importId, batch.map((r) => r.identityHash), batch.map((r) => r.sheet), batch.map((r) => r.sourceRow)]
    );
  }
};

// Saves the evidence of one report (from extractAssignmentEvidence). Call inside a transaction: the caller owns
// BEGIN and COMMIT, so the history and the caller's other writes stand or fall together.
//
// source: { reportHash (sha256 hex of the file's bytes), sourceLabel (file name, a label only), importedBy,
//           allowedJobs } where allowedJobs is null for an admin who may use every city, or the list of city
//           names (city.job) a city admin may use. A city admin's report records only facts whose route
//           belongs to one of their cities; the rest is left out and counted, never refused.
// Returns { importId, alreadyRecorded, voided, recorded, known, skipped, problems, resolved }.
// - The same file bytes again (renamed or not) records nothing new.
// - The same fact in another file is not added twice; the new sighting is kept as provenance.
// - Two Delivery IDs for one waybill are both kept.
export const recordReport = async (db, report, source) => {
  if (!REPORT_HASH.test(source?.reportHash ?? '')) throw new Error('reportHash must be a sha256 hex digest');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', ['carrier-assignments', IMPORT_LOCK_KEY]);

  const earlier = await db.query('SELECT id, voided_at FROM carrier_assignment_imports WHERE carrier = $1 AND report_hash = $2', [CARRIER, source.reportHash]);
  if (earlier.rows[0]) {
    const resolved = await refreshOpenAssignments(db);
    return { importId: earlier.rows[0].id, alreadyRecorded: true, voided: earlier.rows[0].voided_at !== null, recorded: 0, known: 0, skipped: 0, problems: report.problemCount, resolved };
  }

  let rows = report.rows;
  let skipped = 0;
  if (Array.isArray(source.allowedJobs)) {
    const jobs = await knownRoutes(db, [...new Set(rows.map((r) => r.routeCode).filter(Boolean))]);
    rows = rows.filter((r) => r.routeCode && source.allowedJobs.includes(jobs.get(r.routeCode)));
    skipped = report.rows.length - rows.length;
  }

  const dates = rows.map((r) => r.signedOn).filter(Boolean).sort();
  const { rows: created } = await db.query(
    `INSERT INTO carrier_assignment_imports
       (carrier, report_hash, source_label, imported_by, signed_from, signed_to, fee_rows, offset_rows, problem_rows, skipped_rows)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      CARRIER, source.reportHash, cleanLabel(source.sourceLabel), source.importedBy ?? null,
      dates[0] ?? null, dates[dates.length - 1] ?? null,
      report.sheets.fee_details?.rows ?? 0, report.sheets.offset_details?.rows ?? 0, report.problemCount, skipped,
    ]
  );
  const importId = created[0].id;

  const facts = [...new Map(rows.map((r) => [r.identityHash, r])).values()];
  const recorded = await insertAssignments(db, facts, importId);
  await insertSightings(db, rows, importId);
  const known = facts.length - recorded;
  await db.query('UPDATE carrier_assignment_imports SET recorded_rows = $2, known_rows = $3 WHERE id = $1', [importId, recorded, known]);

  const resolved = await refreshOpenAssignments(db);
  return { importId, alreadyRecorded: false, voided: false, recorded, known, skipped, problems: report.problemCount, resolved };
};

// Marks a whole import as wrong. Its facts stop standing unless another import also holds them. Nothing is
// deleted: the import, its facts and its sightings stay for the record.
export const voidImport = async (db, importId, { reason, adminId = null }) => {
  if (typeof reason !== 'string' || reason.trim() === '') throw new Error('a reason is required');
  const { rowCount } = await db.query(
    'UPDATE carrier_assignment_imports SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1 AND voided_at IS NULL',
    [importId, adminId, reason.trim().slice(0, 500)]
  );
  return rowCount === 1;
};

// The history for one waybill, in the shape the claims rematch expects (issue #141, rematchOpenClaims):
//   [{ driverId, cityId, cityName, carrierDeliveryId, routeId, journeyDate, ... }]
// - One entry per distinct Delivery ID / driver / city the history names. A waybill that two reports link to
//   different drivers or cities returns two or more entries: the caller must treat that as ambiguous.
// - A fact with no known city (route missing or unknown) joins the entry for the same Delivery ID when that
//   Delivery ID has exactly one known city; it adds no information, so it is not a conflict.
// - cityName is the city's code (city.city_code, for example "DFW GOFO"), the stored label the owner's
//   exemption rule is written against. cityCode repeats it; cityJob is the city's display name.
// - Only history is read. The driver's current city is never used.
// - An empty list means no history. courier other than "gofo" has no history here yet.
export const findAssignmentCandidates = async (db, { courier, waybill }) => {
  if (courier !== CARRIER) return [];
  const key = normalizeWaybill(waybill);
  if (!key) return [];

  const { rows } = await db.query(
    `SELECT a.id, a.external_delivery_id, a.driver_id, a.route_id, a.route_code, a.city_id,
            c.city_code, c.job AS city_job, to_char(a.signed_on, 'YYYY-MM-DD') AS signed_on,
            (SELECT json_agg(json_build_object('importId', s.import_id, 'sheet', s.source_sheet, 'row', s.source_row)
                             ORDER BY s.import_id, s.source_sheet)
               FROM carrier_assignment_sightings s
               JOIN carrier_assignment_imports i ON i.id = s.import_id
              WHERE s.assignment_id = a.id AND i.voided_at IS NULL) AS evidence
       FROM carrier_package_assignments_live a
       LEFT JOIN city c ON c.id = a.city_id
      WHERE a.carrier = $1 AND a.waybill_key = $2
      ORDER BY a.signed_on ASC NULLS LAST, a.id ASC`,
    [CARRIER, key]
  );

  const groups = new Map();
  const keyOf = (row, city) => `${row.driver_id ?? ''}|${row.external_delivery_id}|${city ?? ''}`;
  const knownCities = new Map();
  for (const row of rows) {
    if (row.city_id !== null) {
      const id = `${row.driver_id ?? ''}|${row.external_delivery_id}`;
      knownCities.set(id, new Set([...(knownCities.get(id) ?? []), row.city_id]));
    }
  }

  for (const row of rows) {
    const cities = knownCities.get(`${row.driver_id ?? ''}|${row.external_delivery_id}`);
    const city = row.city_id ?? (cities?.size === 1 ? [...cities][0] : null);
    const id = keyOf(row, city);
    const existing = groups.get(id);
    if (existing) {
      existing.assignmentIds.push(row.id);
      existing.evidence.push(...(row.evidence ?? []));
      continue;
    }
    groups.set(id, {
      driverId: row.driver_id,
      cityId: city,
      cityName: row.city_code,
      cityCode: row.city_code,
      cityJob: row.city_job,
      carrierDeliveryId: row.external_delivery_id,
      routeId: row.route_id,
      routeCode: row.route_code,
      journeyDate: row.signed_on,
      assignmentIds: [row.id],
      evidence: [...(row.evidence ?? [])],
    });
  }
  return [...groups.values()];
};

// A function with the shape rematchOpenClaims expects, reading through `db`.
export const candidateFinderFor = (db) => (args) => findAssignmentCandidates(db, args);

// Waybills whose standing history names more than one Delivery ID, driver or city, for a person to review.
// Returns [{ waybillKey, facts, deliveryIds, drivers, cities }].
export const listWaybillConflicts = async (db, { limit = 100, offset = 0 } = {}) => {
  const { rows } = await db.query(
    `SELECT waybill_key, count(*)::int AS facts, count(DISTINCT external_delivery_id)::int AS delivery_ids,
            count(DISTINCT driver_id)::int AS drivers, count(DISTINCT city_id)::int AS cities
       FROM carrier_package_assignments_live
      WHERE carrier = $1
      GROUP BY waybill_key
     HAVING count(DISTINCT external_delivery_id) > 1 OR count(DISTINCT driver_id) > 1 OR count(DISTINCT city_id) > 1
      ORDER BY waybill_key
      LIMIT $2 OFFSET $3`,
    [CARRIER, Math.min(Math.max(Number(limit) || 100, 1), 500), Math.max(Number(offset) || 0, 0)]
  );
  return rows.map((r) => ({ waybillKey: r.waybill_key, facts: r.facts, deliveryIds: r.delivery_ids, drivers: r.drivers, cities: r.cities }));
};

// Stores the carrier's Claims Detail sheet from an uploaded report (issue #141) and matches the new claims against
// the waybill history (issue #140). The weekly upload calls it after the history is saved, inside the same transaction.
//
// The claims sheet has no city, and a claim only counts for the city the file was uploaded for. So the city is taken
// from the report's own routes, and only when every route belongs to one city. If that cannot be settled the claims
// are NOT stored and the answer says why: a claim is never put on a guessed city.
//
// Nothing here deducts anything. A matched claim becomes `chargeable`; it reaches a driver only through a pay run (#143).

import XLSX from 'xlsx';
import logger from '../../../utils/logger.js';
import { CLAIMS_SHEET, parseClaimsWorkbook } from './claimsParser.js';
import { importClaims, rematchAllOpenClaims } from './claimsStore.js';
import { candidateFinderFor } from '../../excel/assignmentHistory/assignmentStore.js';
import { getAllowedJobs, isCityLimited } from '../../admin/adminCityAccess.js';

const SAVEPOINT = 'weekly_claims';
const UNDEFINED_TABLE = '42P01';
const COURIER = 'gofo'; // the same spelling the waybill history uses
const MAX_PROBLEMS_SHOWN = 20;
const sheetKey = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');

// Reads only the claims sheet with the xlsx library (the upload itself is read with ExcelJS).
const readClaimsWorkbook = (buffer) => {
  const names = XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames ?? [];
  const name = names.find((n) => sheetKey(n) === sheetKey(CLAIMS_SHEET));
  if (!name) return { SheetNames: [], Sheets: {} };
  return XLSX.read(buffer, { type: 'buffer', sheets: name });
};

const cityOfRoutes = async (client, routeCodes) => {
  if (routeCodes.length === 0) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT c.id, c.job FROM routes r JOIN city c ON c.job = r.job WHERE r.route_code_in_string = ANY($1::text[])`, [routeCodes]);
  return rows;
};

const notStored = (found, parsed, reason) => ({ found, stored: false, reason, inFile: parsed.claims.length, problems: parsed.problems.length, problemRows: parsed.problems.slice(0, MAX_PROBLEMS_SHOWN) });

// routeCodes: the Region/route values of the report (from the history step). user: req.user.
// Call inside the caller's open transaction. Never throws for a claims problem: the pay upload must still succeed.
export const recordWorkbookClaims = async (client, { buffer, fileName, user, routeCodes }) => {
  let parsed;
  try {
    parsed = parseClaimsWorkbook(readClaimsWorkbook(buffer), { courier: COURIER });
  } catch (error) {
    logger.error('Claims sheet could not be read', error);
    return { found: true, stored: false, reason: 'The Claims Detail sheet could not be read.', inFile: 0, problems: 0, problemRows: [] };
  }
  if (!parsed.found) return { found: false, stored: false };

  await client.query(`SAVEPOINT ${SAVEPOINT}`);
  try {
    if (parsed.claims.length === 0) {
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return notStored(true, parsed, parsed.problems.length ? 'Every claim row has a problem; nothing was stored.' : 'The Claims Detail sheet has no claims.');
    }
    const cities = await cityOfRoutes(client, routeCodes ?? []);
    if (cities.length !== 1) {
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return notStored(true, parsed, cities.length === 0
        ? 'Claims were not stored: the report\'s routes do not identify a city. Upload one city\'s report at a time.'
        : 'Claims were not stored: the report\'s routes belong to more than one city. Upload one city\'s report at a time.');
    }
    const [city] = cities;
    const limited = isCityLimited(user?.role);
    if (limited && !(await getAllowedJobs(user.id, client)).includes(city.job)) {
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return notStored(true, parsed, 'Claims were not stored: the report is for a city you do not have access to.');
    }

    // A claim is stored for one city. importClaims finds the current version by courier, waybill and type alone, so a
    // claim already held for ANOTHER city would be seen as a duplicate or superseded by this upload. Those are left out
    // before it is called, and only counted: no city learns more about another city's claims than that some were left out.
    // The check and the store must not be separated by another upload of the same claim, so the per-claim locks that
    // importClaims takes are taken first (in key order, so two uploads cannot wait on each other).
    for (const key of [...new Set(parsed.claims.map((c) => c.key))].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 141))', [key]);
    }
    const { rows: elsewhere } = await client.query(
      `SELECT claim_key FROM courier_claims WHERE claim_key = ANY($1::text[]) AND superseded_at IS NULL AND import_city_id IS DISTINCT FROM $2`,
      [parsed.claims.map((c) => c.key), city.id]);
    const otherCity = new Set(elsewhere.map((r) => r.claim_key));
    const claimsHere = parsed.claims.filter((c) => !otherCity.has(c.key));

    const stored = await importClaims(client, claimsHere, {
      importCityId: city.id, sourceFile: fileName, sourceSheet: parsed.sheet, importedBy: user?.id ?? null,
    });
    // Only this upload's waybills are looked at. importClaims stores; it does not match.
    const waybills = [...new Set(claimsHere.map((c) => c.waybill))];
    await rematchAllOpenClaims(client, candidateFinderFor(client), { waybills });

    const touched = [...stored.inserted, ...stored.amended].map((c) => c.claimId);
    const { rows } = touched.length
      ? await client.query('SELECT status, count(*)::int AS n FROM courier_claim_matches WHERE claim_id = ANY($1::bigint[]) GROUP BY status', [touched])
      : { rows: [] };
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return {
      found: true,
      stored: true,
      cityId: city.id,
      inFile: parsed.claims.length,
      // A claim that already belongs to another city is not stored. A city admin is told only "already recorded", the
      // same as for their own repeat, so the answer cannot be used to find out what other cities hold. Others see the count.
      ...(limited ? {} : { notStored: otherCity.size }),
      inserted: stored.inserted.length,
      duplicates: stored.duplicates.length + (limited ? otherCity.size : 0),
      amended: stored.amended.length,
      held: stored.held.length,
      // Where this upload's new and changed claims stand now. `exempt` carries no deduction.
      matched: { chargeable: by.chargeable ?? 0, exempt: by.exempt ?? 0 },
      waiting: { unresolved: by.unresolved ?? 0, ambiguous: by.ambiguous ?? 0 },
      onHold: by.review ?? 0,
      problems: parsed.problems.length,
      problemRows: parsed.problems.slice(0, MAX_PROBLEMS_SHOWN),
    };
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    logger.error('Courier claims were not stored; the upload continues without them', error);
    return {
      found: true,
      stored: false,
      reason: error.code === UNDEFINED_TABLE ? 'Courier claims are not set up in the database yet.' : 'The claims could not be stored.',
      inFile: parsed.claims.length,
      problems: parsed.problems.length,
      problemRows: parsed.problems.slice(0, MAX_PROBLEMS_SHOWN),
    };
  }
};

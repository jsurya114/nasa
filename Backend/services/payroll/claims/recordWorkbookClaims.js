// Stores the carrier's Claims Detail sheet from an uploaded report (issue #141) and matches the claims to drivers by name
// (issue #180): the claim's Courier (the driver's name) is looked up in the Courier column of Details of Delivery Fees, and that
// row's Delivery ID is the driver code. The weekly upload calls it after the history is saved, inside the same transaction.
//
// The claims sheet has no city, and a claim only counts for the city the file was uploaded for. So the city is taken
// from the report's own routes, and only when every route belongs to one city. If that cannot be settled the claims
// are NOT stored and the answer says why: a claim is never put on a guessed city.
//
// Nothing here deducts anything. A matched claim becomes `chargeable`; it reaches a driver only through a pay run (#143).

import XLSX from 'xlsx';
import logger from '../../../utils/logger.js';
import { CLAIMS_SHEET, parseClaimsWorkbook } from './claimsParser.js';
import { adjustmentsReady, applyKnownAdjustments, importClaims, rematchAllOpenClaims, retireRefundedClaims, saveAdjustments } from './claimsStore.js';
import { FEES_SHEET, parseFeeNames } from './courierNames.js';
import { getAllowedJobs, isCityLimited } from '../../admin/adminCityAccess.js';

const SAVEPOINT = 'weekly_claims';
const UNDEFINED_TABLE = '42P01';
const COURIER = 'gofo'; // the same spelling the waybill history uses
const MAX_PROBLEMS_SHOWN = 20;
const sheetKey = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');

// Reads only one sheet with the xlsx library (the upload itself is read with ExcelJS).
const readSheetWorkbook = (buffer, title) => {
  const names = XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames ?? [];
  const name = names.find((n) => sheetKey(n) === sheetKey(title));
  if (!name) return { SheetNames: [], Sheets: {} };
  return XLSX.read(buffer, { type: 'buffer', sheets: name });
};
const readClaimsWorkbook = (buffer) => readSheetWorkbook(buffer, CLAIMS_SHEET);

// Finds the drivers a claim's name points to: every Delivery ID seen with that name in Details of Delivery Fees is a driver code.
// A Delivery ID with no NASA driver comes back with driverId null (the claim then waits: "not linked to a NASA driver"). The city
// is given by its code, which is what the Dallas GOFO exemption keys on.
const nameFinderFor = (client, names) => {
  const cache = new Map();
  const driverOf = async (code) => {
    if (!cache.has(code)) {
      const { rows } = await client.query(
        'SELECT d.id, d.city_id, c.city_code AS city_name FROM drivers d LEFT JOIN city c ON c.id = d.city_id WHERE d.driver_code = $1', [Number(code)]);
      cache.set(code, rows[0] ?? null);
    }
    return cache.get(code);
  };
  return async ({ nameKey }) => {
    const codes = nameKey ? [...(names.get(nameKey) ?? [])] : [];
    const found = [];
    for (const code of codes) {
      const driver = await driverOf(code);
      found.push({ driverId: driver?.id ?? null, cityId: driver?.city_id ?? null, cityName: driver?.city_name ?? null, carrierDeliveryId: code, routeId: null, journeyDate: null });
    }
    return found;
  };
};

// Every route the report names must belong to a known city. Returns { cities, unresolved }: the distinct cities of the
// routes that are known, and the route codes that are not. A report is only given a city when nothing is unresolved.
const cityOfRoutes = async (client, routeCodes) => {
  if (routeCodes.length === 0) return { cities: [], unresolved: [] };
  const { rows } = await client.query(
    `SELECT r.route_code_in_string AS code, c.id, c.job FROM routes r JOIN city c ON c.job = r.job WHERE r.route_code_in_string = ANY($1::text[])`, [routeCodes]);
  const known = new Set(rows.map((r) => r.code));
  const cities = [...new Map(rows.map((r) => [r.id, { id: r.id, job: r.job }])).values()];
  return { cities, unresolved: routeCodes.filter((code) => !known.has(code)) };
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
    // A present Claims Detail sheet with no new claims still counts: the report's fee sheet may name a driver whose earlier claim is
    // waiting, so after the same city and access checks the open claims are matched (issue #180 review). The answer for a sheet with
    // no claims is unchanged, apart from the counts of what was matched.
    const empty = parsed.claims.length === 0;
    const emptyReason = parsed.problems.length ? 'Every claim row has a problem; nothing was stored.' : 'The Claims Detail sheet has no claims.';
    const { cities, unresolved } = await cityOfRoutes(client, routeCodes ?? []);
    if (unresolved.length > 0) {
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      if (empty) return notStored(true, parsed, emptyReason);
      const shown = unresolved.slice(0, 5).join(', ');
      return notStored(true, parsed, `Claims were not stored: ${unresolved.length} route${unresolved.length === 1 ? '' : 's'} in the report ${unresolved.length === 1 ? 'is' : 'are'} not set up (${shown}${unresolved.length > 5 ? ', ...' : ''}), so the city cannot be confirmed. Add the route${unresolved.length === 1 ? '' : 's'} and upload again.`);
    }
    if (cities.length !== 1) {
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      if (empty) return notStored(true, parsed, emptyReason);
      return notStored(true, parsed, cities.length === 0
        ? 'Claims were not stored: the report names no route, so its city cannot be confirmed. Upload one city\'s report at a time.'
        : 'Claims were not stored: the report\'s routes belong to more than one city. Upload one city\'s report at a time.');
    }
    const [city] = cities;
    const limited = isCityLimited(user?.role);
    if (limited && !(await getAllowedJobs(user.id, client)).includes(city.job)) {
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return notStored(true, parsed, empty ? emptyReason : 'Claims were not stored: the report is for a city you do not have access to.');
    }
    // A refund in the file cancels its penalty. Copies stored by an earlier upload (the penalty, or the refund itself kept as if it were a charge)
    // are retired. This happens whether or not any charge is left to store: a file of only a penalty and its refund still cancels the stored penalty.
    // It runs after the city and access checks above, so a city admin cannot retire another city's claims.
    // The refunds are also remembered against each penalty's original facts, even when the net is zero and the penalty was never stored, so an older
    // report listing the same original penalty cannot bring the refunded amount back (review of #268).
    const remember = await adjustmentsReady(client);
    if (remember && (parsed.adjustments ?? []).length > 0) {
      const adjustmentKeys = [...new Set(parsed.adjustments.map((a) => a.key))].sort();
      for (const key of adjustmentKeys) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 141))', [key]);
      // A claim belongs to the city it was first imported for. This report may not remember a refund against a claim held for another city.
      const { rows: heldElsewhere } = await client.query(
        'SELECT DISTINCT claim_key FROM courier_claims WHERE claim_key = ANY($1::text[]) AND import_city_id IS DISTINCT FROM $2', [adjustmentKeys, city.id]);
      const other = new Set(heldElsewhere.map((r) => r.claim_key));
      await saveAdjustments(client, parsed.adjustments.filter((a) => !other.has(a.key)), { importCityId: city.id, sourceFile: fileName });
    }
    // Penalties in this file that were refunded when an EARLIER file was read get the remembered net, or stay cancelled when it is zero.
    const known = remember ? await applyKnownAdjustments(client, parsed.claims, { importCityId: city.id }) : { claims: parsed.claims, cancelledKeys: [] };
    const fileClaims = known.claims;
    const refunded = (parsed.refunds ?? 0) > 0 || known.cancelledKeys.length > 0
      ? await retireRefundedClaims(client, { cityId: city.id, keys: [...(parsed.refundedKeys ?? []), ...known.cancelledKeys] })
      : { retired: 0, left: 0 };
    if (empty) {
      const fees = parseFeeNames(readSheetWorkbook(buffer, FEES_SHEET));
      const rematched = await rematchAllOpenClaims(client, nameFinderFor(client, fees.names), { cityId: city.id, by: 'name' });
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return {
        ...notStored(true, parsed, emptyReason), cityId: city.id, rematched, refunded: refunded.retired, refundedAlreadyTaken: refunded.left,
        names: { sheetFound: fees.found, drivers: fees.names.size, missingColumns: fees.missingColumns },
      };
    }

    // A claim is stored for one city. importClaims finds the current version by courier, waybill and type alone, so a
    // claim already held for ANOTHER city would be seen as a duplicate or superseded by this upload. Those are left out
    // before it is called, and only counted: no city learns more about another city's claims than that some were left out.
    // The check and the store must not be separated by another upload of the same claim, so the per-claim locks that
    // importClaims takes are taken first (in key order, so two uploads cannot wait on each other).
    for (const key of [...new Set(fileClaims.map((c) => c.key))].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 141))', [key]);
    }
    const { rows: elsewhere } = await client.query(
      `SELECT claim_key FROM courier_claims WHERE claim_key = ANY($1::text[]) AND import_city_id IS DISTINCT FROM $2`,
      [fileClaims.map((c) => c.key), city.id]);
    const otherCity = new Set(elsewhere.map((r) => r.claim_key));
    const claimsHere = fileClaims.filter((c) => !otherCity.has(c.key));

    const stored = await importClaims(client, claimsHere, {
      importCityId: city.id, sourceFile: fileName, sourceSheet: parsed.sheet, importedBy: user?.id ?? null,
    });
    // Matching: the names in this report's Details of Delivery Fees. Every open claim of this city is looked at, so a claim an
    // earlier report could not match is matched now if its driver delivered this week. importClaims stores; it does not match.
    const fees = parseFeeNames(readSheetWorkbook(buffer, FEES_SHEET));
    await rematchAllOpenClaims(client, nameFinderFor(client, fees.names), { cityId: city.id, by: 'name' });

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
      // Earlier claims a refund in this file cancelled (no longer owed), and any already taken from a driver, which are left for the ledger.
      refunded: refunded.retired,
      refundedAlreadyTaken: refunded.left,
      // Where this upload's new and changed claims stand now. `exempt` carries no deduction.
      matched: { chargeable: by.chargeable ?? 0, exempt: by.exempt ?? 0 },
      waiting: { unresolved: by.unresolved ?? 0, ambiguous: by.ambiguous ?? 0 },
      onHold: by.review ?? 0,
      // What the matching had to work with: the driver names in Details of Delivery Fees, and any column that was missing.
      names: { sheetFound: fees.found, drivers: fees.names.size, missingColumns: fees.missingColumns },
      claimsWithoutName: claimsHere.filter((c) => !c.courierNameKey).length,
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

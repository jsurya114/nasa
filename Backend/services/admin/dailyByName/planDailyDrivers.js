import { driverNameKey } from '../driverName.js';

// Daily upload, drivers found by name. This file decides, without touching the database, which driver and which route every row of the daily file
// belongs to. The caller loads what it needs (routes, drivers, remembered choices, what already exists for the day) and applies the plan.
//
// The rules (agreed with the owners):
// - The route in the file is "<MMDD>-<route code>", sometimes with a transfer suffix "-T-<number>" that belongs to the same main route.
// - The driver is the row's DriverName: first a remembered match for that name in the city, else a driver of that city with the same name
//   (case, spaces and accents compared as the app compares driver names). A disabled driver is never used.
// - A driver with a remembered sub-route for that main route is put on it (it decides the price). Anyone else is on the main route.
// - The app keeps one delivery per route, sequence and day. When the file gives two drivers the same sequence numbers on one main route, the
//   later one (in file order) is put on a sub-route of that main route with the SAME prices that is free for those numbers, so nobody's pay
//   changes; if there is none, that driver's rows are not added and are reported.
// - One delivery per sequence, as the old method: a sequence a driver has twice counts once.
// - Nothing is ever dropped without being counted: every row lands in exactly one count.

export const DATE_PREFIX = /^\d{4}-/;
export const TRANSFER_SUFFIX = /-T-\d+$/;

// "1106-DFW 035-1-T-064409" -> "DFW 035-1". Null when the route is empty.
export const mainRouteCodeOf = (route) => {
  const text = String(route ?? '').trim();
  if (!text) return null;
  return text.replace(DATE_PREFIX, '').replace(TRANSFER_SUFFIX, '').trim() || null;
};

// The code the old method stages for a row (fileUploads: `${Sequence}${Route.substring(4)}`), kept for rows this plan does not place, so they
// still match whatever was entered by hand.
export const oldCodeOf = (row) => `${row.Sequence}${row.Route ? row.Route.toString().substring(4) : ''}`;
export const codeFor = (seq, routeCode) => `${seq}-${routeCode}`;

export const COUNTS = Object.freeze([
  'placed', 'unreadable', 'name_not_matched', 'driver_disabled', 'route_not_in_app', 'route_disabled', 'route_without_city', 'paid_day', 'clash',
]);

const samePrices = (a, b) => Number(a.fsPrice) === Number(b.fsPrice) && Number(a.dsPrice) === Number(b.dsPrice);

// rows: the file's rows (objects keyed by the header). lookups:
//   routesByCode   Map main/sub route code -> { id, code, job, enabled, fsPrice, dsPrice }
//   subRoutesOf    Map main route id -> [route, ...] (its "<code>:X" routes)
//   cityOfJob      Map job -> city id
//   driverByName   Map `${cityId}|${nameKey}` -> { id, name, enabled }   (drivers of that city)
//   nameMatch      Map `${cityId}|${nameKey}` -> { id, name, enabled }   (remembered "this name = this driver")
//   choiceOf       Map `${cityId}|${mainRouteId}|${driverId}` -> sub route id
//   dayRows        Map `${driverId}|${routeId}` -> { id, paid, seqs: Set } (what exists for the upload day)
//   takenSeqs      Map `${routeId}|${seq}` -> driver id (deliveries that exist for the upload day)
export const planDailyDrivers = (rows, lookups) => {
  const counts = Object.fromEntries(COUNTS.map((k) => [k, 0]));
  const codes = new Array(rows.length);
  const unmatched = new Map(); // `${cityId}|${nameKey}` -> { cityId, job, fileName, parcels, routes:Set }
  const disabled = new Map();
  const missingRoutes = new Map(); // code -> { code, reason, parcels }
  const jobs = new Set();

  // 1. Each row: its main route and its driver, or the reason it has none.
  const candidates = []; // { index, seq, main, cityId, driver }
  rows.forEach((row, index) => {
    codes[index] = oldCodeOf(row);
    const seq = Number(row.Sequence);
    const code = mainRouteCodeOf(row.Route);
    const nameKey = driverNameKey(String(row.DriverName ?? ''));
    if (!code || !Number.isSafeInteger(seq) || seq < 0 || !nameKey) { counts.unreadable += 1; return; }
    const main = lookups.routesByCode.get(code);
    const routeProblem = !main ? 'route_not_in_app' : !main.enabled ? 'route_disabled' : !lookups.cityOfJob.has(main.job) ? 'route_without_city' : null;
    if (routeProblem) {
      counts[routeProblem] += 1;
      const m = missingRoutes.get(code) ?? { code, reason: routeProblem, parcels: 0 };
      m.parcels += 1;
      missingRoutes.set(code, m);
      return;
    }
    jobs.add(main.job);
    const cityId = lookups.cityOfJob.get(main.job);
    const key = `${cityId}|${nameKey}`;
    const driver = lookups.nameMatch.get(key) ?? lookups.driverByName.get(key);
    if (!driver || !driver.enabled) {
      const reason = driver ? 'driver_disabled' : 'name_not_matched';
      counts[reason] += 1;
      const list = driver ? disabled : unmatched;
      const entry = list.get(key) ?? { cityId, job: main.job, fileName: String(row.DriverName).trim(), driverId: driver?.id ?? null, parcels: 0, routes: new Set() };
      entry.parcels += 1;
      entry.routes.add(main.code);
      list.set(key, entry);
      return;
    }
    candidates.push({ index, seq, main, cityId, driver });
  });

  // 2. Each driver's rows on each main route, in file order.
  const groups = new Map(); // `${driverId}|${mainId}` -> { driver, main, cityId, rows: [] }
  for (const c of candidates) {
    const key = `${c.driver.id}|${c.main.id}`;
    if (!groups.has(key)) groups.set(key, { driver: c.driver, main: c.main, cityId: c.cityId, rows: [] });
    groups.get(key).rows.push(c);
  }

  // 3. Each group's route: the remembered sub-route, else the main route; on a clash, a free sub-route with the same prices.
  const taken = new Map(lookups.takenSeqs); // `${routeId}|${seq}` -> driver id
  const routeById = new Map([...lookups.routesByCode.values()].map((r) => [r.id, r]));
  const placements = new Map(); // `${driverId}|${routeId}` -> { driverId, route, seqs:Set, parcels, dayRow }
  const movedToSub = [];
  const clashes = [];
  const atMainPrice = [];
  const paidDays = [];
  const placedRows = new Set();
  // Parcels that already belong to a day of the upload day (entered by hand, paid, in a pay run): main route + sequence -> { driver, route }.
  // Such a parcel is never given to a second driver, on any route of that main route.
  const mainIdOf = (routeId) => {
    const r = routeById.get(routeId);
    if (!r) return null;
    return r.code.includes(':') ? (lookups.routesByCode.get(r.code.split(':')[0])?.id ?? r.id) : r.id;
  };
  const held = new Map(); // `${mainId}|${seq}` -> [{ driverId, routeId }] (two drivers can each have a parcel with the same number, on different routes)
  for (const [key, driverId] of lookups.takenSeqs) {
    const [routeId, seq] = key.split('|').map(Number);
    const mainId = mainIdOf(routeId);
    if (mainId !== null) held.set(`${mainId}|${seq}`, [...(held.get(`${mainId}|${seq}`) ?? []), { driverId, routeId }]);
  }
  // A holder who still has that parcel in the file keeps it; only a parcel the file now gives to someone else is "held" against them.
  const inFile = new Set(candidates.map((c) => `${c.driver.id}|${c.main.id}|${c.seq}`));
  const freeOn = (route, driverId, seqs) => [...seqs].every((s) => { const owner = taken.get(`${route.id}|${s}`); return owner === undefined || owner === driverId; });

  for (const g of groups.values()) {
    const seqs = new Set(g.rows.map((r) => r.seq));
    const holders = [...seqs].flatMap((s) => (held.get(`${g.main.id}|${s}`) ?? []).map((h) => ({ ...h, seq: s })));
    if (holders.some((h) => h.driverId !== g.driver.id && !inFile.has(`${h.driverId}|${g.main.id}|${h.seq}`))) {
      counts.clash += g.rows.length;
      clashes.push({ driverId: g.driver.id, driverName: g.driver.name, route: g.main.code, parcels: g.rows.length, reason: 'held' });
      continue;
    }
    const chosenId = lookups.choiceOf.get(`${g.cityId}|${g.main.id}|${g.driver.id}`);
    const chosen = chosenId ? routeById.get(chosenId) : null;
    // The driver's own day of the upload day keeps its route (so their parcels are never split over two routes).
    const own = holders.find((h) => h.driverId === g.driver.id);
    const ownRoute = own ? routeById.get(own.routeId) : null;
    let route = ownRoute ?? (chosen && chosen.enabled ? chosen : g.main);
    if (!freeOn(route, g.driver.id, seqs)) {
      const spare = chosen || ownRoute ? null : (lookups.subRoutesOf.get(g.main.id) ?? []).find((s) => s.enabled && samePrices(s, g.main) && freeOn(s, g.driver.id, seqs));
      if (!spare) {
        counts.clash += g.rows.length;
        clashes.push({ driverId: g.driver.id, driverName: g.driver.name, route: route.code, parcels: g.rows.length, reason: 'file' });
        continue;
      }
      movedToSub.push({ driverId: g.driver.id, driverName: g.driver.name, mainRoute: g.main.code, subRoute: spare.code });
      route = spare;
    }
    const dayRow = lookups.dayRows.get(`${g.driver.id}|${route.id}`) ?? null;
    if (dayRow?.paid) {
      counts.paid_day += g.rows.length;
      paidDays.push({ driverId: g.driver.id, driverName: g.driver.name, route: route.code, parcels: g.rows.length });
      continue;
    }
    if (!chosen && route.id === g.main.id && (lookups.subRoutesOf.get(g.main.id) ?? []).some((s) => s.enabled && !samePrices(s, g.main))) {
      atMainPrice.push({ driverId: g.driver.id, driverName: g.driver.name, route: g.main.code, parcels: g.rows.length });
    }
    for (const s of seqs) taken.set(`${route.id}|${s}`, g.driver.id);
    const key = `${g.driver.id}|${route.id}`;
    const placement = placements.get(key) ?? { driverId: g.driver.id, driverName: g.driver.name, route, seqs: new Set(), parcels: 0, dayRow };
    for (const r of g.rows) { placement.seqs.add(r.seq); codes[r.index] = codeFor(r.seq, route.code); placedRows.add(r.index); }
    placement.parcels += g.rows.length;
    placements.set(key, placement);
    counts.placed += g.rows.length;
  }

  // A row that was not placed keeps the old code, so it can still match a day entered by hand, unless a placed driver now has that code: then it
  // gets a code that matches nothing, so it can never change that driver's deliveries.
  const placedCodes = new Set(codes.filter((_, i) => placedRows.has(i)));
  codes.forEach((code, i) => { if (!placedRows.has(i) && placedCodes.has(code)) codes[i] = `unplaced-${i}`; });

  const listOf = (map) => [...map.values()].map((e) => ({ ...e, routes: [...e.routes].sort() })).sort((a, b) => b.parcels - a.parcels || a.fileName.localeCompare(b.fileName));
  return {
    codes,
    jobs: [...jobs],
    placements: [...placements.values()],
    counts: { inFile: rows.length, ...counts },
    unmatchedNames: listOf(unmatched),
    disabledDrivers: listOf(disabled),
    missingRoutes: [...missingRoutes.values()].sort((a, b) => b.parcels - a.parcels),
    movedToSub,
    clashes,
    atMainPrice,
    paidDays,
  };
};

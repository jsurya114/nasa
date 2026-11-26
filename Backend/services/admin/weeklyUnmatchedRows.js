import logger from '../../utils/logger.js';

export const UNMATCHED_LIST_LIMIT = 200;

// Why a staged weekly line will or will not reach the Dashboard. The order is the order of the checks: a line with an unknown Delivery ID and an unknown
// route is counted once, under the Delivery ID, because the driver is what the admin has to add first.
export const REASONS = Object.freeze({
  TO_ADD: 'to_add',
  ALREADY_ON_DASHBOARD: 'already_on_dashboard',
  DRIVER_NOT_IN_APP: 'driver_not_in_app',
  DRIVER_DISABLED: 'driver_disabled',
  ROUTE_NOT_IN_APP: 'route_not_in_app',
  ROUTE_DISABLED: 'route_disabled',
  ROUTE_WITHOUT_CITY: 'route_without_city',
});
const DRIVER_REASONS = new Set([REASONS.DRIVER_NOT_IN_APP, REASONS.DRIVER_DISABLED]);

export const reasonOf = (line) => {
  if (!line.driver_known) return REASONS.DRIVER_NOT_IN_APP;
  if (!line.driver_enabled) return REASONS.DRIVER_DISABLED;
  if (!line.route_known) return REASONS.ROUTE_NOT_IN_APP;
  if (!line.route_enabled) return REASONS.ROUTE_DISABLED;
  if (!line.has_city) return REASONS.ROUTE_WITHOUT_CITY;
  return line.already ? REASONS.ALREADY_ON_DASHBOARD : REASONS.TO_ADD;
};

const cents = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 100));
const money = (c) => (c / 100).toFixed(2);

// Lines grouped by `keyOf`, with the days, routes and counts of each group and, where the route has prices, the driver pay those prices give.
const groupLines = (lines, keyOf) => {
  const groups = new Map();
  for (const line of lines) {
    const key = keyOf(line);
    if (!groups.has(key)) groups.set(key, { key, reason: line.reason, routes: new Set(), deliveryIds: new Set(), days: new Set(), packages: 0, fs: 0, ds: 0, estimateCents: 0, unpriced: 0 });
    const g = groups.get(key);
    if (line.route) g.routes.add(line.route);
    g.deliveryIds.add(line.code);
    g.days.add(line.day);
    g.packages += line.packages;
    g.fs += line.fs;
    g.ds += line.ds;
    const estimate = cents(line.estimate);
    if (estimate === null) g.unpriced += line.packages;
    else g.estimateCents += estimate;
  }
  return [...groups.values()];
};

const sorted = (set) => [...set].sort();

// After a weekly upload: every staged line the "Add to Dashboard" step will skip, and why, so no driver's work is left out without anyone seeing it. It reads the
// lines the upload already built from the file (it never opens the workbook again) and the app's drivers, routes and Dashboard. It runs the same matching as that
// step: an enabled driver whose code is the Delivery ID, an enabled route with the same code, a city for the route, and no Dashboard row yet for that driver, day
// and route. Read only: it never changes what is stored or paid, and a failure is reported as "not checked", never as an upload error.
//
// entries: the upload's lines, { driver_id (the Delivery ID), del_route, del_date, total_deliveries, fs, ds }. fileRows: { read, unreadable } data rows of the file.
export const findUnmatchedRows = async (db, entries, fileRows) => {
  try {
    const list = entries ?? [];
    const { rows } = await db.query(
      `WITH f AS (
         SELECT * FROM unnest($1::int[], $2::text[], $3::date[], $4::int[], $5::int[], $6::int[]) AS f(code, route, day, packages, fs, ds)
       ), d AS (
         SELECT driver_code, bool_or(enabled) AS any_enabled, max(id) FILTER (WHERE enabled) AS enabled_id
           FROM drivers WHERE driver_code = ANY($1::int[]) GROUP BY driver_code
       ), r AS (
         SELECT DISTINCT ON (route_code_in_string) id, route_code_in_string, enabled, job, driver_route_price, driver_doublestop_price
           FROM routes WHERE route_code_in_string = ANY($2::text[]) ORDER BY route_code_in_string, enabled DESC, id
       )
       SELECT f.code, f.route, to_char(f.day, 'YYYY-MM-DD') AS day, f.packages, f.fs, f.ds,
              d.driver_code IS NOT NULL AS driver_known, COALESCE(d.any_enabled, false) AS driver_enabled,
              r.id IS NOT NULL AS route_known, COALESCE(r.enabled, false) AS route_enabled,
              EXISTS (SELECT 1 FROM city c WHERE c.job = r.job) AS has_city,
              (f.fs * r.driver_route_price + f.ds * r.driver_doublestop_price) AS estimate,
              EXISTS (SELECT 1 FROM dashboard_data dd WHERE dd.driver_id = d.enabled_id AND dd.journey_date = f.day AND dd.route_id = r.id) AS already
         FROM f LEFT JOIN d ON d.driver_code = f.code LEFT JOIN r ON r.route_code_in_string = f.route`,
      [list.map((e) => e.driver_id), list.map((e) => e.del_route || null), list.map((e) => e.del_date),
        list.map((e) => e.total_deliveries), list.map((e) => e.fs), list.map((e) => e.ds)],
    );
    const lines = rows.map((line) => ({ ...line, reason: reasonOf(line) }));

    // Every data row of the file is counted exactly once: unreadable, or in one of the reasons above (a line's packages are its rows).
    const byReason = Object.fromEntries(Object.values(REASONS).map((reason) => [reason, 0]));
    for (const line of lines) byReason[line.reason] += line.packages;
    const counted = (fileRows?.unreadable ?? 0) + Object.values(byReason).reduce((a, b) => a + b, 0);

    const shape = (g) => ({
      reason: g.reason, routes: sorted(g.routes), days: sorted(g.days), packages: g.packages, fs: g.fs, ds: g.ds,
      estimate: g.unpriced === g.packages ? null : money(g.estimateCents), unpricedPackages: g.unpriced,
    });
    const drivers = groupLines(lines.filter((l) => DRIVER_REASONS.has(l.reason)), (l) => l.code)
      .map((g) => ({ deliveryId: g.key, ...shape(g) }))
      .sort((a, b) => a.reason.localeCompare(b.reason) || b.packages - a.packages || a.deliveryId - b.deliveryId);
    const routes = groupLines(lines.filter((l) => !DRIVER_REASONS.has(l.reason) && l.reason !== REASONS.TO_ADD && l.reason !== REASONS.ALREADY_ON_DASHBOARD), (l) => l.route ?? '')
      .map((g) => ({ route: g.key || null, deliveryIds: g.deliveryIds.size, ...shape(g), estimate: null }))
      .sort((a, b) => b.packages - a.packages || String(a.route).localeCompare(String(b.route)));

    return {
      checked: true,
      rows: { inFile: (fileRows?.read ?? 0) + (fileRows?.unreadable ?? 0), unreadable: fileRows?.unreadable ?? 0, ...byReason, counted },
      drivers: { total: drivers.length, shown: Math.min(drivers.length, UNMATCHED_LIST_LIMIT), list: drivers.slice(0, UNMATCHED_LIST_LIMIT) },
      routes: { total: routes.length, shown: Math.min(routes.length, UNMATCHED_LIST_LIMIT), list: routes.slice(0, UNMATCHED_LIST_LIMIT) },
    };
  } catch (error) {
    logger.warn('Unmatched weekly lines could not be checked after a weekly upload', { reason: String(error?.message ?? error).slice(0, 120) });
    return { checked: false };
  }
};

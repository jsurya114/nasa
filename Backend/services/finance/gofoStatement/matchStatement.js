// Matches a carrier statement to NASA's own recorded work (issue #252). Pure: the caller loads NASA's rows and the route and driver lookups.
//
// The grain is one Delivery ID on one signing day on one route. BOTH sides are added up to that grain first and only then joined, so a
// repeated key on either side can never multiply the other side's money. Every group of the statement keeps its state:
//   matched         NASA recorded work for that driver, day and route
//   no_route        the carrier gave no route
//   unknown_route   the route is not set up in NASA
//   unknown_driver  no NASA driver has that Delivery ID
//   no_pay_group    the driver and route are known but NASA has no recorded work for that day
// Unmatched money is kept and counted as UNALLOCATED revenue of the statement's city. Nothing is dropped and nothing is forced onto a driver.

export const MATCH_STATES = Object.freeze(['matched', 'no_route', 'unknown_route', 'unknown_driver', 'no_pay_group']);

const keyOf = (deliveryId, day, routeCode) => `${deliveryId}|${day}|${routeCode}`;

// statement lines -> groups. Each line is a fee (detail sheet) or an offset (negative fee).
export const groupStatementLines = (details, offsets) => {
  const groups = new Map();
  const add = (line, isOffset) => {
    const routeCode = line.route ?? '';
    const key = keyOf(line.deliveryId, line.signedOn, routeCode);
    const group = groups.get(key) ?? { deliveryId: line.deliveryId, signedOn: line.signedOn, routeCode, feeCents: 0, feeLines: 0, offsetLines: 0 };
    group.feeCents += line.feeCents;
    if (isOffset) group.offsetLines += 1; else group.feeLines += 1;
    groups.set(key, group);
  };
  details.forEach((line) => add(line, false));
  offsets.forEach((line) => add(line, true));
  return [...groups.values()];
};

// NASA rows -> one aggregate per driver code, day and route. The lowest row id is the anchor the revenue is shown on.
export const aggregateNasaRows = (rows) => {
  const aggregates = new Map();
  for (const row of rows) {
    const key = keyOf(row.driverCode, row.day, row.routeCode);
    const found = aggregates.get(key);
    if (!found) {
      aggregates.set(key, { driverCode: row.driverCode, day: row.day, routeCode: row.routeCode, routeId: row.routeId, driverId: row.driverId, anchorId: row.id, driverCents: row.driverCents, delivered: row.delivered, rows: 1 });
    } else {
      found.anchorId = Math.min(found.anchorId, row.id);
      found.driverCents += row.driverCents;
      found.delivered += row.delivered;
      found.rows += 1;
    }
  }
  return aggregates;
};

// routes: Map route code -> { routeId, cityId }. drivers: Map driver code (text) -> driver id.
export const matchGroups = ({ groups, routes, drivers, nasaRows, cityId }) => {
  const nasa = aggregateNasaRows(nasaRows);
  const used = new Set();
  const matched = groups.map((group) => {
    const base = { ...group, routeId: null, driverId: null, paymentDashboardId: null, nasaDriverCents: null };
    if (group.routeCode === '') return { ...base, matchState: 'no_route' };
    const route = routes.get(group.routeCode);
    if (!route || route.cityId !== cityId) return { ...base, matchState: 'unknown_route' };
    const key = keyOf(group.deliveryId, group.signedOn, group.routeCode);
    const row = nasa.get(key);
    if (row) {
      used.add(key);
      return { ...base, matchState: 'matched', routeId: route.routeId, driverId: row.driverId, paymentDashboardId: row.anchorId, nasaDriverCents: row.driverCents };
    }
    return { ...base, routeId: route.routeId, matchState: drivers.has(group.deliveryId) ? 'no_pay_group' : 'unknown_driver', driverId: drivers.get(group.deliveryId) ?? null };
  });
  const nasaOnly = [...nasa.entries()].filter(([key]) => !used.has(key)).map(([, row]) => row);
  return { groups: matched, nasaOnly, totals: matchTotals(matched, nasaOnly) };
};

export const matchTotals = (groups, nasaOnly = []) => {
  const byState = Object.fromEntries(MATCH_STATES.map((state) => [state, { groups: 0, feeCents: 0 }]));
  for (const group of groups) {
    byState[group.matchState].groups += 1;
    byState[group.matchState].feeCents += group.feeCents;
  }
  const matchedCents = byState.matched.feeCents;
  const unallocatedCents = MATCH_STATES.filter((s) => s !== 'matched').reduce((sum, s) => sum + byState[s].feeCents, 0);
  return {
    byState, matchedCents, unallocatedCents,
    nasaOnlyRows: nasaOnly.length, nasaOnlyDriverCents: nasaOnly.reduce((sum, row) => sum + row.driverCents, 0),
  };
};

import test from 'node:test';
import assert from 'node:assert/strict';
import { mainRouteCodeOf, oldCodeOf, planDailyDrivers } from '../services/admin/dailyByName/planDailyDrivers.js';
import { summarizeDailyPlan } from '../services/admin/dailyByName/summarizeDailyPlan.js';

// The daily file's rows decide driver and route by name. Made-up names, routes and numbers only.
const route = (id, code, extra = {}) => ({ id, code, job: 'Test City', enabled: true, fsPrice: '1.60', dsPrice: '0.25', ...extra });
const MAIN = route(1, 'TST 001-1');
const SUB_A = route(2, 'TST 001-1:A');
const SUB_B = route(3, 'TST 001-1:B');
const SUB_E = route(4, 'TST 001-1:E', { dsPrice: '0.50' });
const OTHER = route(5, 'TST 002-1');
const lookups = (over = {}) => ({
  routesByCode: new Map([MAIN, SUB_A, SUB_B, SUB_E, OTHER].map((r) => [r.code, r])),
  subRoutesOf: new Map([[MAIN.id, [SUB_A, SUB_B, SUB_E]]]),
  cityOfJob: new Map([['Test City', 9]]),
  driverByName: new Map([
    ['9|ana pérez', { id: 101, name: 'Ana Pérez', enabled: true }],
    ['9|bo li', { id: 102, name: 'Bo Li', enabled: true }],
    ['9|cy old', { id: 103, name: 'Cy Old', enabled: false }],
  ]),
  nameMatch: new Map(),
  choiceOf: new Map(),
  dayRows: new Map(),
  takenSeqs: new Map(),
  ...over,
});
const row = (Route, Sequence, DriverName) => ({ Route, Sequence, DriverName, TrackingNo: `T${Route}${Sequence}${DriverName}` });

test('the route code drops the day and a transfer suffix; the old code is what the old upload staged', () => {
  assert.equal(mainRouteCodeOf('1106-DFW 035-1'), 'DFW 035-1');
  assert.equal(mainRouteCodeOf('1106-DFW 035-1-T-064409'), 'DFW 035-1');
  assert.equal(mainRouteCodeOf(''), null);
  assert.equal(oldCodeOf({ Route: '1106-DFW 035-1', Sequence: 12 }), '12-DFW 035-1');
});

test('each driver goes on the main route with the sequences they have in the file; names compare like the app compares them', () => {
  const plan = planDailyDrivers([
    row('1106-TST 001-1', 1, 'Ana Pérez'), row('1106-TST 001-1', 2, '  ANA   PÉREZ '), row('1106-TST 001-1-T-000123', 3, 'ana pérez'),
    row('1106-TST 002-1', 1, 'Bo Li'),
  ], lookups());
  assert.deepEqual(plan.placements.map((p) => [p.driverId, p.route.code, [...p.seqs]]), [[101, 'TST 001-1', [1, 2, 3]], [102, 'TST 002-1', [1]]]);
  assert.deepEqual(plan.codes, ['1-TST 001-1', '2-TST 001-1', '3-TST 001-1', '1-TST 002-1']);
  assert.equal(plan.counts.placed, 4);
  // TST 001-1 has a sub-route with another price and Ana has no choice: she is listed as paid at the main route's price
  assert.deepEqual(plan.atMainPrice, [{ driverId: 101, driverName: 'Ana Pérez', route: 'TST 001-1', parcels: 3 }]);
});

test('a remembered sub-route decides the route; a remembered name match beats the name in the app', () => {
  const plan = planDailyDrivers([row('1106-TST 001-1', 1, 'Ana Pérez'), row('1106-TST 001-1', 2, 'A. Perez')], lookups({
    choiceOf: new Map([['9|1|101', SUB_E.id]]),
    nameMatch: new Map([['9|a. perez', { id: 101, name: 'Ana Pérez', enabled: true }]]),
  }));
  assert.deepEqual(plan.placements.map((p) => [p.driverId, p.route.code, [...p.seqs]]), [[101, 'TST 001-1:E', [1, 2]]]);
  assert.deepEqual(plan.atMainPrice, []);
});

test('two drivers with the same sequences on one route: the later one moves to a free sub-route with the same prices', () => {
  const plan = planDailyDrivers([row('1106-TST 001-1', 1, 'Ana Pérez'), row('1106-TST 001-1', 2, 'Ana Pérez'), row('1106-TST 001-1', 1, 'Bo Li')], lookups());
  assert.deepEqual(plan.placements.map((p) => [p.driverId, p.route.code]), [[101, 'TST 001-1'], [102, 'TST 001-1:A']]);
  assert.deepEqual(plan.movedToSub, [{ driverId: 102, driverName: 'Bo Li', mainRoute: 'TST 001-1', subRoute: 'TST 001-1:A' }]);
  assert.deepEqual(plan.codes, ['1-TST 001-1', '2-TST 001-1', '1-TST 001-1:A']);
});

test('in the file, when every same-price sub-route is taken too, the later driver is not added and is reported', () => {
  const rows = [row('1106-TST 001-1', 1, 'Ana Pérez'), row('1106-TST 001-1', 1, 'Bo Li'), row('1106-TST 001-1', 1, 'Di Ng'), row('1106-TST 001-1', 1, 'Ed Fu')];
  const plan = planDailyDrivers(rows, lookups({ driverByName: new Map([
    ['9|ana pérez', { id: 101, name: 'Ana Pérez', enabled: true }], ['9|bo li', { id: 102, name: 'Bo Li', enabled: true }],
    ['9|di ng', { id: 104, name: 'Di Ng', enabled: true }], ['9|ed fu', { id: 105, name: 'Ed Fu', enabled: true }],
  ]) }));
  assert.deepEqual(plan.placements.map((p) => p.route.code), ['TST 001-1', 'TST 001-1:A', 'TST 001-1:B']); // never :E, which has another price
  assert.deepEqual(plan.clashes, [{ driverId: 105, driverName: 'Ed Fu', route: 'TST 001-1', parcels: 1, reason: 'file' }]);
  assert.equal(plan.codes[3], 'unplaced-3'); // its old code is Ana's now
});

test('a parcel already in another driver\'s day is never given to a second driver, on any route of that main route', () => {
  // driver 999 already has sequence 1 of TST 001-1 that day, on the sub-route :B (entered by hand, or paid, or in a pay run)
  const plan = planDailyDrivers([row('1106-TST 001-1', 1, 'Ana Pérez'), row('1106-TST 001-1', 2, 'Bo Li')], lookups({ takenSeqs: new Map([['3|1', 999]]) }));
  assert.deepEqual(plan.clashes, [{ driverId: 101, driverName: 'Ana Pérez', route: 'TST 001-1', parcels: 1, reason: 'held' }]);
  assert.deepEqual(plan.placements.map((p) => [p.driverId, p.route.code]), [[102, 'TST 001-1']]);
});

test('a driver who already has a day keeps its route, even when a sub-route is remembered for them', () => {
  const plan = planDailyDrivers([row('1106-TST 001-1', 1, 'Ana Pérez'), row('1106-TST 001-1', 2, 'Ana Pérez')], lookups({
    takenSeqs: new Map([['2|1', 101]]), dayRows: new Map([['101|2', { id: 7, paid: false }]]), choiceOf: new Map([['9|1|101', SUB_E.id]]),
  }));
  assert.deepEqual(plan.placements.map((p) => [p.route.code, p.dayRow?.id, [...p.seqs]]), [['TST 001-1:A', 7, [1, 2]]]);
});

test('unmatched names, disabled drivers and unknown routes are counted and listed, never dropped', () => {
  const rows = [
    row('1106-TST 001-1', 1, 'Nobody Known'), row('1106-TST 001-1', 2, 'Nobody Known'), row('1106-TST 002-1', 1, 'Cy Old'),
    row('1106-TST 404-1', 1, 'Ana Pérez'), row('1106-TST 001-1', 'x', 'Ana Pérez'), row('', 3, 'Ana Pérez'), row('1106-TST 001-1', 4, ''),
  ];
  const plan = planDailyDrivers(rows, lookups({ routesByCode: new Map([MAIN, OTHER, route(6, 'TST 404-1', { enabled: false })].map((r) => [r.code, r])) }));
  assert.deepEqual(plan.unmatchedNames.map((u) => [u.fileName, u.parcels, u.routes]), [['Nobody Known', 2, ['TST 001-1']]]);
  assert.deepEqual(plan.disabledDrivers.map((u) => [u.fileName, u.driverId, u.parcels]), [['Cy Old', 103, 1]]);
  assert.deepEqual(plan.missingRoutes, [{ code: 'TST 404-1', reason: 'route_disabled', parcels: 1 }]);
  const summary = summarizeDailyPlan(plan, { created: 0, extended: 0 });
  assert.deepEqual(summary.rows, {
    inFile: 7, placed: 0, unreadable: 3, name_not_matched: 2, driver_disabled: 1, route_not_in_app: 0, route_disabled: 1, route_without_city: 0, paid_day: 0, clash: 0, counted: 7,
  });
});

test('a paid day is never changed: its rows are counted and listed', () => {
  const plan = planDailyDrivers([row('1106-TST 001-1', 1, 'Ana Pérez')], lookups({ dayRows: new Map([['101|1', { id: 55, paid: true }]]) }));
  assert.deepEqual([plan.placements.length, plan.counts.paid_day, plan.paidDays[0].route], [0, 1, 'TST 001-1']);
});

test('a sequence a driver has twice is one delivery, as in the old method', () => {
  const plan = planDailyDrivers([row('1106-TST 002-1', 7, 'Bo Li'), row('1106-TST 002-1', 7, 'Bo Li')], lookups());
  assert.deepEqual([...plan.placements[0].seqs], [7]);
  assert.equal(plan.placements[0].parcels, 2);
});

test('a row that is not placed can never take over a placed driver\'s delivery code', () => {
  // Bo Li (placed) and an unknown name both have sequence 5 on TST 002-1: the unknown row must not stage "5-TST 002-1"
  const plan = planDailyDrivers([row('1106-TST 002-1', 5, 'Bo Li'), row('1106-TST 002-1', 5, 'Nobody Known'), row('1106-TST 002-1', 6, 'Nobody Known')], lookups());
  assert.deepEqual(plan.codes, ['5-TST 002-1', 'unplaced-1', '6-TST 002-1']);
});

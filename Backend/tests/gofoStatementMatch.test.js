import test from 'node:test';
import assert from 'node:assert/strict';
import { StatementError } from '../services/finance/gofoStatement/statementMoney.js';
import { billingWeekDates } from '../services/finance/gofoStatement/statementPeriod.js';
import { aggregateNasaRows, groupStatementLines, matchGroups } from '../services/finance/gofoStatement/matchStatement.js';

// All values are made up.
const fee = (deliveryId, signedOn, route, feeCents) => ({ deliveryId, signedOn, route, feeCents });

test('the billing week is the ISO week, Monday to Sunday, and anything else is refused', () => {
  assert.deepEqual(billingWeekDates('Week 43-2026'), { start: '2026-10-19', end: '2026-10-25', label: 'Week 43-2026' });
  assert.deepEqual(billingWeekDates(' week 40 - 2026 '), { start: '2026-09-28', end: '2026-10-04', label: 'Week 40-2026' });
  assert.equal(billingWeekDates('Week 1-2026').start, '2025-12-29', 'week 1 holds 4 January, so it can start in the old year');
  assert.equal(billingWeekDates('Week 53-2026').end, '2027-01-03', '2026 has 53 weeks');
  for (const bad of ['Week 54-2026', 'Week 0-2026', 'Week 53-2025', 'Weekly settlement', '', null, '43-2026']) {
    assert.throws(() => billingWeekDates(bad), StatementError, String(bad));
  }
});

test('lines are added up per Delivery ID, signing day and route, offsets included', () => {
  const groups = groupStatementLines(
    [fee('1001', '2026-10-19', 'R-1', 180), fee('1001', '2026-10-19', 'R-1', 261), fee('1001', '2026-10-19', 'R-2', 100), fee('1001', '2026-10-20', 'R-1', 50), fee('1002', '2026-10-19', null, 70)],
    [fee('1001', '2026-10-19', 'R-1', -180)]
  );
  const by = (id, day, route) => groups.find((g) => g.deliveryId === id && g.signedOn === day && g.routeCode === route);
  assert.equal(groups.length, 4, "the offset joins the group of the fee it reverses");
  assert.deepEqual(by('1001', '2026-10-19', 'R-1'), { deliveryId: '1001', signedOn: '2026-10-19', routeCode: 'R-1', feeCents: 261, feeLines: 2, offsetLines: 1 });
  assert.equal(by('1002', '2026-10-19', '').feeLines, 1, 'a missing route is its own group');
  assert.equal(groups.reduce((n, g) => n + g.feeCents, 0), 180 + 261 + 100 + 50 + 70 - 180);
});

const routes = new Map([['R-1', { routeId: 11, cityId: 5 }], ['R-2', { routeId: 12, cityId: 5 }], ['OTHER', { routeId: 99, cityId: 6 }]]);
const drivers = new Map([['1001', 501], ['1002', 502]]);
const nasa = (id, driverCode, day, routeCode, driverCents) => ({ id, driverId: Number(driverCode) - 500, driverCode, day, routeId: routeCode === 'R-1' ? 11 : 12, routeCode, delivered: 1, driverCents });
const group = (deliveryId, signedOn, routeCode, feeCents) => ({ deliveryId, signedOn, routeCode, feeCents, feeLines: 1, offsetLines: 0 });

test('each group is matched, or kept with the reason it was not, and every cent is accounted for', () => {
  const groups = [
    group('1001', '2026-10-19', 'R-1', 500),   // matched
    group('1001', '2026-10-20', 'R-1', 300),   // driver and route known, nothing recorded that day
    group('1002', '2026-10-19', '', 40),       // the carrier gave no route
    group('1002', '2026-10-19', 'NOPE', 60),   // route not set up
    group('7777', '2026-10-19', 'R-2', 90),    // no such driver
    group('1002', '2026-10-19', 'OTHER', 25),  // a route of another city is never forced onto this one
  ];
  const result = matchGroups({ groups, routes, drivers, nasaRows: [nasa(1, '1001', '2026-10-19', 'R-1', 410), nasa(2, '1002', '2026-10-21', 'R-1', 120)], cityId: 5 });
  assert.deepEqual(result.groups.map((g) => g.matchState), ['matched', 'no_pay_group', 'no_route', 'unknown_route', 'unknown_driver', 'unknown_route']);
  assert.deepEqual([result.groups[0].paymentDashboardId, result.groups[0].driverId, result.groups[0].routeId, result.groups[0].nasaDriverCents], [1, 501, 11, 410]);
  assert.equal(result.groups[1].driverId, 501, 'a known driver is kept even without a pay group');
  assert.equal(result.totals.matchedCents, 500);
  assert.equal(result.totals.unallocatedCents, 300 + 40 + 60 + 90 + 25);
  assert.equal(result.totals.matchedCents + result.totals.unallocatedCents, groups.reduce((n, g) => n + g.feeCents, 0));
  assert.deepEqual(result.totals.byState.no_route, { groups: 1, feeCents: 40 });
  assert.equal(result.totals.nasaOnlyRows, 1, 'NASA work the carrier did not bill is reported, not hidden');
  assert.equal(result.totals.nasaOnlyDriverCents, 120);
});

test('NASA rows are added up before the join, so a repeated row cannot multiply the revenue', () => {
  const rows = [nasa(7, '1001', '2026-10-19', 'R-1', 100), nasa(3, '1001', '2026-10-19', 'R-1', 250), nasa(9, '1001', '2026-10-19', 'R-2', 10)];
  const aggregates = aggregateNasaRows(rows);
  assert.equal(aggregates.size, 2);
  const joined = aggregates.get('1001|2026-10-19|R-1');
  assert.deepEqual([joined.anchorId, joined.driverCents, joined.rows], [3, 350, 2]);
  const result = matchGroups({ groups: [group('1001', '2026-10-19', 'R-1', 500)], routes, drivers, nasaRows: rows, cityId: 5 });
  assert.equal(result.groups[0].paymentDashboardId, 3, 'the revenue is shown once, on the lowest row id');
  assert.equal(result.totals.matchedCents, 500, 'one group, counted once');
  assert.equal(result.totals.nasaOnlyRows, 1, 'the other route that day is NASA-only');
});

test('a negative group (an offset with no fee) is kept as it is', () => {
  const result = matchGroups({ groups: [group('1001', '2026-10-19', 'R-1', -45)], routes, drivers, nasaRows: [], cityId: 5 });
  assert.deepEqual([result.groups[0].matchState, result.totals.unallocatedCents], ['no_pay_group', -45]);
});

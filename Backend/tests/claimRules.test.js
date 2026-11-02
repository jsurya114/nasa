import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimKey, claimTypeKey, cityKey, isExempt, parseCarrierDateTime, parseCharge, resolveClaim,
} from '../services/payroll/claims/claimRules.js';

// All values below are made up. No real waybill, driver, city record or amount from a client file.

test('the deduction is the absolute charge: +40 and -40 both deduct 40', () => {
  assert.deepEqual(parseCharge(-40), { charge: '-40.00', deduction: '40.00' });
  assert.deepEqual(parseCharge(40), { charge: '40.00', deduction: '40.00' });
  assert.deepEqual(parseCharge('-40'), { charge: '-40.00', deduction: '40.00' });
  assert.deepEqual(parseCharge(' -1,234.5 '), { charge: '-1234.50', deduction: '1234.50' });
  assert.deepEqual(parseCharge(-0.07), { charge: '-0.07', deduction: '0.07' });
  assert.deepEqual(parseCharge(19.99), { charge: '19.99', deduction: '19.99' });
});

test('blank, zero, text and over-precise amounts are refused, never turned into zero or rounded', () => {
  for (const bad of [null, undefined, '', '  ', 'abc', '$40', '40usd', NaN, Infinity, {}, [], true]) {
    assert.ok(parseCharge(bad).error, `should refuse ${String(bad)}`);
  }
  assert.equal(parseCharge(0).error, 'amount is zero');
  assert.equal(parseCharge('-0.00').error, 'amount is zero');
  assert.equal(parseCharge(40.005).error, 'amount has more than two decimals');
});

test('exempt only when the city is DFW GOFO AND the type is Tracking interruption', () => {
  assert.equal(isExempt('DFW GOFO', 'Tracking interruption'), true);
  assert.equal(isExempt('DFW GOFO', 'Damaged Item'), false);
  assert.equal(isExempt('Tyler GOFO', 'Tracking interruption'), false);
  assert.equal(isExempt('Tyler GOFO', 'Damaged Item'), false);
});

test('case, space and punctuation variants still match; other cities stay distinct', () => {
  for (const city of ['dfw gofo', ' DFW  GOFO ', 'Dfw-Gofo', 'DFWGOFO']) assert.equal(isExempt(city, 'Tracking interruption'), true, city);
  for (const type of ['tracking interruption', ' TRACKING   Interruption ', 'Tracking Interruption']) assert.equal(isExempt('DFW GOFO', type), true, type);
  assert.equal(cityKey('DFW'), 'dfw');
  for (const city of ['DFW', 'DFW SpeedX', 'Dallas GOFO', 'GOFO', 'DFW GOFO 2', '', null, undefined]) {
    assert.equal(isExempt(city, 'Tracking interruption'), false, String(city));
  }
  for (const type of ['Tracking', 'interruption', 'Tracking interruption fee', '', null]) assert.equal(isExempt('DFW GOFO', type), false, String(type));
  assert.equal(claimTypeKey('  Fake   POD '), 'fake pod');
});

test('carrier dates are month first and must be real dates', () => {
  assert.equal(parseCarrierDateTime('09/28/2026 14:05:00'), '2026-09-28 14:05:00');
  assert.equal(parseCarrierDateTime('10/04/2026'), '2026-10-04 00:00:00');
  assert.equal(parseCarrierDateTime('2026-10-04 08:30'), '2026-10-04 08:30:00');
  assert.equal(parseCarrierDateTime('02/29/2028 00:00:00'), '2028-02-29 00:00:00');
  for (const bad of ['28/09/2026 14:05:00', '02/30/2026', '13/01/2026', '09/28/2026 24:00:00', '9/28/2026', 'yesterday', '', null, 46000]) {
    assert.equal(parseCarrierDateTime(bad), null, String(bad));
  }
});

test('claim identity ignores amount, file, case and spaces, but not courier, waybill or type', () => {
  const base = { courier: 'gofo', waybill: 'TEST0001', claimType: 'Damaged Item' };
  assert.equal(claimKey(base), claimKey({ ...base, waybill: ' test 0001 ', claimType: 'damaged  item' }));
  assert.notEqual(claimKey(base), claimKey({ ...base, waybill: 'TEST0002' }));
  assert.notEqual(claimKey(base), claimKey({ ...base, claimType: 'fake pod' }));
  assert.notEqual(claimKey(base), claimKey({ ...base, courier: 'speedx' }));
  assert.match(claimKey(base), /^[0-9a-f]{64}$/);
});

const CLAIM = { claimType: 'Damaged Item', deduction: '40.00' };
const TRACKING = { claimType: 'Tracking interruption', deduction: '25.00' };
const DFW = { driverId: 11, cityId: 2, cityName: 'DFW GOFO', carrierDeliveryId: '900001', routeId: 5, journeyDate: '2026-09-28' };

test('all four city and type combinations', () => {
  const tyler = { ...DFW, cityId: 3, cityName: 'Tyler GOFO' };
  assert.deepEqual([resolveClaim(TRACKING, [DFW], 2).status, resolveClaim(TRACKING, [DFW], 2).eligibleDeduction], ['exempt', '0.00']);
  assert.deepEqual([resolveClaim(CLAIM, [DFW], 2).status, resolveClaim(CLAIM, [DFW], 2).eligibleDeduction], ['chargeable', '40.00']);
  assert.deepEqual([resolveClaim(TRACKING, [tyler], 3).status, resolveClaim(TRACKING, [tyler], 3).eligibleDeduction], ['chargeable', '25.00']);
  assert.deepEqual([resolveClaim(CLAIM, [tyler], 3).status, resolveClaim(CLAIM, [tyler], 3).eligibleDeduction], ['chargeable', '40.00']);
  const exempt = resolveClaim(TRACKING, [DFW], 2);
  assert.equal(exempt.driverId, 11);
  assert.equal(exempt.carrierDeliveryId, '900001');
});

test('no history, unlinked delivery or unknown city: unresolved, never charged', () => {
  for (const [candidates, reason] of [
    [[], /no delivery history/],
    [undefined, /no delivery history/],
    [[{ ...DFW, driverId: null }], /not linked to a NASA driver/],
    [[{ ...DFW, cityId: null }], /no verified city/],
    [[{ ...DFW, cityName: '' }], /no verified city/],
  ]) {
    const result = resolveClaim(CLAIM, candidates, 2);
    assert.equal(result.status, 'unresolved');
    assert.equal(result.eligibleDeduction, null);
    assert.equal(result.driverId, null);
    assert.match(result.reason, reason);
  }
});

test('two drivers or two cities for one waybill: ambiguous, never charged', () => {
  const twoDrivers = resolveClaim(CLAIM, [DFW, { ...DFW, driverId: 12 }], 2);
  assert.equal(twoDrivers.status, 'ambiguous');
  assert.equal(twoDrivers.eligibleDeduction, null);
  const twoCities = resolveClaim(CLAIM, [DFW, { ...DFW, cityId: 3, cityName: 'Tyler GOFO' }], 2);
  assert.equal(twoCities.status, 'ambiguous');
  // The same driver on two journeys in the same city is still one driver.
  assert.equal(resolveClaim(CLAIM, [DFW, { ...DFW, routeId: 6, journeyDate: '2026-09-29' }], 2).status, 'chargeable');
});

test('a matching display name never decides who owes a claim', () => {
  // Two different drivers who happen to share a name are two drivers.
  const sameName = resolveClaim(CLAIM, [{ ...DFW, driverName: 'Sam Lee' }, { ...DFW, driverId: 12, driverName: 'Sam Lee' }], 2);
  assert.equal(sameName.status, 'ambiguous');
  assert.equal(sameName.driverId, null);
});

test('the historical city decides, and it must be the city the file was uploaded for', () => {
  // The driver later moved to another city: only the delivery's own city at the time counts.
  assert.equal(resolveClaim(TRACKING, [DFW], 2).status, 'exempt');
  const otherCityFile = resolveClaim(TRACKING, [DFW], 3);
  assert.equal(otherCityFile.status, 'ambiguous');
  assert.equal(otherCityFile.eligibleDeduction, null);
});

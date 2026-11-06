import test from 'node:test';
import assert from 'node:assert/strict';
import { CASH, EVEREE, METHODS_FOR, evereeTypeBlockers, isDriverType, methodAllowed, typeBlockers } from '../services/payroll/payRuns/driverPaymentRules.js';

// The rule of this feature, as pure functions: Local = Cash in Hand or Everee; Desi = Cash in Hand only; no type = nothing.
test('Desi drivers are paid in cash only; Local drivers in cash or through Everee; nobody else is paid', () => {
  assert.deepEqual([methodAllowed('DESI', CASH), methodAllowed('DESI', EVEREE)], [true, false]);
  assert.deepEqual([methodAllowed('LOCAL', CASH), methodAllowed('LOCAL', EVEREE)], [true, true]);
  for (const type of [null, undefined, '', 'local', 'desi', 'OTHER', 0, {}]) {
    assert.equal(methodAllowed(type, CASH), false, `no payment for type ${JSON.stringify(type)}`);
    assert.equal(methodAllowed(type, EVEREE), false);
  }
  for (const method of ['bank_transfer', 'other', 'CASH', '', null, undefined]) {
    assert.equal(methodAllowed('LOCAL', method), false, `method ${JSON.stringify(method)}`);
    assert.equal(methodAllowed('DESI', method), false);
  }
  assert.ok(Object.isFrozen(METHODS_FOR) && Object.isFrozen(METHODS_FOR.DESI));
});

test('a driver with no type is blocked for every method; a Desi driver is blocked for Everee only', () => {
  assert.deepEqual(typeBlockers('LOCAL'), []);
  assert.deepEqual(typeBlockers('DESI'), []);
  for (const type of [null, undefined, '', 'x']) {
    const found = typeBlockers(type);
    assert.deepEqual(found.map((b) => [b.code, b.severity]), [['driver_type_not_set', 'blocking']]);
    assert.match(found[0].message, /Local or Desi/);
  }
  assert.deepEqual(evereeTypeBlockers('LOCAL'), []);
  assert.deepEqual(evereeTypeBlockers(null), [], 'an untyped driver is stopped by typeBlockers, not counted twice');
  assert.deepEqual(evereeTypeBlockers('DESI').map((b) => [b.code, b.severity]), [['desi_not_everee', 'blocking']]);
  assert.equal(isDriverType('LOCAL') && isDriverType('DESI') && !isDriverType('local'), true);
});

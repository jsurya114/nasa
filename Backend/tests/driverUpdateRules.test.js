import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, PHONE_MESSAGE, driverUpdateFailure, parseDriverFields, parsePhone } from '../services/admin/driverUpdateRules.js';

// Saving an edited driver used to answer a bare "Server error" for several ordinary mistakes (an email another driver has, a phone number or email that is
// too long, a bad driver code, a disabled city). Each now says what to change. No database needed.

test('the fields that go into limited columns are checked before the database is asked', () => {
  assert.deepEqual(parseDriverFields({ email: ' a@b.co ', phoneNumber: '903-405-8843', driver_code: '421211' }), { email: 'a@b.co', phoneNumber: '903-405-8843', driverCode: 421211 });
  assert.equal(parseDriverFields({ email: 'a@b.co', phoneNumber: '903-405-8843' }).driverCode, null, 'no code given: the caller keeps the current one');
  for (const bad of [{ email: '' }, { email: undefined }, { email: 'x'.repeat(LIMITS.email + 1) }]) assert.match(parseDriverFields({ phoneNumber: '1', driver_code: 1, ...bad }).error, /Email/);
  assert.match(parseDriverFields({ email: 'a@b.co', phoneNumber: '1'.repeat(21) }).error, /Phone number is required/);
  for (const code of ['12ab', '0', '-5', '99999999999', '2147483648', '1.5', ' 1 2 ']) assert.match(parseDriverFields({ email: 'a@b.co', phoneNumber: '903-405-8843', driver_code: code }).error, /Driver code/, code);
  assert.equal(parseDriverFields({ email: 'a@b.co', phoneNumber: '903-405-8843', driver_code: '2147483647' }).driverCode, 2147483647);
});

test('a known database refusal says what to change, and an unknown error stays a server error', () => {
  const dup = (constraint) => Object.assign(new Error('duplicate key'), { code: '23505', constraint });
  assert.deepEqual(driverUpdateFailure(dup('drivers_email_key')), { status: 409, message: 'Another driver already uses this email' });
  assert.deepEqual(driverUpdateFailure(dup('drivers_driver_code_key')), { status: 409, message: 'Driver code already exists' });
  assert.equal(driverUpdateFailure(Object.assign(new Error('x'), { code: '22001' })).status, 400);
  assert.equal(driverUpdateFailure(Object.assign(new Error('x'), { code: '22003' })).status, 400);
  assert.equal(driverUpdateFailure(Object.assign(new Error('x'), { code: '22P02' })).status, 400);
  assert.match(driverUpdateFailure(Object.assign(new Error('City'), { code: 'CITY_NOT_AVAILABLE' })).message, /city is disabled/);
  for (const other of [dup('drivers_name_key'), dup('something_else'), Object.assign(new Error('x'), { code: '40001' }), new Error('boom'), null, undefined]) {
    assert.equal(driverUpdateFailure(other), null, 'not a refusal we know');
  }
});

test('the phone number is required and must be one Everee can use: a US number of 10 digits (a leading 1 is allowed)', () => {
  for (const good of ['903-405-8843', '(903) 405 8843', '9034058843', '+1 903-405-8843', '1-903-405-8843', '  903.405.8843 ']) {
    // dots are not in the form's allowed characters, but the digits are what counts
    assert.equal(parsePhone(good).error, undefined, good);
    assert.equal(parsePhone(good).phone, good.trim(), 'stored as typed');
  }
  for (const bad of [undefined, null, '', '   ', '12345', '903-405-884', '903-405-88433', '+44 20 7946 0958', 'call me', 5]) {
    assert.equal(parsePhone(bad).error, PHONE_MESSAGE, String(bad));
  }
  assert.equal(parseDriverFields({ email: 'a@b.co', phoneNumber: '', driver_code: 7 }).error, PHONE_MESSAGE, 'editing a driver without a phone asks for one');
  assert.equal(parseDriverFields({ email: 'a@b.co', driver_code: 7 }).error, PHONE_MESSAGE);
});

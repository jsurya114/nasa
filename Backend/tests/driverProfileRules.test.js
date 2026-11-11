import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProfile } from '../services/driver/profileRules.js';

// A driver editing their own full name, email and phone. No database needed.

const good = { name: 'Maria  Lopez ', email: ' maria@example.com ', phoneNumber: '(903) 405-8843' };

test('a good profile comes back cleaned and ready to store', () => {
  assert.deepEqual(parseProfile(good), { values: { name: 'Maria Lopez', email: 'maria@example.com', phoneNumber: '(903) 405-8843' } });
  assert.equal(parseProfile({ ...good, phoneNumber: '1-903-405-8843' }).values.phoneNumber, '1-903-405-8843', 'a leading 1 is allowed, as on the admin form');
});

test('every refused field says which key explains it, and several can fail at once', () => {
  assert.deepEqual(parseProfile({ name: '  ', email: '', phoneNumber: '' }).errors, { name: 'nameRequired', email: 'emailRequired', phoneNumber: 'phoneInvalid' });
  assert.equal(parseProfile({ ...good, name: 'x'.repeat(101) }).errors.name, 'nameTooLong');
  assert.equal(parseProfile({ ...good, email: `${'x'.repeat(146)}@a.co` }).errors.email, 'emailTooLong');
  for (const email of ['plain', 'a@b', '@b.co', 'a b@c.co', 'a@@b.co']) assert.equal(parseProfile({ ...good, email }).errors.email, 'emailInvalid', email);
  for (const phoneNumber of ['12345', '1'.repeat(21), '900-abc-8843']) assert.equal(parseProfile({ ...good, phoneNumber }).errors.phoneNumber, 'phoneInvalid', phoneNumber);
});

test('missing, empty or oddly typed input is refused instead of throwing', () => {
  for (const body of [undefined, null, 'text', 5, [], {}]) assert.deepEqual(Object.keys(parseProfile(body).errors).sort(), ['email', 'name', 'phoneNumber']);
  assert.ok(parseProfile({ name: { a: 1 }, email: 7, phoneNumber: ['903'] }).errors);
});

test('nothing outside the three fields is kept (the id, city, code and password are not a driver\'s to change)', () => {
  const { values } = parseProfile({ ...good, id: 9, driver_code: 5, city: 'X', enabled: false, password: 'p', driverType: 'LOCAL' });
  assert.deepEqual(Object.keys(values), ['name', 'email', 'phoneNumber']);
});

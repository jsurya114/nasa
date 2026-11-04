import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driverIssues, linkSourceOf, matchWorkers, maskEmail, maskPhone, normalizeEmail, normalizePhone, readyToPay, splitName } from '../services/payments/everee/workerRules.js';

// Made-up people only.
const worker = (o) => ({ workerId: 'W1', externalWorkerId: null, firstName: 'Alice', lastName: 'Rider', email: 'alice@example.com', phoneNumber: '5551230001', ...o });
const driver = { email: 'alice@example.com', phone: '5551230001' };

test('email and phone are normalized; anything else is not accepted', () => {
  assert.equal(normalizeEmail('  Alice@Example.COM '), 'alice@example.com');
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizePhone('(555) 123-0001'), '5551230001');
  assert.equal(normalizePhone('+1 555 123 0001'), '5551230001');
  assert.equal(normalizePhone('555123'), null);
  assert.equal(normalizePhone(undefined), null);
});

test('a name is split into first and last; one word is not guessed', () => {
  assert.deepEqual(splitName('Alice Rider'), { firstName: 'Alice', lastName: 'Rider' });
  assert.deepEqual(splitName('  Paul   Alvin  Potier III '), { firstName: 'Paul', lastName: 'Alvin Potier III' });
  assert.equal(splitName('Bob'), null);
  assert.equal(splitName('   '), null);
});

test('driver data issues: a one-word name or no valid phone blocks; email alone does not make up for a missing phone', () => {
  assert.deepEqual(driverIssues({ name: 'Alice Rider', phone_number: '5551230001', email: null }), []);
  assert.deepEqual(driverIssues({ name: 'Bob', phone_number: '5551230001' }).map((i) => i.code), ['name_needs_first_and_last']);
  assert.deepEqual(driverIssues({ name: 'Alice Rider', phone_number: '12', email: 'a@example.com' }).map((i) => i.code), ['no_valid_phone']);
  assert.deepEqual(driverIssues({ name: 'Alice Rider', phone_number: null, email: null }).map((i) => i.code), ['no_valid_phone', 'no_email_or_phone']);
  assert.ok(driverIssues({ name: 'Bob' }).every((i) => typeof i.message === 'string' && i.message.length > 5));
});

test('matching counts only an exact email or phone, never a name', () => {
  const sameNameOnly = worker({ workerId: 'W9', email: 'someone@else.com', phoneNumber: '5550000000' });
  assert.deepEqual(matchWorkers(driver, [sameNameOnly]), { result: 'no_match', matches: [] });
  const byEmail = worker({ phoneNumber: '5550000000', email: 'ALICE@example.com' });
  const [one] = matchWorkers(driver, [byEmail]).matches;
  assert.deepEqual(one.matchedOn, ['email']);
  const byPhone = worker({ email: 'other@example.com', phoneNumber: '(555) 123-0001' });
  assert.deepEqual(matchWorkers(driver, [byPhone]).matches[0].matchedOn, ['phone']);
});

test('one worker found by both email and phone is one match; two different workers are ambiguous', () => {
  const same = matchWorkers(driver, [worker({}), worker({})]);
  assert.equal(same.result, 'match');
  assert.equal(same.matches.length, 1);
  assert.deepEqual(same.matches[0].matchedOn, ['email', 'phone']);
  const a = worker({ workerId: 'WA', phoneNumber: '5550000000' });
  const b = worker({ workerId: 'WB', email: 'other@example.com' });
  const two = matchWorkers(driver, [a, b]);
  assert.equal(two.result, 'ambiguous');
  assert.equal(two.matches.length, 2);
});

test('a search that hit Everee\'s limit is never called a clean match or "no match"', () => {
  assert.equal(matchWorkers(driver, [worker({})], { truncated: true }).result, 'ambiguous');
  assert.equal(matchWorkers(driver, [], { truncated: true }).result, 'ambiguous');
});

test('what is returned about a match is masked, and the link source follows what matched', () => {
  const [m] = matchWorkers(driver, [worker({})]).matches;
  assert.equal(m.maskedEmail, 'a***@example.com');
  assert.equal(m.maskedPhone, '***0001');
  assert.ok(!JSON.stringify(m).includes('alice@example.com') && !JSON.stringify(m).includes('5551230001'));
  assert.equal(maskEmail('nope'), null);
  assert.equal(maskPhone('12'), null);
  assert.equal(linkSourceOf(['email', 'phone']), 'matched_email_and_phone');
  assert.equal(linkSourceOf(['email']), 'matched_email');
  assert.equal(linkSourceOf(['phone']), 'matched_phone');
});

test('a worker is ready to be paid only when onboarding is complete, the tax ID did not fail and they are not separated', () => {
  assert.equal(readyToPay({ onboardingComplete: true, tinStatus: 'VERIFIED', terminated: false }), true);
  assert.equal(readyToPay({ onboardingComplete: true, tinStatus: null, terminated: false }), true);
  assert.equal(readyToPay({ onboardingComplete: false, tinStatus: 'VERIFIED', terminated: false }), false);
  assert.equal(readyToPay({ onboardingComplete: true, tinStatus: 'VERIFICATION_FAILED', terminated: false }), false);
  assert.equal(readyToPay({ onboardingComplete: true, tinStatus: 'VERIFIED', terminated: true }), false);
});

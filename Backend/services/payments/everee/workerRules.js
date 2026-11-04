// The rules for linking a NASA driver to an existing Everee worker (issue #31). No database and no network here.
//
// The client moved its drivers into Everee from QuickBooks, so a worker usually exists already. Rules agreed with Jasil on #31:
// look before creating; match only on an exact email or phone, never on the name; no match or more than one match means the driver
// stays unlinked and blocked; a name of one word or a missing 10-digit phone is a blocker (nothing is invented).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_SEARCH_RESULTS = 10; // Everee returns at most 10 workers for a search

export const normalizeEmail = (value) => {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
};

// A US phone as 10 digits, or null. A leading country code 1 is dropped.
export const normalizePhone = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return /^\d{10}$/.test(ten) ? ten : null;
};

// "Paul Alvin Potier III" -> first "Paul", last "Alvin Potier III". Everee needs both; a one-word name is not guessed at.
export const splitName = (fullName) => {
  const parts = String(fullName ?? '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  return parts.length >= 2 ? { firstName: parts[0], lastName: parts.slice(1).join(' ') } : null;
};

export const ISSUES = Object.freeze({
  name_needs_first_and_last: 'the name has only one word; Everee needs a first and a last name',
  no_valid_phone: 'there is no valid 10-digit phone number',
  no_email_or_phone: 'there is neither an email nor a phone to look the driver up by',
});

// What stops this driver from being linked or paid through Everee, from the driver's own data. [{ code, message }]
export const driverIssues = (driver) => {
  const codes = [];
  if (!splitName(driver?.name)) codes.push('name_needs_first_and_last');
  const phone = normalizePhone(driver?.phone_number);
  if (!phone) codes.push('no_valid_phone');
  if (!phone && !normalizeEmail(driver?.email)) codes.push('no_email_or_phone');
  return codes.map((code) => ({ code, message: ISSUES[code] }));
};

const mask = (value, keep) => (value.length <= keep ? '***' : `***${value.slice(-keep)}`);
export const maskEmail = (email) => {
  const e = normalizeEmail(email);
  if (!e) return null;
  const [local, domain] = e.split('@');
  return `${local[0]}***@${domain}`;
};
export const maskPhone = (phone) => {
  const p = normalizePhone(phone);
  return p ? mask(p, 4) : null;
};

// Everee's search is a loose text search over names, email, phone and IDs. Only a worker whose email or phone equals the driver's
// counts; the name is never looked at. found: the search results (all searches for this driver together).
// Returns { result: 'no_match' | 'match' | 'ambiguous', matches: [...] }. A worker found twice (by email and by phone) is one match.
// If a search returned the most Everee gives, the list may be incomplete, so it is never called a clean match.
export const matchWorkers = ({ email, phone }, found, { truncated = false } = {}) => {
  const byWorker = new Map();
  for (const worker of found) {
    const matchedOn = [];
    if (email && normalizeEmail(worker.email) === email) matchedOn.push('email');
    if (phone && normalizePhone(worker.phoneNumber) === phone) matchedOn.push('phone');
    if (matchedOn.length === 0 || worker.workerId === undefined || worker.workerId === null) continue;
    const key = String(worker.workerId);
    const seen = byWorker.get(key);
    byWorker.set(key, {
      workerId: key,
      externalWorkerId: worker.externalWorkerId ?? null,
      firstName: worker.firstName ?? null,
      lastName: worker.lastName ?? null,
      maskedEmail: maskEmail(worker.email),
      maskedPhone: maskPhone(worker.phoneNumber),
      matchedOn: [...new Set([...(seen?.matchedOn ?? []), ...matchedOn])],
    });
  }
  const matches = [...byWorker.values()];
  if (matches.length === 0) return { result: truncated ? 'ambiguous' : 'no_match', matches };
  return { result: matches.length === 1 && !truncated ? 'match' : 'ambiguous', matches };
};

export const linkSourceOf = (matchedOn) => (matchedOn.includes('email') && matchedOn.includes('phone') ? 'matched_email_and_phone' : matchedOn.includes('email') ? 'matched_email' : 'matched_phone');

// The worker is ready to be paid once Everee says onboarding is complete, the tax ID did not fail, and they are not separated.
export const readyToPay = ({ onboardingComplete, tinStatus, terminated }) => Boolean(onboardingComplete) && !terminated && tinStatus !== 'VERIFICATION_FAILED';

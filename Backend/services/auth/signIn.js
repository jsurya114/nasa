// One sign-in for every NASA account (drivers, city admins, the super admin). The person types an email and a password;
// the server works out which account they belong to. The person never says "I am an admin" or "I am a driver" up front.
//
// Rules:
// - Both account tables are always looked at and every found password is always checked, so the time taken and the
//   answer do not depend on whether the email exists or which kind of account it is.
// - A wrong email, a wrong password and an unknown account all get the same answer ("invalid").
// - A disabled account is reported only to someone who typed its correct password.
// - If the same email and password open BOTH an admin and a driver account, nothing is chosen for the person: the
//   answer is "choose", and the client asks again naming one of the two. Nothing is merged or rewritten.
// - The lookup is exactly the one the two existing login routes use, so every existing password keeps working.
//
// No database or token code here: the lookups and the password check are passed in, so the rules run in plain tests.

export const AREAS = ['admin', 'driver'];

// deps: { findAdmin(email), findDriver(email), checkPassword(password, hash), dummyCheck(password) } all async
export const resolveSignIn = async ({ email, password, area }, deps) => {
  if (area !== undefined && !AREAS.includes(area)) return { kind: 'invalid' };

  const [admin, driver] = await Promise.all([deps.findAdmin(email), deps.findDriver(email)]);
  const found = [
    admin && (area === undefined || area === 'admin') ? { area: 'admin', user: admin, active: admin.is_active !== false } : null,
    driver && (area === undefined || area === 'driver') ? { area: 'driver', user: driver, active: driver.enabled !== false } : null,
  ].filter(Boolean);

  if (found.length === 0) {
    // Same work as a real check, so an unknown email does not answer faster
    await deps.dummyCheck(password);
    return { kind: 'invalid' };
  }

  const checks = await Promise.all(found.map((candidate) => (
    typeof candidate.user.password === 'string' && candidate.user.password.length > 0
      ? deps.checkPassword(password, candidate.user.password).catch(() => false)
      : deps.dummyCheck(password).then(() => false)
  )));
  const opened = found.filter((_, index) => checks[index] === true);

  if (opened.length === 0) return { kind: 'invalid' };
  if (opened.length > 1) return { kind: 'choose', areas: opened.map((candidate) => candidate.area) };

  const [account] = opened;
  if (!account.active) return { kind: 'disabled', area: account.area };
  return { kind: 'ok', area: account.area, user: account.user };
};

// Where the app should go first after this sign-in. The route guards still check everything again (agreement,
// payment setup, super admin pages), so this is only a starting point, never a permission.
export const firstScreen = (area, user) => {
  if (area === 'admin') return '/admin/dashboard';
  return user?.agreement_signed === false ? '/driver/agreement' : '/driver/dashboard';
};

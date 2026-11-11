import { bump, clear } from '../../middlewares/loginRateLimit.js';

// Checking the current password on the Profile page (to change the sign-in email) is a password guess a stolen session could repeat, so it is limited
// per driver, not per address or per email in the request (which the caller chooses): at most 5 checks in 15 minutes. A correct password starts the count again.
// Same counters as the sign-in limit (Redis, with a memory fallback while Redis is down). Sign-in itself is not affected.
const MAX_CHECKS = 5;
const WINDOW_SECONDS = 15 * 60;

export const passwordAttemptsOf = (driverId) => {
  const key = `rl:profile-password:driver:${driverId}`;
  return {
    allow: async () => (await bump(key, WINDOW_SECONDS)).count <= MAX_CHECKS, // counts this check; false once the limit is passed
    passed: () => clear(key),
  };
};

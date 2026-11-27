import bcrypt from 'bcrypt';
import HttpStatus from '../utils/statusCodes.js';
import { dbService } from '../services/admin/dbQueries.js';
import { loginService } from '../services/driver/loginQueries.js';
import { generateToken, generateRefreshToken } from '../services/jwtservice.js';
import { DRIVER_ROLE } from '../middlewares/requireRole.js';
import { resolveSignIn, firstScreen } from '../services/auth/signIn.js';
import logger from '../utils/logger.js';

// POST /auth/login: the one sign-in screen for drivers, city admins and the super admin (services/auth/signIn.js).
// The tokens it returns are exactly those of /admin/login or /driver/login, so refresh, expiry, logout and every
// role and city check on the server work as before.

const MAX_EMAIL = 254;
const MAX_PASSWORD = 1024;
const MAX_TIMEZONE = 64;

const INVALID = 'The email or password is not correct.';
const DISABLED = 'This account cannot sign in. Please contact your NASA administrator.';

// A hash of nothing anyone knows, so a check against it costs the same as a real one and never matches.
let dummyHash = null;
const dummyCheck = async (password) => {
  dummyHash ??= bcrypt.hash(`nasa-no-account-${Math.random()}`, 10);
  await bcrypt.compare(password, await dummyHash);
  return false;
};

export const signInDeps = {
  findAdmin: (email) => dbService.getAdminByEmail(email),
  findDriver: (email) => loginService.getDriverByEmail(email),
  checkPassword: (password, hash) => bcrypt.compare(password, hash),
  dummyCheck,
  updateTimezone: (id, timezone) => loginService.updateTimezone(id, timezone),
};

export const makeSignIn = (deps = signInDeps) => async (req, res) => {
  const { email, password, area, timezone } = req.body ?? {};
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    return res.status(HttpStatus.BAD_REQUEST).json({ code: 'missing_fields', message: 'Enter your email and password.' });
  }
  if (email.length > MAX_EMAIL || password.length > MAX_PASSWORD) {
    return res.status(HttpStatus.UNAUTHORIZED).json({ code: 'invalid_credentials', message: INVALID });
  }

  try {
    const result = await resolveSignIn({ email: email.trim(), password, area }, deps);

    if (result.kind === 'invalid') return res.status(HttpStatus.UNAUTHORIZED).json({ code: 'invalid_credentials', message: INVALID });
    if (result.kind === 'disabled') return res.status(HttpStatus.FORBIDDEN).json({ code: 'account_disabled', message: DISABLED });
    if (result.kind === 'choose') {
      // Only someone who typed the right password for both accounts gets here. They pick; the server never guesses.
      return res.status(HttpStatus.CONFLICT).json({
        code: 'choose_account',
        areas: result.areas,
        message: 'This email and password open more than one NASA account. Choose which one to use.',
      });
    }

    const { area: signedArea, user } = result;
    // Read by the login limits: only this area's counters are given back on success
    res.locals = { ...(res.locals ?? {}), signedArea };
    if (signedArea === 'admin') {
      const claims = { id: user.id, email: user.email, role: user.role, name: user.name };
      const accessToken = generateToken(claims);
      const refreshToken = generateRefreshToken(claims);
      if (!accessToken || !refreshToken) return res.status(HttpStatus.UNAUTHORIZED).json({ code: 'invalid_credentials', message: INVALID });
      const { password: _hidden, ...admin } = user;
      return res.status(HttpStatus.OK).json({ area: 'admin', next: firstScreen('admin', user), admin, accessToken, refreshToken });
    }

    // Drivers: the same timezone update as /driver/login, when the app sends one
    const tz = typeof timezone === 'string' && timezone.length > 0 && timezone.length <= MAX_TIMEZONE ? timezone : null;
    if (tz) await deps.updateTimezone(user.id, tz);
    const claims = { id: user.id, email: user.email, name: user.name, role: DRIVER_ROLE };
    const accessToken = generateToken(claims);
    const refreshToken = generateRefreshToken(claims);
    if (!accessToken || !refreshToken) return res.status(HttpStatus.UNAUTHORIZED).json({ code: 'invalid_credentials', message: INVALID });
    return res.status(HttpStatus.OK).json({
      area: 'driver',
      next: firstScreen('driver', user),
      driver: { id: user.id, email: user.email, name: user.name, timezone: tz ?? user.timezone ?? null, agreement_signed: user.agreement_signed },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    logger.error('Sign-in failed', { reason: error?.message });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 'server_error', message: 'Server error' });
  }
};

export default { Login: makeSignIn() };

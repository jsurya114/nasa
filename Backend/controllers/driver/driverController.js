import HttpStatus from '../../utils/statusCodes.js';
import { loginService } from "../../services/driver/loginQueries.js";
import { generateToken, verifyToken, generateRefreshToken, verifyRefreshToken } from '../../services/jwtservice.js';
import { blackListToken, revokeRefreshToken, isTokenRevoked } from '../../services/redis-jwt-service.js';
import pool from '../../config/db.js';
import { translateError } from "../../utils/backendI18n.js";
import { DRIVER_ROLE } from '../../middlewares/requireRole.js';
import logger from '../../utils/logger.js';

// Token payload for a driver. The role keeps driver tokens out of admin routes.
const driverTokenPayload = (driver) => ({
  id: driver.id,
  email: driver.email,
  name: driver.name,
  role: DRIVER_ROLE
});

// Helper to get language from request
const getLang = (req) => {
  return req.headers['x-language'] || req.query?.lang || 'en';
};

const driverController = {
  Login: async (req, res) => {
    try {
      const lang = getLang(req);
      const { email, password, timezone } = req.body; // ADD timezone

      const errors = {};
      if (!email) errors.email = translateError(lang, 'auth.emailRequired');
      if (!password) errors.password = translateError(lang, 'auth.passwordRequired');
      if (!timezone) errors.timezone = translateError(lang, 'auth.timezoneRequired');

      if (Object.keys(errors).length > 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({ errors });
      }

      const driver = await loginService.getDriverByEmail(email);
      if (!driver) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          errors: { email: translateError(lang, 'auth.invalidEmail') }
        });
      }

      // Check if driver is disabled/blocked
      if (!driver.enabled) {
        return res.status(HttpStatus.FORBIDDEN).json({
          errors: { account: translateError(lang, 'auth.accountBlocked') }
        });
      }

      const validPassword = await loginService.checkPassword(password, driver.password);
      if (!validPassword) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          errors: { password: translateError(lang, 'auth.invalidPassword') }
        });
      }

      // UPDATE: Save driver's timezone on login
      await pool.query(
        'UPDATE drivers SET timezone = $1 WHERE id = $2',
        [timezone, driver.id]
      );

      logger.debug('Driver timezone updated', { driverId: driver.id, timezone });

      let accessToken = generateToken(driverTokenPayload(driver));
      let refreshToken = generateRefreshToken(driverTokenPayload(driver));
      if (!accessToken || !refreshToken) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: translateError(lang, 'common.unauthorized')
        });
      }

      // Return token in response body
      res.status(HttpStatus.OK).json({
        message: translateError(lang, 'auth.loginSuccessful'),
        driver: {
          id: driver.id,
          email: driver.email,
          name: driver.name,
          timezone: timezone, // Return timezone to frontend
          agreement_signed: driver.agreement_signed
        },
        accessToken,
        refreshToken
      });
    } catch (error) {
      const lang = getLang(req);
      logger.error('Driver login failed', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: translateError(lang, 'common.serverError')
      });
    }
  },

  getDriver: async (req, res) => {
    try {
      const lang = getLang(req);
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : null;

      if (!token) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: translateError(lang, 'common.unauthorized')
        });
      }

      const decoded = verifyToken(token);

      // Fetch driver from database to check current status
      const driver = await loginService.getDriverByEmail(decoded.email);

      if (!driver) {
        blackListToken(token);
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: translateError(lang, 'common.unauthorized')
        });
      }

      // Check if driver is disabled/blocked
      if (!driver.enabled) {
        blackListToken(token);
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: translateError(lang, 'common.unauthorized'),
          reason: translateError(lang, 'auth.accountDisabled')
        });
      }

      return res.status(HttpStatus.OK).json({ 
        driver: {
          ...decoded,
          agreement_signed: driver.agreement_signed
        }
      });
    } catch (error) {
      const lang = getLang(req);
      logger.error('getDriver failed', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: translateError(lang, 'common.serverError')
      });
    }
  },


  Logout: async (req, res) => {
    const lang = getLang(req);
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;

    if (token) {
      await blackListToken(token);
    }

    // Also revoke the refresh token, so it cannot be used to sign in again.
    // Only the caller's own refresh token is revoked. Old tokens have no role.
    // An automatic refresh during logout replaces the refresh token, so the app also sends the one it replaced.
    const ownsRefreshToken = (decoded) => decoded.id === req.driver?.id && (decoded.role === undefined || decoded.role === DRIVER_ROLE);
    for (const refreshToken of [req.body?.refreshToken, req.body?.previousRefreshToken]) {
      await revokeRefreshToken(refreshToken, ownsRefreshToken);
    }

    return res.status(HttpStatus.OK).json({
      message: translateError(lang, 'auth.logoutSuccessful')
    });
  },

  RefreshToken: async (req, res) => {
    try {
      const lang = getLang(req);
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(HttpStatus.BAD_REQUEST).json({ message: "Refresh token is required" });
      }

      const decoded = verifyRefreshToken(refreshToken);

      // An admin refresh token must never mint a driver token.
      // Old driver tokens have no role and are still accepted (issue #14 removes this).
      if (decoded.role !== undefined && decoded.role !== DRIVER_ROLE) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: translateError(lang, 'common.unauthorized')
        });
      }

      // A refresh token revoked at logout can no longer be used.
      if (await isTokenRevoked(refreshToken)) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: translateError(lang, 'common.unauthorized')
        });
      }

      const driver = await loginService.getDriverByEmail(decoded.email);

      if (!driver || !driver.enabled) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          message: translateError(lang, 'common.unauthorized')
        });
      }

      const newAccessToken = generateToken(driverTokenPayload(driver));
      const newRefreshToken = generateRefreshToken(driverTokenPayload(driver));

      return res.status(HttpStatus.OK).json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      });
    } catch (error) {
      const lang = getLang(req);
      logger.error("Refresh Token Error", error);
      return res.status(HttpStatus.UNAUTHORIZED).json({
        message: translateError(lang, 'common.unauthorized')
      });
    }
  },

  submitAgreement: async (req, res) => {
    try {
      const { name, joining_date } = req.body;
      const driverId = req.driver.id;

      if (!name || !joining_date) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          message: "Name and joining date are required"
        });
      }

      await pool.query(
        `UPDATE drivers 
         SET agreement_signed = TRUE, 
             agreement_signed_at = NOW(), 
             agreement_signature_name = $1, 
             agreement_joining_date = $2 
         WHERE id = $3`,
        [name, joining_date, driverId]
      );

      return res.status(HttpStatus.OK).json({
        success: true,
        message: "Agreement signed successfully"
      });
    } catch (error) {
      logger.error("Submit Agreement Error", error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: "Internal server error"
      });
    }
  }
};

export default driverController;
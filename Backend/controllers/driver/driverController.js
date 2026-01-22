import HttpStatus from '../../utils/statusCodes.js';
import { loginService } from "../../services/driver/loginQueries.js";
import { generateToken, verifyToken } from '../../services/jwtservice.js';
import { blackListToken } from '../../services/redis-jwt-service.js';
import pool from '../../config/db.js';
import { translateError } from "../../utils/backendI18n.js";

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

      console.log(`✅ ${translateError(lang, 'driver.timezoneUpdated')}: ${timezone} (Driver ${driver.id})`);

      let token = generateToken({ id: driver.id, email: driver.email, name: driver.name });
      if (!token) {
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
          timezone: timezone // Return timezone to frontend
        },
        token
      });
    } catch (error) {
      const lang = getLang(req);
      console.error(error.message);
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

      return res.status(HttpStatus.OK).json({ driver: decoded });
    } catch (error) {
      const lang = getLang(req);
      console.error(error.message);
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
      blackListToken(token);
    }

    return res.status(HttpStatus.OK).json({ 
      message: translateError(lang, 'auth.logoutSuccessful')
    });
  }
};

export default driverController;
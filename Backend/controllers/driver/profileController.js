import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import { translateError } from '../../utils/backendI18n.js';
import logger from '../../utils/logger.js';
import { parseProfile } from '../../services/driver/profileRules.js';
import { passwordAttemptsOf } from '../../services/driver/passwordAttempts.js';
import { getOwnProfile, saveOwnProfile, ProfileError } from '../../services/driver/profileQueries.js';

const getLang = (req) => req.headers['x-language'] || req.query?.lang || 'en';

// The signed-in driver's own profile (full name, email, phone). Self only: the driver comes from the verified token, never from the URL or the body.
const profileController = {
  /** GET /driver/profile  (driver only) */
  getProfile: async (req, res) => {
    const lang = getLang(req);
    try {
      const profile = await getOwnProfile(pool, req.driver.id);
      if (!profile) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: translateError(lang, 'driver.driverNotFound') });
      return res.status(HttpStatus.OK).json({ success: true, profile });
    } catch (error) {
      logger.error('Driver profile load failed', error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: translateError(lang, 'profile.failedToLoad') });
    }
  },

  /** PUT /driver/profile  (driver only). Body: { name, email, phoneNumber, currentPassword } (the password only when the email changes) */
  updateProfile: async (req, res) => {
    const lang = getLang(req);
    try {
      const parsed = parseProfile(req.body);
      if (parsed.errors) {
        const errors = Object.fromEntries(Object.entries(parsed.errors).map(([field, code]) => [field, translateError(lang, `profile.${code}`)]));
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: translateError(lang, 'profile.validationFailed'), errors });
      }

      const { profile, changed } = await saveOwnProfile(pool, req.driver.id, parsed.values, req.body?.currentPassword, passwordAttemptsOf(req.driver.id));
      // Field names only: a name, email or phone number never goes into the log.
      if (changed.length > 0) logger.info('Driver profile updated', { driverId: req.driver.id, fields: changed });
      return res.status(HttpStatus.OK).json({ success: true, message: translateError(lang, 'profile.updatedSuccessfully'), profile });
    } catch (error) {
      if (error instanceof ProfileError) {
        const message = translateError(lang, error.code === 'driverNotFound' ? 'driver.driverNotFound' : `profile.${error.code}`);
        return res.status(error.status).json({ success: false, message, ...(error.field ? { errors: { [error.field]: message } } : {}) });
      }
      logger.error('Driver profile update failed', error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: translateError(lang, 'profile.failedToUpdate') });
    }
  },
};

export default profileController;

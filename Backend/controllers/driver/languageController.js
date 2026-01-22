import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import { translateError } from "../../utils/backendI18n.js";

// Helper to get language from request
const getLang = (req) => {
  return req.headers['x-language'] || req.query?.lang || 'en';
};

const languageController = {
  // Get driver's preferred language
  getDriverLanguage: async (req, res) => {
    try {
      const lang = getLang(req);
      const { driverId } = req.params;

      if (!driverId) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          message: translateError(lang, 'driver.driverIdRequired')
        });
      }

      const result = await pool.query(
        'SELECT preferred_language FROM drivers WHERE id = $1',
        [driverId]
      );

      if (result.rows.length === 0) {
        return res.status(HttpStatus.NOT_FOUND).json({
          message: translateError(lang, 'driver.driverNotFound')
        });
      }

      return res.status(HttpStatus.OK).json({
        preferredLanguage: result.rows[0].preferred_language || 'en'
      });
    } catch (error) {
      const lang = getLang(req);
      console.error('Error fetching driver language:', error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: translateError(lang, 'common.serverError')
      });
    }
  },

  // Update driver's preferred language
  updateDriverLanguage: async (req, res) => {
    try {
      const lang = getLang(req);
      const { driverId, language } = req.body;

      if (!driverId || !language) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          message: translateError(lang, 'language.driverIdAndLanguageRequired')
        });
      }

      // Validate language code
      if (!['en', 'es'].includes(language)) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          message: translateError(lang, 'language.invalidLanguageCode')
        });
      }

      const result = await pool.query(
        'UPDATE drivers SET preferred_language = $1 WHERE id = $2 RETURNING id, preferred_language',
        [language, driverId]
      );

      if (result.rows.length === 0) {
        return res.status(HttpStatus.NOT_FOUND).json({
          message: translateError(lang, 'driver.driverNotFound')
        });
      }

      console.log(`✅ ${translateError(lang, 'language.driverLanguageUpdated')}: ${language} (Driver ${driverId})`);

      return res.status(HttpStatus.OK).json({
        message: translateError(lang, 'language.updatedSuccessfully'),
        preferredLanguage: result.rows[0].preferred_language
      });
    } catch (error) {
      const lang = getLang(req);
      console.error('Error updating driver language:', error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: translateError(lang, 'common.serverError')
      });
    }
  }
};

export default languageController;
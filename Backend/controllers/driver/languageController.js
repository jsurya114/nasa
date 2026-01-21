import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';

const languageController = {
  // Get driver's preferred language
  getDriverLanguage: async (req, res) => {
    try {
      const { driverId } = req.params;

      if (!driverId) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          message: 'Driver ID is required'
        });
      }

      const result = await pool.query(
        'SELECT preferred_language FROM drivers WHERE id = $1',
        [driverId]
      );

      if (result.rows.length === 0) {
        return res.status(HttpStatus.NOT_FOUND).json({
          message: 'Driver not found'
        });
      }

      return res.status(HttpStatus.OK).json({
        preferredLanguage: result.rows[0].preferred_language || 'en'
      });
    } catch (error) {
      console.error('Error fetching driver language:', error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Server error'
      });
    }
  },

  // Update driver's preferred language
  updateDriverLanguage: async (req, res) => {
    try {
      const { driverId, language } = req.body;

      if (!driverId || !language) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          message: 'Driver ID and language are required'
        });
      }

      // Validate language code
      if (!['en', 'es'].includes(language)) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          message: 'Invalid language code. Must be "en" or "es"'
        });
      }

      const result = await pool.query(
        'UPDATE drivers SET preferred_language = $1 WHERE id = $2 RETURNING id, preferred_language',
        [language, driverId]
      );

      if (result.rows.length === 0) {
        return res.status(HttpStatus.NOT_FOUND).json({
          message: 'Driver not found'
        });
      }

      console.log(`✅ Driver ${driverId} language updated to: ${language}`);

      return res.status(HttpStatus.OK).json({
        message: 'Language preference updated successfully',
        preferredLanguage: result.rows[0].preferred_language
      });
    } catch (error) {
      console.error('Error updating driver language:', error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Server error'
      });
    }
  }
};

export default languageController;
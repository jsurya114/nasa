// controllers/driver/passwordController.js
import updatepasswordQueries from "../../services/driver/updatepasswordQueries.js";
import HttpStatus from "../../utils/statusCodes.js";
import { translateError } from "../../utils/backendI18n.js";

// Helper to get language from request
const getLang = (req) => {
  return req.headers['x-language'] || req.query?.lang || 'en';
};

const passwordController = {
  /**
   * Update driver password
   * @route POST /driver/update-password
   * @access Private (Driver only)
   */
  updatePassword: async (req, res) => {
    try {
      const lang = getLang(req);
      const driverId = req.driver.id; // From driverAuth middleware
      const { oldPassword, newPassword, confirmPassword } = req.body;

      // Validation
      const errors = {};

      if (!oldPassword || !oldPassword.trim()) {
        errors.oldPassword = translateError(lang, 'password.currentPasswordRequired');
      }

      if (!newPassword || !newPassword.trim()) {
        errors.newPassword = translateError(lang, 'password.newPasswordRequired');
      } else if (newPassword.length < 6) {
        errors.newPassword = translateError(lang, 'password.minLength');
      } else if (newPassword.length > 50) {
        errors.newPassword = translateError(lang, 'password.maxLength');
      }

      if (!confirmPassword || !confirmPassword.trim()) {
        errors.confirmPassword = translateError(lang, 'password.confirmRequired');
      } else if (newPassword !== confirmPassword) {
        errors.confirmPassword = translateError(lang, 'password.passwordsDoNotMatch');
      }

      // Check if new password is same as old password
      if (oldPassword && newPassword && oldPassword === newPassword) {
        errors.newPassword = translateError(lang, 'password.mustBeDifferent');
      }

      // If validation errors exist, return them
      if (Object.keys(errors).length > 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: translateError(lang, 'password.validationFailed'),
          errors
        });
      }

      // Attempt to change password
      const result = await updatepasswordQueries.changePassword(
        driverId,
        oldPassword.trim(),
        newPassword.trim()
      );

      return res.status(HttpStatus.OK).json({
        success: true,
        message: translateError(lang, 'password.updatedSuccessfully'),
        data: {
          driverId: result.driver.id,
          driverName: result.driver.name,
          email: result.driver.email
        }
      });

    } catch (error) {
      const lang = getLang(req);
      console.error(translateError(lang, 'password.updateError') + ':', error);

      // Handle specific error cases
      if (error.message === 'Current password is incorrect') {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          message: translateError(lang, 'password.incorrectCurrent'),
          errors: {
            oldPassword: translateError(lang, 'password.incorrectCurrent')
          }
        });
      }

      if (error.message === 'Driver not found') {
        return res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: translateError(lang, 'driver.driverNotFound')
        });
      }

      // Generic error
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: translateError(lang, 'password.failedToUpdate'),
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
};

export default passwordController;
// controllers/driver/passwordController.js
import updatepasswordQueries from "../../services/driver/updatepasswordQueries.js";
import HttpStatus from "../../utils/statusCodes.js";

const passwordController = {
  /**
   * Update driver password
   * @route POST /driver/update-password
   * @access Private (Driver only)
   */
  updatePassword: async (req, res) => {
    try {
      const driverId = req.driver.id; // From driverAuth middleware
      const { oldPassword, newPassword, confirmPassword } = req.body;

      // Validation
      const errors = {};

      if (!oldPassword || !oldPassword.trim()) {
        errors.oldPassword = 'Current password is required';
      }

      if (!newPassword || !newPassword.trim()) {
        errors.newPassword = 'New password is required';
      } else if (newPassword.length < 6) {
        errors.newPassword = 'New password must be at least 6 characters';
      } else if (newPassword.length > 50) {
        errors.newPassword = 'New password must not exceed 50 characters';
      }

      if (!confirmPassword || !confirmPassword.trim()) {
        errors.confirmPassword = 'Please confirm your new password';
      } else if (newPassword !== confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
      }

      // Check if new password is same as old password
      if (oldPassword && newPassword && oldPassword === newPassword) {
        errors.newPassword = 'New password must be different from current password';
      }

      // If validation errors exist, return them
      if (Object.keys(errors).length > 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'Validation failed',
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
        message: 'Password updated successfully',
        data: {
          driverId: result.driver.id,
          driverName: result.driver.name,
          email: result.driver.email
        }
      });

    } catch (error) {
      console.error('Password update error:', error);

      // Handle specific error cases
      if (error.message === 'Current password is incorrect') {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          message: 'Current password is incorrect',
          errors: {
            oldPassword: 'Current password is incorrect'
          }
        });
      }

      if (error.message === 'Driver not found') {
        return res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Driver not found'
        });
      }

      // Generic error
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to update password. Please try again.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
};

export default passwordController;
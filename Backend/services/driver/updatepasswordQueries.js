// services/driver/passwordQueries.js
import pool from "../../config/db.js";
import bcrypt from "bcrypt";

const updatepasswordQueries = {
  /**
   * Get driver by ID with password hash
   * @param {number} driverId - Driver ID
   * @returns {Object} Driver object with password
   */
  getDriverById: async (driverId) => {
    try {
      const query = `
        SELECT id, name, email, password, driver_code, enabled
        FROM drivers
        WHERE id = $1;
      `;
      const result = await pool.query(query, [driverId]);
      
      if (result.rows.length === 0) {
        throw new Error('Driver not found');
      }
      
      return result.rows[0];
    } catch (error) {
      console.error('Error in getDriverById:', error);
      throw error;
    }
  },

  /**
   * Verify if the old password matches
   * @param {string} plainPassword - Plain text password to verify
   * @param {string} hashedPassword - Hashed password from database
   * @returns {boolean} True if password matches
   */
  verifyPassword: async (plainPassword, hashedPassword) => {
    try {
      return await bcrypt.compare(plainPassword, hashedPassword);
    } catch (error) {
      console.error('Error in verifyPassword:', error);
      throw error;
    }
  },

  /**
   * Hash a new password
   * @param {string} plainPassword - Plain text password to hash
   * @returns {string} Hashed password
   */
  hashPassword: async (plainPassword) => {
    try {
      const saltRounds = 10;
      return await bcrypt.hash(plainPassword, saltRounds);
    } catch (error) {
      console.error('Error in hashPassword:', error);
      throw error;
    }
  },

  /**
   * Update driver's password
   * @param {number} driverId - Driver ID
   * @param {string} hashedPassword - New hashed password
   * @returns {Object} Updated driver object (without password)
   */
  updatePassword: async (driverId, hashedPassword) => {
    try {
      const query = `
  UPDATE drivers
  SET password = $1
  WHERE id = $2
  RETURNING id, name, email, driver_code, enabled;
`;

      const result = await pool.query(query, [hashedPassword, driverId]);
      
      if (result.rows.length === 0) {
        throw new Error('Failed to update password');
      }
      
      return result.rows[0];
    } catch (error) {
      console.error('Error in updatePassword:', error);
      throw error;
    }
  },

  /**
   * Complete password update process
   * @param {number} driverId - Driver ID
   * @param {string} oldPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Object} Success result
   */
  changePassword: async (driverId, oldPassword, newPassword) => {
    try {
      // 1. Get driver with current password
      const driver = await updatepasswordQueries.getDriverById(driverId);
      
      // 2. Verify old password
      const isValidOldPassword = await updatepasswordQueries.verifyPassword(
        oldPassword, 
        driver.password
      );
      
      if (!isValidOldPassword) {
        throw new Error('Current password is incorrect');
      }
      
      // 3. Hash new password
      const hashedNewPassword = await updatepasswordQueries.hashPassword(newPassword);
      
      // 4. Update password in database
      const updatedDriver = await updatepasswordQueries.updatePassword(
        driverId, 
        hashedNewPassword
      );
      
      return {
        success: true,
        message: 'Password updated successfully',
        driver: updatedDriver
      };
    } catch (error) {
      console.error('Error in changePassword:', error);
      throw error;
    }
  }
};

export default updatepasswordQueries;
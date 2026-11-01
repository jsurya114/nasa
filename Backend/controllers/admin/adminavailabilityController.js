import { availabilityService } from "../../services/driver/availabilityQuery.js";
import { manualResetAllAvailability } from "../../utils/availabilityCronJob.js";
import { 
  validateAdminAvailabilityUpdate, 
  getCurrentTimeInTimezone 
} from "../../utils/timezoneUtils.js";
import logger from '../../utils/logger.js';

const adminAvailabilityController = {
  getAllDriversAvailability: async (req, res) => {
    try {
      const { id: adminId, role: adminRole } = req.admin;
      const { day, page = 1, limit = 10, searchQuery = "", city = "" } = req.query;

      logger.debug(`Admin ${adminId} (${adminRole}) fetching drivers availability`);
      logger.debug('Availability filters', { day: day || 'all', city: city || 'all', hasSearch: Boolean(searchQuery), page, limit });

      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      if (pageNum < 1 || limitNum < 1) {
        logger.warn(`Invalid pagination params: page=${page}, limit=${limit}`);
        return res.status(400).json({
          success: false,
          message: "page and limit must be positive integers"
        });
      }

      const result =
        await availabilityService.getAllDriversAvailability(
          pageNum,
          limitNum,
          day || null,
          adminId,
          adminRole,
          searchQuery.trim(),
          city || null
        );

      logger.debug(`Fetched ${result.data.length} drivers (Total: ${result.pagination.totalRecords})`);

      res.status(200).json({
        success: true,
        count: result.data.length,
        data: result.data,
        pagination: result.pagination
      });
    } catch (err) {
      logger.error("getAllDriversAvailability error", err);
      res.status(500).json({
        success: false,
        message: "Failed to fetch drivers availability",
        error: err.message
      });
    }
  },

  getAvailableCities: async (req, res) => {
    try {
      const { id: adminId, role: adminRole } = req.admin;
      
      logger.debug(`Admin ${adminId} (${adminRole}) fetching available cities`);
      
      const cities = await availabilityService.getAvailableCities(adminId, adminRole);
      
      logger.debug('Available cities found', { count: cities.length });
      
      res.status(200).json({
        success: true,
        data: cities
      });
    } catch (err) {
      logger.error("getAvailableCities error", err);
      res.status(500).json({
        success: false,
        message: "Failed to fetch cities",
        error: err.message
      });
    }
  },

  // NEW: Get global availability counts across all drivers (not paginated)
  getGlobalAvailabilityCounts: async (req, res) => {
    try {
      const { id: adminId, role: adminRole } = req.admin;
      const { searchQuery = "", city = "" } = req.query;

      logger.debug(`Admin ${adminId} (${adminRole}) fetching global availability counts`);
      logger.debug('Availability count filters', { city: city || 'all', hasSearch: Boolean(searchQuery) });

      const counts = await availabilityService.getGlobalAvailabilityCounts(
        adminId,
        adminRole,
        searchQuery.trim(),
        city || null
      );

      logger.debug('Global counts fetched', counts);

      res.status(200).json({
        success: true,
        data: counts
      });
    } catch (err) {
      logger.error("getGlobalAvailabilityCounts error", err);
      res.status(500).json({
        success: false,
        message: "Failed to fetch global availability counts",
        error: err.message
      });
    }
  },

  updateDriverAvailability: async (req, res) => {
    try {
      const { id: adminId, role: adminRole } = req.admin;
      const { driverId } = req.params;
      const { availability } = req.body;

      logger.info(`Admin ${adminId} (${adminRole}) updating driver ${driverId} availability`);
      logger.debug('New availability', availability);

      if (!driverId || isNaN(driverId)) {
        logger.warn(`Invalid driver ID: ${driverId}`);
        return res.status(400).json({
          success: false,
          message: "Valid driver ID is required"
        });
      }

      const validDays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday"
      ];

      // Validate that all days are present and are boolean
      for (const day of validDays) {
        if (typeof availability?.[day] !== "boolean") {
          logger.warn(`Invalid value for ${day}`, availability?.[day]);
          return res.status(400).json({
            success: false,
            message: `Invalid value for ${day}`
          });
        }
      }

      // Get driver's timezone from database
      const driverRows = await availabilityService.getDriverTimezone(parseInt(driverId, 10));

      if (driverRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Driver not found"
        });
      }

      const driverTimezone = driverRows[0].timezone;
      logger.debug(`Driver timezone: ${driverTimezone}`);

      // Get current time in driver's timezone
      const currentTime = getCurrentTimeInTimezone(driverTimezone);
      
      logger.debug(`Current time in ${driverTimezone}`, {
        day: currentTime.dayName,
        hour: currentTime.hour,
        dayIndex: currentTime.dayIndex
      });

      // Get current availability from database
      const currentAvailability = await availabilityService.getDriverAvailability(parseInt(driverId, 10));

      // ADMIN VALIDATION: Only prevent editing past days
      // Admins CAN edit: today, tomorrow (even after 7PM), and all future days
      const validation = validateAdminAvailabilityUpdate(
        availability,
        currentAvailability,
        driverTimezone
      );

      if (!validation.isValid) {
        logger.warn(`Admin validation failed`, validation.errors);
        return res.status(403).json({
          success: false,
          message: validation.errors[0],
          errors: validation.errors
        });
      }

      logger.debug(`Admin validation passed. Updating availability for driver ${driverId}`);

      const updated =
        await availabilityService.updateDriverAvailabilityByAdmin(
          parseInt(driverId, 10),
          availability,
          adminId,
          adminRole
        );

      logger.info(`Driver ${driverId} availability updated successfully by admin ${adminId}`);

      res.status(200).json({
        success: true,
        message: "Driver availability updated successfully",
        data: updated
      });
    } catch (err) {
      logger.error("updateDriverAvailability error", err);

      if (err.message === "Driver not found or access denied") {
        return res.status(404).json({
          success: false,
          message: err.message
        });
      }

      if (err.message === "Driver not found") {
        return res.status(404).json({
          success: false,
          message: "Driver not found"
        });
      }

      res.status(500).json({
        success: false,
        message: "Failed to update driver availability",
        error: err.message
      });
    }
  },

  // Manual reset all drivers availability (Superadmin only)
  manualResetAllDriversAvailability: async (req, res) => {
    try {
      const { role: adminRole, id: adminId } = req.admin;

      logger.info('Manual availability reset triggered', { adminId, adminRole });

      const result = await manualResetAllAvailability();

      logger.info('Manual availability reset completed', { total: result.driversUpdated, enabled: result.enabledDrivers, disabled: result.disabledDrivers });

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          totalDriversReset: result.driversUpdated,
          enabledDriversReset: result.enabledDrivers,
          disabledDriversReset: result.disabledDrivers,
          resetTimestamp: new Date().toISOString(),
          resetBy: {
            adminId,
            adminRole
          }
        }
      });
    } catch (err) {
      logger.error('Manual availability reset failed', err);

      res.status(500).json({
        success: false,
        message: "Failed to reset all drivers availability",
        error: err.message
      });
    }
  }
};

export default adminAvailabilityController;
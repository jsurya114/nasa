import { availabilityService } from "../../services/driver/availabilityQuery.js";
import { manualResetAllAvailability } from "../../utils/availabilityCronJob.js";

const adminAvailabilityController = {
  getAllDriversAvailability: async (req, res) => {
    try {
      const { id: adminId, role: adminRole } = req.admin;
      const { day, page = 1, limit = 10, searchQuery = "", city = "" } = req.query;

      console.log(`📋 Admin ${adminId} (${adminRole}) fetching drivers availability`);
      console.log(`   Filters - Day: ${day || 'all'}, City: ${city || 'all'}, Search: ${searchQuery || 'none'}, Page: ${page}, Limit: ${limit}`);

      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      if (pageNum < 1 || limitNum < 1) {
        console.warn(`⚠️ Invalid pagination params: page=${page}, limit=${limit}`);
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

      console.log(`✅ Fetched ${result.data.length} drivers (Total: ${result.pagination.totalRecords})`);

      res.status(200).json({
        success: true,
        count: result.data.length,
        data: result.data,
        pagination: result.pagination
      });
    } catch (err) {
      console.error("❌ getAllDriversAvailability error:", err.message);
      console.error("Error stack:", err.stack);
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
      
      console.log(`🏙️ Admin ${adminId} (${adminRole}) fetching available cities`);
      
      const cities = await availabilityService.getAvailableCities(adminId, adminRole);
      
      console.log(`✅ Found ${cities.length} cities:`, cities.join(', '));
      
      res.status(200).json({
        success: true,
        data: cities
      });
    } catch (err) {
      console.error("❌ getAvailableCities error:", err.message);
      console.error("Error stack:", err.stack);
      res.status(500).json({
        success: false,
        message: "Failed to fetch cities",
        error: err.message
      });
    }
  },

  updateDriverAvailability: async (req, res) => {
    try {
      const { id: adminId, role: adminRole } = req.admin;
      const { driverId } = req.params;
      const { availability } = req.body;

      console.log(`✏️ Admin ${adminId} (${adminRole}) updating driver ${driverId} availability`);
      console.log(`   New availability:`, availability);

      if (!driverId || isNaN(driverId)) {
        console.warn(`⚠️ Invalid driver ID: ${driverId}`);
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
          console.warn(`⚠️ Invalid value for ${day}:`, availability?.[day]);
          return res.status(400).json({
            success: false,
            message: `Invalid value for ${day}`
          });
        }
      }

      // Validate that admin is not trying to edit past days
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const currentDayName = dayNames[currentDay];

      console.log(`📅 Current day check: ${currentDayName} (index: ${currentDay})`);

      // Get current availability from database
      const currentAvailability = await availabilityService.getDriverAvailability(parseInt(driverId, 10));

      // Check each day to see if admin is trying to modify a past day
      for (const day of validDays) {
        const dayIndex = dayNames.indexOf(day);
        
        // If trying to change a past day (before current day)
        if (dayIndex < currentDay) {
          // If the value for this past day is different from current, reject
          if (availability[day] !== currentAvailability.availability[day]) {
            console.warn(`⚠️ Admin attempted to modify past day: ${day}`);
            return res.status(403).json({
              success: false,
              message: `Cannot modify availability for ${day}. That day has already ended. You can only update today (${currentDayName}) and future days.`
            });
          }
        }
      }

      const updated =
        await availabilityService.updateDriverAvailabilityByAdmin(
          parseInt(driverId, 10),
          availability,
          adminId,
          adminRole
        );

      console.log(`✅ Driver ${driverId} availability updated successfully by admin ${adminId}`);

      res.status(200).json({
        success: true,
        message: "Driver availability updated successfully",
        data: updated
      });
    } catch (err) {
      console.error("❌ updateDriverAvailability error:", err.message);
      console.error("Error stack:", err.stack);

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

      console.log('🔄 ========================================');
      console.log(`🔄 MANUAL AVAILABILITY RESET TRIGGERED`);
      console.log(`🔄 By: Admin ${adminId} (${adminRole})`);
      console.log(`🔄 Time: ${new Date().toISOString()}`);
      console.log('🔄 ========================================');

      const result = await manualResetAllAvailability();

      console.log('✅ ========================================');
      console.log(`✅ MANUAL RESET COMPLETED SUCCESSFULLY`);
      console.log(`✅ Total drivers reset: ${result.driversUpdated}`);
      console.log(`✅ - Enabled drivers: ${result.enabledDrivers}`);
      console.log(`✅ - Disabled drivers: ${result.disabledDrivers}`);
      console.log('✅ ========================================');

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
      console.error("❌ ========================================");
      console.error("❌ MANUAL RESET FAILED");
      console.error("❌ Error:", err.message);
      console.error("❌ Stack:", err.stack);
      console.error("❌ ========================================");
      
      res.status(500).json({
        success: false,
        message: "Failed to reset all drivers availability",
        error: err.message
      });
    }
  }
};

export default adminAvailabilityController;
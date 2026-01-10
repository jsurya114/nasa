import { availabilityService } from "../../services/driver/availabilityQuery.js";

const adminAvailabilityController = {
  getAllDriversAvailability: async (req, res) => {
    try {
      const { id: adminId, role: adminRole } = req.admin;
      const { day, page = 1, limit = 10, searchQuery = "", city = "" } = req.query;

      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      if (pageNum < 1 || limitNum < 1) {
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
          city || null  // NEW: Pass city filter
        );

      res.status(200).json({
        success: true,
        count: result.data.length,
        data: result.data,
        pagination: result.pagination
      });
    } catch (err) {
      console.error("getAllDriversAvailability:", err.message);
      res.status(500).json({
        success: false,
        message: "Failed to fetch drivers availability",
        error: err.message
      });
    }
  },

  // NEW: Get available cities for filter
  getAvailableCities: async (req, res) => {
    try {
      const { id: adminId, role: adminRole } = req.admin;
      
      const cities = await availabilityService.getAvailableCities(adminId, adminRole);
      
      res.status(200).json({
        success: true,
        data: cities
      });
    } catch (err) {
      console.error("getAvailableCities:", err.message);
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

      if (!driverId || isNaN(driverId)) {
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
          return res.status(400).json({
            success: false,
            message: `Invalid value for ${day}`
          });
        }
      }

      // NEW: Validate that admin is not trying to edit past days
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const currentDayName = dayNames[currentDay];

      // Get current availability from database
      const currentAvailability = await availabilityService.getDriverAvailability(parseInt(driverId, 10));

      // Check each day to see if admin is trying to modify a past day
      for (const day of validDays) {
        const dayIndex = dayNames.indexOf(day);
        
        // If trying to change a past day (before current day)
        if (dayIndex < currentDay) {
          // If the value for this past day is different from current, reject
          if (availability[day] !== currentAvailability.availability[day]) {
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

      res.status(200).json({
        success: true,
        message: "Driver availability updated successfully",
        data: updated
      });
    } catch (err) {
      console.error("updateDriverAvailability:", err.message);

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
  }
};

export default adminAvailabilityController;
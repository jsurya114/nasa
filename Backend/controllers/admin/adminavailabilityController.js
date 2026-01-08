import { availabilityService } from "../../services/driver/availabilityQuery.js";

const adminAvailabilityController = {
  getAllDriversAvailability: async (req, res) => {
    try {
      const { id: adminId, role: adminRole } = req.admin;
      const { day, page = 1, limit = 10, searchQuery = "" } = req.query;

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
          searchQuery.trim()
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

      for (const day of validDays) {
        if (typeof availability?.[day] !== "boolean") {
          return res.status(400).json({
            success: false,
            message: `Invalid value for ${day}`
          });
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

      res.status(500).json({
        success: false,
        message: "Failed to update driver availability",
        error: err.message
      });
    }
  }
};

export default adminAvailabilityController;

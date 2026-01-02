import { availabilityService } from "../../services/driver/availabilityQuery.js";

const adminAvailabilityController = {
    // Get all drivers' availability with pagination
    getAllDriversAvailability: async (req, res) => {
        try {
            const adminId = req.admin.id;
            const adminRole = req.admin.role;
            const { day, page = 1, limit = 10 } = req.query;

            // Convert to integers
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);

            // Validate pagination params
            if (pageNum < 1 || limitNum < 1) {
                return res.status(400).json({
                    success: false,
                    message: "page and limit must be positive integers"
                });
            }

            const result = await availabilityService.getAllDriversAvailability(
                pageNum,
                limitNum,
                day || null
            );
            
            res.status(200).json({
                success: true,
                count: result.data.length,
                data: result.data,
                pagination: result.pagination
            });
        } catch (err) {
            console.error("Error in getAllDriversAvailability:", err.message);
            res.status(500).json({
                success: false,
                message: "Failed to fetch drivers availability",
                error: err.message
            });
        }
    }
};

export default adminAvailabilityController;
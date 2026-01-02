import { availabilityService } from "../../services/driver/availabilityQuery.js";



const driverAvailabilityController = {
    // Get logged-in driver's availability
    getAvailability: async (req, res) => {
        try {
            const driverId = req.driver.id;
            
            const availability = await availabilityService.getDriverAvailability(driverId);
            
            res.status(200).json({
                success: true,
                data: availability
            });
        } catch (err) {
            console.error("Error in getAvailability:", err.message);
            res.status(500).json({
                success: false,
                message: "Failed to fetch availability",
                error: err.message
            });
        }
    },

    // Update logged-in driver's availability
    updateAvailability: async (req, res) => {
        try {
            const driverId = req.driver.id;
            const { availability } = req.body;

            // Validate availability object
            const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            
            if (!availability || typeof availability !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: "Invalid availability data"
                });
            }

            // Validate that all days are present and are boolean
            for (const day of validDays) {
                if (!(day in availability) || typeof availability[day] !== 'boolean') {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid value for ${day}. Must be boolean.`
                    });
                }
            }

            const updatedAvailability = await availabilityService.updateDriverAvailability(
                driverId, 
                availability
            );
            
            res.status(200).json({
                success: true,
                message: "Availability updated successfully",
                data: updatedAvailability
            });
        } catch (err) {
            console.error("Error in updateAvailability:", err.message);
            res.status(500).json({
                success: false,
                message: "Failed to update availability",
                error: err.message
            });
        }
    }
};

export default driverAvailabilityController;
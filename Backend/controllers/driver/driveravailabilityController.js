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
            const { availability, dayToUpdate } = req.body;

            // Get current date and time
            const now = new Date();
            const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
            
            // Map day numbers to day names
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const currentDayName = dayNames[currentDay];
            
            // If dayToUpdate is provided, check if it's trying to update a past day
            if (dayToUpdate) {
                const dayIndex = dayNames.indexOf(dayToUpdate.toLowerCase());
                
                if (dayIndex === -1) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid day specified"
                    });
                }
                
                // Check if trying to update a day that has already passed
                // Days before current day are locked (they've ended)
                if (dayIndex < currentDay) {
                    return res.status(403).json({
                        success: false,
                        message: `Cannot update availability for ${dayToUpdate}. That day has already ended. You can only update availability for today (${currentDayName}) and future days.`
                    });
                }
            }

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
            
            // Additional validation: prevent updating past days
            // Check each day in the availability object
            for (const day of validDays) {
                const dayIndex = dayNames.indexOf(day);
                
                // If trying to change a past day (before current day)
                if (dayIndex < currentDay) {
                    // Get the current value from database to ensure it's not being changed
                    const currentAvailability = await availabilityService.getDriverAvailability(driverId);
                    
                    // If the value for this past day is different from current, reject
                    if (availability[day] !== currentAvailability.availability[day]) {
                        return res.status(403).json({
                            success: false,
                            message: `Cannot modify availability for ${day}. That day has already ended. You can only update today (${currentDayName}) and future days.`
                        });
                    }
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
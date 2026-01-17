import { availabilityService } from "../../services/driver/availabilityQuery.js";
import { validateAvailabilityUpdate, getCurrentTimeInTimezone, formatDateForTimezone } from "../../utils/timezoneUtils.js";

const driverAvailabilityController = {
    // Get logged-in driver's availability
    getAvailability: async (req, res) => {
        try {
            const driverId = req.driver.id;
            
            console.log(`📋 Driver ${driverId} fetching their availability`);
            
            const availability = await availabilityService.getDriverAvailability(driverId);
            
            console.log(`✅ Fetched availability for driver ${driverId}`);
            
            res.status(200).json({
                success: true,
                data: availability
            });
        } catch (err) {
            console.error(`❌ Error in getAvailability for driver ${req.driver?.id}:`, err.message);
            console.error("Error stack:", err.stack);
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

            // Get user's timezone from request header or default to UTC
            // Frontend should send this in the request header
            const userTimezone = req.headers['x-user-timezone'] || 'UTC';

            console.log(`✏️ Driver ${driverId} attempting to update availability`);
            console.log(`   User timezone: ${userTimezone}`);
            console.log(`   New availability:`, availability);

            // Get current time in user's timezone
            const currentTime = getCurrentTimeInTimezone(userTimezone);
            
            console.log(`📅 Current time in ${userTimezone}:`, {
                day: currentTime.dayName,
                hour: currentTime.hour,
                formatted: formatDateForTimezone(currentTime.date, userTimezone)
            });

            // Validate availability object structure
            const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            
            if (!availability || typeof availability !== 'object') {
                console.warn(`⚠️ Invalid availability data received`);
                return res.status(400).json({
                    success: false,
                    message: "Invalid availability data"
                });
            }

            // Validate that all days are present and are boolean
            for (const day of validDays) {
                if (!(day in availability) || typeof availability[day] !== 'boolean') {
                    console.warn(`⚠️ Invalid value for ${day}:`, availability[day]);
                    return res.status(400).json({
                        success: false,
                        message: `Invalid value for ${day}. Must be boolean.`
                    });
                }
            }
            
            // Get current availability from database
            const currentAvailability = await availabilityService.getDriverAvailability(driverId);
            
            console.log(`📋 Current availability in DB:`, currentAvailability.availability);
            
            // Validate the update using timezone-aware logic
            const validation = validateAvailabilityUpdate(
                availability,
                currentAvailability,
                userTimezone
            );

            if (!validation.isValid) {
                console.warn(`⚠️ Validation failed:`, validation.errors);
                return res.status(403).json({
                    success: false,
                    message: validation.errors[0], // Return first error
                    errors: validation.errors
                });
            }

            console.log(`✅ All validation checks passed. Updating availability for driver ${driverId}`);

            const updatedAvailability = await availabilityService.updateDriverAvailability(
                driverId, 
                availability
            );
            
            console.log(`✅ Driver ${driverId} availability updated successfully`);
            console.log(`   Updated availability:`, updatedAvailability.availability);
            
            res.status(200).json({
                success: true,
                message: "Availability updated successfully",
                data: updatedAvailability
            });
        } catch (err) {
            console.error(`❌ Error in updateAvailability for driver ${req.driver?.id}:`, err.message);
            console.error("Error stack:", err.stack);
            res.status(500).json({
                success: false,
                message: "Failed to update availability",
                error: err.message
            });
        }
    }
};

export default driverAvailabilityController;
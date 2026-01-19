import { availabilityService } from "../../services/driver/availabilityQuery.js";
import { 
  validateAvailabilityUpdate, 
  getCurrentTimeInTimezone, 
  formatDateForTimezone
} from "../../utils/timezoneUtils.js";
import pool from "../../config/db.js";

const driverAvailabilityController = {
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

    updateAvailability: async (req, res) => {
        try {
            const driverId = req.driver.id;
            const { availability } = req.body;

            console.log(`✏️ Driver ${driverId} attempting to update availability`);

            // Get driver's stored timezone from database
            const driverResult = await pool.query(
                'SELECT timezone FROM drivers WHERE id = $1',
                [driverId]
            );

            if (driverResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Driver not found"
                });
            }

            const driverTimezone = driverResult.rows[0].timezone;
            console.log(`   Driver timezone: ${driverTimezone}`);

            // Get current time in driver's timezone
            const currentTime = getCurrentTimeInTimezone(driverTimezone);
            
            console.log(`📅 Current time in ${driverTimezone}:`, {
                day: currentTime.dayName,
                hour: currentTime.hour,
                formatted: formatDateForTimezone(currentTime.date, driverTimezone)
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
            // This only checks past/today/tomorrow restrictions
            // NO Sunday noon blocking since cron handles reset
            const validation = validateAvailabilityUpdate(
                availability,
                currentAvailability,
                driverTimezone
            );

            if (!validation.isValid) {
                console.warn(`⚠️ Validation failed:`, validation.errors);
                return res.status(403).json({
                    success: false,
                    message: validation.errors[0],
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
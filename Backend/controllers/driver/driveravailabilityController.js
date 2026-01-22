import { availabilityService } from "../../services/driver/availabilityQuery.js";
import { 
  validateAvailabilityUpdate, 
  getCurrentTimeInTimezone, 
  formatDateForTimezone
} from "../../utils/timezoneUtils.js";
import pool from "../../config/db.js";
import { translateError } from "../../utils/backendI18n.js";

// Helper to get language from request
const getLang = (req) => {
  return req.headers['x-language'] || req.query?.lang || 'en';
};

const driverAvailabilityController = {
    getAvailability: async (req, res) => {
        try {
            const lang = getLang(req);
            const driverId = req.driver.id;
            
            console.log(`📋 ${translateError(lang, 'availability.fetchingAvailability')} ${driverId}`);
            
            const availability = await availabilityService.getDriverAvailability(driverId);
            
            console.log(`✅ ${translateError(lang, 'availability.fetchedFor')} ${driverId}`);
            
            res.status(200).json({
                success: true,
                data: availability
            });
        } catch (err) {
            const lang = getLang(req);
            console.error(`❌ Error in getAvailability for driver ${req.driver?.id}:`, err.message);
            console.error("Error stack:", err.stack);
            res.status(500).json({
                success: false,
                message: translateError(lang, 'availability.failedToFetch'),
                error: err.message
            });
        }
    },

    updateAvailability: async (req, res) => {
        try {
            const lang = getLang(req);
            const driverId = req.driver.id;
            const { availability } = req.body;

            console.log(`✏️ ${translateError(lang, 'availability.attemptingUpdate')} ${driverId}`);

            // Get driver's stored timezone from database
            const driverResult = await pool.query(
                'SELECT timezone FROM drivers WHERE id = $1',
                [driverId]
            );

            if (driverResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: translateError(lang, 'driver.driverNotFound')
                });
            }

            const driverTimezone = driverResult.rows[0].timezone;
            console.log(`   ${translateError(lang, 'availability.driverTimezone')}: ${driverTimezone}`);

            // Get current time in driver's timezone
            const currentTime = getCurrentTimeInTimezone(driverTimezone);
            
            console.log(`📅 ${translateError(lang, 'availability.currentTimeIn')} ${driverTimezone}:`, {
                day: currentTime.dayName,
                hour: currentTime.hour,
                formatted: formatDateForTimezone(currentTime.date, driverTimezone)
            });

            // Validate availability object structure
            const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            
            if (!availability || typeof availability !== 'object') {
                console.warn(`⚠️ ${translateError(lang, 'availability.invalidData')}`);
                return res.status(400).json({
                    success: false,
                    message: translateError(lang, 'availability.invalidData')
                });
            }

            // Validate that all days are present and are boolean
            for (const day of validDays) {
                if (!(day in availability) || typeof availability[day] !== 'boolean') {
                    console.warn(`⚠️ ${translateError(lang, 'availability.invalidValueFor')} ${day}:`, availability[day]);
                    return res.status(400).json({
                        success: false,
                        message: `${translateError(lang, 'availability.invalidValueFor')} ${day}. ${translateError(lang, 'availability.mustBeBoolean')}`
                    });
                }
            }
            
            // Get current availability from database
            const currentAvailability = await availabilityService.getDriverAvailability(driverId);
            
            console.log(`📋 ${translateError(lang, 'availability.currentAvailabilityInDB')}:`, currentAvailability.availability);
            
            // Validate the update using timezone-aware logic
            // This only checks past/today/tomorrow restrictions
            // NO Sunday noon blocking since cron handles reset
            const validation = validateAvailabilityUpdate(
                availability,
                currentAvailability,
                driverTimezone
            );

            if (!validation.isValid) {
                console.warn(`⚠️ ${translateError(lang, 'availability.validationFailed')}:`, validation.errors);
                return res.status(403).json({
                    success: false,
                    message: validation.errors[0],
                    errors: validation.errors
                });
            }

            console.log(`✅ ${translateError(lang, 'availability.allChecksPassed')} ${driverId}`);

            const updatedAvailability = await availabilityService.updateDriverAvailability(
                driverId, 
                availability
            );
            
            console.log(`✅ ${translateError(lang, 'availability.fetchedFor')} ${driverId} ${translateError(lang, 'availability.updatedSuccessfully')}`);
            console.log(`   ${translateError(lang, 'availability.updatedAvailabilityLog')}:`, updatedAvailability.availability);
            
            res.status(200).json({
                success: true,
                message: translateError(lang, 'availability.updatedSuccessfully'),
                data: updatedAvailability
            });
        } catch (err) {
            const lang = getLang(req);
            console.error(`❌ Error in updateAvailability for driver ${req.driver?.id}:`, err.message);
            console.error("Error stack:", err.stack);
            res.status(500).json({
                success: false,
                message: translateError(lang, 'availability.failedToUpdate'),
                error: err.message
            });
        }
    }
};

export default driverAvailabilityController;
import { availabilityService } from "../../services/driver/availabilityQuery.js";

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
            const { availability, dayToUpdate } = req.body;

            console.log(`✏️ Driver ${driverId} attempting to update availability`);
            console.log(`   Day to update: ${dayToUpdate || 'all'}`);
            console.log(`   New availability:`, availability);

            // Get current date and time in UTC-6 (CST timezone)
            const now = new Date();
            
            // Convert to UTC-6 (CST)
            const utcOffset = now.getTimezoneOffset(); // Get current UTC offset in minutes
            const cstOffset = -360; // UTC-6 = -360 minutes
            const cstTime = new Date(now.getTime() + (cstOffset - utcOffset) * 60000);
            
            const currentDayJS = cstTime.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
            const currentHour = cstTime.getHours(); // 0-23
            
            // Convert to Monday-based week (Monday = 0, Sunday = 6)
            const currentDay = currentDayJS === 0 ? 6 : currentDayJS - 1;
            
            // Map day numbers to day names (Monday-based)
            const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            const currentDayName = dayNames[currentDay];
            
            console.log(`📅 Current time check (CST): ${currentDayName} at ${currentHour}:00 (Day index: ${currentDay})`);
            console.log(`📅 CST Time: ${cstTime.toISOString()}`);
            console.log(`📅 Server Time: ${now.toISOString()}`);
            
            // Calculate next day index
            const nextDayIndex = (currentDay + 1) % 7;
            const nextDayName = dayNames[nextDayIndex];
            
            // If dayToUpdate is provided, check if it's trying to update a past day
            if (dayToUpdate) {
                const dayIndex = dayNames.indexOf(dayToUpdate.toLowerCase());
                
                if (dayIndex === -1) {
                    console.warn(`⚠️ Invalid day specified: ${dayToUpdate}`);
                    return res.status(400).json({
                        success: false,
                        message: "Invalid day specified"
                    });
                }
                
                // Check if trying to update a day that has already passed
                // Days before current day are locked (they've ended)
                if (dayIndex < currentDay) {
                    console.warn(`⚠️ Driver attempted to update past day: ${dayToUpdate}`);
                    return res.status(403).json({
                        success: false,
                        message: `Cannot update availability for ${dayToUpdate}. That day has already ended. You can only update availability for today (${currentDayName}) and future days.`
                    });
                }
            }

            // Validate availability object
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
            
            // Get current availability from database ONCE before validation
            const currentAvailability = await availabilityService.getDriverAvailability(driverId);
            
            console.log(`📋 Current availability in DB:`, currentAvailability.availability);
            
            // Additional validation: prevent updating past days and enforce 7 PM cutoff
            // Check each day in the availability object
            for (const day of validDays) {
                const dayIndex = dayNames.indexOf(day);
                
                // If trying to change a past day (before current day)
                if (dayIndex < currentDay) {
                    // If the value for this past day is different from current, reject
                    if (availability[day] !== currentAvailability.availability[day]) {
                        console.warn(`⚠️ Driver attempted to modify past day: ${day}`);
                        return res.status(403).json({
                            success: false,
                            message: `Cannot modify availability for ${day}. That day has already ended. You can only update today (${currentDayName}) and future days.`
                        });
                    }
                }
                
                // Check if trying to modify today's availability after 7:00 PM CST
                if (dayIndex === currentDay && currentHour >= 19) {
                    // Check if driver is trying to change today's availability after 7 PM
                    if (availability[day] !== currentAvailability.availability[day]) {
                        console.warn(`⚠️ Driver attempted to modify today's availability after 7 PM cutoff`);
                        return res.status(403).json({
                            success: false,
                            message: `Cannot modify today's availability after 7:00 PM CST.`
                        });
                    }
                }
                
                // Check if trying to modify next day's availability after 7:00 PM CST today
                if (dayIndex === nextDayIndex && currentHour >= 19) { // 19 = 7:00 PM in 24-hour format
                    // Check if driver is trying to change tomorrow's availability after 7 PM
                    if (availability[day] !== currentAvailability.availability[day]) {
                        console.warn(`⚠️ Driver attempted to modify tomorrow's (${nextDayName}) availability after 7 PM cutoff`);
                        return res.status(403).json({
                            success: false,
                            message: `Cannot modify availability for ${nextDayName} after 7:00 PM CST. The cutoff time has passed.`
                        });
                    }
                }
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
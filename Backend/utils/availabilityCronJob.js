import cron from 'node-cron';
import pool from '../config/db.js';
import logger from './logger.js';

/**
 * Check if it's currently Sunday 12:00 PM (noon) in a given timezone
 * FIXED: Now properly checks for the exact hour (12) in 24-hour format
 */
const isSundayNoonInTimezone = (timezone) => {
  try {
    const now = new Date();
    
    // Use Intl API to get current time in the specific timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: 'numeric',
      hour12: false, // CRITICAL: Use 24-hour format
      minute: 'numeric'
    });
    
    const parts = formatter.formatToParts(now);
    const weekday = parts.find(p => p.type === 'weekday').value.toLowerCase();
    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
    
    // CRITICAL FIX: Check if it's Sunday AND hour is exactly 12 (noon in 24h format)
    // We check the full hour window (12:00-12:59) to ensure we catch it
    const isSunday = weekday === 'sunday';
    const isNoonHour = hour === 12;
    const isWithinHourWindow = minute >= 0 && minute < 60;
    
    if (isSunday && isNoonHour && isWithinHourWindow) {
      logger.info('Sunday 12:00 PM detected', { timezone, weekday, hour, minute });
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error('Error checking timezone', { timezone, error });
    return false;
  }
};

/**
 * Reset availability for all enabled drivers in a specific timezone
 */
const resetDriversInTimezone = async (timezone) => {
  try {
    const result = await pool.query(
      `UPDATE drivers
       SET
        monday = false,
        tuesday = false,
        wednesday = false,
        thursday = false,
        friday = false,
        saturday = false,
        sunday = false,
        availability_updated_at = CURRENT_TIMESTAMP
       WHERE timezone = $1 AND enabled = true
       RETURNING id, name, driver_code, timezone`,
      [timezone]
    );
    
    if (result.rowCount > 0) {
      logger.info('Reset enabled drivers', { timezone, count: result.rowCount });
      logger.debug('Reset driver ids', { timezone, ids: result.rows.map(driver => driver.id) });
    }
    
    return result.rowCount;
  } catch (error) {
    logger.error('Error resetting drivers', { timezone, error });
    throw error;
  }
};

/**
 * Initialize the weekly availability reset cron
 * FIXED: Runs EVERY HOUR to check all timezones
 */
export const initializeAvailabilityResetCron = () => {
  // Run every hour (at the start of each hour: 0 minutes)
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const utcTime = now.toISOString();
      
      logger.debug('Availability reset check', { utcTime });
      
      // Get all unique timezones from enabled drivers
      const timezonesResult = await pool.query(
        `SELECT DISTINCT timezone 
         FROM drivers 
         WHERE enabled = true 
         AND timezone IS NOT NULL
         ORDER BY timezone`
      );
      
      const timezones = timezonesResult.rows.map(row => row.timezone);
      logger.debug('Checking timezones', { count: timezones.length });
      
      let totalReset = 0;
      const resetTimezones = [];
      
      // Check each timezone independently
      for (const timezone of timezones) {
        try {
          // Check if it's Sunday 12:00 PM in this timezone
          if (isSundayNoonInTimezone(timezone)) {
            logger.info('Triggering availability reset', { timezone });
            
            const resetCount = await resetDriversInTimezone(timezone);
            totalReset += resetCount;
            
            if (resetCount > 0) {
              resetTimezones.push({ timezone, count: resetCount });
            }
          }
        } catch (tzError) {
          logger.error('Error processing timezone', { timezone, error: tzError });
          // Continue with other timezones even if one fails
        }
      }
      
      if (totalReset > 0) {
        logger.info('Availability reset summary', { totalReset, timezones: resetTimezones });
      } else {
        logger.debug('No timezone is at Sunday 12:00 PM right now');
      }
      
    } catch (error) {
      logger.error('Error in availability reset cron', error);
    }
  }, {
    timezone: "UTC" // Cron runs in UTC, but we check each driver's local timezone
  });

  logger.info('Weekly availability reset cron initialized', {
    schedule: 'every hour, checks all timezones',
    action: 'reset to unavailable at Sunday 12:00 PM in each driver timezone',
  });
};

/**
 * Manual reset function for admin override
 * Resets ALL drivers regardless of timezone or day
 */
export const manualResetAllAvailability = async () => {
  try {
    logger.info('Manual availability reset triggered');
    
    const result = await pool.query(
      `UPDATE drivers
       SET
        monday = false,
        tuesday = false,
        wednesday = false,
        thursday = false,
        friday = false,
        saturday = false,
        sunday = false,
        availability_updated_at = CURRENT_TIMESTAMP
       RETURNING id, name, driver_code, enabled, timezone`
    );

    const enabledCount = result.rows.filter(d => d.enabled).length;
    const disabledCount = result.rows.filter(d => !d.enabled).length;

    logger.info('Manual availability reset completed', { total: result.rowCount, enabled: enabledCount, disabled: disabledCount });

    return {
      success: true,
      message: `Reset availability for ${result.rowCount} drivers`,
      driversUpdated: result.rowCount,
      enabledDrivers: enabledCount,
      disabledDrivers: disabledCount,
      resetTimestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error in manual reset', error);
    throw error;
  }
};
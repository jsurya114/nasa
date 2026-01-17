import cron from 'node-cron';
import pool from '../config/db.js';

/**
 * Multi-Timezone Weekly Availability Reset Service
 * 
 * This cron job resets driver availability every Sunday at 12:00 PM LOCAL TIME
 * for each timezone. Since drivers can be in different timezones, we need to
 * handle resets for multiple timezones.
 * 
 * Strategy:
 * 1. Store driver timezone in the database (add 'timezone' column to drivers table)
 * 2. Create multiple cron jobs, one for each major timezone
 * 3. Each job runs at the time that corresponds to Sunday 12 PM in that timezone
 * 
 * Alternative simpler approach (current implementation):
 * - Run a single cron job every hour on Sundays
 * - Check which drivers need to be reset based on their timezone
 * - Reset only those drivers whose local time is between 12:00-12:59 PM
 */

/**
 * Get drivers that need to be reset for a specific hour
 * @param {number} hourUTC - The current UTC hour (0-23)
 * @returns {Promise<Array>} - List of drivers to reset
 */
const getDriversToResetForHour = async (hourUTC) => {
  // This would require a 'timezone' column in the drivers table
  // For now, we'll implement a simpler version that resets all drivers at once
  // at a specific UTC time that corresponds to 12 PM in the "main" timezone
  
  // Query all drivers (we'll add timezone filtering when timezone column is added)
  const result = await pool.query(`
    SELECT id, name, driver_code, timezone, enabled
    FROM drivers
  `);
  
  return result.rows;
};

/**
 * Initialize hourly cron job that runs every Sunday
 * Checks and resets drivers based on their local timezone
 */
export const initializeAvailabilityResetCron = () => {
  // Run every hour on Sundays: '0 * * * 0'
  // This allows us to reset drivers in different timezones at their local 12 PM
  cron.schedule('0 * * * 0', async () => {
    try {
      const now = new Date();
      const hourUTC = now.getUTCHours();
      
      console.log('🔄 Checking for drivers to reset...');
      console.log(`⏰ Current UTC time: ${now.toISOString()}`);
      console.log(`⏰ Current UTC hour: ${hourUTC}`);
      
      // TEMPORARY: Until timezone column is added, reset all drivers at 18:00 UTC
      // which is 12:00 PM CST (UTC-6)
      if (hourUTC !== 18) {
        console.log(`⏭️  Skipping - will run at 18:00 UTC (12:00 PM CST)`);
        return;
      }

      console.log('🔄 Running weekly availability reset for all drivers...');
      
      // Check total drivers count
      const countResult = await pool.query('SELECT COUNT(*) as total FROM drivers');
      console.log(`📊 Total drivers in database: ${countResult.rows[0].total}`);
      
      // Check current availability status before reset
      const beforeReset = await pool.query(
        `SELECT 
          COUNT(*) FILTER (WHERE monday = true) as monday_count,
          COUNT(*) FILTER (WHERE tuesday = true) as tuesday_count,
          COUNT(*) FILTER (WHERE wednesday = true) as wednesday_count,
          COUNT(*) FILTER (WHERE thursday = true) as thursday_count,
          COUNT(*) FILTER (WHERE friday = true) as friday_count,
          COUNT(*) FILTER (WHERE saturday = true) as saturday_count,
          COUNT(*) FILTER (WHERE sunday = true) as sunday_count
         FROM drivers`
      );
      console.log('📋 Availability before reset:', beforeReset.rows[0]);
      
      // Perform the reset for ALL drivers
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
         RETURNING id, name, driver_code, enabled`
      );

      console.log(`✅ Weekly availability reset completed. ${result.rowCount} drivers updated.`);
      
      if (result.rowCount > 0) {
        const enabledCount = result.rows.filter(d => d.enabled).length;
        const disabledCount = result.rows.filter(d => !d.enabled).length;
        console.log(`📋 Reset ${enabledCount} enabled drivers and ${disabledCount} disabled drivers`);
      }
      
      // Verify the reset worked
      const afterReset = await pool.query(
        `SELECT 
          COUNT(*) FILTER (WHERE monday = true) as monday_count,
          COUNT(*) FILTER (WHERE tuesday = true) as tuesday_count,
          COUNT(*) FILTER (WHERE wednesday = true) as wednesday_count,
          COUNT(*) FILTER (WHERE thursday = true) as thursday_count,
          COUNT(*) FILTER (WHERE friday = true) as friday_count,
          COUNT(*) FILTER (WHERE saturday = true) as saturday_count,
          COUNT(*) FILTER (WHERE sunday = true) as sunday_count
         FROM drivers`
      );
      console.log('📋 Availability after reset:', afterReset.rows[0]);
      
    } catch (error) {
      console.error('❌ Error in availability reset cron:', error);
      console.error('Error stack:', error.stack);
    }
  }, {
    timezone: "UTC"
  });

  console.log('📅 Weekly availability reset cron job initialized');
  console.log('📅 Schedule: Every Sunday, hourly checks');
  console.log('📅 Currently resets all drivers at 18:00 UTC (12:00 PM CST)');
  console.log('📅 Note: Add timezone column to drivers table for multi-timezone support');
};

/**
 * Manual reset function (can be called via admin API)
 * Resets ALL drivers regardless of timezone or enabled status
 */
export const manualResetAllAvailability = async () => {
  try {
    console.log('🔄 Manual reset triggered at:', new Date().toISOString());
    
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
       RETURNING id, name, driver_code, enabled`
    );

    const enabledCount = result.rows.filter(d => d.enabled).length;
    const disabledCount = result.rows.filter(d => !d.enabled).length;

    console.log(`✅ Manual reset completed. ${result.rowCount} total drivers updated.`);

    return {
      success: true,
      message: `Reset availability for ${result.rowCount} drivers`,
      totalDriversReset: result.rowCount,
      enabledDriversReset: enabledCount,
      disabledDriversReset: disabledCount,
      resetTimestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Error in manual reset:', error);
    throw error;
  }
};

/**
 * ADVANCED: Multi-timezone reset implementation
 * 
 * To implement true multi-timezone support:
 * 
 * 1. Add timezone column to drivers table:
 *    ALTER TABLE drivers ADD COLUMN timezone VARCHAR(64) DEFAULT 'UTC';
 * 
 * 2. Create timezone-specific cron jobs:
 */
export const initializeMultiTimezoneResetCrons = () => {
  // Define major timezones and their Sunday 12 PM in UTC
  const timezoneResets = [
    { name: 'US Central (CST)', utcHour: 18, timezone: 'America/Chicago' },
    { name: 'US Eastern (EST)', utcHour: 17, timezone: 'America/New_York' },
    { name: 'India (IST)', utcHour: 6, timezone: 'Asia/Kolkata' }, // 12 PM IST = 6:30 AM UTC (using 6 for hourly schedule)
    { name: 'UK (GMT)', utcHour: 12, timezone: 'Europe/London' },
    { name: 'Australia East (AEST)', utcHour: 2, timezone: 'Australia/Sydney' },
  ];

  timezoneResets.forEach(({ name, utcHour, timezone }) => {
    cron.schedule(`0 ${utcHour} * * 0`, async () => {
      try {
        console.log(`🔄 Running reset for ${name} timezone...`);
        
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
           WHERE timezone = $1
           RETURNING id, name, driver_code`,
          [timezone]
        );

        console.log(`✅ Reset ${result.rowCount} drivers in ${name}`);
      } catch (error) {
        console.error(`❌ Error resetting ${name}:`, error);
      }
    }, {
      timezone: "UTC"
    });

    console.log(`📅 Initialized reset for ${name} at ${utcHour}:00 UTC`);
  });
};
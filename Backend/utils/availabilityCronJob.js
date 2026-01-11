import cron from 'node-cron';
import pool from '../config/db.js';

/**
 * Weekly Availability Reset Service
 * Resets ALL driver availability to false every Sunday at 12:00 PM CST (UTC-6)
 * 
 * Calculation: 12:00 PM CST (UTC-6) = 18:00 (6:00 PM) UTC
 * So we schedule for 6:00 PM UTC which is 12:00 PM CST
 */
export const initializeAvailabilityResetCron = () => {
  // Cron expression: '0 18 * * 0' means "At 18:00 (6:00 PM) UTC on Sunday"
  // Which is equivalent to 12:00 PM CST (UTC-6)
  // Minute Hour Day Month DayOfWeek
  // 0      18   *   *     0 (Sunday)
  cron.schedule('0 18 * * 0', async () => {
    try {
      const now = new Date();
      console.log('🔄 Running weekly availability reset...');
      console.log('⏰ Current time:', now.toISOString());
      console.log('⏰ Server timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
      
      // Check total drivers count
      const countResult = await pool.query('SELECT COUNT(*) as total FROM drivers');
      console.log(`📊 Total drivers in database: ${countResult.rows[0].total}`);
      
      // Check current availability status before reset (for ALL drivers)
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
      console.log('📋 Availability before reset (all drivers):', beforeReset.rows[0]);
      
      // Perform the reset for ALL drivers (no WHERE clause restriction)
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
        console.log('📋 Sample updated drivers:', result.rows.slice(0, 5).map(d => 
          `${d.name} (${d.driver_code}) [${d.enabled ? 'enabled' : 'disabled'}]`
        ).join(', '));
      } else {
        console.warn('⚠️ WARNING: No drivers were updated!');
        console.warn('⚠️ Possible reasons:');
        console.warn('   - No drivers in database');
        console.warn('   - Database connection issue');
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
      console.log('📋 Availability after reset (all drivers):', afterReset.rows[0]);
      console.log('✨ All availability counts should be 0 after reset');
      
    } catch (error) {
      console.error('❌ Error resetting weekly availability:', error);
      console.error('Error details:', error.message);
      console.error('Error stack:', error.stack);
    }
  }, {
    timezone: "UTC" // Explicitly set timezone
  });

  console.log('📅 Weekly availability reset cron job initialized');
  console.log('📅 Schedule: Every Sunday at 12:00 PM CST (18:00 UTC)');
  console.log('📅 Resets availability for ALL drivers (enabled and disabled)');
  console.log('📅 Current server time:', new Date().toISOString());
  console.log('📅 Current server day:', new Date().getUTCDay(), '(0=Sunday, 1=Monday, ..., 6=Saturday)');
  
  // Calculate next Sunday 18:00 UTC
  const now = new Date();
  const daysUntilSunday = (7 - now.getUTCDay()) % 7;
  const nextRun = new Date(now);
  nextRun.setUTCDate(now.getUTCDate() + (daysUntilSunday === 0 ? 7 : daysUntilSunday));
  nextRun.setUTCHours(18, 0, 0, 0);
  console.log('📅 Next scheduled run:', nextRun.toISOString());
};

/**
 * Manual reset function (can be called via admin API if needed)
 * Resets ALL drivers regardless of enabled status
 */
export const manualResetAllAvailability = async () => {
  try {
    console.log('🔄 Manual reset triggered at:', new Date().toISOString());
    
    // Check status before reset (ALL drivers)
    const beforeCount = await pool.query(
      `SELECT COUNT(*) as total FROM drivers WHERE 
       (monday = true OR tuesday = true OR wednesday = true OR thursday = true OR 
        friday = true OR saturday = true OR sunday = true)`
    );
    console.log(`📊 Drivers with availability before reset: ${beforeCount.rows[0].total}`);
    
    // Reset ALL drivers (no WHERE clause)
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
    console.log(`   - ${enabledCount} enabled drivers`);
    console.log(`   - ${disabledCount} disabled drivers`);

    return {
      success: true,
      message: `Reset availability for ${result.rowCount} drivers (${enabledCount} enabled, ${disabledCount} disabled)`,
      driversUpdated: result.rowCount,
      enabledDrivers: enabledCount,
      disabledDrivers: disabledCount,
      drivers: result.rows
    };
  } catch (error) {
    console.error('❌ Error in manual reset:', error);
    throw error;
  }
};
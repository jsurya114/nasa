import cron from 'node-cron';
import pool from '../config/db.js';

/**
 * Weekly Availability Reset Service
 * Resets all driver availability to false every Sunday at 12:00 PM IST (UTC+5:30)
 * 
 * Note: node-cron doesn't natively support IST timezone in all versions
 * We calculate: 12:00 PM IST = 06:30 AM UTC
 * So we schedule for 6:30 AM UTC which is 12:00 PM IST
 */
export const initializeAvailabilityResetCron = () => {
  // Cron expression: '30 6 * * 0' means "At 06:30 AM UTC on Sunday"
  // Which is equivalent to 12:00 PM IST (UTC+5:30)
  // Minute Hour Day Month DayOfWeek
  // 30     6    *   *     0 (Sunday)
  cron.schedule('30 6 * * 0', async () => {
    try {
      console.log('🔄 Running weekly availability reset (Sunday 12:00 PM IST / 06:30 AM UTC)...');
      
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
         WHERE enabled = true
         RETURNING id`
      );

      console.log(`✅ Weekly availability reset completed. ${result.rowCount} drivers updated.`);
    } catch (error) {
      console.error('❌ Error resetting weekly availability:', error);
    }
  });

  console.log('📅 Weekly availability reset cron job initialized');
  console.log('📅 Schedule: Every Sunday at 12:00 PM IST (06:30 AM UTC)');
};

/**
 * Manual reset function (can be called via admin API if needed)
 */
export const manualResetAllAvailability = async () => {
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
       WHERE enabled = true
       RETURNING id, name, driver_code`
    );

    return {
      success: true,
      message: `Reset availability for ${result.rowCount} drivers`,
      drivers: result.rows
    };
  } catch (error) {
    console.error('Error in manual reset:', error);
    throw error;
  }
};
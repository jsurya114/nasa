import cron from 'node-cron';
import pool from '../config/db.js';

/**
 * Weekly Availability Reset Service
 * Resets all driver availability to false every Sunday at 12:00 PM (noon)
 */
export const initializeAvailabilityResetCron = () => {
  // Cron expression: '0 12 * * 0' means "At 12:00 PM (noon) on Sunday"
  // Minute Hour Day Month DayOfWeek
  // 0      12   *   *     0 (Sunday)
  cron.schedule('0 12 * * 0', async () => {
    try {
      console.log('🔄 Running weekly availability reset (Sunday 12:00 PM)...');
      
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

  console.log('📅 Weekly availability reset cron job initialized (runs every Sunday at 12:00 PM)');
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
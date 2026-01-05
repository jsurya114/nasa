import cron from 'node-cron';
import pool from '../config/db.js';

/**
 * Weekly Availability Reset Service
 * Resets all driver availability to false every Monday at 12:00 AM
 */
export const initializeAvailabilityResetCron = () => {
  // Cron expression: '0 0 * * 1' means "At 00:00 on Monday"
  // Alternatively, use '0 0 * * 0' for Sunday at midnight
  cron.schedule('0 0 * * 1', async () => {
    try {
      console.log('🔄 Running weekly availability reset...');
      
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

  console.log('📅 Weekly availability reset cron job initialized (runs every Monday at 12:00 AM)');
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
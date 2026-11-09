import cron from 'node-cron';
import pool from '../config/db.js';
import logger from './logger.js';
import { syncOnboarding } from '../services/payments/everee/onboardingSync.js';

export const runOnboardingSync = async () => {
  try {
    const result = await syncOnboarding(pool);
    if (result.checked) logger.info('Everee onboarding checked', result);
  } catch { logger.error('Everee onboarding check failed'); }
};
export const initializeEvereeOnboardingJob = () => cron.schedule('*/5 * * * *', runOnboardingSync);

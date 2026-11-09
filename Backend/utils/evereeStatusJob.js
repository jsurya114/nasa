import cron from 'node-cron';
import pool from '../config/db.js';
import logger from './logger.js';
import { checkOpenItems } from '../services/payments/everee/paymentStatus.js';

// Looks again at Everee payments that are not final (issue #31, part 5): every 15 minutes. It does nothing unless Everee payments are switched
// on. A returned deposit that Everee retries sends no event when it settles, so this is the only way that is noticed.
let running = false;

export const runEvereeStatusCheck = async () => {
  if (running) return; // a slow check is not started twice
  running = true;
  try {
    const result = await checkOpenItems(pool);
    if (result.checked) logger.info('Everee payments checked', { checked: result.checked, results: result.results });
  } catch (error) {
    logger.error('Everee payment check failed', { message: error.message });
  } finally {
    running = false;
  }
};

export const initializeEvereeStatusJob = () => cron.schedule('*/15 * * * *', runEvereeStatusCheck);

import pool from '../../config/db.js';
import logger from '../../utils/logger.js';
import { PayrollError } from '../../services/payroll/payRuns/payRunStore.js';
import { onboardingReadiness } from '../../services/payments/everee/onboardingReadiness.js';

export const getOnboardingReadiness = async (req, res) => {
  res.set({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' });
  try { return res.json(await onboardingReadiness(pool, req.admin, req.query)); }
  catch (error) {
    if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message });
    logger.error('Everee readiness could not be loaded');
    return res.status(500).json({ message: 'Payment setup could not be loaded. Try again.' });
  }
};

import pool from '../../config/db.js';
import logger from '../../utils/logger.js';
import { getStatus, OnboardingError, startOnboarding } from '../../services/payments/quickbooks/driverOnboarding.js';

// A Desi driver's own QuickBooks setup. The driver is always the one in the verified token (req.driver.id); nothing the browser sends can name another driver or a vendor.
// Every answer is private to that driver and never cached. The request body holds the tax ID: it is passed on once and never logged or echoed.

const noStore = (res) => res.set({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' });

const answer = (action) => async (req, res) => {
  noStore(res);
  const driverId = Number(req.driver?.id);
  if (!Number.isInteger(driverId) || driverId <= 0) return res.status(401).json({ message: 'UNAUTHORIZED' });
  try {
    return res.json(await action(driverId, req.body ?? {}));
  } catch (error) {
    if (error instanceof OnboardingError) {
      return res.status(error.status).json({ code: error.code, message: error.message, ...(error.missing && { missing: error.missing }), ...(error.review && { review: error.review }) });
    }
    logger.error('Driver QuickBooks onboarding failed', { driverId, message: error.message });
    return res.status(500).json({ code: 'server_error', message: 'something went wrong; try again' });
  }
};

export const getQuickbooksStatus = answer((driverId) => getStatus(pool, driverId));
export const startQuickbooksOnboarding = answer((driverId, body) => startOnboarding(pool, driverId, body));

import pool from '../../config/db.js';
import logger from '../../utils/logger.js';
import { adoptLegacyLink, createSession, getStatus, OnboardingError, refreshStatus, startOnboarding } from '../../services/payments/everee/driverOnboarding.js';

// A driver's own Everee onboarding (issue #242). The driver is always the one in the verified token (req.driver.id); nothing the browser sends
// can name another driver, a worker or a type. Every answer is private to that driver and is never cached. The session link is a bearer
// credential: it is sent once, with no-store, and never logged.

const noStore = (res) => res.set({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' });

const answer = (action) => async (req, res) => {
  noStore(res);
  const driverId = Number(req.driver?.id);
  if (!Number.isInteger(driverId) || driverId <= 0) return res.status(401).json({ message: 'UNAUTHORIZED' });
  try {
    return res.json(await action(driverId, req.body ?? {}));
  } catch (error) {
    if (error instanceof OnboardingError) {
      return res.status(error.status).json({ code: error.code, message: error.message, ...(error.missing && { missing: error.missing }) });
    }
    logger.error('Driver Everee onboarding failed', { driverId, message: error.message });
    return res.status(500).json({ code: 'server_error', message: 'something went wrong; try again' });
  }
};

// A link from before tenants were recorded is checked against Everee on the first status read, so no admin has to review it (see adoptLegacyLink).
export const getOnboardingStatus = answer(async (driverId) => { await adoptLegacyLink(pool, driverId); return getStatus(pool, driverId); });
export const startDriverOnboarding = answer((driverId, body) => startOnboarding(pool, driverId, { startDate: body.startDate, homeAddress: body.homeAddress }));
export const createOnboardingSession = answer((driverId, body) => createSession(pool, driverId, { experience: body.experience, platform: body.platform }));
export const refreshOnboarding = answer((driverId) => refreshStatus(pool, driverId));

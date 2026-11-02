import logger from '../../utils/logger.js';
import { translateError } from '../../utils/backendI18n.js';
import { deliver, isPushEnabled } from './pushSender.js';
import { tokensForAdminsOfDriver, tokensForDriverName, tokensForDrivers } from './pushTargets.js';

// The four notifications from docs/MOBILE_APP_DESIGN.md section 10.3. Each one is called after the change it
// reports has been saved, and returns at once: the work runs on the next turn of the event loop, and a failure
// is logged and goes no further, so a notification can never slow down or fail the request that caused it.
//
// Lock-screen text is generic on purpose: no names, amounts, routes or cities. `screen` is a name the app maps to
// one of its own screens (the sign-in and role checks of the web app still decide what is shown).

const fireAndForget = (label, work) => {
  if (!isPushEnabled()) return;
  setImmediate(() => {
    work().catch((error) => logger.error(`Push event failed: ${label}`, error));
  });
};

const message = (key, screen) => (language) => ({
  title: translateError(language, 'push.title'),
  body: translateError(language, `push.${key}`),
  screen,
});

// Each driver whose availability was just reset (the existing Sunday noon job, in the driver's own time zone).
export const notifyAvailabilityReset = (driverIds) =>
  fireAndForget('availabilityReset', async () => {
    await deliver(await tokensForDrivers(driverIds), message('availabilityReset', 'availability'));
  });

// The driver whose journeys were just marked paid.
export const notifyDriverPaid = (driverName) =>
  fireAndForget('paid', async () => {
    await deliver(await tokensForDriverName(driverName), message('paid', 'deliveries'));
  });

// A driver whose agreement was revoked and needs signing again.
export const notifyAgreementRequired = (driverId) =>
  fireAndForget('agreement', async () => {
    await deliver(await tokensForDrivers([driverId]), message('agreement', 'agreement'));
  });

// Admins of the driver's city and super admins, when a driver submits an access code.
export const notifyAccessCodeSubmitted = (driverId) =>
  fireAndForget('accessCode', async () => {
    await deliver(await tokensForAdminsOfDriver(driverId), message('accessCode', 'access-codes'));
  });

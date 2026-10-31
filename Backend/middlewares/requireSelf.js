import HttpStatus from '../utils/statusCodes.js';

/**
 * Lets a driver act only on their own data.
 *
 * Run it after `driverAuth`. It compares the driver ID sent in the request
 * (URL parameter or body field) with the ID in the verified token and
 * refuses the request when they differ.
 *
 *   router.get('/deliveries/:driverId', requireSelf('driverId'), handler);
 *   router.put('/language', requireSelf('driverId', 'body'), handler);
 *
 * - The URLs and body shapes stay the same, so the apps keep working.
 * - If the field is not sent at all, the request passes on unchanged and the
 *   controller's own validation answers (nothing is read or written for
 *   another driver in that case).
 * - Anything that is not a plain whole number (text such as "7abc", arrays,
 *   objects) is refused.
 *
 * @param {string} field   name of the parameter or body field holding the driver ID
 * @param {'params'|'body'|'query'} [source='params']
 */
export function requireSelf(field, source = 'params') {
  return (req, res, next) => {
    const ownId = Number(req.driver?.id);

    if (!Number.isInteger(ownId)) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'UNAUTHORIZED' });
    }

    const raw = req[source]?.[field];

    if (raw === undefined || raw === null || raw === '') {
      return next();
    }

    const sentId = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;

    if (!Number.isInteger(sentId) || sentId !== ownId) {
      return res.status(HttpStatus.FORBIDDEN).json({ message: 'FORBIDDEN' });
    }

    next();
  };
}

export default requireSelf;

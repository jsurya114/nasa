import pool from '../../config/db.js';
import logger from '../../utils/logger.js';
import { listOwnTransfers } from '../../services/payments/everee/driverTransfers.js';

// The signed-in driver's own Everee transfers (issue #242, PR D1). The driver is always the one in the verified token; nothing in the URL or the query
// can name another. The answer is private to that driver and never cached.
export const getOwnTransfers = async (req, res) => {
  res.set({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' });
  const driverId = Number(req.driver?.id);
  if (!Number.isInteger(driverId) || driverId <= 0) return res.status(401).json({ message: 'UNAUTHORIZED' });
  try {
    return res.json(await listOwnTransfers(pool, driverId));
  } catch (error) {
    logger.error('Driver Everee transfers failed', { driverId, message: error.message });
    return res.status(500).json({ message: 'your transfers could not be loaded; try again' });
  }
};

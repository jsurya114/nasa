import HttpStatus from '../utils/statusCodes.js';
import logger from '../utils/logger.js';
import { verifyToken } from '../services/jwtservice.js';
import { isTokenRevoked } from '../services/redis-jwt-service.js';
import { requireRole, DRIVER_ROLE } from './requireRole.js';

export default async function driverAuth(req, res, next) {
  try {
    // Get token from Authorization header instead of cookie
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;

    if (!token) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'UNAUTHORIZED' });
    }

    const isRevoked = await isTokenRevoked(token);
    if (isRevoked) {
      logger.warn('Driver token is revoked')
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'UNAUTHORIZED' });
    }

    const decoded = verifyToken(token);
    req.driver = decoded;

    // Only driver tokens may use driver routes. Admin tokens are refused.
    return requireRole(DRIVER_ROLE)(req, res, next);
  } catch (err) {
    logger.warn('Driver auth failed', { reason: err.message })
    return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'UNAUTHORIZED' });
  }
}
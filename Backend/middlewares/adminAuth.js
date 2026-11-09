import HttpStatus from '../utils/statusCodes.js';
import { verifyToken } from '../services/jwtservice.js';
import { isTokenRevoked } from '../services/redis-jwt-service.js';
import { requireRole, ADMIN_ROLES } from './requireRole.js';
import logger from '../utils/logger.js';

export default async function adminAuth(req, res, next) {
  try {
    // Get token from Authorization header instead of cookie
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (!token) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'UNAUTHORIZED' });
    }

    const revoked = await isTokenRevoked(token);
    if (revoked) {
      logger.warn('Admin token is revoked')
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'UNAUTHORIZED' });
    }

    const decoded = verifyToken(token);
    req.admin = decoded;
    req.user = decoded;

    // Only admin tokens may use admin routes. Driver tokens are refused.
    return requireRole(...ADMIN_ROLES)(req, res, next);
  } catch (err) {
    logger.warn('Admin auth failed', { reason: err.message })
    return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'UNAUTHORIZED' })
  }
}
import HttpStatus from '../utils/statusCodes.js';
import { verifyToken } from '../services/jwtservice.js';
import { isTokenRevoked } from '../services/redis-jwt-service.js';

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
      console.log('token is revoked')
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'UNAUTHORIZED' });
    }

    const decoded = verifyToken(token);
    req.admin = decoded;
      req.user = decoded; 
    next();
  } catch (err) {
    console.log(err.message, 'err in admin middleware')
    return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'UNAUTHORIZED' })
  }
}
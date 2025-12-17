import HttpStatus from '../utils/statusCodes.js';
import { verifyToken } from '../services/jwtservice.js';
import { dbService } from '../services/admin/dbQueries.js';

/**
 * Middleware to verify if the user is a superadmin
 * Should be used after adminAuth middleware
 */
const superAdminAuth = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (!token) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ 
        message: "Access denied. No token provided." 
      });
    }

    // Verify token
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ 
        message: "Invalid or expired token" 
      });
    }

    // Check if user is superadmin
    if (decoded.role !== 'superadmin') {
      return res.status(HttpStatus.FORBIDDEN).json({ 
        message: "Access denied. Superadmin privileges required." 
      });
    }

    // Verify user still exists and is active in database
    const admin = await dbService.getAdminById(decoded.id);
    
    if (!admin) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ 
        message: "User not found" 
      });
    }

    if (!admin.is_active) {
      return res.status(HttpStatus.FORBIDDEN).json({ 
        message: "Account has been deactivated" 
      });
    }

    // Attach user info to request
    req.user = decoded;
    next();

  } catch (error) {
    console.error('SuperAdmin Auth Error:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      message: "Authentication error" 
    });
  }
};

export default superAdminAuth;
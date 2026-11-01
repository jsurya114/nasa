import logger from '../utils/logger.js';
import HttpStatus from '../utils/statusCodes.js';
import { jobService } from '../services/admin/jobQueries.js';

/**
 * Middleware: Validate City Type for Journey Operations
 * 
 * Purpose: Prevent journey creation/modification for WEEKLY cities
 * This ensures drivers cannot add journeys even if admin changes
 * city type while they're logged in.
 * 
 * Usage: Apply to driver journey routes that create/modify journeys
 */
export default async function validateCityType(req, res, next) {
  try {
    // Extract driver ID from authenticated request
    const driverId = req.driver?.id;
    
    if (!driverId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Authentication required',
        error: 'UNAUTHORIZED'
      });
    }

    // Fetch the LATEST city type from database
    // This ensures we always check current configuration
    const cityType = await jobService.getCityTypeByDriverId(driverId);
    
    logger.debug('validateCityType: city type found', { driverId, cityType });

    // BLOCK if city is WEEKLY
    if (cityType === 'WEEKLY') {
      logger.warn('validateCityType: journey blocked, weekly city', { driverId });
      
      return res.status(HttpStatus.FORBIDDEN).json({
        success: false,
        message: 'Journey creation is disabled for weekly-based routes. Your route assignments are managed centrally and follow a fixed weekly schedule.',
        error: 'WEEKLY_CITY_RESTRICTION',
        cityType: 'WEEKLY'
      });
    }

    // ALLOW if city is DAILY or any other valid type
    logger.debug('validateCityType: allowed', { driverId });
    
    // Attach city type to request for use in controller if needed
    req.cityType = cityType;
    
    next();
    
  } catch (error) {
    logger.error('validateCityType failed', error);
    
    // On error, fail-safe: block the operation
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to validate city configuration. Please try again.',
      error: 'VALIDATION_ERROR'
    });
  }
}

/**
 * Optional: Lightweight version for read-only operations
 * Use this if you want to just attach city type info without blocking
 */
export async function attachCityType(req, res, next) {
  try {
    const driverId = req.driver?.id;
    
    if (driverId) {
      const cityType = await jobService.getCityTypeByDriverId(driverId);
      req.cityType = cityType;
      req.isWeeklyCity = cityType === 'WEEKLY';
      req.isDailyCity = cityType === 'DAILY';
    }
    
    next();
  } catch (error) {
    logger.error('attachCityType failed', error);
    // Don't block on error for read operations
    next();
  }
}
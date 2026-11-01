import AdminJourneyQuery from "../../services/admin/AjourneyQuery.js";
import { addRangeOfSqeunceToDeliveries,addRangeOfSequenceToDeliveriesForAdmin, checkSequenceConflict,syncJourneyDeliveries } from "../../services/driver/journeyQueries.js";

import HttpStatus from "../../utils/statusCodes.js";
import pool from "../../config/db.js";
import { getAllottedDrivers } from "../../services/admin/dashboardService.js";
import { canAccessDriver, canAccessRoute, getJourneyDriverId, isRouteActive } from "../../services/admin/journeyAccess.js";
import logger from '../../utils/logger.js';

// The journey id from the URL, as a positive whole number, or null. The same number is used for
// the city check and for the change itself, so the two can never look at different journeys.
const parseJourneyId = (value) => {
  if (!/^\d{1,9}$/.test(String(value))) return null;
  const id = Number(value);
  return id > 0 ? id : null;
};
const INVALID_JOURNEY_ID = { success: false, message: "Invalid journey id" };

const CITY_FORBIDDEN = { success: false, message: "You can only manage journeys in your assigned cities" };

const adminJourneyController = {
  fetchAllJourneys: async (req, res) => {
    try {
      const {id,role}=req.user;
      const journeys = await AdminJourneyQuery.getAllJourneys(id,role);
      res.status(HttpStatus.OK).json({ success: true, data: journeys });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message
      });
    }
  },

  addJourney: async (req, res) => {
    try {
      const { driver_id, route_id, start_seq, end_seq, journey_date } = req.body;

      // ... [Keep your existing input validations for null/numbers] ...

      // 1. Basic Driver Check
      const driverExists = await AdminJourneyQuery.checkDriverExists(driver_id);
      if (!driverExists) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: "Driver does not exist."
        });
      }

      // Both the driver and the route must be in one of the admin's cities.
      if (!(await canAccessDriver(req.user, driver_id)) || !(await canAccessRoute(req.user, route_id))) {
        return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);
      }

      // A new journey cannot use an archived (deleted) route.
      if (!(await isRouteActive(route_id))) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: "Route does not exist."
        });
      }

      // 2. STRICT ROUTE OVERLAP CHECK
      // This checks if ANY driver on this route has these sequences
      const conflictSequences = await checkSequenceConflict(
        route_id, 
        start_seq, 
        end_seq, 
        journey_date
      );

      if (conflictSequences.length > 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          errors: {
            sequence: `Sequence conflict! Range ${start_seq}-${end_seq} overlaps with an existing range (${conflictSequences[0].start_seq}-${conflictSequences[0].end_seq}) on this route.`
          }
        });
      }

      // 3. Proceed to Add
      const newJourney = await AdminJourneyQuery.addJourney({
        driver_id,
        route_id,
        start_seq,
        end_seq,
        journey_date
      });
            
     await addRangeOfSequenceToDeliveriesForAdmin(driver_id, route_id, start_seq, end_seq, newJourney.id,journey_date);
      res.status(HttpStatus.CREATED).json({ success: true, data: newJourney });

    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
    }
  },

  updateJourney: async (req, res) => {
    try {
      const journey_id = parseJourneyId(req.params.journey_id);
      if (journey_id === null) {
        return res.status(HttpStatus.BAD_REQUEST).json(INVALID_JOURNEY_ID);
      }
      const { start_seq, end_seq, route_id, driver_id } = req.body;

      // ... [Keep your existing input validations] ...

      // 1. Validate Driver
      const driverExists = await AdminJourneyQuery.checkDriverExists(driver_id);
      if (!driverExists) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          errors: { driver_id: "Driver does not exist" }
        });
      }

      // 2. Get Current Date (Needed for overlap check)
      const currentJourneyResult = await pool.query(
        `SELECT TO_CHAR(journey_date, 'YYYY-MM-DD') as journey_date FROM dashboard_data WHERE id = $1`,
        [journey_id]
      );

      if (currentJourneyResult.rows.length === 0) {
        return res.status(HttpStatus.NOT_FOUND).json({
          success: false, errors: { general: "Journey not found" }
        });
      } 
      const journey_date = currentJourneyResult.rows[0].journey_date;

      // The journey must be in one of the admin's cities now, and so must the driver and route it is changed to.
      const currentDriverId = await getJourneyDriverId(journey_id);
      if (
        !(await canAccessDriver(req.user, currentDriverId)) ||
        !(await canAccessDriver(req.user, driver_id)) ||
        !(await canAccessRoute(req.user, route_id))
      ) {
        return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);
      }

      // 3. STRICT ROUTE OVERLAP CHECK (With Excluded ID)
      // This ensures 10-55 is rejected if 51-100 exists
      const conflictSequences = await checkSequenceConflict(
        route_id,
        start_seq,
        end_seq,
        journey_date,
        journey_id // Pass ID to exclude self from check
      );

      if (conflictSequences.length > 0) {
        const conflict = conflictSequences[0];
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          errors: {
            sequence: `Sequence conflict! Range ${start_seq}-${end_seq} overlaps with existing range ${conflict.start_seq}-${conflict.end_seq} (ID: ${conflict.id}) on this route.`
          }
        });
      }

      // 4. Update Journey
      const updatedJourney = await AdminJourneyQuery.updateJourneyById(
        journey_id,
        { start_seq, end_seq, route_id, driver_id }
      );

      // 5. Sync Deliveries (If using the logic from previous request)
      if (typeof syncJourneyDeliveries === 'function') {
          await syncJourneyDeliveries(journey_id, driver_id, route_id, start_seq, end_seq, journey_date);
      }

      res.status(HttpStatus.OK).json({
        success: true,
        data: updatedJourney
      });

    } catch (error) {
      logger.error("updateJourney error", error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message
      });
    }
  },
  
  deleteJourney: async (req, res) => {
    try {
      const journey_id = parseJourneyId(req.params.journey_id);
      if (journey_id === null) {
        return res.status(HttpStatus.BAD_REQUEST).json(INVALID_JOURNEY_ID);
      }

      const ownerDriverId = await getJourneyDriverId(journey_id);
      if (ownerDriverId === null) {
        return res.status(404).json({ success: false, message: "Journey not found" });
      }
      if (!(await canAccessDriver(req.user, ownerDriverId))) {
        return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);
      }

      const deleted = await AdminJourneyQuery.deleteJourneyById(journey_id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: "Journey not found"
        });
      }

      res.status(200).json({
        success: true,
        message: "Journey and related data deleted successfully"
      });

    } catch (error) {
      logger.error("deleteJourney error", error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  },

  fetchAllDrivers: async (req, res) => {
    try {
      let drivers;
      const {role,id}= req.user;      
      if(role==='superadmin')
       drivers = await AdminJourneyQuery.getAllDrivers();
      else
        drivers= await getAllottedDrivers(id);
      
      res.status(HttpStatus.OK).json({
        success: true,
        data: drivers
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message
      });
    }
  },

  // ✅ Updated: Fetch paginated journeys with filters
  fetchPaginatedJourneys: async (req, res) => {
    try {
      const { id, role } = req.user;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      
      // ✅ Extract filter parameters from query
      const filters = {};
      
      if (req.query.route_id) {
        filters.route_id = parseInt(req.query.route_id);
      }
      
      if (req.query.driver_name && req.query.driver_name.trim() !== '') {
        filters.driver_name = req.query.driver_name.trim();
      }
      
      if (req.query.journey_date && req.query.journey_date.trim() !== '') {
        filters.journey_date = req.query.journey_date.trim();
      }
      
      // ✅ Pass filters to query functions
      const totalCount = await AdminJourneyQuery.getJourneysCount(id, role, filters);
      const journeys = await AdminJourneyQuery.getPaginatedJourneys(id, role, limit, offset, filters);
      
      const totalPages = Math.ceil(totalCount / limit);
      res.status(HttpStatus.OK).json({ 
        success: true, 
        data: journeys,
        pagination: {
          total: totalCount,
          page: page,
          limit: limit,
          totalPages: totalPages
        }
      });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message
      });
    }
  },
};

export default adminJourneyController;
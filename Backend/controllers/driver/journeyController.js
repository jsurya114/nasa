import e from "express";
import {
  insertJourney,
  getTodayJourney,
  addRangeOfSqeunceToDeliveries,
  checkSequenceConflict,
} from "../../services/driver/journeyQueries.js";
import { jobService } from "../../services/admin/jobQueries.js";
import HttpStatus from "../../utils/statusCodes.js";
import { translateError } from "../../utils/backendI18n.js";

// Helper to get language from request
const getLang = (req) => {
  return req.headers['x-language'] || req.query?.lang || 'en';
};

export const saveJourney = async (req, res) => {
  try {
    const lang = getLang(req);
    let { driver_id, route_id, packages, start_seq, end_seq, journey_date } = req.body;

    // ✅ REMOVED: City type validation - now handled by middleware
    // The validateCityType middleware blocks WEEKLY cities before reaching here
    // This ensures we always check the LATEST city configuration from database
    
    // Note: req.cityType is available here (attached by middleware) if needed
    // But we don't need to check it again since middleware already validated

    start_seq = Number(start_seq);
    end_seq = Number(end_seq);
    packages = end_seq - start_seq + 1;

    const errors = {};
    if (!driver_id) errors.driver_id = translateError(lang, 'driver.driverIdRequired');
    if (!route_id) errors.route_id = translateError(lang, 'journey.routeRequired');
    if (!start_seq || start_seq <= 0) errors.start_seq = translateError(lang, 'journey.startSeqInvalid');
    if (!end_seq || end_seq < start_seq) errors.end_seq = translateError(lang, 'journey.endSeqInvalid');

    const conflictSequences = await checkSequenceConflict(route_id, start_seq, end_seq, journey_date);

    if (conflictSequences.length > 0) {
      errors.sequenceConflict = translateError(lang, 'journey.sequenceConflict');
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    // Check if this driver already saved journey today
    const existingJourney = await getTodayJourney(driver_id);

    if (existingJourney.length > 0) {
      return res.status(400).json({
        success: false,
        message: translateError(lang, 'journey.alreadySaved'),
      });
    }

    // Insert journey
    const journey = await insertJourney({
      driver_id,
      route_id,
      packages,
      start_seq,
      end_seq,
      journey_date: journey_date || new Date().toISOString().split("T")[0],
    });

    if (journey.success === false) {
      return res.status(500).json({
        success: false,
        message: journey.message,
        error: journey.error,
      });
    }

    const sequence = await addRangeOfSqeunceToDeliveries(
      driver_id,
      route_id,
      start_seq,
      end_seq,
      journey.id
    );

    if (sequence.success === false) {
      return res.status(500).json({
        success: false,
        message: translateError(lang, 'journey.savedButSeqFailed'),
        error: sequence.error,
      });
    }

    return res.status(201).json({ success: true, data: journey });
  } catch (error) {
    const lang = getLang(req);
    console.error("saveJourney error:", error);
    return res.status(500).json({
      success: false,
      message: translateError(lang, 'journey.errorInserting'),
      error: error.message,
    });
  }
};

export const fetchTodayJourney = async (req, res) => {
  try {
    const lang = getLang(req);
    const driverId = req.params.driver_id;
    const journey = await getTodayJourney(driverId);
    
    // ✅ Optionally include city type info in response
    res.status(HttpStatus.OK).json({ 
      success: true, 
      data: journey,
      cityType: req.cityType // Attached by middleware
    });
  } catch (error) {
    const lang = getLang(req);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ 
        success: false, 
        message: translateError(lang, 'journey.errorFetching')
      });
  }
};
import express from "express"
import { uploadAccessCodeImages } from "../middlewares/multerConfig.js";
import driverController from "../controllers/driver/driverController.js";
import jobController from "../controllers/admin/jobController.js";
import { saveJourney, fetchTodayJourney } from "../controllers/driver/journeyController.js";
import { getAccessCodes, createAccessCode } from '../controllers/driver/accessCodeControllers.js';
import { getDriverRoutes } from "../controllers/admin/routeController.js";
import getDeliverySummary from "../controllers/driver/deliveryController.js";
import driverAuth from '../middlewares/driverAuth.js';
import validateCityType, { attachCityType } from '../middlewares/validateCityType.js';
import driverAvailabilityController from "../controllers/driver/driveravailabilityController.js";
import passwordController from "../controllers/driver/updatepasswordController.js";
import languageController from "../controllers/driver/languageController.js";

const router = express.Router()

router.post('/login', driverController.Login)
router.post('/refresh-token', driverController.RefreshToken)

// Protect all routes below this line
router.use(driverAuth)

router.get("/access-driver", driverController.getDriver)
router.get("/city-type", jobController.getDriverCityType)
router.post("/logout", driverController.Logout)
router.post("/agreement", driverController.submitAgreement)

// ============================================
// JOURNEY ROUTES - PROTECTED BY CITY TYPE VALIDATION
// ============================================

// POST /journey - Create journey
// ✅ Apply validateCityType middleware to BLOCK weekly cities
router.post("/journey", validateCityType, saveJourney)

// GET /journey/:driver_id - Fetch today's journey
// ✅ Use attachCityType for read operations (doesn't block, just attaches info)
router.get("/journey/:driver_id", attachCityType, fetchTodayJourney)
router.post("/update-password", passwordController.updatePassword)

// Routes list - attach city type info for filtering if needed
router.get("/routes-list", attachCityType, getDriverRoutes)

router.get("/deliveries/:driverId", getDeliverySummary)

// AccessCode Management 
router.post("/access-codes", uploadAccessCodeImages.array('images', 3), createAccessCode)
router.get("/access-codes/list", getAccessCodes)

// Driver Availability Management
router.get("/availability", driverAvailabilityController.getAvailability)
router.post("/availability", driverAvailabilityController.updateAvailability)

router.get("/language/:driverId", languageController.getDriverLanguage);
router.put("/language", languageController.updateDriverLanguage);

export default router;
import express from "express"
import { sanitizeRouterParams } from '../middlewares/sanitize.js';
import { uploadAccessCodeImages } from "../middlewares/multerConfig.js";
import driverController from "../controllers/driver/driverController.js";
import jobController from "../controllers/admin/jobController.js";
import { saveJourney, fetchTodayJourney } from "../controllers/driver/journeyController.js";
import { getAccessCodes, createAccessCode } from '../controllers/driver/accessCodeControllers.js';
import { getDriverRoutes } from "../controllers/admin/routeController.js";
import getDeliverySummary from "../controllers/driver/deliveryController.js";
import driverAuth from '../middlewares/driverAuth.js';
import validateCityType, { attachCityType } from '../middlewares/validateCityType.js';
import { requireSelf } from '../middlewares/requireSelf.js';
import { createOnboardingSession, getOnboardingStatus, refreshOnboarding, startDriverOnboarding } from "../controllers/driver/evereeOnboardingController.js";
import { loginRateLimit } from '../middlewares/loginRateLimit.js';
import driverAvailabilityController from "../controllers/driver/driveravailabilityController.js";
import passwordController from "../controllers/driver/updatepasswordController.js";
import languageController from "../controllers/driver/languageController.js";
import { driverPushTokens } from "../controllers/pushTokenController.js";
import { getOwnBalances, getOwnStatement, getOwnStatements } from "../controllers/payroll/statementController.js";

const router = express.Router()
sanitizeRouterParams(router)

router.post('/login', loginRateLimit('driver'), driverController.Login)
router.post('/refresh-token', driverController.RefreshToken)

// Protect all routes below this line
router.use(driverAuth)

router.get("/access-driver", driverController.getDriver)
router.get("/city-type", jobController.getDriverCityType)
router.post("/logout", driverController.Logout)
router.post("/agreement", driverController.submitAgreement)

// Everee onboarding of the signed-in Local driver (issue #242). Self only: the driver comes from the token, never from the URL or the body.
router.get("/everee/status", getOnboardingStatus)
router.post("/everee/onboarding", startDriverOnboarding)
router.post("/everee/session", createOnboardingSession)
router.post("/everee/refresh", refreshOnboarding)

// ============================================
// JOURNEY ROUTES - PROTECTED BY CITY TYPE VALIDATION
// ============================================

// POST /journey - Create journey
// ✅ Apply validateCityType middleware to BLOCK weekly cities
router.post("/journey", requireSelf('driver_id', 'body'), validateCityType, saveJourney)

// GET /journey/:driver_id - Fetch today's journey
// ✅ Use attachCityType for read operations (doesn't block, just attaches info)
router.get("/journey/:driver_id", requireSelf('driver_id'), attachCityType, fetchTodayJourney)
router.post("/update-password", passwordController.updatePassword)

// Routes list - attach city type info for filtering if needed
router.get("/routes-list", attachCityType, getDriverRoutes)

router.get("/deliveries/:driverId", requireSelf('driverId'), getDeliverySummary)

// AccessCode Management 
router.post("/access-codes", uploadAccessCodeImages.array('images', 3), createAccessCode)
router.get("/access-codes/list", getAccessCodes)

// Driver Availability Management
router.get("/availability", driverAvailabilityController.getAvailability)
router.post("/availability", driverAvailabilityController.updateAvailability)

router.get("/language/:driverId", requireSelf('driverId'), languageController.getDriverLanguage);
router.put("/language", requireSelf('driverId', 'body'), languageController.updateDriverLanguage);

// Push notifications: this driver's own phones only (the id comes from the token)
router.post("/push-token", driverPushTokens.register)
router.post("/push-token/remove", driverPushTokens.remove)

// Pay statements and balances: this driver's own only (the id comes from the token), approved runs only (#145)
router.get("/payroll/statements", getOwnStatements)
router.get("/payroll/statements/:statementId", getOwnStatement)
router.get("/payroll/balances", getOwnBalances)

export default router;
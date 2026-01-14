import express from 'express'
import { upload, uploadAccessCodeImages } from "../middlewares/multerConfig.js"
const router = express.Router()
import adminController from '../controllers/admin/adminController.js'
import jobController from '../controllers/admin/jobController.js';
import { createRoute,getRouteById, updateRoute, deleteRoute,toggleRouteStatus, fetchPaginatedRoutes, getAdminRoutes,getRoutesByDriver  } from "../controllers/admin/routeController.js"
import { changeStatusUser, createUsers, getUsers,updateUser} from '../controllers/admin/addUserController.js';
import { createAccessCode } from '../controllers/admin/accessCodeControllers.js';
import {DailyExcelUpload, getUpdatedTempDashboardData} from '../controllers/admin/fileUploadsController.js';
import { getAccessCodes,updateAccessCode, } from '../controllers/admin/accessCodeControllers.js';
import { changeRoleAdmin, changeStatusAdmin, createAdmins, getAdmins, updateAdmin, getAdminCities } from '../controllers/admin/addAdminController.js';
import { getPaymentDashboardData, getAllPaymentDashboardData, updatePaymentData, updateWeeklyTempDataToDashboard, payDriver, getSummaryData } from '../controllers/admin/dashboardController.js';
import adminJourneyController from '../controllers/admin/adminJourneyController.js';
import adminAuth from '../middlewares/adminAuth.js';
import superAdminAuth from '../middlewares/superAdminAuth.js';
import { getAllData } from '../controllers/admin/dashController.js';
import { getWeeklyTempData, weeklyExcelUpload } from '../controllers/admin/weeklyUploadsController.js';
import { getAnalyticsData } from '../controllers/admin/analyticsController.js';
import adminAvailabilityController from '../controllers/admin/adminavailabilityController.js';


router.post('/login',adminController.Login);

router.use(adminAuth);

router.post('/addjob', superAdminAuth, jobController.addJob);
router.put('/updatejob/:id', superAdminAuth, jobController.updateJob);
router.patch('/:id/status', superAdminAuth, jobController.jobStatus);

router.get('/jobs', jobController.fetchPaginatedJobs)

router.post("/routes",superAdminAuth, createRoute);
router.get("/routes", fetchPaginatedRoutes);
router.get("/routes-list",getAdminRoutes)
router.get("/routes/:id", getRouteById);
router.put("/routes/:id", updateRoute);
router.patch("/routes/:id/status",toggleRouteStatus);
router.delete("/routes/:id", deleteRoute);
router.get("/routes-by-driver/:driverId", getRoutesByDriver);

router.post('/create-users',createUsers);
router.get('/get-users',getUsers);
router.patch('/toggle-user/:id',changeStatusUser);
router.put('/update-user/:id', updateUser);

router.get('/get-cities',jobController.getCities);
router.get('/get-admin-cities', getAdminCities);

router.post("/create-admin", superAdminAuth, createAdmins);
router.get('/get-admins', superAdminAuth, getAdmins);
router.patch('/toggle-admin/:id', superAdminAuth, changeStatusAdmin);
router.patch('/toggle-admin-role/:id', superAdminAuth, changeRoleAdmin);
router.put('/update-admin/:id', superAdminAuth, updateAdmin);

router.post('/doubleStop/dailyFileUpload',upload.single('file'),DailyExcelUpload)

router.get("/journeys/paginated", adminJourneyController.fetchPaginatedJourneys);
router.get("/journeys",adminJourneyController.fetchAllJourneys)
router.post("/journey", adminJourneyController.addJourney);
router.put("/journey/:journey_id",adminJourneyController.updateJourney)
router.delete("/journey/:journey_id", adminJourneyController.deleteJourney);

router.get("/drivers",adminJourneyController.fetchAllDrivers)

router.get('/dashboard/data', getAllData)
router.get('/dashboard/paymentTable', getPaymentDashboardData)
router.get('/dashboard/paymentTableAll', getAllPaymentDashboardData)

// Summary endpoint for total counts
router.get('/dashboard/summary', getSummaryData)

router.post('/dashboard/payDriver', payDriver)

router.post('/doubleStop/weekly-upload',upload.single('file'),weeklyExcelUpload);
router.get('/doubleStop/fetchWeeklyTempData',getWeeklyTempData);
router.post('/doubleStop/update-weekly-excel-to-dashboard',updateWeeklyTempDataToDashboard);

router.get('/doubleStop/tempDashboardData',getUpdatedTempDashboardData);
router.get('/doubleStop/calculatePayment',updatePaymentData);
router.get('/analytics',getAnalyticsData)

// ============================================
// Driver Availability Management (Admin View)
// ============================================

// Get all drivers availability with filters
router.get("/drivers/availability", adminAvailabilityController.getAllDriversAvailability);

// Get available cities for filter dropdown
router.get("/drivers/availability/cities", adminAvailabilityController.getAvailableCities);

// Update specific driver's availability (Admin/Superadmin)
router.put(
  "/drivers/availability/:driverId",
  adminAvailabilityController.updateDriverAvailability
);

// Manual reset all drivers availability (Superadmin only)
router.post(
  "/drivers/availability/reset-all",
 
  adminAvailabilityController.manualResetAllDriversAvailability
);


router.post('/logout',adminController.Logout);

router.get('/access-admin',adminController.getUser);

router.post("/access-codes", uploadAccessCodeImages.array('images', 3), createAccessCode)
router.get("/access-codes/list", getAccessCodes)
router.put("/access-codes/:id", uploadAccessCodeImages.array('images', 3), updateAccessCode)

export default router;
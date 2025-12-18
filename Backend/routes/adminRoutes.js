import express from 'express'
import { upload, uploadAccessCodeImages } from "../middlewares/multerConfig.js"
const router = express.Router()
import adminController from '../controllers/admin/adminController.js'
import jobController from '../controllers/admin/jobController.js';
import { createRoute,getRoutes,getRouteById, updateRoute, deleteRoute,toggleRouteStatus, fetchPaginatedRoutes} from "../controllers/admin/routeController.js"
import { changeStatusUser, createUsers, getUsers,updateUser} from '../controllers/admin/addUserController.js';
import { createAccessCode } from '../controllers/admin/accessCodeControllers.js';
import {DailyExcelUpload, getUpdatedTempDashboardData} from '../controllers/admin/fileUploadsController.js';
import { getAccessCodes,updateAccessCode, } from '../controllers/admin/accessCodeControllers.js';
import { changeRoleAdmin, changeStatusAdmin, createAdmins, getAdmins, updateAdmin, getAdminCities } from '../controllers/admin/addAdminController.js';
import { getPaymentDashboardData, updatePaymentData, updateWeeklyTempDataToDashboard, payDriver } from '../controllers/admin/dashboardController.js';
import adminJourneyController from '../controllers/admin/adminJourneyController.js';
import adminAuth from '../middlewares/adminAuth.js';
import superAdminAuth from '../middlewares/superAdminAuth.js';
import { getAllData } from '../controllers/admin/dashController.js';
import { getWeeklyTempData, weeklyExcelUpload } from '../controllers/admin/weeklyUploadsController.js';

router.post('/login',adminController.Login);

// Protect all routes below this line - Basic admin authentication
router.use(adminAuth);

//Job creation - Both admin and superadmin
router.post('/addjob', superAdminAuth, jobController.addJob);
router.put('/updatejob/:id', superAdminAuth, jobController.updateJob);
router.patch('/:id/status', superAdminAuth, jobController.jobStatus);

router.get('/jobs', jobController.fetchPaginatedJobs)

//Route creation - Both admin and superadmin
router.post("/routes",superAdminAuth, createRoute);
router.get("/routes", fetchPaginatedRoutes);
router.get("/routes-list",getRoutes)
router.get("/routes/:id", getRouteById);
router.put("/routes/:id",superAdminAuth, updateRoute);
router.patch("/routes/:id/status", superAdminAuth,toggleRouteStatus);
router.delete("/routes/:id", deleteRoute);

//User (Driver) creation - Both admin and superadmin can manage drivers
router.post('/create-users',createUsers);
router.get('/get-users',getUsers);
router.patch('/toggle-user/:id',changeStatusUser);
router.put('/update-user/:id', updateUser);

//Cities - Both admin and superadmin
router.get('/get-cities',jobController.getCities); // All enabled cities
router.get('/get-admin-cities', getAdminCities); // Role-based cities (NEW - ADDED THIS LINE)

//Admin Creation - SUPERADMIN ONLY
router.post("/create-admin", superAdminAuth, createAdmins);
router.get('/get-admins', superAdminAuth, getAdmins);
router.patch('/toggle-admin/:id', superAdminAuth, changeStatusAdmin);
router.patch('/toggle-admin-role/:id', superAdminAuth, changeRoleAdmin);
router.put('/update-admin/:id', superAdminAuth, updateAdmin);

//DoubleStop and file upload - Both admin and superadmin
router.post('/doubleStop/dailyFileUpload',upload.single('file'),DailyExcelUpload)

//admin journey - Both admin and superadmin
router.get("/journeys",adminJourneyController.fetchAllJourneys)
router.post("/journey", adminJourneyController.addJourney);
router.put("/journey/:journey_id",adminJourneyController.updateJourney)
router.delete("/journey/:journey_id", adminJourneyController.deleteJourney);

router.get("/drivers",adminJourneyController.fetchAllDrivers)

//payment and dashboard - Both admin and superadmin
router.get('/dashboard/data', getAllData)
router.get('/dashboard/paymentTable', getPaymentDashboardData)
router.post('/dashboard/payDriver', payDriver)

//Weekly Upload - Both admin and superadmin
router.post('/doubleStop/weekly-upload',upload.single('file'),weeklyExcelUpload);
router.get('/doubleStop/fetchWeeklyTempData',getWeeklyTempData);
router.post('/doubleStop/update-weekly-excel-to-dashboard',updateWeeklyTempDataToDashboard);

router.get('/doubleStop/tempDashboardData',getUpdatedTempDashboardData);
router.get('/doubleStop/calculatePayment',updatePaymentData);

//logout from Admin - Both admin and superadmin
router.post('/logout',adminController.Logout);

//Check for admin User - Both admin and superadmin
router.get('/access-admin',adminController.getUser);

//Access codes - Both admin and superadmin
router.post("/access-codes", uploadAccessCodeImages.array('images', 3), createAccessCode)
router.get("/access-codes/list", getAccessCodes)
router.put("/access-codes/:id", uploadAccessCodeImages.array('images', 3), updateAccessCode)

export default router;
import { getAllottedRoutes } from "../../services/admin/dashboardService.js";
import {
  insertRoute,
  getAllRoutes,
  getRouteByIdQuery,
  updateRouteQuery,
  deleteRouteQuery,
  toggleRouteStatusQuery,
  routePagination,
  getAllRoutesOfDriver,
  getRoutesForAdmin,
  getRoutesByDriverCity
} from "../../services/admin/routeQueries.js";
import HttpStatus from "../../utils/statusCodes.js";
import { canAccessJob, canAccessDriverCity } from "../../services/admin/routeAccess.js";
import logger from '../../utils/logger.js';
import asyncHandler from "../../utils/asyncHandler.js";

const CITY_FORBIDDEN = { error: "You can only manage routes in your assigned cities" };


const mapRoute = (r) => ({
  id: r.id,
  route: r.name,
  name: r.name, // Add both for compatibility
  job: r.job,
  companyRoutePrice: parseFloat(r.company_route_price),
  driverRoutePrice: parseFloat(r.driver_route_price),
  companyDoubleStopPrice: parseFloat(r.company_doublestop_price),
  driverDoubleStopPrice: parseFloat(r.driver_doublestop_price),
  routeCodeInString: r.route_code_in_string,
  enabled: r.enabled,
});

// Create a new route
export const createRoute = asyncHandler(async (req, res) => {
  const { route, job, companyRoutePrice, driverRoutePrice, companyDoubleStopPrice, driverDoubleStopPrice, enabled, routeCodeInString } = req.body;
 

  if (!route || route.trim() === "") {
    return res.status(HttpStatus.BAD_REQUEST).json({ error: "Route name is required" });
  }
  if (!job || job.trim() === "") {
    return res.status(HttpStatus.BAD_REQUEST).json({ error: "Job is required" });
  }

  const routeData = {
    name: route,
    job,
    company_route_price: parseFloat(companyRoutePrice),
    driver_route_price: parseFloat(driverRoutePrice),
    company_doublestop_price: parseFloat(companyDoubleStopPrice),
    driver_doublestop_price: parseFloat(driverDoubleStopPrice),
    route_code_in_string: routeCodeInString ? routeCodeInString.trim() : null,
    enabled: enabled || false,
  };

  for (const [key, value] of Object.entries({
    company_route_price: routeData.company_route_price,
    driver_route_price: routeData.driver_route_price,
    company_doublestop_price: routeData.company_doublestop_price,
    driver_doublestop_price: routeData.driver_doublestop_price,
  })) {
    if (isNaN(value) || value == null) {
      throw new Error(`Invalid or missing value for ${key}`);
    }
  }

  const newRouteDb = await insertRoute(routeData);
  const newRoute = mapRoute(newRouteDb);
  res.status(HttpStatus.CREATED).json(newRoute);

}, {
  log: "createRoute error",
  respond: (err, req, res) => res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: `Failed to create route: ${err.message}` }),
});

// ✅ ENHANCED: Fetch paginated routes with city filter
export const fetchPaginatedRoutes = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 4;
  const search = req.query.search || "";
  const cityFilter = req.query.city || ""; // ✅ NEW: City filter parameter
  
  // Get user role and ID from middleware
  const isSuperAdmin = req.user?.role === 'superadmin';
  const adminId = req.user?.id;
  
  logger.debug('Fetching routes with filters', { page, limit, search, cityFilter, isSuperAdmin, adminId });
  
  const { routes, total } = await routePagination(page, limit, search, cityFilter, isSuperAdmin, adminId);

  res.status(HttpStatus.OK).json({
    success: true,
    routes: routes.map(mapRoute),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    isSuperAdmin // Send this to frontend
  });
}, {
  log: "fetchPaginatedRoutes error",
  respond: (error, req, res) => res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: error.message,
  }),
});

// Get all routes (for dropdown, etc.)
export const getAdminRoutes = asyncHandler(async (req, res) => {
  let routesDb;
  const { role, id } = req.user;
  

  
  if (role === 'superadmin') {
    routesDb = await getAllRoutes();
  } else {
    routesDb = await getRoutesForAdmin(id);
  }
  
  const routes = routesDb.map(mapRoute);
  
  res.json({ routes });
}, {
  log: "getAdminRoutes error",
  respond: (err, req, res) => res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message }),
});

export const getDriverRoutes = asyncHandler(async (req, res) => {
  const id = req.driver.id;
  const routesDb = await getAllRoutesOfDriver(id);
  const routes = routesDb.map(mapRoute);
  res.json({ routes });
}, {
  log: "getDriverRoutes error",
  respond: (err, req, res) => res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message }),
});

// Get route by ID
export const getRouteById = asyncHandler(async (req, res) => {
  const routeDb = await getRouteByIdQuery(req.params.id);
  if (!routeDb) {
   
    return res.status(404).json({ error: "Route not found" });
  }
  if (!(await canAccessJob(req.user, routeDb.job))) {
    return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);
  }
  const route = mapRoute(routeDb);
  res.json(route);
}, {
  log: "getRouteById error",
  respond: (err, req, res) => res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message }),
});

// Update route
export const updateRoute = asyncHandler(async (req, res) => {
  const { route, job, companyRoutePrice, driverRoutePrice, companyDoubleStopPrice, driverDoubleStopPrice, enabled, routeCodeInString } = req.body;


  const routeData = {
    name: route,
    job,
    company_route_price: parseFloat(companyRoutePrice),
    driver_route_price: parseFloat(driverRoutePrice),
    company_doublestop_price: parseFloat(companyDoubleStopPrice),
    driver_doublestop_price: parseFloat(driverDoubleStopPrice),
    route_code_in_string: routeCodeInString ? routeCodeInString.trim() : null,
    enabled: enabled || false,
  };

  for (const [key, value] of Object.entries({
    company_route_price: routeData.company_route_price,
    driver_route_price: routeData.driver_route_price,
    company_doublestop_price: routeData.company_doublestop_price,
    driver_doublestop_price: routeData.driver_doublestop_price,
  })) {
    if (isNaN(value) || value == null) {
      throw new Error(`Invalid or missing value for ${key}`);
    }
  }

  const current = await getRouteByIdQuery(req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Route not found" });
  }
  // The route must be in one of the admin's cities now, and so must the city it is moved to.
  if (!(await canAccessJob(req.user, current.job)) || !(await canAccessJob(req.user, job))) {
    return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);
  }

  const updatedDb = await updateRouteQuery(req.params.id, routeData);
  if (!updatedDb) {
    return res.status(404).json({ error: "Route not found" });
  }
  const updated = mapRoute(updatedDb);
  
  res.json(updated);
}, {
  log: "updateRoute error",
  respond: (err, req, res) => res.status(400).json({ error: `Failed to update route: ${err.message}` }),
});

// Toggle route status
export const toggleRouteStatus = asyncHandler(async (req, res) => {
  const current = await getRouteByIdQuery(req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Route not found" });
  }
  if (!(await canAccessJob(req.user, current.job))) {
    return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);
  }

  const updatedDb = await toggleRouteStatusQuery(req.params.id);
  if (!updatedDb) {

    return res.status(404).json({ error: "Route not found" });
  }
  const updated = mapRoute(updatedDb);

  res.json(updated);
}, {
  log: "toggleRouteStatus error",
  respond: (err, req, res) => res.status(500).json({ error: `Failed to toggle route status: ${err.message}` }),
});

// Delete route
export const deleteRoute = asyncHandler(async (req, res) => {
  const current = await getRouteByIdQuery(req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Route not found" });
  }
  if (!(await canAccessJob(req.user, current.job))) {
    return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);
  }

  const deletedDb = await deleteRouteQuery(req.params.id);
  if (!deletedDb) {
    
    return res.status(404).json({ error: "Route not found" });
  }
  
  res.json({ message: "Route deleted successfully" });
}, {
  log: "deleteRoute error",
  respond: (err, req, res) => res.status(500).json({ error: `Failed to delete route: ${err.message}` }),
});

export const getRoutesByDriver = asyncHandler(async (req, res) => {
  const { driverId } = req.params;
  
  if (!driverId) {
    return res.status(400).json({ 
      success: false, 
      error: "Driver ID is required" 
    });
  }
  
  if (!(await canAccessDriverCity(req.user, driverId))) {
    return res.status(HttpStatus.FORBIDDEN).json({ success: false, ...CITY_FORBIDDEN });
  }

  const routesDb = await getRoutesByDriverCity(driverId);
  const routes = routesDb.map(mapRoute);
  
  res.json({ 
    success: true,
    routes 
  });
}, {
  log: "getRoutesByDriver error",
  respond: (err, req, res) => res.status(500).json({
    success: false,
    error: err.message
  }),
});
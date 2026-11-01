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
export const createRoute = async (req, res) => {
  try {
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

  } catch (err) {
    logger.error("createRoute error", err);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: `Failed to create route: ${err.message}` });
  }
};

// ✅ ENHANCED: Fetch paginated routes with city filter
export const fetchPaginatedRoutes = async (req, res) => {
  try {
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
  } catch (error) {
    logger.error("fetchPaginatedRoutes error", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

// Get all routes (for dropdown, etc.)
export const getAdminRoutes = async (req, res) => {
  try {
    let routesDb;
    const { role, id } = req.user;
    
  
    
    if (role === 'superadmin') {
      routesDb = await getAllRoutes();
    } else {
      routesDb = await getRoutesForAdmin(id);
    }
    
    const routes = routesDb.map(mapRoute);
    
    res.json({ routes });
  } catch (err) {
    logger.error("getAdminRoutes error", err);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message });
  }
};

export const getDriverRoutes = async (req, res) => {
  try {
    const id = req.driver.id;
    const routesDb = await getAllRoutesOfDriver(id);
    const routes = routesDb.map(mapRoute);
    res.json({ routes });
  } catch (err) {
    logger.error("getDriverRoutes error", err);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message });
  }
};

// Get route by ID
export const getRouteById = async (req, res) => {
  try {
    const routeDb = await getRouteByIdQuery(req.params.id);
    if (!routeDb) {
     
      return res.status(404).json({ error: "Route not found" });
    }
    if (!(await canAccessJob(req.user, routeDb.job))) {
      return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);
    }
    const route = mapRoute(routeDb);
    res.json(route);
  } catch (err) {
    logger.error("getRouteById error", err);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message });
  }
};

// Update route
export const updateRoute = async (req, res) => {
  try {
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
  } catch (err) {
    logger.error("updateRoute error", err);
    res.status(400).json({ error: `Failed to update route: ${err.message}` });
  }
};

// Toggle route status
export const toggleRouteStatus = async (req, res) => {
  try {
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
  } catch (err) {
    logger.error("toggleRouteStatus error", err);
    res.status(500).json({ error: `Failed to toggle route status: ${err.message}` });
  }
};

// Delete route
export const deleteRoute = async (req, res) => {
  try {
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
  } catch (err) {
    logger.error("deleteRoute error", err);
    res.status(500).json({ error: `Failed to delete route: ${err.message}` });
  }
};

export const getRoutesByDriver = async (req, res) => {
  try {
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
  } catch (err) {
    logger.error("getRoutesByDriver error", err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};
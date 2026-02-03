import {
  getAllCities,
  getAllDrivers,
  getAllRoutes,
  getAllottedCities,
  getAllottedDrivers,
  getAllottedRoutes,
  getDriversByCity,
  getAllottedDriversByCity,
  getRoutesByCity,
  getAllottedRoutesByCity
} from "../../services/admin/dashboardService.js"

export const getAllData = async (req, res) => {
  try {
    const { id: userId, role: userRole } = req.user;
    let cities, drivers, routes;

    if (userRole == 'superadmin') {
      [cities, drivers, routes] = await Promise.all([
        getAllCities(),
        getAllDrivers(),
        getAllRoutes(),
      ]);
    } else {
      [cities, drivers, routes] = await Promise.all([
        getAllottedCities(userId),
        getAllottedDrivers(userId),
        getAllottedRoutes(userId),
      ]);
    }

    res.status(200).json({
      success: true,
      data: { cities, drivers, routes },
    });
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ✅ NEW: Get drivers filtered by city
export const getFilteredDriversByCity = async (req, res) => {
  try {
    const { id: userId, role: userRole } = req.user;
    const { cityJob } = req.query;

    if (!cityJob || cityJob === "All") {
      // Return all drivers if no city selected
      let drivers;
      if (userRole === 'superadmin') {
        drivers = await getAllDrivers();
      } else {
        drivers = await getAllottedDrivers(userId);
      }
      return res.status(200).json({
        success: true,
        data: drivers,
      });
    }

    // Return filtered drivers by city
    let drivers;
    if (userRole === 'superadmin') {
      drivers = await getDriversByCity(cityJob);
    } else {
      drivers = await getAllottedDriversByCity(userId, cityJob);
    }

    res.status(200).json({
      success: true,
      data: drivers,
    });
  } catch (err) {
    console.error("Error fetching drivers by city:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ✅ NEW: Get routes filtered by city
export const getFilteredRoutesByCity = async (req, res) => {
  try {
    const { id: userId, role: userRole } = req.user;
    const { cityJob } = req.query;

    if (!cityJob || cityJob === "All") {
      // Return all routes if no city selected
      let routes;
      if (userRole === 'superadmin') {
        routes = await getAllRoutes();
      } else {
        routes = await getAllottedRoutes(userId);
      }
      return res.status(200).json({
        success: true,
        data: routes,
      });
    }

    // Return filtered routes by city
    let routes;
    if (userRole === 'superadmin') {
      routes = await getRoutesByCity(cityJob);
    } else {
      routes = await getAllottedRoutesByCity(userId, cityJob);
    }

    res.status(200).json({
      success: true,
      data: routes,
    });
  } catch (err) {
    console.error("Error fetching routes by city:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
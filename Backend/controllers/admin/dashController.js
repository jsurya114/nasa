// controllers/dataController.js
import { getAllCities, getAllDrivers, getAllRoutes, getAllottedCities, getAllottedDrivers, getAllottedRoutes} from "../../services/admin/dashboardService.js"

export const getAllData = async (req, res) => {
  try {
    // console.log("Request user", req.user);
    const {id:userId,role:userRole}= req.user;
    let cities,drivers,routes;
    if(userRole=='superadmin'){
     [cities, drivers, routes] = await Promise.all([
      getAllCities(),
      getAllDrivers(),
      getAllRoutes(),
    ]);
  }else{
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
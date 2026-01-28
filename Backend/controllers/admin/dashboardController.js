import { AdminDashboardQueries } from "../../services/admin/dashboardQueries.js";
import { WeeklyExcelQueries } from "../../services/admin/weeklyExcelQueries.js";
import HttpStatus from "../../utils/statusCodes.js";

// ✅ Get summary data for all records matching the filter
export const getSummaryData = async (req, res) => {
  try {
    const { 
      job, 
      driver, 
      route, 
      startDate, 
      endDate, 
      paymentStatus,
      dataType,
      defaultToday
    } = req.query;
    
    const { id, role } = req.user;
    
    const filters = {};
    
    if (job && job !== "All") filters.job = job;
    if (driver && driver !== "All") filters.driver = driver;
    if (route && route !== "All") filters.route = route;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (paymentStatus && paymentStatus !== "All") filters.paymentStatus = paymentStatus;
    if (dataType && dataType !== "all") filters.dataType = dataType;
    
    // Handle default today filter
    if (defaultToday === "true") {
      const today = new Date().toISOString().split('T')[0];
      filters.startDate = today;
      filters.endDate = today;
    }

    const summary = await AdminDashboardQueries.getSummaryData(filters, id, role);
    
    return res.status(HttpStatus.OK).json({ 
      success: true, 
      data: summary
    });
  } catch (error) {
    console.error("Error in getSummaryData:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: error.message || "Failed to fetch summary data" 
    });
  }
};

export const getPaymentDashboardData = async (req, res) => {
  try {
   
    const { 
      job, 
      driver, 
      route, 
      startDate, 
      endDate, 
      paymentStatus, 
      companyEarnings,
      dataType,
      page = 1,
      limit = 10,
      defaultToday
    } = req.query;
    
    const { id, role } = req.user;
    
    const filters = {};
    
    if (job && job !== "All") filters.job = job;
    if (driver && driver !== "All") filters.driver = driver;
    if (route && route !== "All") filters.route = route;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (paymentStatus && paymentStatus !== "All") filters.paymentStatus = paymentStatus;
    if (companyEarnings === "true") filters.companyEarnings = true;
    if (dataType && dataType !== "all") filters.dataType = dataType;
    
    // Handle default today filter
    if (defaultToday === "true") {
      const today = new Date().toISOString().split('T')[0];
      filters.startDate = today;
      filters.endDate = today;
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const totalCount = await AdminDashboardQueries.getPaymentDashboardCount(filters, id, role);
    
    const result = await AdminDashboardQueries.getPaymentDashboardPaginated(
      filters, 
      id, 
      role, 
      limitNum, 
      offset
    );
    
    const totalPages = Math.ceil(totalCount / limitNum);
    
    return res.status(HttpStatus.OK).json({ 
      success: true, 
      data: result,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: totalPages
      }
    });
  } catch (error) {
    console.error("Error in getPaymentDashboardData:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: error.message || "Failed to fetch payment dashboard data" 
    });
  }
};

export const getAllPaymentDashboardData = async (req, res) => {
  try {
    const { 
      job, 
      driver, 
      route, 
      startDate, 
      endDate, 
      paymentStatus, 
      companyEarnings, 
      dataType,
      defaultToday
    } = req.query;
    
    const { id, role } = req.user;
    
    const filters = {};
    
    if (job && job !== "All") filters.job = job;
    if (driver && driver !== "All") filters.driver = driver;
    if (route && route !== "All") filters.route = route;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (paymentStatus && paymentStatus !== "All") filters.paymentStatus = paymentStatus;
    if (companyEarnings === "true") filters.companyEarnings = true;
    if (dataType && dataType !== "all") filters.dataType = dataType;
    
    // Handle default today filter
    if (defaultToday === "true") {
      const today = new Date().toISOString().split('T')[0];
      filters.startDate = today;
      filters.endDate = today;
    }

    const result = await AdminDashboardQueries.PaymentDashboardTable(filters, id, role);
    
    return res.status(HttpStatus.OK).json({ success: true, data: result });
  } catch (error) {
    console.error("Error in getAllPaymentDashboardData:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: error.message || "Failed to fetch payment dashboard data" 
    });
  }
};

export const updatePaymentData = async (req, res) => {
  try {
    const { date } = req.query;
    
    if (date) {
      // Calculate payment for specific date
      await AdminDashboardQueries.updatePaymentTableForDate(date);
      res.status(HttpStatus.OK).json({ 
        success: true,
        message: `Payment calculated for ${date}`
      });
    } else {
      // Calculate payment for all dates
      await AdminDashboardQueries.updatePaymentTable();
      res.status(HttpStatus.OK).json({ 
        success: true,
        message: "Payment calculated for all dates"
      });
    }
  } catch (error) {
    console.error("Error in updatePaymentData:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false,
      message: error.message || "Failed to calculate payment"
    });
  }
};

// ✅ UPDATED: Only pay for journeys where closed = true
export const payDriver = async (req, res) => {
  try {
    const { driverName, startDate, endDate } = req.body;
    
    if (!driverName) {
      return res.status(HttpStatus.BAD_REQUEST).json({ 
        success: false, 
        message: "Driver name is required" 
      });
    }

    // ✅ Update only journeys where closed = true
    const result = await AdminDashboardQueries.updateDriverPaymentStatus(
      driverName, 
      startDate, 
      endDate
    );
    
    // ✅ Check if any rows were updated
    if (result.rowCount === 0) {
      return res.status(HttpStatus.OK).json({ 
        success: true, 
        message: `No closed journeys found to mark as paid for ${driverName}`,
        rowsUpdated: 0,
        warning: "Only journeys with closed status 'Yes' can be marked as paid"
      });
    }
    
    return res.status(HttpStatus.OK).json({ 
      success: true, 
      message: `Payment marked as paid for ${result.rowCount} closed journey(s) for ${driverName}`,
      rowsUpdated: result.rowCount 
    });
  } catch (error) {
    console.error("Error in payDriver:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: error.message || "Failed to update payment status" 
    });
  }
};

export const updateWeeklyTempDataToDashboard = async (req, res) => {
  try {
    const isExists = await WeeklyExcelQueries.getWeeklyData();

    if (!isExists.exists) {
      return res.status(404).json({ 
        success: false, 
        error: "Weekly count table does not exist or is empty",
        message: "Please upload weekly data first"
      });
    }

    const rowsInserted = await WeeklyExcelQueries.createEntriesFromWeeklyCount();
    await WeeklyExcelQueries.deleteWeeklyTableIfExists('weeklycount');

    return res.status(200).json({ 
      success: true, 
      rowsInserted, 
      message: "Data inserted successfully!!" 
    });
  } catch (err) {
    console.error('Route handler error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
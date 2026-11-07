import { AdminDashboardQueries } from "../../services/admin/dashboardQueries.js";
import { WeeklyExcelQueries } from "../../services/admin/weeklyExcelQueries.js";
import HttpStatus from "../../utils/statusCodes.js";
import { resolveToday } from "../../utils/businessDate.js";
import logger from "../../utils/logger.js";
import pool from "../../config/db.js";
import { markProcessingRows } from "../../services/payroll/payRuns/processingRows.js";
import { UploadBusyError } from "../../services/admin/uploadSafety.js";
import {
  CityAccessError,
  assertJobsAllowed,
  getAllowedJobs,
  getWeeklyStagingJobs,
  isCityLimited
} from "../../services/admin/adminCityAccess.js";

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
      const today = resolveToday(req.query.today);
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
      const today = resolveToday(req.query.today);
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
      data: await markProcessingRows(pool, result),
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
      const today = resolveToday(req.query.today);
      filters.startDate = today;
      filters.endDate = today;
    }

    const result = await AdminDashboardQueries.PaymentDashboardTable(filters, id, role);

    return res.status(HttpStatus.OK).json({ success: true, data: await markProcessingRows(pool, result) });
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
    const { id, role } = req.user;

    // A city admin recalculates only the cities assigned to them
    const allowedJobs = isCityLimited(role) ? await getAllowedJobs(id) : null;

    const result = date
      ? await AdminDashboardQueries.updatePaymentTableForDate(date, allowedJobs)
      : await AdminDashboardQueries.updatePaymentTable(allowedJobs);
    const base = date ? `Payment calculated for ${date}` : "Payment calculated for all dates";
    // Rows in an approved pay run or a verified carrier statement are never recalculated; say so instead of skipping them silently.
    const note = result.protectedRows > 0
      ? `. ${result.protectedRows} row${result.protectedRows === 1 ? " was" : "s were"} left as ${result.protectedRows === 1 ? "it is" : "they are"} because ${result.protectedRows === 1 ? "it belongs" : "they belong"} to an approved pay run or a verified carrier statement`
      : "";
    res.status(HttpStatus.OK).json({
      success: true,
      message: `${base}${note}`,
      updated: result.updated,
      protectedRows: result.protectedRows
    });
  } catch (error) {
    if (error instanceof CityAccessError) {
      return res.status(HttpStatus.FORBIDDEN).json({ success: false, message: error.message });
    }
    console.error("Error in updatePaymentData:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Failed to calculate payment"
    });
  }
};

//  UPDATED: Pay journeys with closed = true, supports separate daily/weekly payments
// Older clients must use the approved-run workflow so a paid flag cannot bypass its statement or audit record.
export const payDriver = (_req, res) => res.status(HttpStatus.CONFLICT).json({
  success: false,
  message: "Prepare and approve a pay run, then record payment from Driver payments or the approved run.",
});

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

    // A city admin may add the staged weekly data only when it holds nothing but their cities.
    // The check runs inside the insert's own transaction, so the staged data cannot change in between.
    const { id, role } = req.user;
    const beforeInsert = isCityLimited(role)
      ? async (client) => assertJobsAllowed(
        await getWeeklyStagingJobs(client),
        await getAllowedJobs(id, client),
        "The uploaded weekly data includes cities outside your assigned cities. Nothing was changed."
      )
      : null;

    // The staging table is cleared in the same transaction as the insert
    const rowsInserted = await WeeklyExcelQueries.createEntriesFromWeeklyCount({ beforeInsert });

    return res.status(200).json({
      success: true,
      rowsInserted,
      message: "Data inserted successfully!!"
    });
  } catch (err) {
    if (err instanceof CityAccessError) {
      return res.status(HttpStatus.FORBIDDEN).json({ success: false, error: err.message, message: err.message });
    }
    if (err instanceof UploadBusyError) {
      return res.status(HttpStatus.CONFLICT).json({ success: false, error: err.message, message: err.message });
    }
    if (err.code === "42P01") {
      // The staged data was cleared by someone else after the check above
      return res.status(404).json({
        success: false,
        error: "Weekly count table does not exist or is empty",
        message: "Please upload weekly data first"
      });
    }
    logger.error("Could not add the weekly data to the dashboard", err);
    return res.status(500).json({ success: false, message: "Could not add the weekly data. Nothing was changed." });
  }
};

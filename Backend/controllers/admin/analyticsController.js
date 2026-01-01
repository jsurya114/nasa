import pool from "../../config/db.js";
import HttpStatus from "../../utils/statusCodes.js";
import { AnalyticsQueries } from "../../services/admin/analyticsQueries.js";

export const getAnalyticsData = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, role } = req.user; // User from auth middleware
    const { viewType, date } = req.query;

    if (!viewType || !date) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "viewType and date are required",
      });
    }

    await client.query("BEGIN");

    let analyticsData;

    if (viewType === "daily") {
      analyticsData = await AnalyticsQueries.getDailyAnalytics(
        client,
        id,
        role,
        date
      );
    } else if (viewType === "weekly") {
      analyticsData = await AnalyticsQueries.getWeeklyAnalytics(
        client,
        id,
        role,
        date
      );
    } else {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "Invalid viewType. Must be 'daily' or 'weekly'",
      });
    }

    await client.query("COMMIT");

    return res.status(HttpStatus.OK).json({
      success: true,
      data: analyticsData,
    });
  } catch (error) {
    console.error("Analytics fetch error:", error);
    await client.query("ROLLBACK");
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error fetching analytics data",
      error: error.message,
    });
  } finally {
    client.release();
  }
};
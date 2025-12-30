import statusCode from "../../utils/statusCodes.js";
import pool from "../../config/db.js";
import HttpStatus from "../../utils/statusCodes.js";
import XLSX from "xlsx";
import { ExcelFileQueries } from "../../services/admin/excelFileQueries.js";
import { unlink } from "fs";

// Excel sheet name
const sheetName = "result";

/* =========================================================
   GET DAILY DASHBOARD DATA (DATE BASED)
========================================================= */
export const getUpdatedTempDashboardData = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, role } = req.user;
    const { date } = req.query;

    // ✅ Validate date
    if (!date || isNaN(Date.parse(date))) {
      return res.status(400).json({
        success: false,
        message: "Valid date (YYYY-MM-DD) is required",
      });
    }

    await client.query("BEGIN");

    const result = await ExcelFileQueries.getTempDashboardData(
      client,
      date,
      id,
      role
    );

    await client.query("COMMIT");

    return res.status(statusCode.OK).json({
      success: true,
      data: result,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Dashboard fetch error:", error);
    return res.status(statusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  } finally {
    client.release();
  }
};

/* =========================================================
   DAILY EXCEL UPLOAD & CALCULATION (FINAL FIXED VERSION)
========================================================= */
export const DailyExcelUpload = async (req, res) => {
  const client = await pool.connect();
  try {
    const { journey_date } = req.body;

    // ✅ Validate journey date
    if (!journey_date || isNaN(Date.parse(journey_date))) {
      return res.status(400).json({
        success: false,
        message: "Journey date is required",
      });
    }

    // ✅ Validate file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return res.status(400).json({
        success: false,
        message: `Sheet "${sheetName}" not found`,
      });
    }

    const rows = XLSX.utils.sheet_to_json(sheet);

    await client.query("BEGIN");

    /* ---------------------------------------------------------
       1️⃣ Ensure journey exists
    --------------------------------------------------------- */
    const journeyCheck = await client.query(
      `
      SELECT 1
      FROM dashboard_data
      WHERE journey_date = $1
      LIMIT 1
    `,
      [journey_date]
    );

    if (journeyCheck.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "No journey exists for the selected date",
      });
    }

    /* ---------------------------------------------------------
       2️⃣ Remove previous Excel data for same date
    --------------------------------------------------------- */
    await client.query(
      `
      DELETE FROM todays_excel_data
      WHERE upload_date = $1
    `,
      [journey_date]
    );

    /* ---------------------------------------------------------
       3️⃣ Insert Excel rows with correct upload_date
    --------------------------------------------------------- */
    await ExcelFileQueries.insertDataIntoDailyTable(
      "todays_excel_data",
      rows,
      client,
      journey_date
    );

    /* ---------------------------------------------------------
       4️⃣ ALIGN deliveries to journey date  🔥 MAIN FIX
    --------------------------------------------------------- */
    await client.query(
      `
      UPDATE deliveries d
      SET driver_set_date = $1
      FROM todays_excel_data e
      WHERE d.seq_route_code = e.seq_route_code
    `,
      [journey_date]
    );

    /* ---------------------------------------------------------
       5️⃣ Reset delivery results ONLY for this date
    --------------------------------------------------------- */
    await client.query(
      `
      UPDATE deliveries
      SET final_result = 'not_assigned'
      WHERE DATE(driver_set_date) = $1
    `,
      [journey_date]
    );

    /* ---------------------------------------------------------
       6️⃣ Merge Excel → Deliveries
    --------------------------------------------------------- */
    await ExcelFileQueries.mergeDeliveriesAndExcelData(client);

    /* ---------------------------------------------------------
       7️⃣ Set no_scanned & failed_attempt
    --------------------------------------------------------- */
    await ExcelFileQueries.setUntouchedRowsAsNoScannedAndUpdateFailedAttempt(
      client
    );

    /* ---------------------------------------------------------
       8️⃣ Calculate first_stop & double_stop
    --------------------------------------------------------- */
    await ExcelFileQueries.updateFirstStopAndDoubleStop(client);

    /* ---------------------------------------------------------
       9️⃣ Reset dashboard counts for this journey date
    --------------------------------------------------------- */
    await client.query(
      `
      UPDATE dashboard_data
      SET
        no_scanned = 0,
        failed_attempt = 0,
        ds = 0,
        first_stop = 0,
        delivered = 0,
        is_deliveries_count_added = false
      WHERE journey_date = $1
    `,
      [journey_date]
    );

    /* ---------------------------------------------------------
       🔟 Recalculate dashboard counts
    --------------------------------------------------------- */
    await ExcelFileQueries.addEachDriversCount(client);

    await client.query("COMMIT");

    // 🧹 Remove uploaded file
    unlink(req.file.path, () => {});

    return res.status(statusCode.OK).json({
      success: true,
      message: "Daily Excel processed and calculated successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Daily upload error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  } finally {
    client.release();
  }
};

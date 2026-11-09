import statusCode from "../../utils/statusCodes.js";
import pool from "../../config/db.js";
import HttpStatus from "../../utils/statusCodes.js";
import XLSX from "xlsx";
// import XlsxPopulate from 'xlsx-populate';
import { ExcelFileQueries } from "../../services/admin/excelFileQueries.js";
import {
  CityAccessError,
  assertJobsAllowed,
  getAllowedJobs,
  getDailyStagingJobs,
  isCityLimited
} from "../../services/admin/adminCityAccess.js";
import logger from "../../utils/logger.js";
import {
  UploadFileError,
  isIsoDate,
  lockUploads,
  respondToUploadError
} from "../../services/admin/uploadSafety.js";


import { unlink } from "fs";


const sheetName = "result";
// Without these the rows cannot be matched to deliveries or classified
const REQUIRED_COLUMNS = ["Route", "Sequence", "Status"];



export const getUpdatedTempDashboardData = async (req, res) => {
  const client = await pool.connect()
  try {
    const { id, role } = req.user;

    const { date, page = 1, limit = 10 } = req.query;

    if (!date || date === 'undefined' || date === 'null') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "Valid date query param is required",
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "Date must be in YYYY-MM-DD format",
      });
    }

    await client.query('BEGIN');

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const result = await ExcelFileQueries.getTempDashboardData(
      client,
      id,
      role,
      date,
      limitNum,
      offset
    );

    const countResult = await ExcelFileQueries.getTempDashboardDataCount(
      client,
      id,
      role,
      date
    );

    await client.query('COMMIT');

    const total = parseInt(countResult);
    const totalPages = Math.ceil(total / limitNum);

    return res.status(statusCode.OK).json({
      success: true,
      data: result,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems: total,
        itemsPerPage: limitNum
      }
    });
  } catch (error) {
    console.error(error);
    await client.query('ROLLBACK');
    return res.status(statusCode.INTERNAL_SERVER_ERROR).json({
      message: 'error in server',
      error
    });
  } finally {
    client.release();
  }
}


export const DailyExcelUpload = async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ success: false, message: "NO file uploaded" });
    }

    const { uploadDate } = req.body;



    if (!uploadDate) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "uploadDate is required"
      });
    }

    if (!isIsoDate(uploadDate)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "uploadDate must be a real date written as YYYY-MM-DD"
      });
    }


    const fileName = req.file;
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      throw new UploadFileError("The file could not be read. Upload the Excel (.xlsx) file as downloaded. Nothing was changed.");
    }
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return res.status(400).json({
        success: false,
        error: "Sheet named result not found",
        message: "Sheet named result not found. Nothing was changed."
      });
    }

    const rows = XLSX.utils.sheet_to_json(sheet);

    // Rows without the columns the matching needs cannot be matched or classified. Refuse the file
    // before anything is touched. (A file with no rows at all is processed as before.)
    const missingColumns = rows.length === 0 ? [] : REQUIRED_COLUMNS.filter(
      (column) => !rows.some((row) => row[column] !== undefined && row[column] !== "")
    );
    if (missingColumns.length > 0) {
      throw new UploadFileError(`Missing required column(s): ${missingColumns.join(", ")}. Nothing was changed.`);
    }

    const tableName = `todays_excel_data`;

    await client.query("BEGIN");
    await lockUploads(client);

    await ExcelFileQueries.deleteIfTableAlreadyExists(tableName, client);
    await ExcelFileQueries.createDailyTable(tableName, client);
    await ExcelFileQueries.insertDataIntoDailyTable(
      tableName,
      rows,
      uploadDate,
      client
    );


    // A city admin may upload only a file whose deliveries all belong to their cities.
    // Nothing is written to the deliveries yet, so refusing here rolls everything back.
    if (isCityLimited(req.user.role)) {
      assertJobsAllowed(
        await getDailyStagingJobs(client),
        await getAllowedJobs(req.user.id, client),
        "This file includes deliveries for cities outside your assigned cities. Nothing was changed."
      );
    }

    await ExcelFileQueries.mergeDeliveriesAndExcelData(client);

    // 🔥 RESET old delivery results so recalculation works
    await ExcelFileQueries.resetDeliveryResults(client, uploadDate);

    await ExcelFileQueries.setUntouchedRowsAsNoScannedAndUpdateFailedAttempt(
      client
    );

    await ExcelFileQueries.updateFirstStopAndDoubleStop(client);

    // 🔥 RESET dashboard counts before recalculating
    await client.query(`
      UPDATE dashboard_data
      SET
        no_scanned = 0,
        failed_attempt = 0,
        ds = 0,
        first_stop = 0,
        delivered = 0,
        is_deliveries_count_added = false
       WHERE journey_date = $1
         AND (start_seq != 0 OR end_seq != 0)
         AND paid = false
   
    `, [uploadDate]);

    await ExcelFileQueries.addEachDriversCount(client);

    await client.query("COMMIT");
    logger.info("Daily upload processed", { rows: rows.length, uploadDate });

    return res
      .status(statusCode.OK)
      .json({ success: true, message: "Excel processed successfully", rowsRead: rows.length });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof CityAccessError) {
      return res.status(HttpStatus.FORBIDDEN).json({ success: false, message: error.message });
    }
    if (respondToUploadError(res, error)) return;
    logger.error("Daily upload failed", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error occurred while processing Excel. Nothing was changed.",
    });
  } finally {
    client.release();
  }
};













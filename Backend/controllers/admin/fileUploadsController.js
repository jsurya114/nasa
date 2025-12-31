import statusCode from "../../utils/statusCodes.js";
import pool from "../../config/db.js";
import HttpStatus from "../../utils/statusCodes.js";
import XLSX from "xlsx";
// import XlsxPopulate from 'xlsx-populate';
import { ExcelFileQueries } from "../../services/admin/excelFileQueries.js";


import { unlink } from "fs";

// printMatchSummary 

// import { AdminDashboardQueries } from "../../services/admin/dashboardQueries.js";

// const sheetName = "dup";
const sheetName = "result";

//Modified to implement role based data for admin and superadmin
// export const getUpdatedTempDashboardData = async(req,res)=>{
//   const client = await pool.connect()
//   try {
//     client.query('BEGIN')
//     const result = await ExcelFileQueries.getTempDashboardData(client)
//     client.query('COMMIT')
//     return res.status(statusCode.OK).json({success:true,data:result})
//   } catch (error) {
//     console.error(error)
//     client.query('ROLLBACK')
//     return res.status(statusCode.INTERNAL_SERVER_ERROR).json({message:'error in server',error})
//   }
//   finally{
//     client.release()
//   }
// }

export const getUpdatedTempDashboardData = async (req, res) => {
  const client = await pool.connect()
  try {
    const { id, role } = req.user   // 👈 IMPORTANT

    await client.query('BEGIN')

    const result = await ExcelFileQueries.getTempDashboardData(
      client,
      id,
      role
    )

    await client.query('COMMIT')

    return res.status(statusCode.OK).json({
      success: true,
      data: result
    })
  } catch (error) {
    console.error(error)
    await client.query('ROLLBACK')
    return res.status(statusCode.INTERNAL_SERVER_ERROR).json({
      message: 'error in server',
      error
    })
  } finally {
    client.release()
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

    const fileName = req.file;
    const workbook = XLSX.readFile(fileName.path);
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return res.status(400).json({ error: "Sheet named result not found" });
    }

    const rows = XLSX.utils.sheet_to_json(sheet);
    const tableName = `todays_excel_data`;

    await client.query("BEGIN");

    await ExcelFileQueries.deleteIfTableAlreadyExists(tableName, client);
    await ExcelFileQueries.createDailyTable(tableName, client);
    await ExcelFileQueries.insertDataIntoDailyTable(
      tableName,
      rows,
      client
    );

    await ExcelFileQueries.mergeDeliveriesAndExcelData(client);

    // 🔥 RESET old delivery results so recalculation works
    await ExcelFileQueries.resetDeliveryResults(client);

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
      WHERE journey_date IN (
        SELECT upload_date FROM todays_excel_data
      );
    `);

    await ExcelFileQueries.addEachDriversCount(client);

    await client.query("COMMIT");

    unlink(fileName.path, (e) => {
      if (e) throw new Error(e);
    });

    return res
      .status(statusCode.OK)
      .json({ success: true, message: "Excel processed successfully" });
  } catch (error) {
    console.error(error);
    await client.query("ROLLBACK");
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error occurred while processing Excel",
    });
  } finally {
    client.release();
  }
};


// export const updateDriverPayment = async (req,res)=>{
//   try {
//     await AdminDashboardQueries.updatePaymentTable()

//   } catch (error) {

//   }
// }
// export default fileUpload





  




      

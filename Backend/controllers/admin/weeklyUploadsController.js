// import pool from "../../config/db.js";
// import HttpStatus from "../../utils/statusCodes.js";
// import ExcelJS from 'exceljs';
// import moment from 'moment';

// import { WeeklyExcelQueries } from "../../services/admin/weeklyExcelQueries.js";

// import { unlink } from "fs";


// export const getWeeklyTempData=async(req,res)=>{
//   try{
  

//     const {page=1,limit=10}=req.query;
//     const {id,role} = req.admin;

//     let pageNum=Number(page);
//     let pageLimit=Number(limit);
//     let offset=(pageNum-1)* pageLimit
   
//     let data = await WeeklyExcelQueries.getWeeklyData(id,role,pageLimit,offset);
    
//     let countOfData= await WeeklyExcelQueries.getCountOfWeeklyData(id,role);
  
//     const total = parseInt(countOfData);
//     const totalPages = Math.ceil(total / pageLimit);

//     return res.status(HttpStatus.OK).json({data,
//       pagination: {
//         currentPage: pageNum,
//         totalPages,
//         totalItems: total,
//         itemsPerPage: pageLimit
//       }
//     });
//   }catch(err){
//     console.error("Upload Error:", err);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// }


// export const weeklyExcelUpload = async (req, res) => {
//   try {
//     const file = req.file;
    
//     if (!file) {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'No file uploaded' 
//       });
//     }

//     // Since you're using memoryStorage, file.buffer exists, not file.path
//     if (!file.buffer) {
//       console.error('File object:', file);
//       return res.status(400).json({ 
//         success: false, 
//         message: 'File buffer is missing' 
//       });
//     }

    

//     // Function to process Excel from buffer
//     async function processExcelFromBuffer(buffer, batchSize = 500) {
//       const workbook = new ExcelJS.Workbook();
      
//       // Read from buffer instead of file path
//       await workbook.xlsx.load(buffer);
      
//       const worksheet = workbook.getWorksheet("Details of dlivery Fee");
      
//       if (!worksheet) {
//         const availableSheets = workbook.worksheets.map(ws => ws.name);
//         throw new Error(
//           `Sheet "Details of dlivery Fee" not found. Available sheets: ${availableSheets.join(', ')}`
//         );
//       }
      
//       const jsonData = [];
//       worksheet.eachRow((row, rowNumber) => {
//         // Skip header row (rowNumber === 1)
//         if (rowNumber > 1) {
//           jsonData.push(row.values.slice(1)); 
//         }
//       });
      
      
      
//       if (jsonData.length === 0) {
//         throw new Error('No data rows found in the Excel file');
//       }

//       // Map to accumulate aggregated data across batches
//       const aggregatedData = new Map();
//       let totalProcessed = 0;
//       let totalSkipped = 0;
//       let batchCount = 0;

//       // Process in batches
//       for (let i = 0; i < jsonData.length; i += batchSize) {
//         batchCount++;
//         const batch = jsonData.slice(i, i + batchSize);
       

//         for (let rowIndex = 0; rowIndex < batch.length; rowIndex++) {
//           const row = batch[rowIndex];
          
//           try {
//             // Extract fields (adjust indices to match your Excel structure)
//             const regionRoute = (row[6] || '').toString().trim();
//             const courier = (row[8] || '').toString().trim();
//             const deliveryId = parseInt(row[9]) || null;
//             const signingTime = (row[12] || '').toString().trim();
//             const structuredAddress = (row[13] || '').toString().trim();
//             const stopPointDetails = (row[18] || '').toString().trim();

//             // Debug first few rows
//             // if (totalProcessed + totalSkipped < 3) {
//             //   console.log(`Sample row ${totalProcessed + totalSkipped + 1}:`, {
//             //     regionRoute,
//             //     courier,
//             //     deliveryId,
//             //     signingTime,
//             //     structuredAddress,
//             //     stopPointDetails
//             //   });
//             // }

//             // Validation
//             if (!deliveryId || !signingTime) {
          
//               totalSkipped++;
//               continue;
//             }

//             // Parse and validate date
//             const isValidDate = 
//               moment(signingTime, 'MM/DD/YYYY HH:mm:ss', true).isValid() || 
//               moment(signingTime, 'MM/DD/YYYY', true).isValid();
              
//             if (!isValidDate) {
              
//               totalSkipped++;
//               continue;
//             }
            
//             const delDate = moment(signingTime, ['MM/DD/YYYY HH:mm:ss', 'MM/DD/YYYY'])
//               .format('YYYY-MM-DD');

//             // Determine address based on structured address
//             // const address = structuredAddress;

//              // Determine map based on  stopPointDetails
//             const address = stopPointDetails;
//             if (!address) {
             
//               totalSkipped++;
//               continue;
//             }

//             // Create unique key and aggregate
//             const key = `${delDate}-${deliveryId}-${regionRoute}`;
            
//             if (!aggregatedData.has(key)) {
//               aggregatedData.set(key, {
//                 courier_name: courier,
//                 driver_id: deliveryId,
//                 del_route: regionRoute,
//                 del_date: delDate,
//                 total_deliveries: 0,
//                 fs: 0,
//                 ds: 0,
//                 // addresses: new Map(),
//                 addresses: new Map([["1",0]]),
//               });
//             }

//             const entry = aggregatedData.get(key);
//             entry.total_deliveries++;
            
//             //This is count of fs and ds based on structuredAddress 
//             // if (!entry.addresses.has(address)) {
//             //   entry.addresses.set(address, 0);
//             //   entry.fs++;
//             // } else {
//             //   entry.ds++;
//             // }

//             //This is coount of fs and ds based on stopPointDetails
//              if (entry.addresses.has(address)) {
//               // entry.addresses.set(address, 0);
//               entry.fs++;
//             } else {
//               entry.ds++;
//             }

//             totalProcessed++;
            
//           } catch (rowError) {
//             console.error(
//               `Batch ${batchCount}, Row ${rowIndex + 1}: Error -`,
//               rowError.message
//             );
//             totalSkipped++;
//             continue;
//           }
//         }
        
       
//       }


//       // Prepare and insert into database
//       let tableName = "weeklycount";
//       await WeeklyExcelQueries.deleteWeeklyTableIfExists(tableName);
//       await WeeklyExcelQueries.createWeeklyTable(tableName);

//       const client = await pool.connect();
//       try {
//         await client.query('BEGIN');
        
//         let insertCount = 0;
//         for (const [key, data] of aggregatedData) {
//           const { courier_name, driver_id, del_route, del_date, total_deliveries, fs, ds } = data;
          
//           await client.query(
//             `INSERT INTO weeklycount (courier_name, driver_id, del_route, total_deliveries, fs, ds, del_date)
//              VALUES ($1, $2, $3, $4, $5, $6, $7)
//              ON CONFLICT (driver_id, del_date, del_route)
//              DO UPDATE SET
//                total_deliveries = weeklycount.total_deliveries + EXCLUDED.total_deliveries,
//                fs = weeklycount.fs + EXCLUDED.fs,
//                ds = weeklycount.ds + EXCLUDED.ds`,
//             [courier_name, driver_id, del_route, total_deliveries, fs, ds, del_date]
//           );
//           insertCount++;
//         }
        
//         await client.query('COMMIT');
    
        
//         return {
//           success: true,
//           recordsProcessed: totalProcessed,
//           recordsSkipped: totalSkipped,
//           recordsInserted: insertCount
//         };
        
//       } catch (dbError) {
//         await client.query('ROLLBACK');
//         console.error('Database Error:', dbError);
//         throw dbError;
//       } finally {
//         client.release();
//       }
//     }

//     // Process the Excel file from buffer
//     const result = await processExcelFromBuffer(file.buffer, 500);
    
//     res.status(200).json({
//       success: true,
//       message: 'Upload and processing completed successfully',
//       data: result
//     });

//   } catch (err) {
//     console.error('Upload Error:', err);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: err.message
//     });
//   }
// };




















import pool from "../../config/db.js";
import HttpStatus from "../../utils/statusCodes.js";
import ExcelJS from 'exceljs';
import moment from 'moment';

import { WeeklyExcelQueries } from "../../services/admin/weeklyExcelQueries.js";

import { unlink } from "fs";


export const getWeeklyTempData=async(req,res)=>{
  try{
  

    const {page=1,limit=10}=req.query;
    const {id,role} = req.admin;

    let pageNum=Number(page);
    let pageLimit=Number(limit);
    let offset=(pageNum-1)* pageLimit
   
    let data = await WeeklyExcelQueries.getWeeklyData(id,role,pageLimit,offset);
    
    let countOfData= await WeeklyExcelQueries.getCountOfWeeklyData(id,role);
  
    const total = parseInt(countOfData);
    const totalPages = Math.ceil(total / pageLimit);

    return res.status(HttpStatus.OK).json({data,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems: total,
        itemsPerPage: pageLimit
      }
    });
  }catch(err){
    console.error("Upload Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * OPTIMIZED WEEKLY EXCEL UPLOAD WITH BATCHED BULK INSERTS
 * 
 */

export const weeklyExcelUpload = async (req, res) => {
  const startTime = Date.now();
  const client = await pool.connect();
  
  try {
    const file = req.file;
    
    if (!file?.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded or file buffer is missing'
      });
    }

    // console.log(`[${Date.now() - startTime}ms] File received, size: ${file.buffer.length} bytes`);

    const result = await processExcelFromBuffer(file.buffer, client, startTime);

    const totalTime = Date.now() - startTime;
    // console.log(`[${totalTime}ms] ✅ Total processing completed`);

    res.status(200).json({
      success: true,
      message: 'Upload and processing completed successfully',
      data: result,
      processingTime: `${totalTime}ms`
    });

  } catch (err) {
    const totalTime = Date.now() - startTime;
    console.error(`[${totalTime}ms] ❌ Error:`, err.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message
    });
  } finally {
    client.release();
  }
};

async function processExcelFromBuffer(buffer, client, startTime) {
  
  // console.log(`[${Date.now() - startTime}ms] Loading Excel...`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  // console.log(`[${Date.now() - startTime}ms] Excel loaded`);

  const worksheet = workbook.getWorksheet("Details of Delivery Fees");
  // const worksheet = workbook.getWorksheet("Details of dlivery Fee");
  if (!worksheet) {
    const availableSheets = workbook.worksheets.map(ws => ws.name);
    throw new Error(
      `Sheet "Details of dlivery Fee" not found. Available sheets: ${availableSheets.join(', ')}`
    );
  }

 
  // console.log(`[${Date.now() - startTime}ms] Starting row processing...`);
  
  const aggregatedData = new Map();
  let totalProcessed = 0;
  let totalSkipped = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    try {
      const values = row.values.slice(1);
      
      // Extract fields
      const regionRoute = (values[6] || '').toString().trim();
      const courier = (values[8] || '').toString().trim();
      const deliveryId = parseInt(values[9]) || null;
      const signingTime = (values[12] || '').toString().trim();
      const stopPointDetails = (values[18] || '').toString().trim();

      // Validation
      if (!deliveryId || !signingTime || !stopPointDetails) {
        totalSkipped++;
        return;
      }

      // Parse date
      const delDate = moment(signingTime, ['MM/DD/YYYY HH:mm:ss', 'MM/DD/YYYY'], true);
      if (!delDate.isValid()) {
        totalSkipped++;
        return;
      }

      const formattedDate = delDate.format('YYYY-MM-DD');
      const address = stopPointDetails;

      // Aggregate data
      const key = `${formattedDate}-${deliveryId}-${regionRoute}`;
      
      if (!aggregatedData.has(key)) {
        aggregatedData.set(key, {
          courier_name: courier,
          driver_id: deliveryId,
          del_route: regionRoute,
          del_date: formattedDate,
          total_deliveries: 0,
          fs: 0,
          ds: 0,
          addresses: new Map([["1",0]])
        });
      }

      const entry = aggregatedData.get(key);
      entry.total_deliveries++;

      // Count first stops (FS) and double stops (DS)
      if (entry.addresses.has(address)) {
        entry.fs++;
      } else {
        entry.ds++;
        // entry.addresses.add(address);
      }

      totalProcessed++;

    } catch (rowError) {
      console.error(`Row ${rowNumber} Error:`, rowError.message);
      totalSkipped++;
    }
  });

  // console.log(`[${Date.now() - startTime}ms] Row processing complete`);
  // console.log(`  - Processed: ${totalProcessed}`);
  // console.log(`  - Skipped: ${totalSkipped}`);
  // console.log(`  - Aggregated records: ${aggregatedData.size}`);

 
  const tableName = "weeklycount";
  // console.log(`[${Date.now() - startTime}ms] Preparing database table...`);
  await WeeklyExcelQueries.deleteWeeklyTableIfExists(tableName);
  await WeeklyExcelQueries.createWeeklyTable(tableName);
  // console.log(`[${Date.now() - startTime}ms] Table ready`);

  
  await client.query('BEGIN');
  
  try {
    // Configuration
    const BATCH_SIZE = 1000; // Insert 1000 records per batch
    const dataArray = Array.from(aggregatedData.values());
    let totalInserted = 0;

    // console.log(`[${Date.now() - startTime}ms] Starting batched bulk INSERT...`);
    // console.log(`  - Total records: ${dataArray.length}`);
    // console.log(`  - Batch size: ${BATCH_SIZE}`);
    // console.log(`  - Number of batches: ${Math.ceil(dataArray.length / BATCH_SIZE)}`);

    // Process in batches
    for (let i = 0; i < dataArray.length; i += BATCH_SIZE) {
      const batchStartTime = Date.now();
      const batch = dataArray.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      
      // Build VALUES clauses and parameters for this batch
      const values = [];
      const params = [];
      let paramCounter = 1;

      for (const data of batch) {
        const { courier_name, driver_id, del_route, total_deliveries, fs, ds, del_date } = data;
        
        values.push(
          `($${paramCounter}, $${paramCounter + 1}, $${paramCounter + 2}, $${paramCounter + 3}, $${paramCounter + 4}, $${paramCounter + 5}, $${paramCounter + 6})`
        );
        
        params.push(courier_name, driver_id, del_route, total_deliveries, fs, ds, del_date);
        paramCounter += 7;
      }

      // Execute batch insert
      const query = `
        INSERT INTO weeklycount 
        (courier_name, driver_id, del_route, total_deliveries, fs, ds, del_date)
        VALUES ${values.join(', ')}
        ON CONFLICT (driver_id, del_date, del_route) 
        DO UPDATE SET 
          total_deliveries = weeklycount.total_deliveries + EXCLUDED.total_deliveries,
          fs = weeklycount.fs + EXCLUDED.fs,
          ds = weeklycount.ds + EXCLUDED.ds
      `;
      
      await client.query(query, params);
      
      totalInserted += batch.length;
      const batchTime = Date.now() - batchStartTime;
      
      // console.log(`[${Date.now() - startTime}ms] Batch ${batchNumber}/${Math.ceil(dataArray.length / BATCH_SIZE)}: ${batch.length} records in ${batchTime}ms (${totalInserted}/${dataArray.length} total)`);
    }

    // console.log(`[${Date.now() - startTime}ms] All batches completed. Committing transaction...`);
    await client.query('COMMIT');
    // console.log(`[${Date.now() - startTime}ms] Transaction committed successfully`);

    return {
      success: true,
      recordsProcessed: totalProcessed,
      recordsSkipped: totalSkipped,
      recordsInserted: totalInserted,
      batchSize: BATCH_SIZE,
      numberOfBatches: Math.ceil(dataArray.length / BATCH_SIZE)
    };

  } catch (dbError) {
    console.error(`[${Date.now() - startTime}ms] Database error, rolling back:`, dbError.message);
    await client.query('ROLLBACK');
    throw dbError;
  }
}
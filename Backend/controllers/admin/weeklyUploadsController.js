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


export const weeklyExcelUpload = async (req, res) => {
  try {
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    // Since you're using memoryStorage, file.buffer exists, not file.path
    if (!file.buffer) {
      console.error('File object:', file);
      return res.status(400).json({ 
        success: false, 
        message: 'File buffer is missing' 
      });
    }

    console.log(`Processing file: ${file.originalname}, Size: ${file.size} bytes`);

    // Function to process Excel from buffer
    async function processExcelFromBuffer(buffer, batchSize = 500) {
      const workbook = new ExcelJS.Workbook();
      
      // Read from buffer instead of file path
      await workbook.xlsx.load(buffer);
      
      const worksheet = workbook.getWorksheet("Details of dlivery Fee");
      
      if (!worksheet) {
        const availableSheets = workbook.worksheets.map(ws => ws.name);
        throw new Error(
          `Sheet "Details of dlivery Fee" not found. Available sheets: ${availableSheets.join(', ')}`
        );
      }
      
      const jsonData = [];
      worksheet.eachRow((row, rowNumber) => {
        // Skip header row (rowNumber === 1)
        if (rowNumber > 1) {
          jsonData.push(row.values.slice(1)); 
        }
      });
      
      console.log(`Total data rows found: ${jsonData.length}`);
      
      if (jsonData.length === 0) {
        throw new Error('No data rows found in the Excel file');
      }

      // Map to accumulate aggregated data across batches
      const aggregatedData = new Map();
      let totalProcessed = 0;
      let totalSkipped = 0;
      let batchCount = 0;

      // Process in batches
      for (let i = 0; i < jsonData.length; i += batchSize) {
        batchCount++;
        const batch = jsonData.slice(i, i + batchSize);
        console.log(
          `Processing batch ${batchCount} (rows ${i + 1} to ${Math.min(i + batchSize, jsonData.length)})`
        );

        for (let rowIndex = 0; rowIndex < batch.length; rowIndex++) {
          const row = batch[rowIndex];
          
          try {
            // Extract fields (adjust indices to match your Excel structure)
            const regionRoute = (row[6] || '').toString().trim();
            const courier = (row[8] || '').toString().trim();
            const deliveryId = parseInt(row[9]) || null;
            const signingTime = (row[12] || '').toString().trim();
            const structuredAddress = (row[13] || '').toString().trim();
            const stopPointDetails = (row[18] || '').toString().trim();

            // Debug first few rows
            if (totalProcessed + totalSkipped < 3) {
              console.log(`Sample row ${totalProcessed + totalSkipped + 1}:`, {
                regionRoute,
                courier,
                deliveryId,
                signingTime,
                structuredAddress,
                stopPointDetails
              });
            }

            // Validation
            if (!deliveryId || !signingTime) {
              console.log(
                `Batch ${batchCount}, Row ${rowIndex + 1}: Skipping - Missing required fields`
              );
              totalSkipped++;
              continue;
            }

            // Parse and validate date
            const isValidDate = 
              moment(signingTime, 'MM/DD/YYYY HH:mm:ss', true).isValid() || 
              moment(signingTime, 'MM/DD/YYYY', true).isValid();
              
            if (!isValidDate) {
              console.log(
                `Batch ${batchCount}, Row ${rowIndex + 1}: Skipping - Invalid date: "${signingTime}"`
              );
              totalSkipped++;
              continue;
            }
            
            const delDate = moment(signingTime, ['MM/DD/YYYY HH:mm:ss', 'MM/DD/YYYY'])
              .format('YYYY-MM-DD');

            // Determine address
            const address = structuredAddress.toUpperCase() || stopPointDetails;
            if (!address) {
              console.log(
                `Batch ${batchCount}, Row ${rowIndex + 1}: Skipping - No address found`
              );
              totalSkipped++;
              continue;
            }

            // Create unique key and aggregate
            const key = `${delDate}-${deliveryId}-${regionRoute}`;
            
            if (!aggregatedData.has(key)) {
              aggregatedData.set(key, {
                courier_name: courier,
                driver_id: deliveryId,
                del_route: regionRoute,
                del_date: delDate,
                total_deliveries: 0,
                fs: 0,
                ds: 0,
                addresses: new Map(),
              });
            }

            const entry = aggregatedData.get(key);
            entry.total_deliveries++;
            
            if (!entry.addresses.has(address)) {
              entry.addresses.set(address, 0);
              entry.fs++;
            } else {
              entry.ds++;
            }

            totalProcessed++;
            
          } catch (rowError) {
            console.error(
              `Batch ${batchCount}, Row ${rowIndex + 1}: Error -`,
              rowError.message
            );
            totalSkipped++;
            continue;
          }
        }
        
        console.log(
          `Batch ${batchCount} completed. Processed: ${totalProcessed}, Skipped: ${totalSkipped}`
        );
      }

      console.log(
        `\nFinal Summary - Total rows: ${jsonData.length}, ` +
        `Processed: ${totalProcessed}, Skipped: ${totalSkipped}, ` +
        `Aggregated groups: ${aggregatedData.size}`
      );

      // Prepare and insert into database
      let tableName = "weeklycount";
      await WeeklyExcelQueries.deleteWeeklyTableIfExists(tableName);
      await WeeklyExcelQueries.createWeeklyTable(tableName);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        let insertCount = 0;
        for (const [key, data] of aggregatedData) {
          const { courier_name, driver_id, del_route, del_date, total_deliveries, fs, ds } = data;
          
          await client.query(
            `INSERT INTO weeklycount (courier_name, driver_id, del_route, total_deliveries, fs, ds, del_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (driver_id, del_date, del_route)
             DO UPDATE SET
               total_deliveries = weeklycount.total_deliveries + EXCLUDED.total_deliveries,
               fs = weeklycount.fs + EXCLUDED.fs,
               ds = weeklycount.ds + EXCLUDED.ds`,
            [courier_name, driver_id, del_route, total_deliveries, fs, ds, del_date]
          );
          insertCount++;
        }
        
        await client.query('COMMIT');
        console.log(`Database: ${insertCount} records inserted/updated successfully`);
        
        return {
          success: true,
          recordsProcessed: totalProcessed,
          recordsSkipped: totalSkipped,
          recordsInserted: insertCount
        };
        
      } catch (dbError) {
        await client.query('ROLLBACK');
        console.error('Database Error:', dbError);
        throw dbError;
      } finally {
        client.release();
      }
    }

    // Process the Excel file from buffer
    const result = await processExcelFromBuffer(file.buffer, 500);
    
    res.status(200).json({
      success: true,
      message: 'Upload and processing completed successfully',
      data: result
    });

  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message
    });
  }
};


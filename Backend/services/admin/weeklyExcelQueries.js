import pool from "../../config/db.js";

        export const WeeklyExcelQueries={
            fetchDashboardDataByDates : async(dates)=>{
                const selectQuery=`SELECT 
            dd.id AS dashboard_id,
            dd.journey_date,
            d.name,
            r.name AS route_name, 
            dd.start_seq,
            dd.end_seq,
            dd.packages,
            dd.delivered,
            dd.ds,
            dd.no_scanned,
            dd.failed_attempt
        FROM dashboard_data dd
        JOIN drivers d ON dd.driver_id = d.id
        JOIN routes r ON dd.route_id = r.id
        WHERE journey_date = ANY($1)`        
        const res= await pool.query(selectQuery,[dates]);
        return res.rows;
            },

        createWeeklyTable:async(table_name)=>{
        try {
            await pool.query(`
                        CREATE TABLE ${table_name} (
                          id SERIAL PRIMARY KEY,
                          courier_name VARCHAR(100) NOT NULL,
                          driver_id INT NOT NULL,
                          del_route VARCHAR(100),
                          total_deliveries INT DEFAULT 0,
                          fs INT DEFAULT 0,
                          ds INT DEFAULT 0,
                          del_date DATE NOT NULL,
                          CONSTRAINT weeklycount_unique UNIQUE (driver_id, del_date, del_route)
                      );
                    `);
          
            } catch (error) {
            console.error("❌ Error creating table:", error);
            }
        },

        deleteWeeklyTableIfExists: async (table_name) => {
        try {
      await pool.query(`
                DROP TABLE IF EXISTS ${table_name}
            `);

    } catch (error) {
      console.error(error);
    }
  },



  insertBatchDatafromExcel:async(insertPlaceholders,insertValues)=>{

    let insertQuery=`
    INSERT INTO weekly_excel_data
    (orig_name, match_name, date, deliveries, fullStop, doubleStop, route, start_seq,end_seq, ambiguous,failedAttempt)
    VALUES ${insertPlaceholders.join(",")}
    RETURNING *`;

   let res=await pool.query(insertQuery ,insertValues);
   return res.rows;
  },

getWeeklyData: async (id,role,limit,offset) => {
  try {
    // Check if table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'weeklycount'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      return { exists: false, data: [] };
    }


    
    let query = `SELECT wc.* FROM weeklycount wc`;
const values = [];

if (role === 'admin') {
  query += `
    WHERE EXISTS (
      SELECT 1
      FROM routes r
      JOIN city c ON c.job = r.job
      JOIN admin_city_ref acr ON acr.city_id = c.id
      WHERE r.route_code_in_string = wc.del_route
        AND acr.admin_id = $1)`;
  values.push(id);
}

query += `
  ORDER BY del_date DESC
  LIMIT $${values.length + 1}
  OFFSET $${values.length + 2}
`;

values.push(limit, offset);

const res = await pool.query(query, values);  
    
    return { exists: true, data: res.rows };
    
  } catch (error) {
    console.error('Error fetching weekly data:', error);
    throw error;
  }
},

getCountOfWeeklyData: async (id,role) => {
  try {
    // Check if table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'weeklycount'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      return 0;
    }
    
    let query=` SELECT COUNT(*)::int AS total
      FROM weeklycount wc`

    let values=[];
    
    if(role==='admin'){
      query+=`
      WHERE EXISTS (
        SELECT 1
        FROM routes r
        JOIN city c ON c.job = r.job
        JOIN admin_city_ref acr ON acr.city_id = c.id
        WHERE r.route_code_in_string = wc.del_route
          AND acr.admin_id = $1) `
      values.push(id);
    }    
    const res = await pool.query(query,values);   
    
    return Number(res.rows[0].total);
    
  } catch (error) {
    console.error('Error fetching weekly data:', error);
    throw error;
  }
},

  UpdateWeeklyTempToDashboard : async()=>{
         const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const tempData = await WeeklyExcelQueries.getWeeklyData();
    
    if (!tempData.exists || tempData.data.length === 0) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        message: 'No weekly data found to process' 
      };
    }
    
    // Dashboard update
    const dashboardUpdate = await client.query(`
      WITH matched_weekly AS (
        SELECT 
          we.match_name,
          we.date as journey_date,
          we.deliveries,
          we.fullstop,
          we.doublestop,
          we.route,
          we.start_seq,
          we.end_seq,
          we.no_scanned,
          we.failedattempt,
          d.id as driver_id,
          r.id as route_id
        FROM weekly_excel_data we
        INNER JOIN drivers d ON d.name = we.match_name
        INNER JOIN routes r ON r.name = we.route
      )
      UPDATE dashboard_data dd
      SET 
        packages = mw.deliveries,
        no_scanned = COALESCE(mw.no_scanned, 0),
        failed_attempt = COALESCE(mw.failedattempt, 0),
        ds = COALESCE(mw.doublestop, 0),
        delivered = COALESCE(mw.fullstop, 0) + COALESCE(mw.doublestop, 0),
        start_seq = mw.start_seq,
        end_seq = mw.end_seq,
        first_stop = COALESCE(mw.fullstop, 0)
      FROM matched_weekly mw
      WHERE dd.driver_id = mw.driver_id 
        AND dd.journey_date = mw.journey_date
        AND dd.route_id = mw.route_id
        AND dd.closed = false
        AND dd.paid = false
      RETURNING dd.id, dd.driver_id, dd.journey_date, dd.route_id, 
                dd.packages, dd.no_scanned, dd.failed_attempt, 
                dd.ds, dd.delivered, dd.first_stop
    `);
    
    if (dashboardUpdate.rows.length === 0) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        message: 'No matching open records found in dashboard_data to update' 
      };
    }
    
    // Payment update
    const paymentUpdate = await client.query(`
      UPDATE payment_dashboard pd
      SET 
        packages = dd.packages,
        no_scanned = COALESCE(dd.no_scanned, 0),
        failed_attempt = COALESCE(dd.failed_attempt, 0),
        ds = COALESCE(dd.ds, 0),
        fs = COALESCE(dd.first_stop, 0),
        delivered = COALESCE(dd.ds, 0) + COALESCE(dd.first_stop, 0),
        start_seq = dd.start_seq,
        end_seq = dd.end_seq,
        first_stop = dd.first_stop,
        driver_payment = ROUND(
          (COALESCE(dd.ds, 0) * COALESCE(r.driver_doublestop_price, 0)) + 
          (COALESCE(dd.first_stop, 0) * COALESCE(r.company_route_price, 0)),
          2
        )
      FROM dashboard_data dd
      JOIN routes r ON dd.route_id = r.id
      WHERE pd.dashboard_data_id = dd.id
        AND pd.paid = false
        AND pd.closed = false
        AND EXISTS (
          SELECT 1 FROM weekly_excel_data we
          INNER JOIN drivers d ON d.name = we.match_name
          WHERE dd.driver_id = d.id 
            AND dd.journey_date = we.date
        )
      RETURNING pd.id, pd.driver_id, pd.journey_date, pd.driver_payment, pd.dashboard_data_id
    `);
    
    await client.query('COMMIT');
    
    return {
      success: true,
      message: 'Data updated successfully',
    //   dashboardRecords: dashboardUpdate.rows.length,
    //   paymentRecords: paymentUpdate.rows.length,
      updatedDashboard: dashboardUpdate.rows,
      updatedPayments: paymentUpdate.rows
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating dashboard from weekly data:', error);
    throw error;
  } finally {
    client.release();
  }
     },

     processWeeklyData: async () => {
  try {
    // Step 1: Update dashboards and payments
    const result = await WeeklyExcelQueries.UpdateWeeklyTempToDashboard();
    
    if (!result.success) {
      return result;
    }
    
    // Step 2: Delete weekly temp data after successful update
    await WeeklyExcelQueries.deleteWeeklyData();
    
    return {
      ...result,
      message: 'Weekly data processed and cleared successfully'
    };
    
  } catch (error) {
    console.error('Error processing weekly data:', error);
    throw error;
  }
},

// Delete weekly data after successful update
deleteWeeklyData: async () => {
  try {
    await pool.query('DROP TABLE IF EXISTS weekly_excel_data CASCADE');
    return { success: true, message: 'Weekly data cleared' };
  } catch (error) {
    console.error('Error deleting weekly data:', error);
    throw error;
  }
},



  

createEntriesFromWeeklyCount: async () => {
  console.log("⏳ Starting dashboard_data insertion...");
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    

    //QUERY 1: Insert into dashboard_data (triggers the function)
    const insertQuery = `
          INSERT INTO dashboard_data (
        driver_id,
        journey_date,
        route_id,
        packages,
        first_stop,
        ds,
        delivered,
        driver_payment,
        company_earnings,
        closed,
        paid,
        is_deliveries_count_added
      )
      SELECT
        d.id AS driver_id,
        wc.del_date AS journey_date,
        r.id AS route_id,
        wc.total_deliveries AS packages,
        wc.fs AS first_stop,
        wc.ds AS ds,
        wc.total_deliveries AS delivered,
        ((wc.fs * r.driver_route_price) +
        (wc.ds * r.driver_doublestop_price)) AS driver_payment,
       ((wc.fs *( r.company_route_price-r.driver_route_price)) +
        (wc.ds * (r.company_doublestop_price-r.driver_doublestop_price))) AS company_earnings,
        TRUE,
        FALSE,
        FALSE
      FROM weeklycount wc
      INNER JOIN drivers d
        ON wc.driver_id = d.driver_code
      INNER JOIN routes r
        ON wc.del_route = r.route_code_in_string
      AND r.enabled = TRUE
      WHERE d.enabled = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM dashboard_data dd
        WHERE dd.driver_id = d.id
          AND dd.journey_date = wc.del_date
          AND dd.route_id = r.id
      )
      RETURNING id;
`

    const insertResult = await client.query(insertQuery);
    const insertedIds = insertResult.rows.map(row => row.id);



    // QUERY 2: Update payment_dashboard with business logic
    // Only update the newly inserted records
    const updateQuery = `
      UPDATE payment_dashboard pd
      SET 
        packages = dd.packages,
        fs = dd.first_stop,
        ds = dd.ds,
        delivered = dd.delivered,
        driver_payment = dd.driver_payment,
        company_earnings=dd.company_earnings,
        closed = dd.closed,
        paid = dd.paid
      FROM dashboard_data dd
      WHERE pd.dashboard_data_id = dd.id
        AND dd.id = ANY($1)
      RETURNING pd.id
    `;

    const updateResult = await client.query(updateQuery, [insertedIds]);

    // QUERY 3: Apply insurance deduction ($1.92 per driver per working day)
    // A driver should only be charged $1.92 ONCE per day, regardless of how many
    // routes they drive on that day (e.g. GOFO 9 + GOFO 39 = still only $1.92).
    // 
    // Step 3a: Zero out insurance on ALL rows for the affected driver-days
    //          (covers both old and newly inserted rows for those days).
    // Step 3b: Apply $1.92 to exactly ONE row per driver-day (lowest pd.id).
    const INSURANCE_RATE_PER_DAY = 1.92;

    // 3a: Find all affected (driver_id, journey_date) pairs from the new batch
    //     and reset insurance_deduction to 0 for ALL rows matching those pairs.
    const resetInsuranceQuery = `
      UPDATE payment_dashboard pd
      SET insurance_deduction = 0
      WHERE (pd.driver_id, pd.journey_date) IN (
        SELECT pd2.driver_id, pd2.journey_date
        FROM payment_dashboard pd2
        WHERE pd2.dashboard_data_id = ANY($1)
      )
      AND pd.insurance_deduction != 0
    `;
    await client.query(resetInsuranceQuery, [insertedIds]);

    // 3b: Now apply $1.92 to exactly ONE row per (driver_id, journey_date)
    //     across ALL records for those driver-days (not just the new batch).
    const insuranceQuery = `
      UPDATE payment_dashboard pd
      SET insurance_deduction = $1
      WHERE pd.id IN (
        SELECT DISTINCT ON (all_pd.driver_id, all_pd.journey_date)
          all_pd.id
        FROM payment_dashboard all_pd
        WHERE (all_pd.driver_id, all_pd.journey_date) IN (
          SELECT pd2.driver_id, pd2.journey_date
          FROM payment_dashboard pd2
          WHERE pd2.dashboard_data_id = ANY($2)
        )
        ORDER BY all_pd.driver_id, all_pd.journey_date, all_pd.id
      )
    `;

    const insuranceResult = await client.query(insuranceQuery, [INSURANCE_RATE_PER_DAY, insertedIds]);
    console.log(`🛡️ Insurance deduction applied to ${insuranceResult.rowCount} driver-day(s) at $${INSURANCE_RATE_PER_DAY}/day`);

    await client.query('COMMIT');

    return {
      inserted: insertResult.rowCount,
      updated: updateResult.rowCount,
      insuranceApplied: insuranceResult.rowCount,
      totalAffected: insertResult.rowCount
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ Error in createEntriesFromWeeklyCount:", err);
    throw err;
  } finally {
    client.release();
  }
},
  
}
import pool from "../../config/db.js";

export const ExcelFileQueries = {
  createDailyTable: async (tableName, client) => {
    try {
      await client.query(`
        CREATE TABLE ${tableName}(
          id SERIAL PRIMARY KEY,
          route TEXT,
          sequence INT,
          address TEXT,
          unit TEXT,
          zipcode INT,
          tracking_no TEXT,
          recipient_name TEXT,
          recipient_phone TEXT,
          status TEXT,
          complete_time TIMESTAMP,
          seq_route_code TEXT,
          upload_date DATE
        )
      `);
      console.log(`✅ Table ${tableName} created successfully`);
    } catch (error) {
      console.error("❌ Error creating table:", error);
      throw error;
    }
  },

  insertDataIntoDailyTable: async (tableName, data, client) => {
    try {
      if (!data || data.length === 0) {
        console.log("⚠️ No data to insert");
        return;
      }

      const values = [];
      const placeholders = [];

      data.forEach((row, i) => {
        const idx = i * 12;

        placeholders.push(
          `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5},
            $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9},
            $${idx + 10}, $${idx + 11}, $${idx + 12})`
        );

        const routeModified = row.Route ? row.Route.substring(4) : null;
        const dateFromRoute = `${new Date().getFullYear()}-${row.Route[0]}${row.Route[1]}-${row.Route[2]}${row.Route[3]}`;

        values.push(
          row.Route,
          row.Sequence,
          row.Address,
          row.Unit || null,
          Number(row.ZipCode),
          row.TrackingNo,
          row.RecipientName,
          row.RecipientPhone,
          row.Status,
          row.CompleteTime ? new Date(row.CompleteTime) : null,
          `${row.Sequence}${routeModified}`,
          new Date(dateFromRoute)
        );
      });

      const query = `
        INSERT INTO ${tableName} (
          route, sequence, address, unit, zipcode,
          tracking_no, recipient_name, recipient_phone,
          status, complete_time, seq_route_code, upload_date
        ) VALUES ${placeholders.join(",")}
      `;

      await client.query(query, values);
      console.log(`✅ Inserted ${data.length} rows into ${tableName}`);
    } catch (error) {
      console.error("❌ Error inserting daily data:", error);
      throw error;
    }
  },

  deleteIfTableAlreadyExists: async (tableName, client) => {
    try {
      await client.query(`DROP TABLE IF EXISTS ${tableName}`);
      console.log(`✅ Table ${tableName} deleted`);
    } catch (error) {
      console.error(error);
      throw error;
    }
  },

  // 🔴 FIXED: MERGE MUST BE SCOPED BY upload_date == driver_set_date
  mergeDeliveriesAndExcelData: async (client) => {
    try {
      await client.query(`
        UPDATE deliveries d
        SET
          address = e.address,
          address_unit = e.unit,
          zip_code = e.zipcode,
          courier_code = e.tracking_no,
          recp_name = e.recipient_name,
          recipient_phone = e.recipient_phone,
          status = e.status
        FROM todays_excel_data e
        WHERE d.seq_route_code = e.seq_route_code
          AND DATE(d.driver_set_date) = DATE(e.upload_date);
      `);
      console.log("✅ Deliveries merged with Excel data");
    } catch (error) {
      throw error;
    }
  },

  // 🔴 FIXED: only update untouched rows
  setUntouchedRowsAsNoScannedAndUpdateFailedAttempt: async (client) => {
    try {
      const queryStr = `
        UPDATE deliveries
        SET final_result = CASE
          WHEN status = 'FAILED_ATTEMPT' THEN 'failed_attempt'
          WHEN status = 'Pending'
            AND address = 'No_Address'
            AND recp_name = 'Unknown Recipient'
          THEN 'no_scanned'
          WHEN status = 'NEW' THEN 'no_scanned'
          ELSE final_result
        END
        WHERE final_result = 'not_assigned';
      `;
      await client.query(queryStr);
      console.log("✅ Updated no_scanned and failed_attempt");
    } catch (error) {
      throw error;
    }
  },

  // 🔴 FIXED: COUNTS BASED ON dashboard_data (route + seq range)
  addEachDriversCount: async (client) => {
    try {
      const queryStr = `
        UPDATE dashboard_data d
        SET
          no_scanned = sub.no_scanned_count,
          failed_attempt = sub.failed_attempt_count,
          ds = sub.double_stop_count,
          first_stop = sub.first_stop_count,
          delivered = sub.first_stop_count + sub.double_stop_count,
          is_deliveries_count_added = true
        FROM (
          SELECT
            d2.id AS dashboard_id,
            COUNT(*) FILTER (WHERE del.final_result = 'no_scanned')      AS no_scanned_count,
            COUNT(*) FILTER (WHERE del.final_result = 'failed_attempt') AS failed_attempt_count,
            COUNT(*) FILTER (WHERE del.final_result = 'first_stop')     AS first_stop_count,
            COUNT(*) FILTER (WHERE del.final_result = 'double_stop')    AS double_stop_count
          FROM dashboard_data d2
          JOIN deliveries del
            ON del.driver_id = d2.driver_id
           AND del.route_id = d2.route_id
           AND del.sequence_number BETWEEN d2.start_seq AND d2.end_seq
           AND DATE(del.driver_set_date) = DATE(d2.journey_date)
          WHERE d2.is_deliveries_count_added = false
          GROUP BY d2.id
        ) sub
        WHERE d.id = sub.dashboard_id;
      `;
      await client.query(queryStr);
    } catch (error) {
      console.error(error);
      throw error;
    }
  },

  getTempDashboardData: async (client, id, role) => {
    try {
      let query = `
        SELECT
          d.name,
          dd.journey_date,
          r.name AS route,
          dd.start_seq || ' - ' || dd.end_seq AS sequence,
          dd.packages,
          dd.no_scanned,
          dd.failed_attempt,
          dd.ds,
          dd.delivered
        FROM dashboard_data dd
        JOIN routes r ON dd.route_id = r.id
        JOIN drivers d ON d.id = dd.driver_id
        WHERE dd.journey_date BETWEEN CURRENT_DATE - INTERVAL '1 day'
                                AND CURRENT_DATE
      `;

      const params = [];

      if (role === "admin") {
        query += `
          AND EXISTS (
            SELECT 1
            FROM admin_city_ref acr
            WHERE acr.city_id = d.city_id
              AND acr.admin_id = $1
          )
        `;
        params.push(id);
      }

      query += ` ORDER BY dd.journey_date DESC`;

      const res = await client.query(query, params);
      return res.rows;
    } catch (error) {
      console.error(error);
      throw error;
    }
  },

  // 🔴 FIXED: Double stop logic must include route & date
  updateFirstStopAndDoubleStop: async (client) => {
  try {
    const queryStr = `
      WITH ranked AS (
        SELECT
          unique_id,
          driver_id,
          route_id,
          driver_set_date,
          address,
          address_unit,
          ROW_NUMBER() OVER (
            PARTITION BY driver_id, route_id, driver_set_date,
                         address, COALESCE(address_unit, '##NO_UNIT##')
            ORDER BY sequence_number
          ) AS rn,
          COUNT(*) OVER (
            PARTITION BY driver_id, route_id, driver_set_date,
                         address, COALESCE(address_unit, '##NO_UNIT##')
          ) AS cnt
        FROM deliveries
        WHERE final_result = 'not_assigned'::final_result_enum
      )
      UPDATE deliveries d
      SET final_result = CASE
        WHEN r.cnt = 1 THEN 'first_stop'::final_result_enum
        WHEN r.rn = 1 THEN 'first_stop'::final_result_enum
        ELSE 'double_stop'::final_result_enum
      END
      FROM ranked r
      WHERE d.unique_id = r.unique_id;
    `;

    await client.query(queryStr);
    console.log("✅ First stop & double stop updated");
  } catch (error) {
    console.error(error);
    throw error;
  }
},
resetDeliveryResults: async (client) => {
  await client.query(`
    UPDATE deliveries
    SET final_result = 'not_assigned'
    WHERE DATE(driver_set_date) IN (
      SELECT journey_date FROM dashboard_data
    )
  `);
},


};

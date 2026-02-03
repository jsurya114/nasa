import pool from "../../config/db.js";

export const AdminDashboardQueries = {
  // Update payment table for a specific date only
  updatePaymentTableForDate: async (selectedDate) => {
    try {
      const queryStr = `
        UPDATE payment_dashboard pd
        SET 
            no_scanned = dd.no_scanned,
            failed_attempt = dd.failed_attempt,
            closed = true,
            ds = dd.ds,
            fs = dd.first_stop,
            delivered = dd.ds + dd.first_stop,
            driver_payment = (dd.ds * r.driver_doublestop_price) + (dd.first_stop * r.driver_route_price),
            company_earnings = (dd.ds * r.company_doublestop_price)+ (dd.first_stop * r.company_route_price)
        FROM dashboard_data dd
        JOIN routes r ON dd.route_id = r.id
        WHERE pd.dashboard_data_id = dd.id
          AND pd.journey_date = $1::date;
      `;
      const result = await pool.query(queryStr, [selectedDate]);

      return result;
    } catch (error) {
      console.error("Error in updatePaymentTableForDate:", error);
      throw error;
    }
  },

  updatePaymentTable: async () => {
    try {
      const queryStr = `
        UPDATE payment_dashboard pd
        SET 
            no_scanned = dd.no_scanned,
            failed_attempt = dd.failed_attempt,
            closed = true,
            ds = dd.ds,
            fs = dd.first_stop,
            delivered = dd.ds + dd.first_stop,
            driver_payment = (dd.ds * r.driver_doublestop_price) + (dd.first_stop * r.driver_route_price),
            company_earnings = (dd.ds * r.company_doublestop_price)+ (dd.first_stop * r.company_route_price)
        FROM dashboard_data dd
        JOIN routes r ON dd.route_id = r.id
        WHERE pd.dashboard_data_id = dd.id;
      `;
      await pool.query(queryStr);
    } catch (error) {
      console.error("Error in updatePaymentTable:", error);
      throw error;
    }
  },

  // ✅ Get summary data for all matching records (not paginated)
  // Modified: Join via route's job for historical driver data and apply city_type rules
  getSummaryData: async (filters = {}, id, role) => {
    try {
      const baseQuery = `
        SELECT 
          COALESCE(SUM(pd.packages), 0) AS total_packages,
          COALESCE(SUM(pd.no_scanned), 0) AS total_no_scanned,
          COALESCE(SUM(pd.failed_attempt), 0) AS total_failed_attempt,
          COALESCE(SUM(pd.fs), 0) AS total_fs,
          COALESCE(SUM(pd.ds), 0) AS total_ds,
          COALESCE(SUM(pd.delivered), 0) AS total_delivered,
          COALESCE(SUM(pd.driver_payment), 0) AS total_driver_payment,
          COALESCE(SUM(pd.company_earnings), 0) AS total_company_earnings
        FROM payment_dashboard pd
        JOIN drivers d ON d.id = pd.driver_id
        LEFT JOIN routes r ON pd.route_id = r.id
        LEFT JOIN city c ON r.job = c.job
        WHERE 1 = 1
      `;

      const whereClauses = [];
      const queryParams = [];

      // Filter by route's city (historical) and apply city_type rules
      if (filters.job) {
        whereClauses.push(`c.job = $${queryParams.length + 1}`);
        queryParams.push(filters.job);
        // Auto-apply city_type filtering: DAILY = seq != 0, WEEKLY = seq = 0
        whereClauses.push(`(
          CASE 
            WHEN c.city_type = 'DAILY' THEN pd.start_seq != 0 AND pd.end_seq != 0
            WHEN c.city_type = 'WEEKLY' THEN pd.start_seq = 0 AND pd.end_seq = 0
            ELSE TRUE
          END
        )`);
      }

      if (filters.driver) {
        whereClauses.push(`d.name = $${queryParams.length + 1}`);
        queryParams.push(filters.driver);
      }

      if (filters.route) {
        whereClauses.push(`r.name = $${queryParams.length + 1}`);
        queryParams.push(filters.route);
      }

      if (filters.startDate) {
        whereClauses.push(`pd.journey_date >= $${queryParams.length + 1}::date`);
        queryParams.push(filters.startDate);
      }

      if (filters.endDate) {
        whereClauses.push(`pd.journey_date <= $${queryParams.length + 1}::date`);
        queryParams.push(filters.endDate);
      }

      if (filters.paymentStatus) {
        const isPaid = filters.paymentStatus.toLowerCase() === "paid";
        whereClauses.push(`pd.paid = $${queryParams.length + 1}`);
        queryParams.push(isPaid);
      }

      // Filter by data type
      if (filters.dataType && filters.dataType !== "all") {
        whereClauses.push(`
          CASE 
            WHEN pd.start_seq IS NULL OR pd.end_seq IS NULL 
                 OR pd.start_seq = 0 OR pd.end_seq = 0 
            THEN 'weekly' 
            ELSE 'daily' 
          END = $${queryParams.length + 1}
        `);
        queryParams.push(filters.dataType);
      }

      if (role === "admin") {
        whereClauses.push(`
          EXISTS (
            SELECT 1
            FROM admin_city_ref acr
            WHERE acr.city_id = c.id
              AND acr.admin_id = $${queryParams.length + 1}
          )
        `);
        queryParams.push(id);
      }

      let finalQuery = baseQuery;

      if (whereClauses.length > 0) {
        finalQuery += " AND " + whereClauses.join(" AND ");
      }

      const result = await pool.query(finalQuery, queryParams);
      return result.rows[0];
    } catch (error) {
      console.error("Error in getSummaryData:", error);
      throw error;
    }
  },

  // Modified: Join via route's job for historical driver data and apply city_type rules
  getPaymentDashboardCount: async (filters = {}, id, role) => {
    try {
      const baseQuery = `
        SELECT COUNT(*) as total
        FROM payment_dashboard pd
        JOIN drivers d ON d.id = pd.driver_id
        LEFT JOIN routes r ON pd.route_id = r.id
        LEFT JOIN city c ON r.job = c.job
        WHERE 1 = 1
      `;

      const whereClauses = [];
      const queryParams = [];

      // Filter by route's city (historical) and apply city_type rules
      if (filters.job) {
        whereClauses.push(`c.job = $${queryParams.length + 1}`);
        queryParams.push(filters.job);
        // Auto-apply city_type filtering: DAILY = seq != 0, WEEKLY = seq = 0
        whereClauses.push(`(
          CASE 
            WHEN c.city_type = 'DAILY' THEN pd.start_seq != 0 AND pd.end_seq != 0
            WHEN c.city_type = 'WEEKLY' THEN pd.start_seq = 0 AND pd.end_seq = 0
            ELSE TRUE
          END
        )`);
      }

      if (filters.driver) {
        whereClauses.push(`d.name = $${queryParams.length + 1}`);
        queryParams.push(filters.driver);
      }

      if (filters.route) {
        whereClauses.push(`r.name = $${queryParams.length + 1}`);
        queryParams.push(filters.route);
      }

      if (filters.startDate) {
        whereClauses.push(`pd.journey_date >= $${queryParams.length + 1}::date`);
        queryParams.push(filters.startDate);
      }

      if (filters.endDate) {
        whereClauses.push(`pd.journey_date <= $${queryParams.length + 1}::date`);
        queryParams.push(filters.endDate);
      }

      if (filters.paymentStatus) {
        const isPaid = filters.paymentStatus.toLowerCase() === "paid";
        whereClauses.push(`pd.paid = $${queryParams.length + 1}`);
        queryParams.push(isPaid);
      }

      // Filter by data type
      if (filters.dataType && filters.dataType !== "all") {
        whereClauses.push(`
          CASE 
            WHEN pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0 
            THEN 'weekly' 
            ELSE 'daily' 
          END = $${queryParams.length + 1}
        `);
        queryParams.push(filters.dataType);
      }

      if (role === "admin") {
        whereClauses.push(`
          EXISTS (
            SELECT 1
            FROM admin_city_ref acr
            WHERE acr.city_id = c.id
              AND acr.admin_id = $${queryParams.length + 1}
          )
        `);
        queryParams.push(id);
      }

      let finalQuery = baseQuery;

      if (whereClauses.length > 0) {
        finalQuery += " AND " + whereClauses.join(" AND ");
      }

      const result = await pool.query(finalQuery, queryParams);
      return parseInt(result.rows[0].total);
    } catch (error) {
      console.error("Error in getPaymentDashboardCount:", error);
      throw error;
    }
  },

  // Modified: Join via route's job for historical driver data and apply city_type rules
  getPaymentDashboardPaginated: async (filters = {}, id, role, limit = 10, offset = 0) => {
    try {
      // Conditionally include company_earnings based on role
      const companyEarningsField = role === "superadmin" ? "pd.company_earnings," : "";

      const baseQuery = `
        SELECT 
          pd.id, 
          pd.dashboard_data_id, 
          pd.driver_id,
          d.name AS driver_name, 
          pd.journey_date, 
          pd.route_id,
          r.name AS route_name,
          c.job,
          pd.packages, 
          pd.no_scanned, 
          pd.failed_attempt,
          pd.fs,
          pd.ds, 
          pd.delivered, 
          pd.closed, 
          pd.payment_date,
          pd.driver_payment, 
          ${companyEarningsField}
          pd.paid,
          pd.start_seq,
          pd.end_seq, 
          pd.first_stop,
          CASE 
            WHEN pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0 
            THEN 'weekly' 
            ELSE 'daily' 
          END AS data_type
        FROM payment_dashboard pd
        JOIN drivers d ON d.id = pd.driver_id
        LEFT JOIN routes r ON pd.route_id = r.id
        LEFT JOIN city c ON r.job = c.job
        WHERE 1 = 1
      `;

      const whereClauses = [];
      const queryParams = [];

      // Filter by route's city (historical) and apply city_type rules
      if (filters.job) {
        whereClauses.push(`c.job = $${queryParams.length + 1}`);
        queryParams.push(filters.job);
        // Auto-apply city_type filtering: DAILY = seq != 0, WEEKLY = seq = 0
        whereClauses.push(`(
          CASE 
            WHEN c.city_type = 'DAILY' THEN pd.start_seq != 0 AND pd.end_seq != 0
            WHEN c.city_type = 'WEEKLY' THEN pd.start_seq = 0 AND pd.end_seq = 0
            ELSE TRUE
          END
        )`);
      }

      if (filters.driver) {
        whereClauses.push(`d.name = $${queryParams.length + 1}`);
        queryParams.push(filters.driver);
      }

      if (filters.route) {
        whereClauses.push(`r.name = $${queryParams.length + 1}`);
        queryParams.push(filters.route);
      }

      if (filters.startDate) {
        whereClauses.push(`pd.journey_date >= $${queryParams.length + 1}::date`);
        queryParams.push(filters.startDate);
      }

      if (filters.endDate) {
        whereClauses.push(`pd.journey_date <= $${queryParams.length + 1}::date`);
        queryParams.push(filters.endDate);
      }

      if (filters.paymentStatus) {
        const isPaid = filters.paymentStatus.toLowerCase() === "paid";
        whereClauses.push(`pd.paid = $${queryParams.length + 1}`);
        queryParams.push(isPaid);
      }

      // Filter by data type
      if (filters.dataType && filters.dataType !== "all") {
        whereClauses.push(`
          CASE 
            WHEN pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0 
            THEN 'weekly' 
            ELSE 'daily' 
          END = $${queryParams.length + 1}
        `);
        queryParams.push(filters.dataType);
      }

      if (role === "admin") {
        whereClauses.push(`
          EXISTS (
            SELECT 1
            FROM admin_city_ref acr
            WHERE acr.city_id = c.id
              AND acr.admin_id = $${queryParams.length + 1}
          )
        `);
        queryParams.push(id);
      }

      let finalQuery = baseQuery;

      if (whereClauses.length > 0) {
        finalQuery += " AND " + whereClauses.join(" AND ");
      }

      finalQuery += " ORDER BY r.name, pd.journey_date DESC, pd.start_seq";
      finalQuery += ` LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;

      queryParams.push(limit, offset);

      const result = await pool.query(finalQuery, queryParams);
      return result.rows;
    } catch (error) {
      console.error("Error in getPaymentDashboardPaginated:", error);
      throw error;
    }
  },

  // Modified: Join via route's job for historical driver data and apply city_type rules
  PaymentDashboardTable: async (filters = {}, id, role) => {
    try {
      // Conditionally include company_earnings based on role
      const companyEarningsField = role === "superadmin" ? "pd.company_earnings," : "";

      const baseQuery = `
        SELECT 
          pd.id, 
          pd.dashboard_data_id, 
          pd.driver_id,
          d.name AS driver_name, 
          pd.journey_date, 
          pd.route_id,
          r.name AS route_name,
          c.job,
          pd.packages, 
          pd.no_scanned, 
          pd.failed_attempt,
          pd.fs,
          pd.ds, 
          pd.delivered, 
          pd.closed, 
          pd.payment_date,
          pd.driver_payment,
          ${companyEarningsField}
          pd.paid,
          pd.start_seq,
          pd.end_seq, 
          pd.first_stop,
          CASE 
            WHEN pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0 
            THEN 'weekly' 
            ELSE 'daily' 
          END AS data_type
        FROM payment_dashboard pd
        JOIN drivers d ON d.id = pd.driver_id
        LEFT JOIN routes r ON pd.route_id = r.id
        LEFT JOIN city c ON r.job = c.job
        WHERE 1 = 1
      `;

      const whereClauses = [];
      const queryParams = [];

      // Filter by route's city (historical) and apply city_type rules
      if (filters.job) {
        whereClauses.push(`c.job = $${queryParams.length + 1}`);
        queryParams.push(filters.job);
        // Auto-apply city_type filtering: DAILY = seq != 0, WEEKLY = seq = 0
        whereClauses.push(`(
          CASE 
            WHEN c.city_type = 'DAILY' THEN pd.start_seq != 0 AND pd.end_seq != 0
            WHEN c.city_type = 'WEEKLY' THEN pd.start_seq = 0 AND pd.end_seq = 0
            ELSE TRUE
          END
        )`);
      }

      if (filters.driver) {
        whereClauses.push(`d.name = $${queryParams.length + 1}`);
        queryParams.push(filters.driver);
      }

      if (filters.route) {
        whereClauses.push(`r.name = $${queryParams.length + 1}`);
        queryParams.push(filters.route);
      }

      if (filters.startDate) {
        whereClauses.push(`pd.journey_date >= $${queryParams.length + 1}::date`);
        queryParams.push(filters.startDate);
      }

      if (filters.endDate) {
        whereClauses.push(`pd.journey_date <= $${queryParams.length + 1}::date`);
        queryParams.push(filters.endDate);
      }

      if (filters.paymentStatus) {
        const isPaid = filters.paymentStatus.toLowerCase() === "paid";
        whereClauses.push(`pd.paid = $${queryParams.length + 1}`);
        queryParams.push(isPaid);
      }

      // Filter by data type
      if (filters.dataType && filters.dataType !== "all") {
        whereClauses.push(`
          CASE 
            WHEN pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0 
            THEN 'weekly' 
            ELSE 'daily' 
          END = $${queryParams.length + 1}
        `);
        queryParams.push(filters.dataType);
      }

      if (role === "admin") {
        whereClauses.push(`
          EXISTS (
            SELECT 1
            FROM admin_city_ref acr
            WHERE acr.city_id = c.id
              AND acr.admin_id = $${queryParams.length + 1}
          )
        `);
        queryParams.push(id);
      }

      let finalQuery = baseQuery;

      if (whereClauses.length > 0) {
        finalQuery += " AND " + whereClauses.join(" AND ");
      }

      finalQuery += " ORDER BY r.name, pd.journey_date DESC, pd.start_seq;";

      const result = await pool.query(finalQuery, queryParams);
      return result.rows;
    } catch (error) {
      console.error("Error in PaymentDashboardTable:", error);
      throw error;
    }
  },

  // ✅ UPDATED: Only pay journeys with closed = true, with optional dataType filter
  updateDriverPaymentStatus: async (driverName, startDate, endDate, dataType = null) => {
    try {
      const whereClauses = [];
      const queryParams = [driverName];

      // Driver name filter
      whereClauses.push(`d.name = $1`);

      // Date filters
      if (startDate) {
        whereClauses.push(`pd.journey_date >= $${queryParams.length + 1}::date`);
        queryParams.push(startDate);
      }

      if (endDate) {
        whereClauses.push(`pd.journey_date <= $${queryParams.length + 1}::date`);
        queryParams.push(endDate);
      }

      // ✅ NEW: Data type filter for separate daily/weekly payments
      if (dataType === 'daily') {
        // Daily: start_seq and end_seq are both non-zero
        whereClauses.push(`(pd.start_seq IS NOT NULL AND pd.end_seq IS NOT NULL AND pd.start_seq != 0 AND pd.end_seq != 0)`);
      } else if (dataType === 'weekly') {
        // Weekly: start_seq or end_seq is null or zero
        whereClauses.push(`(pd.start_seq IS NULL OR pd.end_seq IS NULL OR pd.start_seq = 0 OR pd.end_seq = 0)`);
      }

      // ✅ CRITICAL: Build the complete UPDATE query with closed status check
      const updateQuery = `
        UPDATE payment_dashboard pd
        SET 
          paid = true,
          payment_date = CURRENT_DATE
        FROM drivers d
        WHERE pd.driver_id = d.id
          AND ${whereClauses.join(' AND ')}
          AND pd.closed = true
          AND pd.paid = false;
      `;

      console.log("Executing payment update query:", updateQuery);
      console.log("With params:", queryParams);

      const result = await pool.query(updateQuery, queryParams);

      console.log(`Updated ${result.rowCount} records to paid status`);

      return result;
    } catch (error) {
      console.error("Error in updateDriverPaymentStatus:", error);
      throw error;
    }
  },
};
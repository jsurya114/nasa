import pool from "../../config/db.js";

export const AnalyticsQueries = {
  getDailyAnalytics: async (client, userId, role, selectedDate) => {
    try {
      // 🔥 UPDATED: Now shows individual sequences instead of ranges
      let query = `
        SELECT
          d.name AS driver_name,
          r.name AS route,
          del.sequence_number AS sequence,
          COUNT(*) FILTER (WHERE del.final_result = 'no_scanned') AS no_scanned,
          COUNT(*) FILTER (WHERE del.final_result = 'double_stop') AS double_stop,
          COUNT(*) FILTER (WHERE del.final_result = 'failed_attempt') AS failed_attempt
        FROM deliveries del
        JOIN drivers d ON del.driver_id = d.id
        JOIN routes r ON del.route_id = r.id
        WHERE DATE(del.driver_set_date) = $1
          AND del.final_result IN ('no_scanned', 'double_stop', 'failed_attempt')
      `;

      const params = [selectedDate];

      // Role-based filtering (admin can only see their cities)
      if (role === "admin") {
        query += `
          AND EXISTS (
            SELECT 1
            FROM admin_city_ref acr
            WHERE acr.city_id = d.city_id
              AND acr.admin_id = $2
          )
        `;
        params.push(userId);
      }

      query += `
        GROUP BY d.name, r.name, del.sequence_number
        HAVING COUNT(*) FILTER (WHERE del.final_result IN ('no_scanned', 'double_stop', 'failed_attempt')) > 0
        ORDER BY d.name, r.name, del.sequence_number
      `;

      const result = await client.query(query, params);
      return result.rows;
    } catch (error) {
      console.error("Error fetching daily analytics:", error);
      throw error;
    }
  },

  getWeeklyAnalytics: async (client, userId, role, selectedDate) => {
    try {
      // Check if weeklycount table exists
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'weeklycount'
        )
      `);

      if (!tableExists.rows[0].exists) {
        return [];
      }

      let query = `
        SELECT
          wc.courier_name AS driver_name,
          wc.del_route AS route,
          '' AS sequence,
          0 AS no_scanned,
          COALESCE(wc.ds, 0) AS double_stop,
          0 AS failed_attempt
        FROM weeklycount wc
        INNER JOIN drivers d ON wc.driver_id = d.driver_code
        WHERE wc.del_date = $1
          AND (wc.fs > 0 OR wc.ds > 0)
      `;

      const params = [selectedDate];

      // Role-based filtering
      if (role === "admin") {
        query += `
          AND EXISTS (
            SELECT 1
            FROM admin_city_ref acr
            WHERE acr.city_id = d.city_id
              AND acr.admin_id = $2
          )
        `;
        params.push(userId);
      }

      query += ` ORDER BY wc.courier_name, wc.del_route`;

      const result = await client.query(query, params);
      return result.rows;
    } catch (error) {
      console.error("Error fetching weekly analytics:", error);
      throw error;
    }
  },

  // Alternative: Get analytics from deliveries table directly (more detailed)
  getDailyAnalyticsFromDeliveries: async (client, userId, role, selectedDate) => {
    try {
      let query = `
        SELECT
          d.name AS driver_name,
          r.name AS route,
          del.sequence_number AS sequence,
          COUNT(*) FILTER (WHERE del.final_result = 'no_scanned') AS no_scanned,
          COUNT(*) FILTER (WHERE del.final_result = 'double_stop') AS double_stop,
          COUNT(*) FILTER (WHERE del.final_result = 'failed_attempt') AS failed_attempt
        FROM deliveries del
        JOIN drivers d ON del.driver_id = d.id
        JOIN routes r ON del.route_id = r.id
        WHERE DATE(del.driver_set_date) = $1
        `;

      const params = [selectedDate];

      if (role === "admin") {
        query += `
          AND EXISTS (
            SELECT 1
            FROM admin_city_ref acr
            WHERE acr.city_id = d.city_id
              AND acr.admin_id = $2
          )
        `;
        params.push(userId);
      }

      query += `
        GROUP BY d.name, r.name, del.sequence_number
        HAVING COUNT(*) FILTER (WHERE del.final_result IN ('no_scanned', 'double_stop', 'failed_attempt')) > 0
        ORDER BY d.name, r.name, del.sequence_number
      `;

      const result = await client.query(query, params);
      return result.rows;
    } catch (error) {
      console.error("Error fetching detailed analytics:", error);
      throw error;
    }
  },
};
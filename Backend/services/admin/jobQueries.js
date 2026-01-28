import pool from "../../config/db.js"

export const jobService = {
  getCityByJob: async (job) => {
    const result = await pool.query(
      "SELECT id FROM city WHERE job = $1 AND enabled = true",
      [job]
    );

    if (result.rows.length === 0) {
      throw new Error(`City with job "${job}" not found or is disabled`);
    }

    return result.rows[0].id;
  },

  getCity: async () => {
    const result = await pool.query(
      "SELECT id, job, city_code, enabled, city_type FROM city ORDER BY id ASC"
    )
    return result.rows
  },

  addcity: async (job, city_code, city_type = 'DAILY') => {
    const result = await pool.query(
      "INSERT INTO city (job, city_code, enabled, city_type) VALUES ($1, $2, true, $3) RETURNING *",
      [job, city_code, city_type]
    )
    return result.rows[0]
  },

  updateCity: async (id, job, city_code, city_type) => {
    console.log('updateCity called with:', { id, job, city_code, city_type });
    
    let query, params;
    
    if (city_type !== undefined && city_type !== null) {
      query = "UPDATE city SET job = $1, city_code = $2, city_type = $3 WHERE id = $4 RETURNING *";
      params = [job, city_code, city_type, id];
    } else {
      query = "UPDATE city SET job = $1, city_code = $2 WHERE id = $3 RETURNING *";
      params = [job, city_code, id];
    }
    
    console.log('Executing query:', query, 'with params:', params);
    const result = await pool.query(query, params);
    console.log('Update result:', result.rows[0]);
    
    return result.rows[0];
  },

  deleteCity: async (id) => {
    const result = await pool.query(
      "DELETE FROM city WHERE id = $1 RETURNING *", 
      [id]
    )
    return result.rows[0]
  },

  cityStatus: async (id) => {
    const city = await pool.query("SELECT enabled FROM city WHERE id = $1", [id]);
    if (city.rows.length === 0) return null;
    const newStatus = !city.rows[0].enabled;

    const result = await pool.query(
      "UPDATE city SET enabled = $1 WHERE id = $2 RETURNING *",
      [newStatus, id]
    );
    return result.rows[0];
  },

  jobPagination: async (page, limit, search = "", statusFilter = "all", isSuperAdmin = false, adminId = null) => {
    try {
      const offset = (page - 1) * limit;

      let whereConditions = [];
      let paramIndex = 1;
      let queryParams = [];

      // Admin city filter
      if (!isSuperAdmin && adminId) {
        whereConditions.push(`city.id IN (SELECT city_id FROM admin_city_ref WHERE admin_id = $${paramIndex})`);
        queryParams.push(adminId);
        paramIndex++;
      }

      // Search filter
      if (search) {
        whereConditions.push(`(job ILIKE $${paramIndex} OR city_code ILIKE $${paramIndex})`);
        queryParams.push(`%${search}%`);
        paramIndex++;
      }

      // Status filter
      if (isSuperAdmin) {
        if (statusFilter === "enabled") {
          whereConditions.push(`enabled = true`);
        } else if (statusFilter === "disabled") {
          whereConditions.push(`enabled = false`);
        }
      } else {
        whereConditions.push(`enabled = true`);
      }

      const whereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';

      const jobsQuery = `
        SELECT id, job, city_code, enabled, city_type 
        FROM city
        ${whereClause}
        ORDER BY id ASC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      const values = [...queryParams, limit, offset];

      const countQuery = `
        SELECT COUNT(*) FROM city
        ${whereClause}
      `;

      const jobs = await pool.query(jobsQuery, values);
      const total = await pool.query(countQuery, queryParams);

      return {
        jobs: jobs.rows,
        total: parseInt(total.rows[0].count),
      };
    } catch (error) {
      console.error("jobPagination error:", error.message);
      throw error;
    }
  },

  getTotalCities: async () => {
    try {
      const cities = await pool.query(
        `SELECT id, job, city_type FROM city WHERE enabled = true ORDER BY id ASC`
      );
      return cities.rows;
    } catch (error) {
      console.error("GETTING CITIES ERROR:", error.message);
      throw error;
    }
  },

  // New: Get city type by driver ID
  getCityTypeByDriverId: async (driverId) => {
    try {
      const result = await pool.query(
        `SELECT c.city_type 
         FROM drivers d
         JOIN city c ON d.city_id = c.id
         WHERE d.id = $1`,
        [driverId]
      );
      
      if (result.rows.length === 0) {
        throw new Error(`Driver with ID ${driverId} not found`);
      }
      
      return result.rows[0].city_type;
    } catch (error) {
      console.error("getCityTypeByDriverId error:", error.message);
      throw error;
    }
  },
}
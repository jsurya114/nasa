import pool from "../../config/db.js";

// Insert route with job and price validation
export const insertRoute = async (data) => {
  const {
    name,
    job,
    company_route_price,
    driver_route_price,
    company_doublestop_price,
    driver_doublestop_price,
    route_code_in_string,
    enabled,
  } = data;

  // Validate job exists in city table
  const jobCheck = await pool.query("SELECT job FROM city WHERE job = $1", [job]);
  if (jobCheck.rows.length === 0) {
    throw new Error(`Job '${job}' does not exist in city table`);
  }

  // Validate price fields
  const prices = {
    company_route_price: parseFloat(company_route_price),
    driver_route_price: parseFloat(driver_route_price),
    company_doublestop_price: parseFloat(company_doublestop_price),
    driver_doublestop_price: parseFloat(driver_doublestop_price),
  };
  for (const [key, value] of Object.entries(prices)) {
    if (isNaN(value) || value == null) {
      throw new Error(`Invalid or missing value for ${key}`);
    }
  }


  const result = await pool.query(
    `INSERT INTO routes 
      (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string, enabled) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      name,
      job,
      prices.company_route_price,
      prices.driver_route_price,
      prices.company_doublestop_price,
      prices.driver_doublestop_price,
      route_code_in_string,
      enabled,
    ]
  );


  return result.rows[0];
};

// Get all routes - for superadmin
export const getAllRoutes = async () => {
  const result = await pool.query("SELECT * FROM routes ORDER BY id ASC");
  return result.rows;
};

// Get routes for specific admin based on assigned cities
export const getRoutesForAdmin = async (adminId) => {

  const result = await pool.query(`
    SELECT DISTINCT r.* 
    FROM routes r
    INNER JOIN city c ON r.job = c.job
    INNER JOIN admin_city_ref acr ON c.id = acr.city_id
    WHERE acr.admin_id = $1
      AND c.enabled = true
    ORDER BY r.id ASC
  `, [adminId]);


  return result.rows;
};

export const getAllRoutesOfDriver = async (id) => {
  const result = await pool.query(`
    SELECT
      r.id,
      r.name,
      r.job,
      r.company_route_price,
      r.driver_route_price,
      r.company_doublestop_price,
      r.driver_doublestop_price,
      r.route_code_in_string,
      r.enabled
    FROM drivers d
    JOIN driver_city_ref dcr ON d.id = dcr.driver_id
    JOIN city c ON c.id = dcr.city_id
    JOIN routes r ON r.job = c.job
    WHERE d.id = $1
      AND d.enabled = true
      AND r.enabled = true
      AND c.city_type = 'DAILY';
  `, [id]);
  return result.rows;
};

// Get route by ID
export const getRouteByIdQuery = async (id) => {
  const result = await pool.query("SELECT * FROM routes WHERE id = $1", [id]);
  return result.rows[0];
};

// Update route with job and price validation
export const updateRouteQuery = async (id, data) => {
  const {
    name,
    job,
    company_route_price,
    driver_route_price,
    company_doublestop_price,
    driver_doublestop_price,
    route_code_in_string,
    enabled,
  } = data;

  // Validate job exists in city table
  const jobCheck = await pool.query("SELECT job FROM city WHERE job = $1", [job]);
  if (jobCheck.rows.length === 0) {
    throw new Error(`Job '${job}' does not exist in city table`);
  }

  // Validate price fields
  const prices = {
    company_route_price: parseFloat(company_route_price),
    driver_route_price: parseFloat(driver_route_price),
    company_doublestop_price: parseFloat(company_doublestop_price),
    driver_doublestop_price: parseFloat(driver_doublestop_price),
  };
  for (const [key, value] of Object.entries(prices)) {
    if (isNaN(value) || value == null) {
      throw new Error(`Invalid or missing value for ${key}`);
    }
  }


  const result = await pool.query(
    `UPDATE routes 
     SET name=$1, job=$2, company_route_price=$3, driver_route_price=$4, 
        company_doublestop_price=$5, driver_doublestop_price=$6, enabled=$7, route_code_in_string=$8 
     WHERE id=$9 RETURNING *`,
    [
      name,
      job,
      prices.company_route_price,
      prices.driver_route_price,
      prices.company_doublestop_price,
      prices.driver_doublestop_price,
      enabled,
      route_code_in_string,
      id,
    ]
  );


  return result.rows[0];
};

// Toggle route status
export const toggleRouteStatusQuery = async (id) => {

  const route = await getRouteByIdQuery(id);
  if (!route) {

    return null;
  }
  const result = await pool.query(
    "UPDATE routes SET enabled = NOT enabled WHERE id=$1 RETURNING *",
    [id]
  );

  return result.rows[0];
};

// Delete route
export const deleteRouteQuery = async (id) => {

  const result = await pool.query("DELETE FROM routes WHERE id=$1 RETURNING *", [id]);

  return result.rows[0];
};

// ✅ ENHANCED: Paginated routes with city filter
export const routePagination = async (page, limit, search = "", cityFilter = "", isSuperAdmin = false, adminId = null) => {
  try {
    const offset = (page - 1) * limit;
    let routeQuery;
    let countQuery;
    let values;

    if (isSuperAdmin) {
      // Superadmin sees all routes
      if (search && cityFilter) {
        // Both search and city filter
        routeQuery = `
          SELECT * FROM routes
          WHERE (job ILIKE $1 OR name ILIKE $1)
            AND job = $2
          ORDER BY id ASC
          LIMIT $3 OFFSET $4`;
        values = [`%${search}%`, cityFilter, limit, offset];
        countQuery = `
          SELECT COUNT(*) FROM routes
          WHERE (job ILIKE $1 OR name ILIKE $1)
            AND job = $2`;
      } else if (search) {
        // Only search
        routeQuery = `
          SELECT * FROM routes
          WHERE job ILIKE $1 OR name ILIKE $1
          ORDER BY id ASC
          LIMIT $2 OFFSET $3`;
        values = [`%${search}%`, limit, offset];
        countQuery = `
          SELECT COUNT(*) FROM routes
          WHERE job ILIKE $1 OR name ILIKE $1`;
      } else if (cityFilter) {
        // Only city filter
        routeQuery = `
          SELECT * FROM routes
          WHERE job = $1
          ORDER BY id ASC
          LIMIT $2 OFFSET $3`;
        values = [cityFilter, limit, offset];
        countQuery = `
          SELECT COUNT(*) FROM routes
          WHERE job = $1`;
      } else {
        // No filters
        routeQuery = `
          SELECT * FROM routes
          ORDER BY id ASC
          LIMIT $1 OFFSET $2`;
        values = [limit, offset];
        countQuery = `SELECT COUNT(*) FROM routes`;
      }
    } else {
      // Normal admin sees only routes for their assigned cities
      if (search && cityFilter) {
        // Both search and city filter
        routeQuery = `
          SELECT DISTINCT r.* 
          FROM routes r
          INNER JOIN city c ON r.job = c.job
          INNER JOIN admin_city_ref acr ON c.id = acr.city_id
          WHERE acr.admin_id = $1
            AND (r.job ILIKE $2 OR r.name ILIKE $2)
            AND r.job = $3
            AND r.enabled = true
            AND c.enabled = true
          ORDER BY r.id ASC
          LIMIT $4 OFFSET $5`;
        values = [adminId, `%${search}%`, cityFilter, limit, offset];
        countQuery = `
          SELECT COUNT(DISTINCT r.id) 
          FROM routes r
          INNER JOIN city c ON r.job = c.job
          INNER JOIN admin_city_ref acr ON c.id = acr.city_id
          WHERE acr.admin_id = $1
            AND (r.job ILIKE $2 OR r.name ILIKE $2)
            AND r.job = $3
            AND r.enabled = true
            AND c.enabled = true`;
      } else if (search) {
        // Only search
        routeQuery = `
          SELECT DISTINCT r.* 
          FROM routes r
          INNER JOIN city c ON r.job = c.job
          INNER JOIN admin_city_ref acr ON c.id = acr.city_id
          WHERE acr.admin_id = $1
            AND (r.job ILIKE $2 OR r.name ILIKE $2)
            AND r.enabled = true
            AND c.enabled = true
          ORDER BY r.id ASC
          LIMIT $3 OFFSET $4`;
        values = [adminId, `%${search}%`, limit, offset];
        countQuery = `
          SELECT COUNT(DISTINCT r.id) 
          FROM routes r
          INNER JOIN city c ON r.job = c.job
          INNER JOIN admin_city_ref acr ON c.id = acr.city_id
          WHERE acr.admin_id = $1
            AND (r.job ILIKE $2 OR r.name ILIKE $2)
            AND r.enabled = true
            AND c.enabled = true`;
      } else if (cityFilter) {
        // Only city filter
        routeQuery = `
          SELECT DISTINCT r.* 
          FROM routes r
          INNER JOIN city c ON r.job = c.job
          INNER JOIN admin_city_ref acr ON c.id = acr.city_id
          WHERE acr.admin_id = $1
            AND r.job = $2
            AND r.enabled = true
            AND c.enabled = true
          ORDER BY r.id ASC
          LIMIT $3 OFFSET $4`;
        values = [adminId, cityFilter, limit, offset];
        countQuery = `
          SELECT COUNT(DISTINCT r.id) 
          FROM routes r
          INNER JOIN city c ON r.job = c.job
          INNER JOIN admin_city_ref acr ON c.id = acr.city_id
          WHERE acr.admin_id = $1
            AND r.job = $2
            AND r.enabled = true
            AND c.enabled = true`;
      } else {
        // No filters
        routeQuery = `
          SELECT DISTINCT r.* 
          FROM routes r
          INNER JOIN city c ON r.job = c.job
          INNER JOIN admin_city_ref acr ON c.id = acr.city_id
          WHERE acr.admin_id = $1
            AND r.enabled = true
            AND c.enabled = true
          ORDER BY r.id ASC
          LIMIT $2 OFFSET $3`;
        values = [adminId, limit, offset];
        countQuery = `
          SELECT COUNT(DISTINCT r.id) 
          FROM routes r
          INNER JOIN city c ON r.job = c.job
          INNER JOIN admin_city_ref acr ON c.id = acr.city_id
          WHERE acr.admin_id = $1
            AND r.enabled = true
            AND c.enabled = true`;
      }
    }

    const routes = await pool.query(routeQuery, values);

    // Build count query values based on filters
    let countValues;
    if (isSuperAdmin) {
      if (search && cityFilter) {
        countValues = [`%${search}%`, cityFilter];
      } else if (search) {
        countValues = [`%${search}%`];
      } else if (cityFilter) {
        countValues = [cityFilter];
      } else {
        countValues = [];
      }
    } else {
      if (search && cityFilter) {
        countValues = [adminId, `%${search}%`, cityFilter];
      } else if (search) {
        countValues = [adminId, `%${search}%`];
      } else if (cityFilter) {
        countValues = [adminId, cityFilter];
      } else {
        countValues = [adminId];
      }
    }

    const total = await pool.query(countQuery, countValues);

    return {
      routes: routes.rows,
      total: parseInt(total.rows[0].count)
    };
  } catch (error) {
    console.error("routePagination error:", error.message);
    console.error("Stack:", error.stack);
    throw error;
  }
};

export const getRoutesByDriverCity = async (driverId) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT r.* 
      FROM routes r
      INNER JOIN city c ON r.job = c.job
      INNER JOIN driver_city_ref dcr ON c.id = dcr.city_id
      WHERE dcr.driver_id = $1
        AND r.enabled = true
        AND c.enabled = true
        AND c.city_type = 'DAILY'
      ORDER BY r.id ASC
    `, [driverId]);


    return result.rows;
  } catch (error) {
    console.error("getRoutesByDriverCity error:", error.message);
    throw error;
  }
};
import pool from "../../config/db.js";

export const availabilityService = {
  // Driver: get own availability
  getDriverAvailability: async (driverId) => {
    const result = await pool.query(
      `SELECT
        monday,
        tuesday,
        wednesday,
        thursday,
        friday,
        saturday,
        sunday,
        availability_updated_at
       FROM drivers
       WHERE id = $1`,
      [driverId]
    );

    if (result.rows.length === 0) {
      throw new Error("Driver not found");
    }

    return {
      availability: {
        monday: result.rows[0].monday,
        tuesday: result.rows[0].tuesday,
        wednesday: result.rows[0].wednesday,
        thursday: result.rows[0].thursday,
        friday: result.rows[0].friday,
        saturday: result.rows[0].saturday,
        sunday: result.rows[0].sunday
      },
      availability_updated_at: result.rows[0].availability_updated_at
    };
  },

  // Driver: update own availability
  updateDriverAvailability: async (driverId, availability) => {
    const result = await pool.query(
      `UPDATE drivers
       SET
        monday = $2,
        tuesday = $3,
        wednesday = $4,
        thursday = $5,
        friday = $6,
        saturday = $7,
        sunday = $8,
        availability_updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING
        monday, tuesday, wednesday, thursday,
        friday, saturday, sunday, availability_updated_at`,
      [
        driverId,
        availability.monday,
        availability.tuesday,
        availability.wednesday,
        availability.thursday,
        availability.friday,
        availability.saturday,
        availability.sunday
      ]
    );

    return {
      availability: {
        monday: result.rows[0].monday,
        tuesday: result.rows[0].tuesday,
        wednesday: result.rows[0].wednesday,
        thursday: result.rows[0].thursday,
        friday: result.rows[0].friday,
        saturday: result.rows[0].saturday,
        sunday: result.rows[0].sunday
      },
      availability_updated_at: result.rows[0].availability_updated_at
    };
  },

  // Admin: get all drivers availability with pagination
  getAllDriversAvailability: async (page = 1, limit = 10, filterDay = null) => {
    const offset = (page - 1) * limit;

    // Build WHERE clause for day filter
    let whereClause = '';
    if (filterDay) {
      whereClause = `WHERE d.${filterDay} = true`;
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM drivers d
      JOIN city c ON d.city_id = c.id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery);
    const totalRecords = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalRecords / limit);

    // Get paginated data
    const dataQuery = `
      SELECT
        d.id,
        d.driver_code,
        d.name,
        d.email,
        d.enabled,
        c.job AS city,
        d.monday,
        d.tuesday,
        d.wednesday,
        d.thursday,
        d.friday,
        d.saturday,
        d.sunday,
        d.availability_updated_at
       FROM drivers d
       JOIN city c ON d.city_id = c.id
       ${whereClause}
       ORDER BY d.name
       LIMIT $1 OFFSET $2
    `;
    
    const result = await pool.query(dataQuery, [limit, offset]);

    const data = result.rows.map(row => ({
      id: row.id,
      driver_code: row.driver_code,
      name: row.name,
      email: row.email,
      city: row.city,
      enabled: row.enabled,
      availability: {
        monday: row.monday,
        tuesday: row.tuesday,
        wednesday: row.wednesday,
        thursday: row.thursday,
        friday: row.friday,
        saturday: row.saturday,
        sunday: row.sunday
      },
      availability_updated_at: row.availability_updated_at
    }));

    return {
      data,
      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    };
  },

  // Admin: filter drivers by day (deprecated - use getAllDriversAvailability with filterDay)
  getDriversByDay: async (day) => {
    const result = await pool.query(
      `SELECT
        d.id,
        d.driver_code,
        d.name,
        d.email,
        d.enabled,
        c.job AS city,
        d.monday,
        d.tuesday,
        d.wednesday,
        d.thursday,
        d.friday,
        d.saturday,
        d.sunday,
        d.availability_updated_at
       FROM drivers d
       JOIN city c ON d.city_id = c.id
       WHERE d.${day} = true
       ORDER BY d.name`
    );

    return result.rows.map(row => ({
      id: row.id,
      driver_code: row.driver_code,
      name: row.name,
      email: row.email,
      city: row.city,
      enabled: row.enabled,
      availability: {
        monday: row.monday,
        tuesday: row.tuesday,
        wednesday: row.wednesday,
        thursday: row.thursday,
        friday: row.friday,
        saturday: row.saturday,
        sunday: row.sunday
      },
      availability_updated_at: row.availability_updated_at
    }));
  }
};
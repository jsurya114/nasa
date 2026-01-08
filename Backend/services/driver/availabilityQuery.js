import pool from "../../config/db.js";

const VALID_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
];

export const availabilityService = {
  // Driver: get own availability
  getDriverAvailability: async (driverId) => {
    const result = await pool.query(
      `
      SELECT
        monday,
        tuesday,
        wednesday,
        thursday,
        friday,
        saturday,
        sunday,
        availability_updated_at
      FROM drivers
      WHERE id = $1
      `,
      [driverId]
    );

    if (result.rows.length === 0) {
      throw new Error("Driver not found");
    }

    const row = result.rows[0];

    return {
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
    };
  },

  // Driver: update own availability
  updateDriverAvailability: async (driverId, availability) => {
    const result = await pool.query(
      `
      UPDATE drivers
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
        friday, saturday, sunday, availability_updated_at
      `,
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

    if (result.rows.length === 0) {
      throw new Error("Driver not found");
    }

    const row = result.rows[0];

    return {
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
    };
  },

  // Admin: get all drivers availability
  getAllDriversAvailability: async (
    page = 1,
    limit = 10,
    filterDay = null,
    adminId,
    adminRole,
    searchQuery = ""
  ) => {
    const offset = (page - 1) * limit;
    const searchPattern = searchQuery ? `${searchQuery}%` : "%";

    const dayCondition =
      filterDay && VALID_DAYS.includes(filterDay)
        ? `AND d.${filterDay} = true`
        : "";

    /* ================= COUNT QUERY ================= */
    let countQuery = `
      SELECT COUNT(*) AS total
      FROM drivers d
      JOIN city c ON d.city_id = c.id
    `;

    let countParams = [];

    if (adminRole === "admin") {
      countQuery += `
        JOIN admin_city_ref acr ON acr.city_id = c.id
        WHERE acr.admin_id = $1
        ${dayCondition}
        AND d.name ILIKE $2
      `;
      countParams = [adminId, searchPattern];
    } else if (adminRole === "superadmin") {
      countQuery += `
        WHERE 1=1
        ${dayCondition}
        AND d.name ILIKE $1
      `;
      countParams = [searchPattern];
    } else {
      throw new Error("Unauthorized role");
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalRecords = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(totalRecords / limit);

    /* ================= DATA QUERY ================= */
    let dataQuery = `
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
    `;

    let params = [];

    if (adminRole === "admin") {
      dataQuery += `
        JOIN admin_city_ref acr ON acr.city_id = c.id
        WHERE acr.admin_id = $1
        ${dayCondition}
        AND d.name ILIKE $2
        ORDER BY d.name
        LIMIT $3 OFFSET $4
      `;
      params = [adminId, searchPattern, limit, offset];
    } else {
      dataQuery += `
        WHERE 1=1
        ${dayCondition}
        AND d.name ILIKE $1
        ORDER BY d.name
        LIMIT $2 OFFSET $3
      `;
      params = [searchPattern, limit, offset];
    }

    const result = await pool.query(dataQuery, params);

    const data = result.rows.map((row) => ({
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

  // Admin: update specific driver's availability
  updateDriverAvailabilityByAdmin: async (
    driverId,
    availability,
    adminId,
    adminRole
  ) => {
    let accessQuery;
    let accessParams;

    if (adminRole === "admin") {
      accessQuery = `
        SELECT d.id
        FROM drivers d
        JOIN city c ON d.city_id = c.id
        JOIN admin_city_ref acr ON acr.city_id = c.id
        WHERE d.id = $1 AND acr.admin_id = $2
      `;
      accessParams = [driverId, adminId];
    } else if (adminRole === "superadmin") {
      accessQuery = `
        SELECT id
        FROM drivers
        WHERE id = $1
      `;
      accessParams = [driverId];
    } else {
      throw new Error("Unauthorized role");
    }

    const accessResult = await pool.query(accessQuery, accessParams);

    if (accessResult.rows.length === 0) {
      throw new Error("Driver not found or access denied");
    }

    const result = await pool.query(
      `
      UPDATE drivers
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
        id, name,
        monday, tuesday, wednesday, thursday,
        friday, saturday, sunday,
        availability_updated_at
      `,
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

    const row = result.rows[0];

    return {
      id: row.id,
      name: row.name,
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
    };
  }
};

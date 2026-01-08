import pool from "../../config/db.js";

export const getAllCities = async () => {
  const result = await pool.query(`SELECT * FROM city ORDER BY job ASC`);
  return result.rows;
};

export const getAllDrivers = async () => {
  const result = await pool.query(`SELECT * FROM drivers ORDER BY name ASC`);
  return result.rows;
};

export const getAllRoutes = async () => {
  const result = await pool.query(`SELECT * FROM routes ORDER BY name ASC`);
  return result.rows;
};

export const getAllottedCities = async (id) => {
  const result = await pool.query(
    `SELECT c.id as id, c.job, c.city_code, acr.admin_id 
     FROM city c
     JOIN admin_city_ref acr ON c.id = acr.city_id 
     WHERE acr.admin_id = $1 `,
    [id]
  );
  return result.rows;
}

export const getAllottedDrivers = async (id) => {
  const result = await pool.query(
    `SELECT 
      d.id,
      d.name,
      d.enabled,
      c.job AS city
    FROM drivers d
    JOIN city c ON c.id = d.city_id
    JOIN admin_city_ref acr ON acr.city_id = c.id
    WHERE acr.admin_id = $1
      `,
    [id]
  );
  return result.rows;
}

export const getAllottedRoutes = async (id) => {
  const result = await pool.query(
    `SELECT 
      r.id,
      r.name,
      r.enabled,
      c.job AS city
    FROM routes r
    JOIN city c ON c.job = r.job
    JOIN admin_city_ref acr ON acr.city_id = c.id
    WHERE acr.admin_id = $1
    `,
    [id]
  );
  return result.rows;
}
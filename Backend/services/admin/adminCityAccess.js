import pool from "../../config/db.js";

// Rules: a super admin may work on every city. Any other role may work only on the cities listed
// for them in admin_city_ref. An action that names a city outside that list is refused.

const SUPER_ADMIN = "superadmin";

export class CityAccessError extends Error {
  constructor(message) {
    super(message);
    this.name = "CityAccessError";
  }
}

export const isCityLimited = (role) => role !== SUPER_ADMIN;

// City names (city.job) assigned to this admin.
export const getAllowedJobs = async (adminId, db = pool) => {
  const result = await db.query(
    `SELECT c.job
       FROM admin_city_ref acr
       JOIN city c ON c.id = acr.city_id
      WHERE acr.admin_id = $1`,
    [adminId]
  );
  return result.rows.map((row) => row.job);
};

export const assertJobsAllowed = (jobs, allowedJobs, message) => {
  if (jobs.some((job) => !allowedJobs.includes(job))) {
    throw new CityAccessError(message);
  }
};

// Cities the already-staged weekly rows belong to.
export const getWeeklyStagingJobs = async (db = pool) => {
  const result = await db.query(
    `SELECT DISTINCT r.job
       FROM weeklycount wc
       JOIN routes r ON r.route_code_in_string = wc.del_route`
  );
  return result.rows.map((row) => row.job);
};

// Cities a weekly file would touch, from the route codes found in the file.
export const getJobsForRouteCodes = async (routeCodes, db = pool) => {
  if (routeCodes.length === 0) return [];
  const result = await db.query(
    "SELECT DISTINCT job FROM routes WHERE route_code_in_string = ANY($1::text[])",
    [routeCodes]
  );
  return result.rows.map((row) => row.job);
};

// Cities whose delivery rows a daily file would update (same match the upload itself uses).
export const getDailyStagingJobs = async (db) => {
  const result = await db.query(
    `SELECT DISTINCT r.job
       FROM todays_excel_data e
       JOIN deliveries d
         ON d.seq_route_code = e.seq_route_code
        AND DATE(d.driver_set_date) = DATE(e.upload_date)
       JOIN routes r ON r.id = d.route_id`
  );
  return result.rows.map((row) => row.job);
};

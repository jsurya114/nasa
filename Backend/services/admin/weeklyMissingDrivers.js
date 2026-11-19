import logger from '../../utils/logger.js';
import { getJobsForRouteCodes } from './adminCityAccess.js';

export const MISSING_LIST_LIMIT = 200;

// After a weekly upload: the enabled drivers of the cities the file covers whose driver code (the file's Delivery ID) is not in the file. The cities come from the
// route codes in the file, so a city admin, who may upload only files for their own cities, only ever sees drivers of those cities. This is a warning only: it
// runs after the upload is stored, never changes what was stored, and a failure here is reported as "not checked", never as an upload error.
export const findMissingDrivers = async (db, { driverCodes, routeCodes }) => {
  try {
    const codes = [...new Set((driverCodes ?? []).filter(Number.isSafeInteger))];
    const cities = (await getJobsForRouteCodes((routeCodes ?? []).filter(Boolean), db)).sort();
    if (cities.length === 0) return { checked: true, cities: [], total: 0, shown: 0, drivers: [] };
    const { rows } = await db.query(
      `SELECT d.id, d.name, d.driver_code, c.job AS city, count(*) OVER ()::int AS total
         FROM drivers d JOIN city c ON c.id = d.city_id
        WHERE d.enabled AND c.job = ANY($1::text[]) AND NOT COALESCE(d.driver_code = ANY($2::int[]), false)
        ORDER BY c.job, d.name, d.id LIMIT $3`,
      [cities, codes, MISSING_LIST_LIMIT]);
    return {
      checked: true,
      cities,
      total: rows[0]?.total ?? 0,
      shown: rows.length,
      drivers: rows.map((r) => ({ driverId: r.id, name: r.name, driverCode: r.driver_code, city: r.city })),
    };
  } catch (error) {
    logger.warn('Missing drivers could not be checked after a weekly upload', { reason: String(error?.message ?? error).slice(0, 120) });
    return { checked: false };
  }
};

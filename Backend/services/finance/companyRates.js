// The company price fields on a route (issue #252). For daily SpeedX they stay: revenue is the stored company price figure. For a weekly GOFO city the
// carrier's statement is the revenue, so once a city has a verified (published) statement its routes no longer take company prices. This is the one place
// that says what "no company rate" means in SQL and which cities have retired the fields.

const UNDEFINED_TABLE = '42P01';

// True for a route of a WEEKLY city with no company rate configured (both company prices 0). Its revenue cannot be worked out from prices, so nothing is
// estimated for it: a new record gets no company figure, and recalculating an old record keeps the figure it already has.
export const noCompanyRateSql = (route, city) => `(${city}.city_type = 'WEEKLY' AND ${route}.company_route_price = 0 AND ${route}.company_doublestop_price = 0)`;

// The company earnings formula, in one place. `ds` and `fs` are SQL expressions for the double stops and first stops; `keep` is the SQL for the value a
// record already has (null for a new record).
export const companyEarningsSql = ({ route, city, ds, fs, keep = 'NULL' }) => `CASE WHEN ${noCompanyRateSql(route, city)} THEN ${keep}
         ELSE (${ds} * (${route}.company_doublestop_price - ${route}.driver_doublestop_price)) + (${fs} * (${route}.company_route_price - ${route}.driver_route_price)) END`;

// The ids (of the given cities) that have at least one published statement. An older database without the statement tables has none.
export const citiesWithVerifiedStatements = async (db, cityIds) => {
  if (!Array.isArray(cityIds) || cityIds.length === 0) return new Set();
  try {
    const { rows } = await db.query("SELECT DISTINCT city_id FROM carrier_statements WHERE status = 'published' AND city_id = ANY($1::int[])", [cityIds]);
    return new Set(rows.map((r) => r.city_id));
  } catch (error) {
    if (error.code === UNDEFINED_TABLE) return new Set();
    throw error;
  }
};

// True when the named job (city) is a WEEKLY city with a verified statement: its routes take no company prices.
export const companyRatesRetired = async (db, job) => {
  const { rows } = await db.query('SELECT id, city_type FROM city WHERE job = $1', [job]);
  if (rows.length === 0 || rows[0].city_type !== 'WEEKLY') return false;
  return (await citiesWithVerifiedStatements(db, [rows[0].id])).has(rows[0].id);
};

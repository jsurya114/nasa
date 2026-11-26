import { NAME_KEY_SQL } from '../driverName.js';

// Database side of "daily upload, drivers found by name": loads what planDailyDrivers needs and creates the drivers' days from its plan. Everything
// runs on the upload's transaction client, after the upload lock is taken.

// The switch (agreed with the owners): until it is on, the daily upload works exactly as before, from the routes and sequences entered by hand.
export const dailyMatchByNameOn = () => process.env.DAILY_MATCH_BY_NAME === 'true';

const routeOf = (r) => ({ id: r.id, code: r.route_code_in_string, job: r.job, enabled: r.enabled, fsPrice: r.driver_route_price, dsPrice: r.driver_doublestop_price });

// mainCodes: the main route codes in the file. uploadDate: "YYYY-MM-DD".
export const loadDailyLookups = async (db, { mainCodes, uploadDate }) => {
  const routes = (await db.query(
    `SELECT id, route_code_in_string, job, enabled, driver_route_price, driver_doublestop_price FROM routes
      WHERE deleted_at IS NULL AND (route_code_in_string = ANY($1::text[]) OR split_part(route_code_in_string, ':', 1) = ANY($1::text[]))
      ORDER BY route_code_in_string, enabled DESC, id`,
    [mainCodes],
  )).rows.map(routeOf);
  const routesByCode = new Map();
  for (const r of routes) if (!routesByCode.has(r.code)) routesByCode.set(r.code, r);
  const subRoutesOf = new Map();
  for (const r of routesByCode.values()) {
    if (!r.code.includes(':')) continue;
    const main = routesByCode.get(r.code.split(':')[0]);
    if (!main || main.job !== r.job) continue;
    subRoutesOf.set(main.id, [...(subRoutesOf.get(main.id) ?? []), r]);
  }
  const jobs = [...new Set(routes.map((r) => r.job))];
  const cities = (await db.query('SELECT id, job FROM city WHERE job = ANY($1::text[])', [jobs])).rows;
  const cityOfJob = new Map(cities.map((c) => [c.job, c.id]));
  const cityIds = cities.map((c) => c.id);

  const drivers = (await db.query(
    `SELECT id, name, enabled, city_id, ${NAME_KEY_SQL('name')} AS name_key FROM drivers WHERE city_id = ANY($1::int[])`, [cityIds])).rows;
  const driverByName = new Map(drivers.map((d) => [`${d.city_id}|${d.name_key}`, { id: d.id, name: d.name, enabled: d.enabled }]));
  const matches = (await db.query(
    `SELECT m.city_id, m.name_key, d.id, d.name, d.enabled FROM daily_name_matches m JOIN drivers d ON d.id = m.driver_id WHERE m.city_id = ANY($1::int[])`,
    [cityIds])).rows;
  const nameMatch = new Map(matches.map((m) => [`${m.city_id}|${m.name_key}`, { id: m.id, name: m.name, enabled: m.enabled }]));
  const choices = (await db.query('SELECT city_id, main_route_id, driver_id, sub_route_id FROM daily_subroute_choices WHERE city_id = ANY($1::int[])', [cityIds])).rows;
  const choiceOf = new Map(choices.map((c) => [`${c.city_id}|${c.main_route_id}|${c.driver_id}`, c.sub_route_id]));

  const routeIds = [...routesByCode.values()].map((r) => r.id);
  const day = (await db.query(
    `SELECT dd.id, dd.driver_id, dd.route_id, dd.paid FROM dashboard_data dd WHERE dd.journey_date = $1::date AND dd.route_id = ANY($2::int[])`,
    [uploadDate, routeIds])).rows;
  const dayRows = new Map(day.map((r) => [`${r.driver_id}|${r.route_id}`, { id: r.id, paid: r.paid }]));
  const taken = (await db.query(
    'SELECT route_id, sequence_number, driver_id FROM deliveries WHERE driver_set_date = $1::date AND route_id = ANY($2::int[])',
    [uploadDate, routeIds])).rows;
  const takenSeqs = new Map(taken.map((t) => [`${t.route_id}|${t.sequence_number}`, t.driver_id]));
  return { routesByCode, subRoutesOf, cityOfJob, driverByName, nameMatch, choiceOf, dayRows, takenSeqs };
};

// Creates each placed driver's day: a dashboard row (as a hand entry makes it: route, first and last sequence, packages) and one delivery per
// sequence in the file. A day that exists and is not paid gets only the sequences it does not have yet; the counts are then worked out again by
// the daily upload's usual steps. A paid day is never in the plan. Returns how many days were created and extended.
export const applyDailyPlan = async (db, plan, uploadDate) => {
  let created = 0;
  let extended = 0;
  for (const p of plan.placements) {
    const seqs = [...p.seqs].sort((a, b) => a - b);
    let dayId = p.dayRow?.id;
    if (!dayId) {
      dayId = (await db.query(
        `INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1, $2, $3, $4, $5::date, $6) RETURNING id`,
        [p.driverId, p.route.id, seqs[0], seqs.at(-1), uploadDate, seqs.length])).rows[0].id;
      created += 1;
    } else {
      // Widening the range makes the database fill the whole new range (a trigger); those filler rows are removed again, so only the file's
      // sequences are this driver's deliveries.
      const { rowCount } = await db.query(
        `UPDATE dashboard_data SET start_seq = LEAST(start_seq, $2), end_seq = GREATEST(end_seq, $3) WHERE id = $1 AND (start_seq > $2 OR end_seq < $3)`,
        [dayId, seqs[0], seqs.at(-1)]);
      if (rowCount) await db.query(`DELETE FROM deliveries WHERE dashboard_data_id = $1 AND seq_route_code = route_id::text || '-' || sequence_number`, [dayId]);
      extended += 1;
    }
    await db.query(
      `INSERT INTO deliveries (driver_id, driver_set_date, route_id, sequence_number, seq_route_code, dashboard_data_id)
       SELECT $1, $2::date, $3, s, s || '-' || $4, $5 FROM unnest($6::int[]) AS s
        WHERE NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.dashboard_data_id = $5 AND d.sequence_number = s)`,
      [p.driverId, uploadDate, p.route.id, p.route.code, dayId, seqs]);
    await db.query(
      `UPDATE dashboard_data SET packages = (SELECT count(*) FROM deliveries WHERE dashboard_data_id = $1) WHERE id = $1`, [dayId]);
  }
  return { created, extended };
};

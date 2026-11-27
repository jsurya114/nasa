import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyDailyPlan, loadDailyLookups, releaseFileDays } from '../services/admin/dailyByName/dailyByNameStore.js';
import { planDailyDrivers } from '../services/admin/dailyByName/planDailyDrivers.js';
import { ChoiceError, deleteChoice, listChoices, saveNameMatch, saveSubRouteChoice } from '../services/admin/dailyByName/dailyChoices.js';

// Needs a PostgreSQL copy with the app's tables and the 2026-11-26 migration (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables.
// Everything runs in one transaction that is always rolled back. Synthetic city, routes and drivers only.
const hasDb = process.env.PAYROLL_TEST_DB === '1';

test('daily by name: lookups, days created from the file, re-upload, paid days and the remembered choices', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const tag = randomUUID().slice(0, 6);
    const job = `Test Daily ${tag}`;
    const city = await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, 'TDN', 'DAILY') RETURNING id", [job]);
    const route = (code, ds = 0.25) => one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ($1, $2, 2, 1.6, 0.5, $3, $4) RETURNING id`, [`R ${code}`, job, ds, code]);
    const main = `T${tag} 01-1`;
    const mainRoute = await route(main);
    const subA = await route(`${main}:A`);
    const subE = await route(`${main}:E`, 0.5);
    let n = 0;
    const driver = (name) => one("INSERT INTO drivers (password, name, email, driver_code, city_id, enabled) VALUES ('x', $1, $2, $3, $4, true) RETURNING id",
      [name, `d${n += 1}${tag}@example.test`, 8800000 + Number.parseInt(tag, 16) % 100000 + n, city.id]);
    const ana = await driver(`Ana ${tag}`);
    const bo = await driver(`Bo ${tag}`);
    const day = '2026-11-06';
    const rows = [
      { Route: `1106-${main}`, Sequence: 1, DriverName: `Ana ${tag}` }, { Route: `1106-${main}`, Sequence: 2, DriverName: `ana  ${tag}` },
      { Route: `1106-${main}`, Sequence: 1, DriverName: `Bo ${tag}` },
    ];
    const plan = planDailyDrivers(rows, await loadDailyLookups(db, { mainCodes: [main], uploadDate: day }));
    assert.deepEqual(plan.movedToSub.map((m) => m.subRoute), [`${main}:A`]); // same price as the main route, never :E
    assert.equal((await applyDailyPlan(db, plan, day)).created, 2);
    const days = (await db.query('SELECT driver_id, route_id, start_seq, end_seq, packages FROM dashboard_data WHERE journey_date = $1 AND driver_id = ANY($2) ORDER BY driver_id', [day, [ana.id, bo.id]])).rows;
    assert.deepEqual(days.map((d) => [d.driver_id, d.route_id, d.start_seq, d.end_seq, d.packages]), [[ana.id, mainRoute.id, 1, 2, 2], [bo.id, subA.id, 1, 1, 1]]);
    const codes = (await db.query('SELECT seq_route_code FROM deliveries WHERE driver_set_date = $1 AND driver_id = ANY($2) ORDER BY seq_route_code', [day, [ana.id, bo.id]])).rows.map((r) => r.seq_route_code);
    assert.deepEqual(codes, [`1-${main}`, `1-${main}:A`, `2-${main}`]);

    // The same day again with one more sequence: the day is extended with only that sequence, no filler rows.
    const again = planDailyDrivers([...rows, { Route: `1106-${main}`, Sequence: 5, DriverName: `Ana ${tag}` }], await loadDailyLookups(db, { mainCodes: [main], uploadDate: day }));
    assert.deepEqual(await applyDailyPlan(db, again, day), { created: 0, extended: 2 });
    const anaSeqs = (await db.query('SELECT sequence_number FROM deliveries WHERE driver_set_date = $1 AND driver_id = $2 ORDER BY 1', [day, ana.id])).rows.map((r) => r.sequence_number);
    assert.deepEqual(anaSeqs, [1, 2, 5]);

    // A paid day is never changed.
    await db.query('UPDATE dashboard_data SET paid = true WHERE journey_date = $1 AND driver_id = $2', [day, ana.id]);
    const paid = planDailyDrivers([{ Route: `1106-${main}`, Sequence: 9, DriverName: `Ana ${tag}` }], await loadDailyLookups(db, { mainCodes: [main], uploadDate: day }));
    assert.equal(paid.counts.paid_day, 1);

    // Remembered choices: a name match and a sub-route; both checked against the city, both undone.
    const nameId = await saveNameMatch(db, { cityId: city.id, fileName: ' A.  Pérez ', driverId: ana.id, adminId: null });
    const subId = await saveSubRouteChoice(db, { cityId: city.id, mainRouteId: mainRoute.id, driverId: bo.id, subRouteId: subE.id, adminId: null });
    const listed = await listChoices(db, city.id);
    assert.deepEqual([listed.names[0].file_name, listed.subRoutes[0].sub_route], ['A. Pérez', `${main}:E`]);
    const byChoice = planDailyDrivers([{ Route: `1106-${main}`, Sequence: 3, DriverName: 'a. pérez' }, { Route: `1106-${main}`, Sequence: 4, DriverName: `Bo ${tag}` }],
      await loadDailyLookups(db, { mainCodes: [main], uploadDate: '2026-11-07' }));
    assert.deepEqual(byChoice.placements.map((p) => [p.driverId, p.route.code]), [[ana.id, main], [bo.id, `${main}:E`]]);
    await assert.rejects(saveSubRouteChoice(db, { cityId: city.id, mainRouteId: mainRoute.id, driverId: bo.id, subRouteId: mainRoute.id, adminId: null }), ChoiceError);
    assert.equal(await deleteChoice(db, 'names', nameId), 1);

    // The bug found on the mock server: a name matched to the wrong driver, uploaded, then corrected and uploaded again. The parcels must move to the
    // right driver and leave the wrong one; a paid day is never rebuilt.
    const cy = await driver(`Cy ${tag}`);
    const wrong = await saveNameMatch(db, { cityId: city.id, fileName: 'Shown Differently', driverId: bo.id, adminId: null });
    const fileRows = [{ Route: `1106-${main}`, Sequence: 30, DriverName: 'Shown Differently' }, { Route: `1106-${main}`, Sequence: 31, DriverName: 'Shown Differently' }];
    const day2 = '2026-11-08';
    const upload = async () => {
      const rebuilt = await releaseFileDays(db, { mainCodes: [main], uploadDate: day2 });
      const p = planDailyDrivers(fileRows, await loadDailyLookups(db, { mainCodes: [main], uploadDate: day2 }));
      return { rebuilt, ...(await applyDailyPlan(db, p, day2)), clashes: p.clashes.length };
    };
    assert.deepEqual(await upload(), { rebuilt: 0, created: 1, extended: 0, clashes: 0 });
    await saveNameMatch(db, { cityId: city.id, fileName: 'Shown Differently', driverId: cy.id, adminId: null }); // corrected
    assert.deepEqual(await upload(), { rebuilt: 1, created: 1, extended: 0, clashes: 0 });
    const owners = (await db.query('SELECT driver_id, count(*)::int AS n FROM deliveries WHERE driver_set_date = $1 GROUP BY driver_id', [day2])).rows;
    assert.deepEqual(owners, [{ driver_id: cy.id, n: 2 }]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM dashboard_data WHERE journey_date = $1', [day2])).rows[0].n, 1);
    // once paid, the day is never rebuilt, and nobody else gets its parcels
    await db.query('UPDATE dashboard_data SET paid = true WHERE journey_date = $1', [day2]);
    await saveNameMatch(db, { cityId: city.id, fileName: 'Shown Differently', driverId: bo.id, adminId: null });
    const afterPaid = await upload();
    assert.deepEqual([afterPaid.rebuilt, afterPaid.created, afterPaid.clashes], [0, 0, 1]);
    assert.ok(wrong);
    assert.equal(await deleteChoice(db, 'subroutes', subId), 1);
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});

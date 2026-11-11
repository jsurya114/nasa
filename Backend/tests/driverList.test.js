import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ListInputError, PAGE_SIZE, listDrivers, parseListQuery } from '../services/admin/driverList.js';

// The Users page's list: search, filters, sorting and the Everee onboarding status of each driver. The first test needs no database; the second runs the
// real query in a rolled-back transaction (MCP_TEST_DB=1 or PAYROLL_TEST_DB=1 and the DB_* variables) with made-up drivers.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const ENV = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_ENVIRONMENT: 'sandbox', EVEREE_DRIVER_ONBOARDING_ENABLED: 'true', EVEREE_ONBOARDING_ENFORCED: 'true' };

test('only known words reach the query: defaults, and every unknown choice is refused with a message', () => {
  assert.deepEqual(parseListQuery({}), { page: 1, search: '', city: '', type: '', enabled: '', status: '', issue: '', sort: 'name', dir: 'asc' });
  assert.deepEqual(parseListQuery({ page: '3', search: ' ann ', city: 'All', type: 'LOCAL', enabled: 'disabled', status: 'in-progress', issue: 'no_phone', sort: 'status', dir: 'DESC' }),
    { page: 3, search: 'ann', city: 'All', type: 'LOCAL', enabled: 'disabled', status: 'in-progress', issue: 'no_phone', sort: 'status', dir: 'desc' });
  for (const bad of [{ type: 'local' }, { type: 'x; DROP TABLE drivers' }, { status: 'done' }, { issue: 'x' }, { sort: 'password' }, { sort: 'name; --' }, { dir: 'sideways' }, { enabled: 'yes' },
    { page: '0' }, { page: '-1' }, { page: 'abc' }, { page: '1.5' }, { page: '100001' }]) {
    assert.throws(() => parseListQuery(bad), ListInputError, JSON.stringify(bad));
  }
  assert.equal(parseListQuery({ search: 'x'.repeat(500) }).search.length, 100, 'a long search is cut, not refused');
});

test('the list: Everee status for every driver, counts, filters, sorting, search and who may see which drivers', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const { readFileSync } = await import('node:fs');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(new URL('../migrations/2026-11-04-issue-031-everee-workers.sql', import.meta.url), 'utf8'));
    await db.query(readFileSync(new URL('../migrations/2026-11-07-issue-242-everee-driver-onboarding.sql', import.meta.url), 'utf8'));
    const tag = randomBytes(3).toString('hex');
    const city = async (n) => (await one('INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, $3) RETURNING id, job', [`LD ${n} ${tag}`, `LD${n}${tag}`.toUpperCase(), 'DAILY']));
    const mine = await city('A');
    const other = await city('B');
    const admin = (await one('SELECT id FROM admin ORDER BY id LIMIT 1')).id;
    let code = 600000000 + Math.floor(Math.random() * 90000000);
    const driver = async (label, { cityId = mine.id, type = 'LOCAL', enabled = true, phone = '903-405-8843', signed = true, name } = {}) => (await one(
      `INSERT INTO drivers (password, name, email, driver_code, city_id, enabled, driver_type, phone_number, agreement_signed) VALUES ('x', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name`,
      [name ?? `${label} Driver ${tag}`, `ld-${label}-${tag}@example.test`, (code += 1), cityId, enabled, type, phone, signed]));
    const link = (id, { done = true, tenant = '4321', gone = false } = {}) => db.query(
      `INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, onboarding_complete, linked_by, unlinked_by, unlinked_at, unlink_reason)
       VALUES ($1, 'sandbox', $2, $3, 'matched_email', $4, $5, $6, $7, $8)`,
      [id, tenant, `W${id}-${tag}`, done, admin, gone ? admin : null, gone ? new Date() : null, gone ? 'test' : null]);
    const intent = (id, state) => db.query(
      `INSERT INTO everee_onboarding (driver_id, environment, tenant_id, external_worker_id, state, request_id) VALUES ($1, 'sandbox', '4321', $2, $3, gen_random_uuid())`, [id, `X${id}-${tag}`, state]);

    const complete = await driver('Complete'); await link(complete.id);
    const started = await driver('Started'); await link(started.id, { done: false });
    const creating = await driver('Creating'); await intent(creating.id, 'creating');
    const verifying = await driver('Verifying'); await intent(verifying.id, 'verifying');
    const fresh = await driver('Fresh', { phone: null, signed: false, name: 'Mononym' });
    const legacy = await driver('Legacy'); await link(legacy.id, { tenant: null });
    const wrongTenant = await driver('Wrong'); await link(wrongTenant.id, { tenant: '9999' });
    const removed = await driver('Removed'); await link(removed.id, { gone: true });
    const review = await driver('Review'); await intent(review.id, 'needs_review');
    const desi = await driver('Desi', { type: 'DESI' });
    const untyped = await driver('Untyped', { type: null });
    const off = await driver('Off', { enabled: false, phone: '12345' });
    const elsewhere = await driver('Elsewhere', { cityId: other.id });
    const ids = { complete, started, creating, verifying, fresh, legacy, wrongTenant, removed, review, desi, untyped, off };
    const query = (over = {}) => parseListQuery({ city: mine.job, ...over });
    const list = (over, scope = { all: true }, env = ENV) => listDrivers(db, scope, query(over), { env });
    const statusOf = async (over) => Object.fromEntries((await list({ sort: 'name', ...over })).drivers.map((d) => [d.name.split(' ')[0], d.everee_status]));

    await t.test('every driver gets a status from NASA\'s own records, the same way the payment setup overview works it out', async () => {
      const r = await list({}, { all: true });
      assert.equal(r.total, 12);
      const status = Object.fromEntries(r.drivers.map((d) => [d.name.split(' ')[0], d.everee_status]));
      // the page holds 10: ask for the second page as well
      Object.assign(status, Object.fromEntries((await list({ page: '2' })).drivers.map((d) => [d.name.split(' ')[0], d.everee_status])));
      assert.deepEqual(status, {
        Complete: 'complete', Started: 'in-progress', Creating: 'in-progress', Verifying: 'in-progress', Mononym: 'not-started',
        Legacy: 'needs-review', Wrong: 'needs-review', Removed: 'needs-review', Review: 'needs-review',
        Desi: 'not-required', Untyped: 'classification-required', Off: 'not-started',
      });
      assert.equal(r.everee.configured, true);
      assert.equal(r.everee.enforced, true);
    });

    await t.test('counts per status describe what choosing a chip would show, with every other filter applied', async () => {
      assert.deepEqual((await list({})).counts, { all: 12, complete: 1, 'in-progress': 3, 'not-started': 2, 'needs-review': 4, 'not-required': 1, 'classification-required': 1, 'service-unavailable': 0 });
      const localOnly = (await list({ type: 'LOCAL' })).counts;
      assert.deepEqual([localOnly.all, localOnly['not-required'], localOnly['classification-required']], [10, 0, 0]);
      assert.equal((await list({ status: 'complete' })).counts.all, 12, 'the status filter itself does not change the chip counts');
      assert.equal((await list({ status: 'needs-review' })).total, 4);
      assert.equal((await list({ status: 'needs-review' })).totalPages, 1);
      assert.deepEqual((await list({ enabled: 'disabled' })).drivers.map((d) => d.name.split(' ')[0]), ['Off']);
    });

    await t.test('filters: status, type, enabled, and the things Everee needs (phone, agreement, a first and last name)', async () => {
      assert.deepEqual((await list({ status: 'complete' })).drivers.map((d) => d.id), [complete.id]);
      assert.equal((await list({ type: 'DESI' })).total, 1);
      assert.equal((await list({ type: 'none' })).total, 1);
      const noPhone = (await list({ issue: 'no_phone', sort: 'name' })).drivers.map((d) => d.name.split(' ')[0]);
      assert.deepEqual(noPhone, ['Mononym', 'Off'], 'a missing phone and one of 5 digits; (903) 405 8843 and +1 903-405-8843 are fine');
      assert.deepEqual((await list({ issue: 'agreement_not_signed' })).drivers.map((d) => d.name), ['Mononym']);
      assert.deepEqual((await list({ issue: 'one_word_name' })).drivers.map((d) => d.name), ['Mononym']);
      const fresh_ = (await list({ search: 'Mononym' })).drivers[0];
      assert.deepEqual(fresh_.everee_needs, ['no_phone', 'agreement_not_signed', 'one_word_name'], 'what a not-onboarded Local driver still needs');
      const done = (await list({ status: 'complete' })).drivers[0];
      assert.deepEqual(done.everee_needs, [], 'an onboarded driver needs nothing');
      assert.deepEqual((await list({ type: 'DESI' })).drivers[0].everee_needs, [], 'Desi drivers do not use Everee');
      await db.query("UPDATE drivers SET phone_number = '(903) 405 8843' WHERE id = $1", [complete.id]);
      await db.query("UPDATE drivers SET phone_number = '+1 903-405-8843' WHERE id = $1", [started.id]);
      assert.deepEqual((await list({ issue: 'no_phone' })).drivers.map((d) => d.name.split(' ')[0]), ['Mononym', 'Off']);
    });

    await t.test('sorting: pending work first by status, and by name, code, city, type and account; ties are stable', async () => {
      const names = (r) => r.drivers.map((d) => d.name.split(' ')[0]);
      const first = async (sort, dir) => [...names(await list({ sort, dir })), ...names(await list({ sort, dir, page: '2' }))]; // both pages: 12 drivers
      const byStatus = await first('status', 'asc');
      assert.deepEqual(byStatus.slice(0, 4).sort(), ['Legacy', 'Removed', 'Review', 'Wrong'], 'needs review first');
      assert.deepEqual(byStatus.slice(4, 6).sort(), ['Mononym', 'Off'], 'then not started');
      assert.deepEqual(byStatus.slice(-2), ['Untyped', 'Desi'], 'waiting for a type, then not needed, last');
      const descending = await first('status', 'desc');
      assert.deepEqual(descending.slice(0, 2), ['Desi', 'Untyped']);
      assert.equal(await first('name', 'asc').then((n) => n.join(',')), [...(await first('name', 'asc'))].sort((a, b) => a.localeCompare(b)).join(','));
      const codes = (await list({ sort: 'code', dir: 'desc' })).drivers.map((d) => d.driver_code);
      assert.deepEqual(codes, [...codes].sort((a, b) => b - a));
      assert.deepEqual((await first('enabled', 'desc')).at(0), 'Off', 'disabled first when descending');
      assert.equal((await first('type', 'asc')).at(-1), 'Untyped', 'no type last');
      assert.deepEqual(await first('status', 'asc'), await first('status', 'asc'), 'the same order every time');
    });

    await t.test('search: name, email, code and phone; a % or _ is just a character', async () => {
      assert.equal((await list({ search: 'complete driver' })).total, 1);
      assert.equal((await list({ search: `ld-desi-${tag}` })).total, 1, 'by email');
            assert.equal((await list({ search: '%' })).total, 0);
      assert.equal((await list({ search: '_' })).total, 0);
      assert.equal((await list({ search: 'DRIVER' })).total, 11, 'not case sensitive (the one-word name has no "driver" in it)');
    });

    await t.test('pagination: ten a page, and a page past the end is empty', async () => {
      assert.equal(PAGE_SIZE, 10);
      assert.deepEqual([(await list({ page: '1' })).drivers.length, (await list({ page: '2' })).drivers.length, (await list({ page: '3' })).drivers.length], [10, 2, 0]);
      assert.equal((await list({})).totalPages, 2);
    });

    await t.test('an ordinary admin sees only the drivers of their own cities', async () => {
      const mineOnly = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'admin') RETURNING id", [`LD adm ${tag}`, `ld-adm-${tag}@example.test`]);
      await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [mineOnly.id, mine.id]);
      const seen = await listDrivers(db, { adminId: mineOnly.id }, parseListQuery({}), { env: ENV });
      assert.equal(seen.total, 12);
      assert.ok(seen.drivers.every((d) => d.job === mine.job), 'only their city');
      assert.equal((await listDrivers(db, { adminId: mineOnly.id }, parseListQuery({ search: 'Elsewhere' }), { env: ENV })).total, 0);
      assert.equal((await listDrivers(db, { all: true }, parseListQuery({ search: 'Elsewhere' }), { env: ENV })).drivers[0].id, elsewhere.id, 'a super admin sees it');
      const stranger = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'admin') RETURNING id", [`LD str ${tag}`, `ld-str-${tag}@example.test`]);
      assert.equal((await listDrivers(db, { adminId: stranger.id }, parseListQuery({}), { env: ENV })).total, 0, 'an admin with no city sees nobody');
    });

    await t.test('without Everee configured a Local driver is "unavailable" (never guessed), and Desi and untyped are unchanged', async () => {
      const s = await statusOf({}, ENV);
      const r = await list({}, { all: true }, { ...ENV, EVEREE_API_TOKEN: undefined });
      const status = Object.fromEntries([...r.drivers, ...(await list({ page: '2' }, { all: true }, { ...ENV, EVEREE_API_TOKEN: undefined })).drivers].map((d) => [d.name.split(' ')[0], d.everee_status]));
      assert.equal(status.Complete, 'service-unavailable');
      assert.equal(status.Desi, 'not-required');
      assert.equal(status.Untyped, 'classification-required');
      assert.equal(r.everee.configured, false);
      assert.ok(s);
    });

    await t.test('reading the list changes nothing', async () => {
      const snapshot = async () => JSON.stringify(await one('SELECT (SELECT count(*) FROM drivers) d, (SELECT count(*) FROM everee_workers) w, (SELECT count(*) FROM everee_onboarding) o, (SELECT sum(driver_code) FROM drivers) c'));
      const before = await snapshot();
      await list({ sort: 'status' });
      assert.equal(await snapshot(), before);
    });
    void ids;
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await pool.end();
  }
});

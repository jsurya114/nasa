import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pool from '../config/db.js';

// A driver may look access codes up but never add, change or delete one: only admins write them. The route files are read as text because
// importing a router starts the app's background jobs, which keep a test process from ending. Nothing here queries the database.
test.after(() => pool.end());

const WRITE = /router\.(post|put|patch|delete)\(\s*["'`]\/access-codes/;
const READ = /router\.get\(\s*["'`]\/access-codes\/list/;
const source = (file) => readFileSync(new URL(`../routes/${file}`, import.meta.url), 'utf8');

test('the driver router can read access codes but has no route that writes one', () => {
  const driver = source('driverRoutes.js');
  assert.match(driver, READ);
  assert.doesNotMatch(driver, WRITE);
  assert.doesNotMatch(driver, /uploadAccessCodeImages|createAccessCode/);
});

test('the driver controller and queries no longer expose a create function', async () => {
  const controller = await import('../controllers/driver/accessCodeControllers.js');
  const { default: queries } = await import('../services/driver/accessCodeQueries.js');
  assert.equal(controller.createAccessCode, undefined);
  assert.equal(queries.createAccessCode, undefined);
  assert.equal(typeof controller.getAccessCodes, 'function');
});

test('admins can still add, change and delete access codes', () => {
  const admin = source('adminRoutes.js');
  assert.match(admin, /router\.post\(\s*["']\/access-codes["']/);
  assert.match(admin, /router\.put\(\s*["']\/access-codes\/:id["']/);
  assert.match(admin, /router\.delete\(\s*["']\/access-codes\/:id["']/);
});

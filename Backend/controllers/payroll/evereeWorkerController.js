// HTTP side of linking drivers to Everee workers (issue #31). Super admin only, checked in the service together with the admin's cities.

import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { PayrollError } from '../../services/payroll/payRuns/payRunStore.js';
import {
  createSandboxWorker, linkDriver, listCityWorkers, lookupDriver, refreshWorker, unlinkDriver,
} from '../../services/payments/everee/workerStore.js';

const id = (value) => (/^\d{1,12}$/.test(String(value ?? '')) && Number(value) > 0 ? Number(value) : null);
const workerIdOf = (value) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null);

const fail = (res, error, action) => {
  if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message });
  logger.error(`Everee workers ${action} failed`, { code: error.code, message: error.message });
  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'the Everee workers request could not be completed; try again' });
};

const run = (action, handler) => async (req, res) => {
  try {
    return res.status(HttpStatus.OK).json(await handler(req));
  } catch (error) {
    return fail(res, error, action);
  }
};

const scope = (source) => ({ cityId: id(source.cityId), driverId: id(source.driverId) });
const need = (values, keys) => {
  for (const key of keys) if (!values[key]) throw new PayrollError(HttpStatus.BAD_REQUEST, `${key} must be a number`);
  return values;
};

export const getWorkers = run('list', (req) => {
  const { cityId } = need({ cityId: id(req.query.cityId) }, ['cityId']);
  return listCityWorkers(pool, req.admin, cityId);
});

export const postLookup = run('lookup', (req) => lookupDriver(pool, req.admin, need(scope(req.body ?? {}), ['cityId', 'driverId'])));

export const postLink = run('link', (req) => {
  const { cityId, driverId } = need(scope(req.body ?? {}), ['cityId', 'driverId']);
  const workerId = workerIdOf(req.body?.workerId);
  if (!workerId) throw new PayrollError(HttpStatus.BAD_REQUEST, 'workerId must be the ID of the worker that was found');
  return linkDriver(pool, req.admin, { cityId, driverId, workerId });
});

export const postRefresh = run('refresh', (req) => refreshWorker(pool, req.admin, need(scope(req.body ?? {}), ['cityId', 'driverId'])));

export const postUnlink = run('unlink', (req) => {
  const { cityId, driverId } = need(scope(req.body ?? {}), ['cityId', 'driverId']);
  return unlinkDriver(pool, req.admin, { cityId, driverId, linkId: id(req.body?.linkId), reason: req.body?.reason, acknowledgeOutstanding: req.body?.acknowledgeOutstanding === true });
});

export const postSandboxWorker = run('sandbox worker', (req) => createSandboxWorker(pool, req.admin, need(scope(req.body ?? {}), ['cityId', 'driverId'])));

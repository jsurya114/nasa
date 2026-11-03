// HTTP side of pay statements (issue #145). Read-only.
// Driver routes (driverRoutes.js) use the driver ID from the verified token only.
// Admin routes (payrollRoutes.js) check the admin's cities in statementStore.js.

import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import {
  getDriverBalances, getMyBalances, getMyStatement, getStatement, listDriverStatements, listMyStatements,
} from '../../services/payroll/statements/statementStore.js';
import { PayrollError } from '../../services/payroll/payRuns/payRunStore.js';

const id = (value) => (/^\d{1,12}$/.test(String(value ?? '')) && Number(value) > 0 ? Number(value) : null);

const fail = (res, error, action) => {
  if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message });
  logger.error(`Statement ${action} failed`, { code: error.code, message: error.message });
  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'statements could not be loaded; try again' });
};

const badRequest = (res, message) => res.status(HttpStatus.BAD_REQUEST).json({ message });

const send = (action, load) => async (req, res) => {
  try {
    return res.status(HttpStatus.OK).json(await load(req));
  } catch (error) {
    return fail(res, error, action);
  }
};

// ---------- driver ----------

const ownId = (req) => Number(req.driver?.id);

export const getOwnStatements = send('list', async (req) => ({ statements: await listMyStatements(pool, ownId(req)) }));

export const getOwnBalances = send('balances', (req) => getMyBalances(pool, ownId(req)));

export const getOwnStatement = async (req, res) => {
  const statementId = id(req.params.statementId);
  if (!statementId) return badRequest(res, 'unknown statement');
  return send('read', () => getMyStatement(pool, ownId(req), statementId))(req, res);
};

// ---------- admin ----------

// cityId is optional for a super admin and required for a city admin (checked in the service).
const driverAndCity = (req) => {
  const driverId = id(req.params.driverId);
  const cityId = req.query.cityId === undefined || req.query.cityId === '' ? null : id(req.query.cityId);
  if (!driverId) return { error: 'unknown driver' };
  if (req.query.cityId && !cityId) return { error: 'cityId must be a number' };
  return { driverId, cityId };
};

export const getDriverStatementList = async (req, res) => {
  const { driverId, cityId, error } = driverAndCity(req);
  if (error) return badRequest(res, error);
  return send('list', async () => ({ statements: await listDriverStatements(pool, req.admin, driverId, cityId) }))(req, res);
};

export const getDriverBalanceList = async (req, res) => {
  const { driverId, cityId, error } = driverAndCity(req);
  if (error) return badRequest(res, error);
  return send('balances', () => getDriverBalances(pool, req.admin, driverId, cityId))(req, res);
};

export const getAdminStatement = async (req, res) => {
  const statementId = id(req.params.statementId);
  if (!statementId) return badRequest(res, 'unknown statement');
  return send('read', () => getStatement(pool, req.admin, statementId))(req, res);
};

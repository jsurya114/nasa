// HTTP side of pay runs and payroll settings (issue #143). Admin and super admin only (payrollRoutes.js).

import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { withTransaction } from '../../services/payroll/claims/claimsStore.js';
import { parseDate } from '../../services/payroll/ledger/ledgerRules.js';
import {
  discardRun, finalizeRun, generateRun, getRecoveryLimit, getRun, listRuns, PayrollError, setRecoveryLimit, voidRun,
} from '../../services/payroll/payRuns/payRunStore.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PERIOD_DAYS = 31;
const id = (value) => (/^\d{1,12}$/.test(String(value ?? '')) && Number(value) > 0 ? Number(value) : null);
const text = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 500) : '');

const fail = (res, error, action) => {
  if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message });
  // Two requests for the same rows at once: the database lets only one through.
  if (error.code === '23505') return res.status(HttpStatus.CONFLICT).json({ message: 'another pay run already holds some of these rows; refresh and try again' });
  logger.error(`Pay run ${action} failed`, { code: error.code, message: error.message });
  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'the pay run could not be updated; try again' });
};

export const parseRunRequest = (body = {}) => {
  const errors = {};
  const requestId = typeof body.requestId === 'string' ? body.requestId.toLowerCase() : '';
  if (!UUID.test(requestId)) errors.requestId = 'requestId must be a UUID made by the form';
  const cityId = id(body.cityId);
  if (!cityId) errors.cityId = 'choose a city';
  const periodStart = parseDate(body.periodStart);
  const periodEnd = parseDate(body.periodEnd);
  if (!periodStart) errors.periodStart = 'periodStart must be a real date (YYYY-MM-DD)';
  if (!periodEnd) errors.periodEnd = 'periodEnd must be a real date (YYYY-MM-DD)';
  if (periodStart && periodEnd) {
    const days = (Date.parse(periodEnd) - Date.parse(periodStart)) / 86400000 + 1;
    if (days < 1) errors.periodEnd = 'periodEnd must be on or after periodStart';
    else if (days > MAX_PERIOD_DAYS) errors.periodEnd = `a pay run covers at most ${MAX_PERIOD_DAYS} days`;
  }
  const dataType = ['daily', 'weekly'].includes(body.dataType) ? body.dataType : null;
  if (!dataType) errors.dataType = 'dataType must be daily or weekly';
  return Object.keys(errors).length ? { errors } : { request: { requestId, cityId, periodStart, periodEnd, dataType } };
};

const badRequest = (res, errors) => res.status(HttpStatus.BAD_REQUEST).json({ message: 'check the highlighted fields', errors });

export const getPayrollSettings = async (_req, res) => {
  try {
    return res.status(HttpStatus.OK).json({ recoveryLimit: await getRecoveryLimit(pool) });
  } catch (error) {
    return fail(res, error, 'settings');
  }
};

export const putRecoveryLimit = async (req, res) => {
  try {
    const value = await withTransaction(pool, (db) => setRecoveryLimit(db, req.admin, req.body?.recoveryLimit ?? null, req.body?.reason));
    logger.info('Recovery limit changed', { adminId: req.admin?.id, type: value?.type ?? 'none' });
    return res.status(HttpStatus.OK).json({ recoveryLimit: value });
  } catch (error) {
    return fail(res, error, 'settings');
  }
};

export const postPayRun = async (req, res) => {
  const { request, errors } = parseRunRequest(req.body);
  if (errors) return badRequest(res, errors);
  try {
    const result = await withTransaction(pool, (db) => generateRun(db, req.admin, request));
    logger.info('Pay run drafted', { runId: result.run.id, cityId: request.cityId, replay: result.replay });
    const detail = await getRun(pool, req.admin, result.run.id);
    return res.status(result.replay ? HttpStatus.OK : HttpStatus.CREATED).json({ ...detail, replay: result.replay });
  } catch (error) {
    return fail(res, error, 'draft');
  }
};

export const getPayRuns = async (req, res) => {
  const cityId = req.query.cityId === undefined || req.query.cityId === '' ? null : id(req.query.cityId);
  if (req.query.cityId && !cityId) return badRequest(res, { cityId: 'cityId must be a number' });
  try {
    return res.status(HttpStatus.OK).json({ runs: await listRuns(pool, req.admin, cityId) });
  } catch (error) {
    return fail(res, error, 'list');
  }
};

export const getPayRun = async (req, res) => {
  const runId = id(req.params.runId);
  if (!runId) return badRequest(res, { runId: 'unknown pay run' });
  try {
    return res.status(HttpStatus.OK).json(await getRun(pool, req.admin, runId));
  } catch (error) {
    return fail(res, error, 'read');
  }
};

// finalize | discard | void
const action = (name, fn, needsReason) => async (req, res) => {
  const runId = id(req.params.runId);
  const reason = text(req.body?.reason);
  if (!runId) return badRequest(res, { runId: 'unknown pay run' });
  if (needsReason && reason.length < 3) return badRequest(res, { reason: 'give a reason (at least 3 characters)' });
  try {
    const result = await withTransaction(pool, (db) => fn(db, req.admin, runId, reason));
    logger.info(`Pay run ${name}`, { runId, adminId: req.admin?.id, replay: result.replay });
    return res.status(HttpStatus.OK).json(result);
  } catch (error) {
    return fail(res, error, name);
  }
};

export const postFinalize = action('finalized', (db, admin, runId) => finalizeRun(db, admin, runId), false);
export const postDiscard = action('discarded', discardRun, true);
export const postVoid = action('voided', voidRun, true);

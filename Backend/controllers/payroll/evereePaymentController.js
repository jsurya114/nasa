// HTTP side of paying a pay run through Everee (issue #31, part 4). Super admin only, checked in the service together with the run's city.

import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { PayrollError } from '../../services/payroll/payRuns/payRunStore.js';
import {
  getBatchView, getCitySettings, listRunBatches, PreviewChangedError, retryBatch, setCitySettings, submitBatch,
} from '../../services/payments/everee/batchSubmit.js';
import { checkBatch } from '../../services/payments/everee/paymentStatus.js';
import { listPayableRuns } from '../../services/payments/everee/payableRuns.js';

const id = (value) => (/^\d{1,12}$/.test(String(value ?? '')) && Number(value) > 0 ? Number(value) : null);

const fail = (res, error, action) => {
  if (error instanceof PreviewChangedError) return res.status(error.status).json({ message: error.message, preview: error.preview });
  if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message });
  // Two requests for the same statements at once: the database lets only one through.
  if (error.code === '23505') return res.status(HttpStatus.CONFLICT).json({ message: 'a payment for these statements was already started; refresh and look at the batch' });
  logger.error(`Everee payment ${action} failed`, { code: error.code, message: error.message });
  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'the payment request could not be completed; check the batch before trying again' });
};

const run = (action, handler) => async (req, res) => {
  try {
    return res.status(HttpStatus.OK).json(await handler(req));
  } catch (error) {
    return fail(res, error, action);
  }
};

const need = (value, message) => {
  if (!value) throw new PayrollError(HttpStatus.BAD_REQUEST, message);
  return value;
};

export const postBatch = run('submit', (req) => submitBatch(pool, req.admin, {
  runId: need(id(req.params.runId), 'unknown pay run'), requestId: req.body?.requestId, previewHash: req.body?.previewHash, driverIds: req.body?.driverIds,
}));
export const getRunBatches = run('list', (req) => listRunBatches(pool, req.admin, need(id(req.params.runId), 'unknown pay run')));
export const getBatch = run('read', (req) => getBatchView(pool, req.admin, need(id(req.params.batchId), 'unknown payment batch')));
export const postRetry = run('retry', (req) => retryBatch(pool, req.admin, need(id(req.params.batchId), 'unknown payment batch')));
export const postCheck = run('check', (req) => checkBatch(pool, req.admin, need(id(req.params.batchId), 'unknown payment batch')));
export const getPayableRuns = run('payable runs', (req) => listPayableRuns(pool, req.admin, { cityId: req.query.cityId, driverId: req.query.driverId }));
export const getSettings = run('settings', (req) => getCitySettings(pool, req.admin, need(id(req.query.cityId), 'cityId must be a number')));
export const putSettings = run('settings update', (req) => setCitySettings(pool, req.admin, need(id(req.params.cityId), 'cityId must be a number'), req.body ?? {}));

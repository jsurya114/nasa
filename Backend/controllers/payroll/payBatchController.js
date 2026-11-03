// HTTP side of the city payment batch review (issue #144). Read-only.

import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { PayrollError } from '../../services/payroll/payRuns/payRunStore.js';
import { reviewRunAsBatch } from '../../services/payroll/payRuns/payBatchReview.js';

export const getBatchReview = async (req, res) => {
  const raw = String(req.params.runId ?? '');
  const runId = /^\d{1,12}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
  if (!runId) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'unknown pay run' });
  try {
    return res.status(HttpStatus.OK).json(await reviewRunAsBatch(pool, req.admin, runId));
  } catch (error) {
    if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message });
    logger.error('Pay batch review failed', { code: error.code, message: error.message });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'the batch review could not be loaded; try again' });
  }
};

// HTTP side of the Everee batch preview (issue #31, part 3). Read-only. Super admin only, checked in the service together with the admin's city.

import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { PayrollError } from '../../services/payroll/payRuns/payRunStore.js';
import { previewEvereeBatch } from '../../services/payments/everee/batchPreview.js';
import { statementIdList } from './statementIdList.js';

export const getEvereePreview = async (req, res) => {
  const raw = String(req.params.runId ?? '');
  const runId = /^\d{1,12}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
  if (!runId) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'unknown pay run' });
  try {
    return res.status(HttpStatus.OK).json(await previewEvereeBatch(pool, req.admin, runId, { statementIds: statementIdList(req.query.statementIds) }));
  } catch (error) {
    if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message, ...(error.code === 'onboarding_required' && { code: error.code }) });
    logger.error('Everee batch preview failed', { code: error.code, message: error.message });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'the preview could not be loaded; try again' });
  }
};

// HTTP side of the Everee connection check (issue #31). Super admin only, checked in the service.

import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { PayrollError } from '../../services/payroll/payRuns/payRunStore.js';
import { checkEvereeConnection, getEvereeStatus } from '../../services/payments/everee/evereeService.js';

const fail = (res, error, action) => {
  if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message });
  logger.error(`Everee ${action} failed`, { message: error.message });
  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'the Everee check could not be run; try again' });
};

export const getStatus = (req, res) => {
  try {
    return res.status(HttpStatus.OK).json(getEvereeStatus(req.admin));
  } catch (error) {
    return fail(res, error, 'status');
  }
};

export const postCheck = async (req, res) => {
  try {
    return res.status(HttpStatus.OK).json(await checkEvereeConnection(req.admin));
  } catch (error) {
    return fail(res, error, 'connection check');
  }
};

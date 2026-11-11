// HTTP side of confirming a driver's changed email or phone. Super admin only, checked in the service together with the admin's cities.

import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { PayrollError } from '../../services/payroll/payRuns/payRunStore.js';
import { confirmContact } from '../../services/payments/contactReview.js';

const id = (value) => (/^\d{1,12}$/.test(String(value ?? '')) && Number(value) > 0 ? Number(value) : null);

export const postConfirmContact = async (req, res) => {
  try {
    const cityId = id(req.body?.cityId);
    const driverId = id(req.body?.driverId);
    if (!cityId || !driverId) throw new PayrollError(HttpStatus.BAD_REQUEST, 'cityId and driverId must be numbers');
    return res.status(HttpStatus.OK).json(await confirmContact(pool, req.admin, { cityId, driverId, contactChangedAt: req.body?.contactChangedAt }));
  } catch (error) {
    if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message });
    logger.error('Confirming driver contact failed', { code: error.code, message: error.message });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'the contact details could not be confirmed; try again' });
  }
};

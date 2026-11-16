import pool from '../config/db.js';
import HttpStatus from '../utils/statusCodes.js';
import logger from '../utils/logger.js';

// Who may use Invoices: the super admin, and an admin the super admin switched it on for. The switch is read from the database on every request, not
// from the token, so switching it off (or disabling the admin) takes effect at once. Run it after adminAuth, which sets req.admin from the verified token.
export const invoiceAccessOf = async (admin, db = pool) => {
  if (admin?.role === 'superadmin') return true;
  if (admin?.role !== 'admin') return false;
  const { rows: [row] } = await db.query('SELECT can_use_invoices FROM admin WHERE id = $1 AND is_active = true', [admin.id]);
  return row?.can_use_invoices === true;
};

export const requireInvoiceAccess = async (req, res, next) => {
  try {
    if (await invoiceAccessOf(req.admin)) return next();
    return res.status(HttpStatus.FORBIDDEN).json({ message: 'FORBIDDEN' });
  } catch (error) {
    logger.error('Invoice access could not be checked', { code: error?.code });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Invoices could not be opened. Try again.' });
  }
};

export default requireInvoiceAccess;

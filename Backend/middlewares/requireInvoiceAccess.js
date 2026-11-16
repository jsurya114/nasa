import pool from '../config/db.js';
import HttpStatus from '../utils/statusCodes.js';
import logger from '../utils/logger.js';

// Who may use Invoices: the super admin, and an admin the super admin switched it on for. Everything is read from the database on every request, the role
// included: the token only says which admin this is (and that it is an admin token), so switching Invoices off, disabling the admin or changing their
// role takes effect at once. Run it after adminAuth, which sets req.admin from the verified token.
// Answers who the admin is for Invoices right now ({ id, role } from the database), or null when they have no access.
export const invoiceActorOf = async (admin, db = pool) => {
  const id = Number(admin?.id);
  if (!['admin', 'superadmin'].includes(admin?.role) || !Number.isInteger(id) || id <= 0) return null;
  const { rows: [row] } = await db.query('SELECT id, role, is_active, can_use_invoices FROM admin WHERE id = $1', [id]);
  if (!row || row.is_active !== true) return null;
  if (row.role === 'superadmin') return { id: row.id, role: 'superadmin' };
  return row.role === 'admin' && row.can_use_invoices === true ? { id: row.id, role: 'admin' } : null;
};

export const invoiceAccessOf = async (admin, db = pool) => (await invoiceActorOf(admin, db)) !== null;

export const requireInvoiceAccess = async (req, res, next) => {
  try {
    const actor = await invoiceActorOf(req.admin);
    if (actor) {
      req.invoiceActor = actor; // the routes below scope by this, never by the role in the token
      return next();
    }
    return res.status(HttpStatus.FORBIDDEN).json({ message: 'FORBIDDEN' });
  } catch (error) {
    logger.error('Invoice access could not be checked', { code: error?.code });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Invoices could not be opened. Try again.' });
  }
};

export default requireInvoiceAccess;

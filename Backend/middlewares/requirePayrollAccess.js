import pool from '../config/db.js';
import HttpStatus from '../utils/statusCodes.js';
import logger from '../utils/logger.js';

// Who may use the Payroll page: the super admin, and an admin the super admin switched Payroll on for. Read from the database on every request, the role
// included, so switching Payroll off, disabling the admin or changing their role takes effect at once. Run it after adminAuth (req.admin from the token).
// The payroll services check the admin's cities for everything an ordinary admin does, and keep waivers for the super admin.
// Answers { id, role } from the database, or null when the admin has no access.
export const payrollActorOf = async (admin, db = pool) => {
  const id = Number(admin?.id);
  if (!['admin', 'superadmin'].includes(admin?.role) || !Number.isInteger(id) || id <= 0) return null;
  const { rows: [row] } = await db.query('SELECT id, role, is_active, can_use_payroll FROM admin WHERE id = $1', [id]);
  if (!row || row.is_active !== true) return null;
  if (row.role === 'superadmin') return { id: row.id, role: 'superadmin' };
  return row.role === 'admin' && row.can_use_payroll === true ? { id: row.id, role: 'admin' } : null;
};

export const requirePayrollAccess = async (req, res, next) => {
  try {
    const actor = await payrollActorOf(req.admin);
    if (!actor) return res.status(HttpStatus.FORBIDDEN).json({ message: 'FORBIDDEN' });
    // The services decide by this role (city checks, super-admin-only waivers): the database's, never an older one in the token
    req.admin = { ...req.admin, id: actor.id, role: actor.role };
    return next();
  } catch (error) {
    logger.error('Payroll access could not be checked', { code: error?.code });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Payroll could not be opened. Try again.' });
  }
};

// GET /admin/payroll/access: whether this admin may use the Payroll page (the menu and the page ask). Changes nothing.
export const getPayrollAccess = async (req, res) => {
  try {
    return res.status(HttpStatus.OK).json({ allowed: (await payrollActorOf(req.admin)) !== null });
  } catch (error) {
    logger.error('Payroll access could not be checked', { code: error?.code });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Payroll access could not be checked. Try again.' });
  }
};

export default requirePayrollAccess;

import HttpStatus from '../utils/statusCodes.js';

export const ADMIN_ROLES = ['admin', 'superadmin'];
export const DRIVER_ROLE = 'driver';

/**
 * Allows the request only when the verified token carries one of `roles`.
 * Run it after the middleware that verifies the token and sets
 * `req.user`, `req.admin` or `req.driver`.
 *
 * Driver tokens issued before roles existed have no `role`. Admin tokens
 * always had one, so a token without a role can only be an old driver
 * token. It is accepted as a driver for as long as those tokens live
 * (refresh tokens last 7 days). Issue #14 removes this allowance.
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    const principal = req.user || req.admin || req.driver;
    let role = principal?.role;

    if (role === undefined && roles.includes(DRIVER_ROLE)) {
      role = DRIVER_ROLE;
    }

    if (!role || !roles.includes(role)) {
      return res.status(HttpStatus.FORBIDDEN).json({ message: 'FORBIDDEN' });
    }

    next();
  };
}

export default requireRole;

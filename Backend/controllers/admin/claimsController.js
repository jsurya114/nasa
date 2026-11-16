import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { ClaimsInputError, listClaims, parseClaimsQuery } from '../../services/admin/claimsList.js';

// Read only. Any signed-in admin: an ordinary admin gets the claims of their assigned cities, the super admin gets all. The admin comes from the token.
export const getClaims = async (req, res) => {
  try {
    const filters = parseClaimsQuery(req.query);
    const scope = req.user.role === 'superadmin' ? { all: true } : { adminId: req.user.id };
    return res.status(HttpStatus.OK).json(await listClaims(pool, scope, filters));
  } catch (error) {
    if (error instanceof ClaimsInputError) return res.status(HttpStatus.BAD_REQUEST).json({ message: error.message });
    logger.error('Claims list failed', { code: error?.code, message: error?.message });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Claims could not be loaded. Try again.' });
  }
};

import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { ClaimsInputError, claimsScopeOf, listClaims, parseClaimsQuery } from '../../services/admin/claimsList.js';

// Read only. Any active admin: an ordinary admin gets the claims of their assigned cities, the super admin gets all. Who they are and their role are read from
// the database on every request (a disabled account or a changed role takes effect at once); the token only says which admin it is.
export const getClaims = async (req, res) => {
  try {
    const filters = parseClaimsQuery(req.query);
    const scope = await claimsScopeOf(pool, req.user);
    if (!scope) return res.status(HttpStatus.FORBIDDEN).json({ message: 'FORBIDDEN' });
    return res.status(HttpStatus.OK).json(await listClaims(pool, scope, filters));
  } catch (error) {
    if (error instanceof ClaimsInputError) return res.status(HttpStatus.BAD_REQUEST).json({ message: error.message });
    logger.error('Claims list failed', { code: error?.code, message: error?.message });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Claims could not be loaded. Try again.' });
  }
};

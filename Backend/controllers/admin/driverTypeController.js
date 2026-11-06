import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { parseTypeChange, setDriverTypes } from '../../services/admin/driverType.js';

// PATCH /admin/drivers/type  { driverIds: [1, 2], driverType: 'LOCAL' | 'DESI' }. Any admin, for drivers in their own cities (checked in the service).
export const changeDriverTypes = async (req, res) => {
  try {
    const parsed = parseTypeChange(req.body);
    if (parsed.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsed.error });
    const result = await setDriverTypes(req.user, parsed.driverIds, parsed.driverType);
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });
    return res.status(HttpStatus.OK).json({
      message: result.updated === 0 ? 'No change needed' : 'Driver type updated',
      updated: result.updated,
      unchanged: result.unchanged,
      driverIds: parsed.driverIds,
      driverType: parsed.driverType,
    });
  } catch (err) {
    logger.error('Error changing driver type', err);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Server error' });
  }
};

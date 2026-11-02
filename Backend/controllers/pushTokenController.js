import deviceTokenQueries, { USER_TYPES } from '../services/push/deviceTokenQueries.js';
import { parseRegistration, parseRemoval } from '../services/push/pushTokenRules.js';
import asyncHandler from '../utils/asyncHandler.js';
import HttpStatus from '../utils/statusCodes.js';
import logger from '../utils/logger.js';

const serverError = (error, req, res) =>
  res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });

// Register and remove push tokens for one kind of person. `getUserId` reads the id from the verified token,
// never from the body or URL: a person can only register or remove their own phones. The token itself is
// never logged.
export const createPushTokenController = (userType, getUserId) => ({
  register: asyncHandler(async (req, res) => {
    const parsed = parseRegistration(req.body);
    if (parsed.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsed.error });

    await deviceTokenQueries.register({ userType, userId: getUserId(req), ...parsed });
    logger.info('Push token registered', { userType, userId: getUserId(req), platform: parsed.platform });
    return res.status(HttpStatus.OK).json({ success: true });
  }, { log: 'Push token register error', respond: serverError }),

  remove: asyncHandler(async (req, res) => {
    const parsed = parseRemoval(req.body);
    if (parsed.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsed.error });

    await deviceTokenQueries.revoke({ userType, userId: getUserId(req), token: parsed.token });
    return res.status(HttpStatus.OK).json({ success: true });
  }, { log: 'Push token remove error', respond: serverError }),
});

export const driverPushTokens = createPushTokenController(USER_TYPES.DRIVER, (req) => req.driver.id);
export const adminPushTokens = createPushTokenController(USER_TYPES.ADMIN, (req) => req.user.id);

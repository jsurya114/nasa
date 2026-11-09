import deviceTokenQueries, { USER_TYPES } from '../services/push/deviceTokenQueries.js';
import { parseRegistration, parseRemoval } from '../services/push/pushTokenRules.js';
import asyncHandler from '../utils/asyncHandler.js';
import HttpStatus from '../utils/statusCodes.js';
import logger from '../utils/logger.js';

const serverError = (error, req, res) =>
  res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });

// Register and remove push tokens for one kind of person. `getUserId` and `getIssuedAt` read the id and the issue
// time (`iat`, in seconds) from the verified access token, never from the body or URL: a person can only register or
// remove their own phones, and a registration cannot claim to be newer than the sign-in it was sent with. The token
// itself is never logged.
export const createPushTokenController = (userType, getUserId, getIssuedAt) => ({
  register: asyncHandler(async (req, res) => {
    const parsed = parseRegistration(req.body);
    if (parsed.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsed.error });

    const outcome = await deviceTokenQueries.register({
      userType,
      userId: getUserId(req),
      ...parsed,
      issuedAt: getIssuedAt(req),
    });
    if (!outcome.registered) {
      // From a sign-in that has already ended (the person removed this phone since). Not an error worth retrying.
      logger.info('Push token registration refused', { userType, userId: getUserId(req), reason: outcome.reason });
      return res.status(HttpStatus.CONFLICT).json({ message: 'Registration is from a finished sign-in' });
    }
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

export const driverPushTokens = createPushTokenController(USER_TYPES.DRIVER, (req) => req.driver.id, (req) => req.driver.iat);
export const adminPushTokens = createPushTokenController(USER_TYPES.ADMIN, (req) => req.user.id, (req) => req.user.iat);

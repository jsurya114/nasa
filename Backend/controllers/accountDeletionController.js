import bcrypt from 'bcrypt';
import HttpStatus from '../utils/statusCodes.js';
import pool from '../config/db.js';
import logger from '../utils/logger.js';
import * as deletion from '../services/account/accountDeletion.js';

// Account deletion in the app (services/account/accountDeletion.js). A person sees, asks for and withdraws their own
// request; asking needs their current password. A super admin lists open requests and completes them.

const MESSAGES = {
  wrong_password: 'The password is not correct.',
  last_super_admin: 'You are the only active super admin. Make another admin a super admin before deleting this account.',
  own_request: 'Another super admin must complete your own deletion request.',
  not_open: 'This request is no longer open.',
  not_found: 'Request not found.',
};
const STATUS = { wrong_password: HttpStatus.FORBIDDEN, last_super_admin: HttpStatus.CONFLICT, own_request: HttpStatus.CONFLICT, not_open: HttpStatus.CONFLICT, not_found: HttpStatus.NOT_FOUND };

const answer = (res, error) => {
  if (MESSAGES[error?.code]) return res.status(STATUS[error.code]).json({ code: error.code, message: MESSAGES[error.code] });
  logger.error('Account deletion failed', { reason: error?.message });
  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 'server_error', message: 'Server error' });
};

const TABLE = { driver: 'drivers', admin: 'admin' };
const whoAmI = (userType, req) => (userType === 'driver' ? req.driver?.id : req.user?.id);

const passwordMatches = async (userType, userId, password, db) => {
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024) return false;
  const row = (await db.query(`SELECT password FROM ${TABLE[userType]} WHERE id = $1`, [userId])).rows[0];
  return Boolean(row?.password) && bcrypt.compare(password, row.password);
};

export const makeSelfService = (userType, db = pool) => ({
  status: async (req, res) => {
    try {
      return res.status(HttpStatus.OK).json({ request: await deletion.getRequest(userType, whoAmI(userType, req), db), completionDays: deletion.COMPLETION_DAYS });
    } catch (error) { return answer(res, error); }
  },
  request: async (req, res) => {
    try {
      const userId = whoAmI(userType, req);
      if (!(await passwordMatches(userType, userId, req.body?.password, db))) throw Object.assign(new Error('wrong_password'), { code: 'wrong_password' });
      return res.status(HttpStatus.OK).json({ request: await deletion.requestDeletion(userType, userId, db), completionDays: deletion.COMPLETION_DAYS });
    } catch (error) { return answer(res, error); }
  },
  cancel: async (req, res) => {
    try {
      return res.status(HttpStatus.OK).json({ request: await deletion.cancelRequest(userType, whoAmI(userType, req), db) });
    } catch (error) { return answer(res, error); }
  },
});

export const makeAdminReview = (db = pool) => ({
  list: async (_req, res) => {
    try { return res.status(HttpStatus.OK).json({ requests: await deletion.listOpen(db) }); } catch (error) { return answer(res, error); }
  },
  complete: async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(HttpStatus.BAD_REQUEST).json({ code: 'bad_request', message: 'Bad request id.' });
    try {
      const done = await deletion.completeRequest(id, req.user.id, db);
      logger.info('Account deletion completed', { requestId: id, userType: done.userType });
      return res.status(HttpStatus.OK).json({ request: done });
    } catch (error) { return answer(res, error); }
  },
});

export const driverDeletion = makeSelfService('driver');
export const adminDeletion = makeSelfService('admin');
export const deletionReview = makeAdminReview();

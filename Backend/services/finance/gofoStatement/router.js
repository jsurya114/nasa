/**
 * The owner-only routes for carrier (GOFO) statements (issue #252). Super admin only: the router checks the token and then the role before any route
 * runs, so a route added below cannot be reached without both. The real `adminAuth`, the upload middleware and the service are passed in by
 * routes/financeRoutes.js; tests pass their own.
 *
 *   GET  /                 the statements, newest week first
 *   POST /preview          file -> everything publishing would check and what it would do. Stores nothing.
 *   POST /publish          file -> stores a statement that reconciles. Same statement again: nothing changes. A correction becomes a new version.
 *   GET  /:id/unallocated  the unmatched money of one statement and why
 *   POST /:id/rematch      matches groups whose work reached NASA later
 *   POST /:id/void         { reason } retires a statement; its history stays
 *
 * Nothing here recalculates pay, changes a rate, marks anyone paid or calls Everee.
 */
import express from 'express';
import rateLimit from '../../../middlewares/rateLimit.js';
import HttpStatus from '../../../utils/statusCodes.js';
import logger from '../../../utils/logger.js';

const ZIP_START = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // an .xlsx file is a zip
const REASON_MIN = 5;
const REASON_MAX = 300;
const PUBLISH_STATUS = { published: HttpStatus.CREATED, already_published: HttpStatus.OK, older_version: HttpStatus.CONFLICT, rejected: HttpStatus.UNPROCESSABLE_ENTITY };

const idOf = (value) => (/^\d{1,15}$/.test(String(value)) ? Number(value) : null);

export function createStatementRouter({ adminAuth, requireRole, upload, service }) {
  for (const [name, part] of Object.entries({ adminAuth, requireRole, upload })) {
    if (typeof part !== 'function' && !(name === 'upload' && typeof part?.single === 'function')) throw new Error(`createStatementRouter needs ${name}`);
  }
  if (!service || ['list', 'preview', 'publish', 'unallocated', 'rematch', 'void'].some((fn) => typeof service[fn] !== 'function')) throw new Error('createStatementRouter needs a service');
  const router = express.Router();

  // Everything below is for the super admin only. Keep new routes below this line.
  router.use(adminAuth);
  router.use(requireRole('superadmin'));
  router.use(rateLimit({ windowMs: 60 * 1000, max: 60, keyGenerator: (req) => `statements:${req.admin?.id ?? req.ip}` }));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }); // company figures are never cached

  const handle = (action, job) => async (req, res) => {
    try {
      return await job(req, res);
    } catch (error) {
      if (error?.name === 'StatementWorkChanged') return res.status(HttpStatus.CONFLICT).json({ message: error.message });
      logger.error(`Carrier statement ${action} failed`, { code: error?.code, message: error?.message });
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'The carrier statement request could not be completed. Nothing was changed.' });
    }
  };

  // The file must be an Excel workbook (a zip) sent in the "file" field. Answers 400 and returns null when it is not.
  const fileOf = (req, res) => {
    const file = req.file;
    if (!file?.buffer?.length) { res.status(HttpStatus.BAD_REQUEST).json({ message: 'Choose the carrier statement (.xlsx) to upload.' }); return null; }
    if (!file.buffer.subarray(0, 4).equals(ZIP_START)) { res.status(HttpStatus.BAD_REQUEST).json({ message: 'This is not an Excel (.xlsx) file. Upload the statement as downloaded.' }); return null; }
    return file;
  };
  const withUpload = (job) => (req, res, next) => upload.single('file')(req, res, (error) => {
    if (error) return res.status(HttpStatus.BAD_REQUEST).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'The file is too large for a statement.' : 'The file could not be accepted. Upload the Excel (.xlsx) statement.' });
    return job(req, res, next);
  });

  router.get('/', handle('list', async (_req, res) => res.status(HttpStatus.OK).json({ statements: await service.list() })));

  router.post('/preview', withUpload(handle('preview', async (req, res) => {
    const file = fileOf(req, res);
    if (file) res.status(HttpStatus.OK).json(await service.preview(file.buffer));
  })));

  router.post('/publish', withUpload(handle('publish', async (req, res) => {
    const file = fileOf(req, res);
    if (!file) return;
    const result = await service.publish(file.buffer, { user: { id: req.admin.id }, sourceLabel: String(file.originalname ?? 'statement.xlsx').replace(/[^\w .()-]/g, '_').slice(0, 200) });
    res.status(PUBLISH_STATUS[result.status] ?? HttpStatus.OK).json(result);
  })));

  router.get('/:id/unallocated', handle('unallocated', async (req, res) => {
    const id = idOf(req.params.id);
    if (!id) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'The statement id is not valid.' });
    const rows = await service.unallocated(id);
    return rows ? res.status(HttpStatus.OK).json({ unallocated: rows }) : res.status(HttpStatus.NOT_FOUND).json({ message: 'No such statement.' });
  }));

  router.post('/:id/rematch', handle('rematch', async (req, res) => {
    const id = idOf(req.params.id);
    if (!id) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'The statement id is not valid.' });
    const matched = await service.rematch(id, { actorId: req.admin.id });
    return matched === null ? res.status(HttpStatus.NOT_FOUND).json({ message: 'No such published statement.' }) : res.status(HttpStatus.OK).json({ matched });
  }));

  router.post('/:id/void', express.json({ limit: '4kb' }), handle('void', async (req, res) => {
    const id = idOf(req.params.id);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!id) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'The statement id is not valid.' });
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) return res.status(HttpStatus.BAD_REQUEST).json({ message: `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.` });
    const done = await service.void(id, { actorId: req.admin.id, reason });
    return done ? res.status(HttpStatus.OK).json({ voided: true }) : res.status(HttpStatus.CONFLICT).json({ message: 'Only a published statement can be voided.' });
  }));

  return router;
}

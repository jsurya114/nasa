// Carrier assignment history (issue #140): import older reports without touching the weekly pay staging, review
// conflicting links, and void a wrong import. Which admin may do what: see routes/assignmentHistoryRoutes.js.
import ExcelJS from 'exceljs';
import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { UploadFileError, respondToUploadError } from '../../services/admin/uploadSafety.js';
import { recordWorkbookHistory } from '../../services/excel/assignmentHistory/recordWorkbookHistory.js';
import { listWaybillConflicts, voidImport } from '../../services/excel/assignmentHistory/assignmentStore.js';
import { extractAssignmentEvidence } from '../../services/excel/assignmentHistory/assignmentWorkbook.js';

const UNDEFINED_TABLE = '42P01';
const NOT_SET_UP = 'Assignment history is not set up in the database yet.';

const loadWorkbook = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new UploadFileError('The file could not be read. Upload the Excel (.xlsx) file as downloaded. Nothing was changed.');
  }
  return workbook;
};

const answerFailure = (res, error, message) => {
  if (respondToUploadError(res, error)) return;
  if (error?.code === UNDEFINED_TABLE) return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ success: false, message: NOT_SET_UP });
  logger.error(message, error);
  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: `${message} Nothing was changed.` });
};

// POST /admin/assignment-history/import  (multipart, field "file")
// Reads an older GOFO report (or any report with the same sheets) and keeps its waybill, Delivery ID and route
// evidence. It never touches the weekly staging data or any pay table, so an older report is safe to upload.
export const importAssignmentHistory = async (req, res) => {
  const file = req.file;
  if (!file?.buffer) {
    return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'No file uploaded or file buffer is missing' });
  }

  let client;
  try {
    const workbook = await loadWorkbook(file.buffer);
    const evidence = extractAssignmentEvidence(workbook);
    const usable = Object.values(evidence.sheets).some((sheet) => sheet.found && sheet.missingColumns.length === 0);
    if (!usable) {
      const found = workbook.worksheets.map((sheet) => sheet.name).join(', ');
      throw new UploadFileError(`The file needs a "Details of Delivery Fees" or "Offset Details" sheet with Waybill No and Delivery ID columns. Sheets found: ${found}. Nothing was changed.`);
    }

    client = await pool.connect();
    await client.query('BEGIN');
    let summary;
    try {
      summary = await recordWorkbookHistory(client, workbook, { buffer: file.buffer, fileName: file.originalname, user: req.user, bestEffort: false });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return res.status(HttpStatus.OK).json({ success: true, data: summary });
  } catch (error) {
    return answerFailure(res, error, 'The assignment history import failed.');
  } finally {
    client?.release();
  }
};

// GET /admin/assignment-history/conflicts?limit=&offset=  (super admin)
// Waybills whose standing history names more than one Delivery ID, driver or city.
export const getAssignmentConflicts = async (req, res) => {
  try {
    const conflicts = await listWaybillConflicts(pool, { limit: req.query.limit, offset: req.query.offset });
    return res.status(HttpStatus.OK).json({ success: true, data: conflicts });
  } catch (error) {
    return answerFailure(res, error, 'The conflicts could not be listed.');
  }
};

// POST /admin/assignment-history/imports/:importId/void  { reason }  (super admin)
export const voidAssignmentImport = async (req, res) => {
  const importId = Number(req.params.importId);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!Number.isSafeInteger(importId) || importId < 1) {
    return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'importId must be a positive whole number.' });
  }
  if (reason === '') {
    return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'A reason is required.' });
  }
  let client;
  try {
    // One client and one transaction: the void takes the import lock and must hold it until it commits.
    client = await pool.connect();
    await client.query('BEGIN');
    let voided;
    try {
      voided = await voidImport(client, importId, { reason, adminId: req.user.id });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    if (!voided) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'No such import, or it was already voided.' });
    }
    logger.info('Assignment history import voided', { import: importId, admin: req.user.id });
    return res.status(HttpStatus.OK).json({ success: true });
  } catch (error) {
    return answerFailure(res, error, 'The import could not be voided.');
  } finally {
    client?.release();
  }
};

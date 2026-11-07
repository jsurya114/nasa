// Carrier (GOFO) statements (issue #252). Mounted at /admin/finance/gofo-statements in app.js. Super admin only.
import multer from 'multer';
import adminAuth from '../middlewares/adminAuth.js';
import { requireRole } from '../middlewares/requireRole.js';
import pool from '../config/db.js';
import { createStatementRouter } from '../services/finance/gofoStatement/router.js';
import { createStatementService } from '../services/finance/gofoStatement/statementService.js';

const MAX_STATEMENT_BYTES = 25 * 1024 * 1024;

// Kept in memory only; a statement is never written to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_STATEMENT_BYTES, files: 1 } });

export default createStatementRouter({ adminAuth, requireRole, upload, service: createStatementService(pool) });

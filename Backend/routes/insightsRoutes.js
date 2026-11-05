// Insights page data (issue #227). Mounted at /admin/insights in app.js. Super admin only; read only.
import adminAuth from '../middlewares/adminAuth.js';
import { requireRole } from '../middlewares/requireRole.js';
import pool from '../config/db.js';
import { createInsightsRouter } from '../services/insights/router.js';
import { createReportRunner } from '../services/insights/reportRunner.js';

export default createInsightsRouter({ adminAuth, requireRole, run: createReportRunner({ pool }).run });

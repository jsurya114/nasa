// Carrier assignment history routes (issue #140). Mounted at /admin/assignment-history in app.js.
// Any admin may import a report (a city admin records only their own cities' routes); only a super admin may
// review conflicts or void an import.
import express from 'express';
import { sanitizeRouterParams } from '../middlewares/sanitize.js';
import { upload } from '../middlewares/multerConfig.js';
import adminAuth from '../middlewares/adminAuth.js';
import superAdminAuth from '../middlewares/superAdminAuth.js';
import {
  getAssignmentConflicts,
  importAssignmentHistory,
  voidAssignmentImport,
} from '../controllers/admin/assignmentHistoryController.js';

const router = express.Router();
sanitizeRouterParams(router);
router.use(adminAuth);

router.post('/import', upload.single('file'), importAssignmentHistory);
router.get('/conflicts', superAdminAuth, getAssignmentConflicts);
router.post('/imports/:importId/void', superAdminAuth, voidAssignmentImport);

export default router;

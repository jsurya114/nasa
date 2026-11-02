// Payroll routes (issues #138 to #145). Mounted at /admin/payroll in app.js. Admin and super admin only;
// each action also checks the admin's cities in its service.
import express from 'express';
import { sanitizeRouterParams } from '../middlewares/sanitize.js';
import adminAuth from '../middlewares/adminAuth.js';
import { getLedger, postLedgerEntry, postLedgerVoid } from '../controllers/payroll/ledgerController.js';

const router = express.Router();
sanitizeRouterParams(router);
router.use(adminAuth);

// Manual advances, repayments, expenses, reimbursements, claims and corrections (#142).
router.get('/ledger', getLedger);
router.post('/ledger', postLedgerEntry);
router.post('/ledger/:entryId/void', postLedgerVoid);

export default router;

// Payroll routes (issues #138 to #145). Mounted at /admin/payroll in app.js. Admin and super admin only;
// each action also checks the admin's cities in its service.
import express from 'express';
import { sanitizeRouterParams } from '../middlewares/sanitize.js';
import adminAuth from '../middlewares/adminAuth.js';
import { getLedger, postLedgerEntry, postLedgerVoid } from '../controllers/payroll/ledgerController.js';
import {
  getPayrollSettings, getPayRun, getPayRuns, postDiscard, postFinalize, postPayRun, postVoid, putRecoveryLimit,
} from '../controllers/payroll/payRunController.js';
import { getAdminStatement, getDriverBalanceList, getDriverStatementList } from '../controllers/payroll/statementController.js';

const router = express.Router();
sanitizeRouterParams(router);
router.use(adminAuth);

// Manual advances, repayments, expenses, reimbursements, claims and corrections (#142).
router.get('/ledger', getLedger);
router.post('/ledger', postLedgerEntry);
router.post('/ledger/:entryId/void', postLedgerVoid);

// Pay runs and the recovery limit (#143). Changing the setting and voiding a finalized run are super admin only,
// checked in the service.
router.get('/settings', getPayrollSettings);
router.put('/settings/recovery-limit', putRecoveryLimit);
router.get('/runs', getPayRuns);
router.post('/runs', postPayRun);
router.get('/runs/:runId', getPayRun);
router.post('/runs/:runId/finalize', postFinalize);
router.post('/runs/:runId/discard', postDiscard);
router.post('/runs/:runId/void', postVoid);

// Read-only statements and balances for one driver of the admin's cities (#145).
router.get('/statements/:statementId', getAdminStatement);
router.get('/drivers/:driverId/statements', getDriverStatementList);
router.get('/drivers/:driverId/balances', getDriverBalanceList);

export default router;

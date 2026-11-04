// Payroll routes (issues #138 to #145). Mounted at /admin/payroll in app.js. Admin and super admin only;
// each action also checks the admin's cities in its service.
import express from 'express';
import { sanitizeRouterParams } from '../middlewares/sanitize.js';
import adminAuth from '../middlewares/adminAuth.js';
import { getLedger, getLedgerHistory, postLedgerEdit, postLedgerEntry, postLedgerVoid, postSettlement, postSettlementReversal } from '../controllers/payroll/ledgerController.js';
import {
  getPayrollSettings, getPayRun, getPayRuns, postDiscard, postFinalize, postPayRun, postVoid, putRecoveryLimit,
} from '../controllers/payroll/payRunController.js';
import { getBatchReview } from '../controllers/payroll/payBatchController.js';
import { getEvereePreview } from '../controllers/payroll/evereeBatchController.js';
import { getStatus as getEvereeStatus, postCheck as postEvereeCheck } from '../controllers/payroll/evereeController.js';
import { getWorkers as getEvereeWorkers, postLink as postEvereeLink, postLookup as postEvereeLookup, postRefresh as postEvereeRefresh, postSandboxWorker as postEvereeSandboxWorker, postUnlink as postEvereeUnlink } from '../controllers/payroll/evereeWorkerController.js';
import { getAdminStatement, getDriverBalanceList, getDriverDashboardSummary, getDriverStatementList } from '../controllers/payroll/statementController.js';

const router = express.Router();
sanitizeRouterParams(router);
router.use(adminAuth);

// Manual advances, repayments, expenses, reimbursements, claims and corrections (#142).
router.get('/ledger', getLedger);
router.post('/ledger', postLedgerEntry);
router.post('/ledger/:entryId/void', postLedgerVoid);
// Edit keeps the original and links the corrected entry; history shows every version and settlement (#166).
router.post('/ledger/:entryId/edit', postLedgerEdit);
router.get('/ledger/:entryId/history', getLedgerHistory);
// Repaid outside payroll or waived, in whole or in part, and its reversal (#166).
router.post('/ledger/:entryId/settlements', postSettlement);
router.post('/ledger/settlements/:settlementId/reverse', postSettlementReversal);

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
// Everee connection (#31): whether the backend is set up and which environment, and a read-only test call. Super admin only, checked in the service.
router.get('/everee/status', getEvereeStatus);
router.post('/everee/check', postEvereeCheck);
// Linking drivers to existing Everee workers (#31): the city's drivers and their link state, a read-only lookup by email or phone, and a link
// that is saved only from one exact match. Test workers (sandbox only, made-up data), refresh and unlink. Super admin only, checked in the service.
router.get('/everee/workers', getEvereeWorkers);
router.post('/everee/workers/lookup', postEvereeLookup);
router.post('/everee/workers/link', postEvereeLink);
router.post('/everee/workers/refresh', postEvereeRefresh);
router.post('/everee/workers/unlink', postEvereeUnlink);
router.post('/everee/workers/sandbox-test', postEvereeSandboxWorker);
// City payment batch review (#144): read-only; says who could be paid and why not.
router.get('/runs/:runId/batch-review', getBatchReview);
// What paying this run through Everee would do (#31): who, how much, the total, what blocks anyone, and a fingerprint for the confirm step.
// Read-only; super admin only, checked in the service.
router.get('/runs/:runId/everee-preview', getEvereePreview);

// Read-only statements and balances for one driver of the admin's cities (#145).
router.get('/statements/:statementId', getAdminStatement);
router.get('/drivers/:driverId/statements', getDriverStatementList);
router.get('/drivers/:driverId/balances', getDriverBalanceList);
// This payday's deductions and what is still outstanding, for the dashboard (#166).
router.get('/drivers/:driverId/dashboard-summary', getDriverDashboardSummary);

export default router;

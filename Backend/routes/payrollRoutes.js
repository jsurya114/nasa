// Payroll routes (issues #138 to #145). Mounted at /admin/payroll in app.js. Super admin only, except the one
// Dashboard summary below; each action also checks the admin's cities in its service.
import express from 'express';
import { postConfirmContact } from '../controllers/payroll/contactReviewController.js';
import { getOnboardingReadiness } from '../controllers/payroll/evereeReadinessController.js';
import { sanitizeRouterParams } from '../middlewares/sanitize.js';
import adminAuth from '../middlewares/adminAuth.js';
import { requireRole } from '../middlewares/requireRole.js';
import { getLedger, getLedgerHistory, postLedgerEdit, postLedgerEntry, postLedgerVoid, postSettlement, postSettlementReversal } from '../controllers/payroll/ledgerController.js';
import {
  getPayrollSettings, getPayRun, getPayRuns, postDiscard, postFinalize, postPayRun, postVoid, putRecoveryLimit,
} from '../controllers/payroll/payRunController.js';
import { getBatchReview } from '../controllers/payroll/payBatchController.js';
import { getPaymentRuns, getPaymentReview, postPaymentRecord } from '../controllers/payroll/paymentRecordController.js';
import { getEvereePreview } from '../controllers/payroll/evereeBatchController.js';
import { getBatch as getEvereeBatch, getRunBatches as getEvereeRunBatches, getSettings as getEvereeCitySettings, postBatch as postEvereeBatch, postRetry as postEvereeBatchRetry, postCheck as postEvereeBatchCheck, putSettings as putEvereeCitySettings } from '../controllers/payroll/evereePaymentController.js';
import { getStatus as getEvereeStatus, postCheck as postEvereeCheck } from '../controllers/payroll/evereeController.js';
import { getWorkers as getEvereeWorkers, postLink as postEvereeLink, postLookup as postEvereeLookup, postRefresh as postEvereeRefresh, postSandboxWorker as postEvereeSandboxWorker, postUnlink as postEvereeUnlink } from '../controllers/payroll/evereeWorkerController.js';
import { getCallback as getQuickbooksCallback, getStatus as getQuickbooksStatus, getVendors as getQuickbooksVendors, postCheck as postQuickbooksCheck, postConnect as postQuickbooksConnect, postLink as postQuickbooksLink, postLookup as postQuickbooksLookup, postUnlink as postQuickbooksUnlink } from '../controllers/payroll/quickbooksController.js';
import { getBatch as getQuickbooksBatch, getPreview as getQuickbooksPreview, getRunBatches as getQuickbooksRunBatches, getSettings as getQuickbooksSettings, postBatch as postQuickbooksBatch, postRetry as postQuickbooksBatchRetry, putSettings as putQuickbooksSettings } from '../controllers/payroll/quickbooksPaymentController.js';
import { getAdminStatement, getDriverBalanceList, getDriverDashboardSummary, getDriverStatementList } from '../controllers/payroll/statementController.js';

const router = express.Router();
sanitizeRouterParams(router);
// QuickBooks sends the admin's browser back here after the sign-in. That is a plain page visit with no Authorization header, so this one route sits before the login
// check; the single-use state made by the signed-in admin identifies them, and the service checks they are still an active super admin.
router.get('/quickbooks/callback', getQuickbooksCallback);

router.use(adminAuth);

// This payday's deductions and what is still outstanding, for the Dashboard (#166). The one payroll call an ordinary admin
// still makes, because the Dashboard shows it; the service checks the admin's cities.
router.get('/drivers/:driverId/dashboard-summary', getDriverDashboardSummary);

// Everything below is for the super admin only: ledger, pay runs, payments and Everee. Keep new payroll routes below this line.
router.use(requireRole('superadmin'));

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
// QuickBooks for Desi drivers: connect the company (sign-in redirect and its callback), a read-only check, and linking each Desi driver to their existing
// vendor. Super admin only (the guard above); the services check the cities again.
router.get('/quickbooks/status', getQuickbooksStatus);
router.post('/quickbooks/connect', postQuickbooksConnect);
router.post('/quickbooks/check', postQuickbooksCheck);
router.get('/quickbooks/vendors', getQuickbooksVendors);
router.post('/quickbooks/vendors/lookup', postQuickbooksLookup);
router.post('/quickbooks/vendors/link', postQuickbooksLink);
router.post('/quickbooks/vendors/unlink', postQuickbooksUnlink);
// Recording a run's Desi payments in QuickBooks: the accounts used, what would be recorded (read-only, with a fingerprint), the confirm click, the batch and a safe retry.
router.get('/quickbooks/settings', getQuickbooksSettings);
router.put('/quickbooks/settings', putQuickbooksSettings);
router.get('/runs/:runId/quickbooks-preview', getQuickbooksPreview);
router.post('/runs/:runId/quickbooks-batches', postQuickbooksBatch);
router.get('/runs/:runId/quickbooks-batches', getQuickbooksRunBatches);
router.get('/quickbooks-batches/:batchId', getQuickbooksBatch);
router.post('/quickbooks-batches/:batchId/retry', postQuickbooksBatchRetry);
// Everee connection (#31): whether the backend is set up and which environment, and a read-only test call. Super admin only, checked in the service.
router.get('/everee/onboarding-readiness', getOnboardingReadiness);
// A driver's own email or phone change is held until a super admin confirms it (used by both Everee and QuickBooks linking).
router.post('/drivers/confirm-contact', postConfirmContact);
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
router.get('/payments/runs', getPaymentRuns);
router.get('/payments/runs/:runId', getPaymentReview);
router.post('/payments/runs/:runId/record', postPaymentRecord);
// What paying this run through Everee would do (#31): who, how much, the total, what blocks anyone, and a fingerprint for the confirm step.
// Read-only; super admin only, checked in the service.
router.get('/runs/:runId/everee-preview', getEvereePreview);
// Paying through Everee (#31, part 4): the confirm click sends the batch (only with the payments switch on), the batch and its per-driver
// results can be read, and what failed can be retried. Per-city Everee settings (time zone, work location). Super admin only, checked in the service.
router.post('/runs/:runId/everee-batches', postEvereeBatch);
router.get('/runs/:runId/everee-batches', getEvereeRunBatches);
router.get('/everee-batches/:batchId', getEvereeBatch);
router.post('/everee-batches/:batchId/retry', postEvereeBatchRetry);
router.post('/everee-batches/:batchId/check', postEvereeBatchCheck);
router.get('/everee/city-settings', getEvereeCitySettings);
router.put('/everee/city-settings/:cityId', putEvereeCitySettings);

// Read-only statements and balances for one driver of the admin's cities (#145).
router.get('/statements/:statementId', getAdminStatement);
router.get('/drivers/:driverId/statements', getDriverStatementList);
router.get('/drivers/:driverId/balances', getDriverBalanceList);

export default router;

// Invoices: saved vendors, invoices, history and payments received. Mounted at /admin/invoices in app.js. Super admin only: the token and the role are
// checked before any route below runs. Nothing here moves money: "payment received" records a payment that already arrived outside NASA.
import express from 'express';
import { sanitizeRouterParams } from '../middlewares/sanitize.js';
import adminAuth from '../middlewares/adminAuth.js';
import { requireRole } from '../middlewares/requireRole.js';
import {
  getInvoices, getNextNumber, getOneInvoice, getVendors, postInvoice, postPayment, postVendor, putInvoice, putVendor,
} from '../controllers/invoices/invoiceController.js';

const router = express.Router();
sanitizeRouterParams(router);
router.use(adminAuth);
// Everything below is for the super admin only. Keep new invoice routes below this line.
router.use(requireRole('superadmin'));

router.get('/vendors', getVendors);
router.post('/vendors', postVendor);
router.put('/vendors/:id', putVendor);

router.get('/next-number', getNextNumber);
router.get('/', getInvoices);
router.post('/', postInvoice);
router.get('/:id', getOneInvoice);
router.put('/:id', putInvoice);
router.post('/:id/payment', postPayment);

export default router;

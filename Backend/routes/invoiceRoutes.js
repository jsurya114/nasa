// Invoices: saved vendors, invoices, history and payments received. Mounted at /admin/invoices in app.js. The super admin, and the admins the super admin
// switched Invoices on for: the token and the access are checked before any route below runs. An admin sees only the invoices they created. Nothing here moves money: "payment received" records a payment that already arrived outside NASA.
import express from 'express';
import { sanitizeRouterParams } from '../middlewares/sanitize.js';
import adminAuth from '../middlewares/adminAuth.js';
import { requireInvoiceAccess } from '../middlewares/requireInvoiceAccess.js';
import {
  getAccess, getInvoices, getNextNumber, getOneInvoice, getVendors, postInvoice, postPayment, postVendor, putInvoice, putVendor,
} from '../controllers/invoices/invoiceController.js';

const router = express.Router();
sanitizeRouterParams(router);
router.use(adminAuth);
// Any signed-in admin may ask whether they have access (the menu and the page use it). It changes nothing.
router.get('/access', getAccess);
// Everything below needs Invoices access. Keep new invoice routes below this line.
router.use(requireInvoiceAccess);

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

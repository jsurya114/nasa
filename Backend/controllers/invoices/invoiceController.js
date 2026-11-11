// HTTP side of the Invoices module. Super admin only (routes/invoiceRoutes.js checks the token and the role before any of these run).
// The admin always comes from the verified token. Short messages only: never the request body or SQL.
import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { withTransaction } from '../../services/payroll/claims/claimsStore.js';
import { InvoiceInputError, parseHistoryQuery, parseInvoice, parsePayment, parseVendor } from '../../services/invoices/invoiceRules.js';
import {
  InvoiceError, createInvoice, createVendor, getInvoice, listInvoices, listVendors, markPaymentReceived, nextInvoiceNumber, updateInvoice, updateVendor,
} from '../../services/invoices/invoiceStore.js';

const adminOf = (req) => req.admin ?? req.user;
const idOf = (value) => (/^\d{1,18}$/.test(String(value ?? '')) && Number(value) > 0 ? Number(value) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fail = (res, error, action) => {
  if (error instanceof InvoiceInputError) return res.status(HttpStatus.BAD_REQUEST).json({ message: error.message, errors: error.errors });
  if (error instanceof InvoiceError) return res.status(error.status).json({ message: error.message, ...(error.code && { code: error.code }), ...(error.errors && { errors: error.errors }) });
  logger.error(`Invoice ${action} failed`, { code: error?.code, constraint: error?.constraint, message: error?.message });
  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'The invoice could not be saved. Try again.' });
};

const handle = (action, job) => async (req, res) => {
  try {
    return await job(req, res);
  } catch (error) {
    return fail(res, error, action);
  }
};

export const getVendors = handle('vendor list', async (_req, res) => res.status(HttpStatus.OK).json({ vendors: await listVendors(pool) }));

export const postVendor = handle('vendor create', async (req, res) => {
  const vendor = parseVendor(req.body);
  return res.status(HttpStatus.CREATED).json({ vendor: await createVendor(pool, adminOf(req), vendor) });
});

export const putVendor = handle('vendor update', async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(HttpStatus.NOT_FOUND).json({ message: 'Vendor not found.' });
  const vendor = parseVendor(req.body);
  return res.status(HttpStatus.OK).json({ vendor: await updateVendor(pool, adminOf(req), id, vendor) });
});

export const getInvoices = handle('history', async (req, res) => res.status(HttpStatus.OK).json(await listInvoices(pool, parseHistoryQuery(req.query))));

export const getNextNumber = handle('next number', async (_req, res) => res.status(HttpStatus.OK).json({ invoiceNumber: await nextInvoiceNumber(pool) }));

export const getOneInvoice = handle('read', async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(HttpStatus.NOT_FOUND).json({ message: 'Invoice not found.' });
  return res.status(HttpStatus.OK).json({ invoice: await getInvoice(pool, id) });
});

export const postInvoice = handle('create', async (req, res) => {
  const input = parseInvoice(req.body);
  const requestId = req.body?.requestId;
  if (requestId !== undefined && !UUID.test(String(requestId))) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'Unknown request id.' });
  const result = await withTransaction(pool, (db) => createInvoice(db, adminOf(req), input, requestId));
  return res.status(result.replay ? HttpStatus.OK : HttpStatus.CREATED).json(result);
});

export const putInvoice = handle('update', async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(HttpStatus.NOT_FOUND).json({ message: 'Invoice not found.' });
  const version = idOf(req.body?.version);
  if (!version) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'Open the invoice again before saving it.' });
  const input = parseInvoice(req.body);
  const invoice = await withTransaction(pool, (db) => updateInvoice(db, adminOf(req), id, input, version));
  return res.status(HttpStatus.OK).json({ invoice });
});

export const postPayment = handle('payment', async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(HttpStatus.NOT_FOUND).json({ message: 'Invoice not found.' });
  const payment = parsePayment(req.body);
  const result = await withTransaction(pool, (db) => markPaymentReceived(db, adminOf(req), id, payment));
  return res.status(HttpStatus.OK).json(result);
});

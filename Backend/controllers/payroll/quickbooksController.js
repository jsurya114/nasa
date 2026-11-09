// HTTP side of the QuickBooks connection and the Desi vendor links. Super admin only, checked in the services together with the admin's cities.

import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { PayrollError } from '../../services/payroll/payRuns/payRunStore.js';
import { checkQuickbooks, finishConnect, getQuickbooksStatus, startConnect } from '../../services/payments/quickbooks/quickbooksService.js';
import { linkVendor, listCityVendors, lookupVendor, unlinkVendor } from '../../services/payments/quickbooks/vendorStore.js';

const id = (value) => (/^\d{1,12}$/.test(String(value ?? '')) && Number(value) > 0 ? Number(value) : null);
const vendorIdOf = (value) => (typeof value === 'string' && /^[0-9]{1,20}$/.test(value) ? value : null);

const fail = (res, error, action) => {
  if (error instanceof PayrollError) return res.status(error.status).json({ message: error.message });
  logger.error(`QuickBooks ${action} failed`, { code: error.code, message: error.message });
  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'the QuickBooks request could not be completed; try again' });
};

const run = (action, handler) => async (req, res) => {
  try {
    return res.status(HttpStatus.OK).json(await handler(req));
  } catch (error) {
    return fail(res, error, action);
  }
};

const scope = (source) => ({ cityId: id(source.cityId), driverId: id(source.driverId) });
const need = (values, keys) => {
  for (const key of keys) if (!values[key]) throw new PayrollError(HttpStatus.BAD_REQUEST, `${key} must be a number`);
  return values;
};

export const getStatus = run('status', (req) => getQuickbooksStatus(pool, req.admin));
export const postConnect = run('connect', (req) => startConnect(pool, req.admin));
export const postCheck = run('check', (req) => checkQuickbooks(pool, req.admin));

// QuickBooks sends the admin's browser here after the sign-in. A short page, so no screen of the app is needed and nothing sensitive stays in the address bar.
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p></body></html>`;
export const getCallback = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  try {
    const { code, state, realmId, error } = req.query;
    if (error) throw new PayrollError(HttpStatus.BAD_REQUEST, 'QuickBooks was not approved');
    await finishConnect(pool, req.admin, { code, state, realmId });
    return res.status(HttpStatus.OK).type('html').send(page('QuickBooks connected', 'You can close this tab and go back to NASA.'));
  } catch (err) {
    const message = err instanceof PayrollError ? err.message : 'the QuickBooks connection could not be completed; try again';
    if (!(err instanceof PayrollError)) logger.error('QuickBooks callback failed', { code: err.code, message: err.message });
    return res.status(err instanceof PayrollError ? err.status : HttpStatus.INTERNAL_SERVER_ERROR).type('html').send(page('QuickBooks was not connected', message.replace(/[<>&"]/g, '')));
  }
};

export const getVendors = run('list', (req) => listCityVendors(pool, req.admin, need({ cityId: id(req.query.cityId) }, ['cityId']).cityId));
export const postLookup = run('lookup', (req) => lookupVendor(pool, req.admin, need(scope(req.body ?? {}), ['cityId', 'driverId'])));
export const postLink = run('link', (req) => {
  const { cityId, driverId } = need(scope(req.body ?? {}), ['cityId', 'driverId']);
  const vendorId = vendorIdOf(req.body?.vendorId);
  if (!vendorId) throw new PayrollError(HttpStatus.BAD_REQUEST, 'vendorId must be the ID of the vendor that was found');
  return linkVendor(pool, req.admin, { cityId, driverId, vendorId });
});
export const postUnlink = run('unlink', (req) => {
  const { cityId, driverId } = need(scope(req.body ?? {}), ['cityId', 'driverId']);
  return unlinkVendor(pool, req.admin, { cityId, driverId, reason: req.body?.reason });
});

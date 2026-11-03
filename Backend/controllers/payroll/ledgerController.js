// HTTP side of the manual driver ledger (issue #142). Admin and super admin only (payrollRoutes.js).
// The admin always comes from the verified token; city access is checked in ledgerStore.js.

import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { withTransaction } from '../../services/payroll/claims/claimsStore.js';
import { parseNewEntry, parseReversal, parseSettlement, parseVoid } from '../../services/payroll/ledger/ledgerRules.js';
import { createEntry, listEntries, LedgerError, voidEntry } from '../../services/payroll/ledger/ledgerStore.js';
import { reverseSettlement, settleEntry } from '../../services/payroll/ledger/ledgerSettlements.js';

const optionalId = (value) => {
  if (value === undefined || value === '') return { id: null };
  return /^\d{1,9}$/.test(String(value)) && Number(value) > 0 ? { id: Number(value) } : { error: true };
};

const fail = (res, error, action) => {
  if (error instanceof LedgerError) return res.status(error.status).json({ message: error.message });
  // Short message only: never the request body or SQL.
  logger.error(`Ledger ${action} failed`, { code: error.code, message: error.message });
  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'the ledger could not be updated; try again' });
};

export const getLedger = async (req, res) => {
  const city = optionalId(req.query.cityId);
  const driver = optionalId(req.query.driverId);
  if (city.error || driver.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'cityId and driverId must be numbers' });
  try {
    return res.status(HttpStatus.OK).json(await listEntries(pool, req.admin, { cityId: city.id, driverId: driver.id }));
  } catch (error) {
    return fail(res, error, 'list');
  }
};

export const postLedgerEntry = async (req, res) => {
  const { entry, errors } = parseNewEntry(req.body);
  if (errors) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'check the highlighted fields', errors });
  try {
    const result = await withTransaction(pool, (db) => createEntry(db, req.admin, entry));
    logger.info('Ledger entry recorded', { entryId: result.entry.id, type: result.entry.entry_type, replay: result.replay });
    return res.status(result.replay ? HttpStatus.OK : HttpStatus.CREATED).json(result);
  } catch (error) {
    return fail(res, error, 'create');
  }
};

export const postLedgerVoid = async (req, res) => {
  const { void: request, errors } = parseVoid(req.body, req.params.entryId);
  if (errors) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'check the highlighted fields', errors });
  try {
    const result = await withTransaction(pool, (db) => voidEntry(db, req.admin, request));
    logger.info('Ledger entry voided', { entryId: request.entryId, voidId: result.entry.id, replay: result.replay });
    return res.status(result.replay ? HttpStatus.OK : HttpStatus.CREATED).json(result);
  } catch (error) {
    // Two admins voiding the same entry at once: the database lets only one through.
    if (error.code === '23505') return res.status(HttpStatus.CONFLICT).json({ message: 'this entry is already voided' });
    return fail(res, error, 'void');
  }
};

export const postSettlement = async (req, res) => {
  const { settlement, errors } = parseSettlement(req.body, req.params.entryId);
  if (errors) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'check the highlighted fields', errors });
  try {
    const result = await withTransaction(pool, (db) => settleEntry(db, req.admin, settlement));
    logger.info('Ledger entry settled', { entryId: settlement.entryId, kind: settlement.kind, settlementId: result.settlement.id, replay: result.replay });
    return res.status(result.replay ? HttpStatus.OK : HttpStatus.CREATED).json(result);
  } catch (error) {
    return fail(res, error, 'settle');
  }
};

export const postSettlementReversal = async (req, res) => {
  const { reversal, errors } = parseReversal(req.body, req.params.settlementId);
  if (errors) return res.status(HttpStatus.BAD_REQUEST).json({ message: 'check the highlighted fields', errors });
  try {
    const result = await withTransaction(pool, (db) => reverseSettlement(db, req.admin, reversal));
    logger.info('Ledger settlement reversed', { settlementId: reversal.settlementId, reversalId: result.settlement.id, replay: result.replay });
    return res.status(result.replay ? HttpStatus.OK : HttpStatus.CREATED).json(result);
  } catch (error) {
    // Two admins reversing the same settlement at once: the database lets only one through.
    if (error.code === '23505') return res.status(HttpStatus.CONFLICT).json({ message: 'this settlement was already reversed' });
    return fail(res, error, 'reverse');
  }
};

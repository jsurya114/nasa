// Saves the assignment evidence of one loaded GOFO report (issue #140). The one place both callers use: the weekly
// upload (which also stages pay data) and the history-only import (older reports, no pay data).
//
// Call inside the caller's open transaction on `client`.

import { createHash } from 'node:crypto';
import { getAllowedJobs, isCityLimited } from '../../admin/adminCityAccess.js';
import logger from '../../../utils/logger.js';
import { extractAssignmentEvidence } from './assignmentWorkbook.js';
import { recordReport } from './assignmentStore.js';

const UNDEFINED_TABLE = '42P01';
const SAVEPOINT = 'assignment_history';
const MAX_PROBLEMS_SHOWN = 10;

const summarize = (evidence, saved, claims) => ({
  saved: true,
  importId: saved.importId,
  alreadyRecorded: saved.alreadyRecorded,
  voided: saved.voided,
  recorded: saved.recorded,
  alreadyKnown: saved.known,
  reassertedAfterVoid: saved.revived,
  leftOut: saved.skipped,
  linkedNow: saved.resolved,
  claimsRematched: claims,
  problems: evidence.problemCount,
  problemRows: evidence.problems.slice(0, MAX_PROBLEMS_SHOWN),
  sheets: Object.fromEntries(Object.entries(evidence.sheets).map(([name, sheet]) => [name, { found: sheet.found, rows: sheet.rows, missingColumns: sheet.missingColumns }])),
});

// Claims are no longer matched from this history (issue #180): the owner decided a claim is matched to its driver by the Courier
// name, found in Details of Delivery Fees, when the weekly report is uploaded (see payroll/claims/recordWorkbookClaims.js). Waybill
// history is kept as evidence only, so `claimsRematched` is always null.

// workbook: a loaded ExcelJS workbook. buffer: the file's bytes (the hash recognises a renamed copy).
// user: req.user ({ id, role }). fileName: only a label.
//
// bestEffort: true for the weekly upload. The history is then written inside a savepoint: if it cannot be written
// (for example the migration has not been run yet) the pay upload carries on exactly as before and the answer says
// the history was not saved. false for the history-only import, where saving the history is the whole job.
export const recordWorkbookHistory = async (client, workbook, { buffer, fileName, user, bestEffort }) => {
  let evidence;
  try {
    evidence = extractAssignmentEvidence(workbook);
  } catch (error) {
    if (!bestEffort) throw error;
    logger.error('Assignment history could not be read from the report', error);
    return { saved: false, reason: 'The report could not be read for assignment history.', routeCodes: [] };
  }
  // Every route the report names on either sheet, even on a row that gives no usable package identity, for callers
  // that need to know which city the report belongs to.
  const { routeCodes } = evidence;

  if (bestEffort) await client.query(`SAVEPOINT ${SAVEPOINT}`);
  try {
    const allowedJobs = isCityLimited(user.role) ? await getAllowedJobs(user.id, client) : null;
    const saved = await recordReport(client, evidence, {
      reportHash: createHash('sha256').update(buffer).digest('hex'),
      sourceLabel: fileName,
      importedBy: user.id ?? null,
      allowedJobs,
    });
    if (bestEffort) await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    const claims = null;
    logger.info('Assignment history stored', { import: saved.importId, recorded: saved.recorded, known: saved.known, leftOut: saved.skipped, problems: evidence.problemCount });
    return { ...summarize(evidence, saved, claims), routeCodes };
  } catch (error) {
    if (!bestEffort) throw error;
    await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    logger.error('Assignment history was not saved; the upload continues without it', error);
    return {
      saved: false,
      reason: error.code === UNDEFINED_TABLE
        ? 'Assignment history is not set up in the database yet.'
        : 'Assignment history could not be saved.',
      routeCodes,
    };
  }
};

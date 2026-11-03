// Saves the assignment evidence of one loaded GOFO report (issue #140). The one place both callers use: the weekly
// upload (which also stages pay data) and the history-only import (older reports, no pay data).
//
// Call inside the caller's open transaction on `client`.

import { createHash } from 'node:crypto';
import { getAllowedJobs, isCityLimited } from '../../admin/adminCityAccess.js';
import logger from '../../../utils/logger.js';
import { extractAssignmentEvidence } from './assignmentWorkbook.js';
import { recordReport, candidateFinderFor } from './assignmentStore.js';
import { rematchAllOpenClaims } from '../../payroll/claims/claimsStore.js';

const UNDEFINED_TABLE = '42P01';
const SAVEPOINT = 'assignment_history';
const CLAIMS_SAVEPOINT = 'assignment_claims_rematch';
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

// New evidence can settle claims that were waiting for it. Only claims still open are looked at, and only from
// history, so nothing already chargeable, exempt or held for review changes. This is a second step with its own
// savepoint: if it fails (for example the claims tables are not set up yet) the history just saved is kept.
// Returns the counts, null when nothing new could change a claim, or { failed: true }.
const rematchClaims = async (client, saved, { limited }) => {
  const gainedEvidence = saved.recorded > 0 || saved.revived > 0 || saved.resolved.drivers > 0 || saved.resolved.routes > 0;
  if (!gainedEvidence) return null;
  await client.query(`SAVEPOINT ${CLAIMS_SAVEPOINT}`);
  try {
    const counts = await rematchAllOpenClaims(client, candidateFinderFor(client));
    await client.query(`RELEASE SAVEPOINT ${CLAIMS_SAVEPOINT}`);
    // The rematch covers every city, because the match depends only on history. A city admin must not learn
    // how many claims other cities have, so they are told only that it ran.
    return limited ? { ran: true } : counts;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${CLAIMS_SAVEPOINT}`);
    logger.error('Courier claims were not rematched after the assignment history was saved', error);
    return { failed: true };
  }
};

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
    return { saved: false, reason: 'The report could not be read for assignment history.' };
  }

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
    const claims = await rematchClaims(client, saved, { limited: allowedJobs !== null });
    logger.info('Assignment history stored', { import: saved.importId, recorded: saved.recorded, known: saved.known, leftOut: saved.skipped, problems: evidence.problemCount });
    return summarize(evidence, saved, claims);
  } catch (error) {
    if (!bestEffort) throw error;
    await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    logger.error('Assignment history was not saved; the upload continues without it', error);
    return {
      saved: false,
      reason: error.code === UNDEFINED_TABLE
        ? 'Assignment history is not set up in the database yet.'
        : 'Assignment history could not be saved.',
    };
  }
};

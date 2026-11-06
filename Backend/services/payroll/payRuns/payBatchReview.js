// Read-only review of one pay run as a city payment batch (issue #144). It moves no money and changes nothing:
// it lays out each driver's statement, says who could be paid and why anyone cannot, and discloses what is still
// waiting for the city (claims not yet matched, which have no driver). Recording a payment or submitting to Everee (#31) are separate, later steps.
//
// The population is the statements frozen on the run, chosen by immutable IDs on the server. No name, page or
// client-sent list decides who is in the batch.

import { fromCents, toCents } from './payCalculator.js';
import { assertCityAllowed, PayrollError } from './payRunStore.js';
import { typeBlockers } from './driverPaymentRules.js';
import { blockedDriverIds, ONBOARDING_REQUIRED } from '../../payments/everee/onboardingGate.js';

// blocking: this driver cannot be paid from this batch. disclose: shown to the person confirming; does not block.
export const BLOCKERS = Object.freeze({
  run_not_finalized: { severity: 'blocking', message: 'the pay run is not finalized; only a finalized run can be paid' },
  negative_net: { severity: 'blocking', message: 'the statement is below zero; nothing is paid until it is reviewed' },
  payout_in_progress: { severity: 'blocking', message: 'a payment was already submitted or its result is unconfirmed; reconcile it before paying again' },
  already_paid: { severity: 'blocking', message: 'this statement is already paid' },
  previous_payout_failed: { severity: 'disclose', message: 'an earlier payment attempt failed; check that it did not go through before paying again' },
});

const FLAG_SEVERITY = 'disclose';

// Pure. statement: a pay_statements row. runStatus: the run's status.
export const blockersFor = ({ statement, runStatus }) => {
  const found = [];
  const add = (code, extra = {}) => found.push({ code, ...BLOCKERS[code], ...extra });
  if (runStatus !== 'finalized') add('run_not_finalized');
  if (toCents(statement.net) < 0) add('negative_net');
  if (statement.payout_status === 'paid') add('already_paid');
  else if (statement.payout_status === 'submitted' || statement.payout_status === 'unconfirmed') add('payout_in_progress');
  else if (statement.payout_status === 'failed') add('previous_payout_failed');
  for (const flag of statement.flags ?? []) {
    found.push({ code: flag.code, severity: FLAG_SEVERITY, message: flag.message, ...(flag.entryId ? { entryId: flag.entryId } : {}) });
  }
  return found;
};

const SUM_KEYS = [['gross', 'gross'], ['insurance', 'insurance'], ['reimbursements', 'reimbursements'], ['claimDeductions', 'claim_deductions'], ['recoveries', 'recoveries'], ['net', 'net'], ['carriedForward', 'carried_forward']];

export const reviewRunAsBatch = async (db, admin, runId) => {
  const { rows: runs } = await db.query(
    `SELECT id, city_id, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end, data_type, status
       FROM pay_runs WHERE id = $1`, [runId]);
  const run = runs[0];
  if (!run) throw new PayrollError(404, 'pay run not found');
  await assertCityAllowed(db, admin, run.city_id);

  const { rows: statements } = await db.query(
    `SELECT s.id, s.driver_id, d.name AS driver_name, s.gross, s.insurance, s.reimbursements, s.claim_deductions, s.recoveries,
            s.net, s.carried_forward, s.flags, s.payout_status, d.driver_type
       FROM pay_statements s JOIN drivers d ON d.id = s.driver_id
      WHERE s.pay_run_id = $1 ORDER BY d.name, s.id`, [runId]);
  const driverIds = statements.map((s) => s.driver_id);
  // A Local driver whose Everee onboarding is not complete is held for every payment method (empty while the gate is off).
  const onboardingHeld = await blockedDriverIds(db, driverIds);

  // Claims of this city that are not decided yet. A claim with no decision has no driver (#141), so these are shown for
  // the whole city and never attributed to a driver. They are not deducted in any statement of this batch.
  const { rows: pending } = await db.query(
    `SELECT m.status, count(*)::int AS n
       FROM courier_claim_matches m JOIN courier_claims c ON c.id = m.claim_id
      WHERE c.import_city_id = $1 AND c.superseded_at IS NULL AND m.status IN ('unresolved', 'ambiguous', 'review')
      GROUP BY m.status`, [run.city_id]);
  const pendingClaims = { unresolved: 0, ambiguous: 0, review: 0, total: 0 };
  for (const r of pending) { pendingClaims[r.status] = r.n; pendingClaims.total += r.n; }

  const drivers = statements.map((s) => {
    // A driver with no type (or a type that is not Local or Desi) is blocked for every payment method until an admin sets one.
    const blockers = [...blockersFor({ statement: s, runStatus: run.status }), ...typeBlockers(s.driver_type),
      ...(onboardingHeld.has(s.driver_id) ? [{ code: ONBOARDING_REQUIRED.code, severity: 'blocking', message: ONBOARDING_REQUIRED.message }] : [])];
    return {
      statementId: s.id,
      driverId: s.driver_id,
      driverName: s.driver_name,
      driverType: s.driver_type ?? null,
      amounts: Object.fromEntries(SUM_KEYS.map(([out, col]) => [out, s[col]])),
      payoutStatus: s.payout_status,
      blockers,
      eligible: !blockers.some((b) => b.severity === 'blocking'),
    };
  });

  const eligible = drivers.filter((d) => d.eligible);
  const totalsOf = (list) => Object.fromEntries(SUM_KEYS.map(([out]) => [out, fromCents(list.reduce((sum, d) => sum + toCents(d.amounts[out]), 0))]));
  return {
    run,
    drivers,
    summary: {
      drivers: drivers.length,
      eligible: eligible.length,
      blocked: drivers.length - eligible.length,
      withDisclosures: eligible.filter((d) => d.blockers.length > 0).length,
      eligibleTotals: totalsOf(eligible),
      // City-level: claims still waiting for a driver. They are not deducted here; confirm knowing they are open.
      pendingClaims,
    },
    // Reading the review changes nothing and cannot pay anyone. Paying is a separate confirmed step.
    readOnly: true,
  };
};

import { createHash } from 'node:crypto';
import { fromCents, toCents } from '../../payroll/payRuns/payCalculator.js';
import { PayrollError, isSuperAdmin } from '../../payroll/payRuns/payRunStore.js';
import { reviewRunAsBatch } from '../../payroll/payRuns/payBatchReview.js';
import { paymentsGate, readEvereeConfig } from './evereeConfig.js';
import { driverIssues, readyToPay } from './workerRules.js';

// The preview of paying a finalized pay run through Everee (issue #31, part 3). READ-ONLY: it calls nothing at Everee, writes nothing and
// pays no one. It is what the person confirming looks at (#144: no blind transfer): who would be paid, how much, the total, and what blocks
// anyone, with the reason. The amount is each statement's frozen net; nothing is recalculated here.
//
// It builds on the batch review of #144 (the statements of the run, chosen by ID on the server; blockers for an unfinalized run, a
// negative net, and a payment already submitted or paid) and adds Everee's rules. Rules agreed with Jasil on #31:
//   block: net below zero, a payment already submitted or unconfirmed, the run not finalized, the driver not linked to an Everee worker, or
//          the worker not ready (onboarding incomplete, tax ID check failed, or left); also a net of exactly zero (nothing to pay).
//   warn (do not block): claims still waiting in the city; earlier failed attempts; the statement's own flags.
//   only a super admin confirms, and not the person who finalized the run.
// `previewHash` fingerprints exactly what would be paid. The confirming step sends it back; if anything changed the server answers 409
// and shows a new preview.

export const EVEREE_BLOCKERS = Object.freeze({
  nothing_to_pay: { severity: 'blocking', message: 'the statement is $0.00; there is nothing to pay' },
  no_everee_worker: { severity: 'blocking', message: 'this driver is not linked to an Everee worker' },
  worker_not_ready: { severity: 'blocking', message: 'the Everee worker cannot be paid yet' },
});

const WORKER_PROBLEMS = Object.freeze({
  onboarding_incomplete: 'the worker has not finished onboarding in Everee',
  tin_verification_failed: 'the worker\'s tax ID check failed in Everee',
  separated: 'the worker has left (separated) in Everee',
});

export const workerProblems = (link) => {
  const found = [];
  if (!link.onboarding_complete) found.push('onboarding_incomplete');
  if (link.tin_status === 'VERIFICATION_FAILED') found.push('tin_verification_failed');
  if (link.terminated) found.push('separated');
  return found;
};

// Fingerprint of what would be paid: the run, the environment and, for each driver who can be paid, the statement, the amount in cents and the
// Everee worker. The same facts always give the same hash; any change gives another.
export const previewHashOf = ({ runId, environment, items }) => {
  const canonical = items
    .map((i) => [i.statementId, i.driverId, i.amountCents, i.workerId])
    .sort((a, b) => a[0] - b[0]);
  return createHash('sha256').update(JSON.stringify({ v: 1, runId, environment, items: canonical })).digest('hex');
};

export const previewEvereeBatch = async (db, admin, runId, { env = process.env } = {}) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can preview or confirm a payment to Everee');
  const review = await reviewRunAsBatch(db, admin, runId); // also checks the run exists and the admin's city
  const config = readEvereeConfig(env);
  const gate = paymentsGate(config, env);

  const { rows: [meta] } = await db.query('SELECT finalized_by FROM pay_runs WHERE id = $1', [runId]);
  const driverIds = review.drivers.map((d) => d.driverId);
  const [{ rows: links }, { rows: people }] = await Promise.all([
    config.configured
      ? db.query(
        `SELECT driver_id, everee_worker_id, onboarding_complete, tin_status, terminated FROM everee_workers
          WHERE environment = $1 AND unlinked_at IS NULL AND driver_id = ANY($2::int[])`, [config.environment, driverIds])
      : { rows: [] },
    db.query('SELECT id, name, phone_number, email FROM drivers WHERE id = ANY($1::int[])', [driverIds]),
  ]);
  const linkOf = new Map(links.map((l) => [l.driver_id, l]));
  const personOf = new Map(people.map((p) => [p.id, p]));

  const drivers = review.drivers.map((d) => {
    const blockers = [...d.blockers];
    const add = (code, extra = {}) => blockers.push({ code, ...EVEREE_BLOCKERS[code], ...extra });
    const amountCents = toCents(d.amounts.net);
    if (amountCents === 0) add('nothing_to_pay');

    const link = linkOf.get(d.driverId);
    let worker = { linked: false, ready: false, problems: [], driverDataIssues: [] };
    if (!link) {
      // Why: no worker is linked yet; a driver with a data problem (one-word name, no valid phone) has to be fixed before a lookup can run.
      const issues = driverIssues(personOf.get(d.driverId)).map((i) => i.code);
      worker = { ...worker, driverDataIssues: issues };
      add('no_everee_worker', { hint: issues.length > 0 ? 'fix_driver_data' : 'link_worker' });
    } else {
      const problems = workerProblems(link);
      const ready = readyToPay({ onboardingComplete: link.onboarding_complete, tinStatus: link.tin_status, terminated: link.terminated });
      worker = { linked: true, ready, problems, driverDataIssues: [] };
      if (!ready) add('worker_not_ready', { problems: problems.map((code) => ({ code, message: WORKER_PROBLEMS[code] })) });
    }
    return {
      statementId: d.statementId, driverId: d.driverId, driverName: d.driverName, amount: d.amounts.net, amounts: d.amounts,
      payoutStatus: d.payoutStatus, worker, blockers, eligible: !blockers.some((b) => b.severity === 'blocking'),
      _workerId: link?.everee_worker_id ?? null,
    };
  });

  const eligible = drivers.filter((d) => d.eligible);
  const batchBlockers = [];
  if (review.run.status !== 'finalized') batchBlockers.push({ code: 'run_not_finalized', message: 'the pay run is not finalized; only a finalized run can be paid' });
  if (!gate.enabled) batchBlockers.push({ code: 'payments_off', message: gate.reason });
  if (eligible.length === 0) batchBlockers.push({ code: 'nobody_to_pay', message: 'no driver in this run can be paid right now' });

  const finalizedBy = meta?.finalized_by ?? null;
  const confirm = finalizedBy !== null && Number(finalizedBy) === Number(admin.id)
    ? { allowed: false, reason: 'you finalized this run; another super admin has to confirm the payment' }
    : { allowed: true, reason: null };

  const previewHash = config.configured
    ? previewHashOf({
      runId, environment: config.environment,
      items: eligible.map((d) => ({ statementId: d.statementId, driverId: d.driverId, amountCents: toCents(d.amount), workerId: d._workerId })),
    })
    : null;

  return {
    readOnly: true,
    environment: config.configured ? config.environment : null, // naming an environment when nothing is set up would mislead
    run: review.run,
    drivers: drivers.map(({ _workerId, ...rest }) => rest),
    summary: {
      drivers: drivers.length,
      eligible: eligible.length,
      blocked: drivers.length - eligible.length,
      withWarnings: eligible.filter((d) => d.blockers.length > 0).length,
      total: fromCents(eligible.reduce((sum, d) => sum + toCents(d.amount), 0)),
      pendingClaims: review.summary.pendingClaims,
    },
    // What stops the whole batch (separate from one driver being blocked). `canSubmit` is true only when nothing stops it.
    batchBlockers,
    canSubmit: batchBlockers.length === 0,
    confirm,
    previewHash,
  };
};

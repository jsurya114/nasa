/**
 * Carrier claim exposure and the payment overview (issue #220). Both read the reporting views over the approved payroll
 * tables, so they only describe what Payroll already decided; they decide nothing and never touch a pay run.
 */
import { InputError, centsToText, toCents } from './inputs.js';

const MONEY = 'numeric(16,2)';
const ZERO = '0.00';
const cityScope = (alias) => `($1::int[] IS NULL OR ${alias}.city_id = ANY($1::int[]))`;

async function assertCities(db, cityIds) {
  if (cityIds === null) return;
  const { rows } = await db.query('SELECT city_id FROM reporting.cities WHERE city_id = ANY($1::int[])', [cityIds]);
  const known = new Set(rows.map((r) => r.city_id));
  const unknown = cityIds.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new InputError(`Unknown city_id: ${unknown.join(', ')}. Use list_reporting_cities to see the valid ones.`);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Claims by what was decided about them. `period` (optional) limits by the claim's own date.
export async function claimExposure(db, { period = null, cityIds }) {
  await assertCities(db, cityIds);
  const { rows } = await db.query(
    `SELECT f.decision,
            (count(*))::int AS claims,
            (COALESCE(sum(f.claim_amount), 0))::${MONEY} AS claim_amount,
            (COALESCE(sum(f.chargeable_amount), 0))::${MONEY} AS chargeable_amount,
            (COALESCE(sum(f.deducted_in_approved_runs), 0))::${MONEY} AS deducted,
            (COALESCE(sum(GREATEST(COALESCE(f.chargeable_amount, 0) - f.deducted_in_approved_runs, 0)), 0))::${MONEY} AS still_to_deduct,
            to_char(min(f.claim_date), 'YYYY-MM-DD') AS oldest,
            to_char(max(f.claim_date), 'YYYY-MM-DD') AS newest
       FROM reporting.claim_facts f
      WHERE ${cityScope('f')} AND ($2::date IS NULL OR f.claim_date >= $2::date) AND ($3::date IS NULL OR f.claim_date <= $3::date)
      GROUP BY f.decision`,
    [cityIds, period?.startDate ?? null, period?.endDate ?? null]
  );
  const by = Object.fromEntries(rows.map((r) => [r.decision, r]));
  const pick = (name) => by[name] ?? { claims: 0, claim_amount: ZERO, chargeable_amount: ZERO, deducted: ZERO, still_to_deduct: ZERO, oldest: null, newest: null };
  const chargeable = pick('chargeable');
  const exempt = pick('exempt');
  const unmatchedKinds = ['unresolved', 'ambiguous', 'review'].map((k) => [k, pick(k)]);
  const sumCents = (list, key) => list.reduce((n, r) => n + toCents(r[key]), 0n);
  const unmatchedRows = unmatchedKinds.map(([, r]) => r);
  const unmatchedClaims = unmatchedRows.reduce((n, r) => n + r.claims, 0);
  const oldestUnmatched = unmatchedRows.map((r) => r.oldest).filter(Boolean).sort()[0] ?? null;
  const totalClaims = rows.reduce((n, r) => n + r.claims, 0);

  const warnings = [];
  if (totalClaims === 0) warnings.push('There are no carrier claims in this scope.');
  if (unmatchedClaims > 0) warnings.push(`${plural(unmatchedClaims, 'claim is', 'claims are')} not matched to a driver yet (${centsToText(sumCents(unmatchedRows, 'claim_amount'))} USD). Unmatched claims are never assigned to a driver or deducted until they are decided.`);
  warnings.push('Deducted in approved pay runs is what active claim lines in approved runs took, before any later refund. It is not a driver balance: Payroll balances remain the authority for what a driver still owes.');
  warnings.push('Claims count by their own date and use the latest version of each claim. Carrier claims are part of penalty balances, as already approved. Exempt claims owe nothing, including the agreed DFWGOFO + Tracking interruption exemption.');
  return {
    data: {
      period: period ? { startDate: period.startDate, endDate: period.endDate } : null,
      cities: cityIds ?? 'all',
      totalClaims,
      chargeable: {
        claims: chargeable.claims, amountOwedByDrivers: chargeable.chargeable_amount,
        deductedInApprovedPayRuns: chargeable.deducted, stillToDeductBeforeRefunds: chargeable.still_to_deduct,
      },
      exempt: { claims: exempt.claims, claimAmountNotCharged: exempt.claim_amount },
      unmatched: {
        claims: unmatchedClaims,
        claimAmount: centsToText(sumCents(unmatchedRows, 'claim_amount')),
        oldestClaimDate: oldestUnmatched,
        byStatus: Object.fromEntries(unmatchedKinds.map(([k, r]) => [k, { claims: r.claims, claimAmount: r.claim_amount }])),
      },
    },
    scope: { description: `Current carrier claims${period ? ` dated ${period.startDate} to ${period.endDate}` : ' of all dates'}, ${cityIds ? `cities ${cityIds.join(', ')}` : 'all cities'}. A snapshot as of now.` },
    coverage: [{ source: 'Carrier claims (latest version of each claim) and their match decisions', claims: totalClaims, oldestClaimDate: [chargeable, exempt, ...unmatchedRows].map((r) => r.oldest).filter(Boolean).sort()[0] ?? null, newestClaimDate: [chargeable, exempt, ...unmatchedRows].map((r) => r.newest).filter(Boolean).sort().reverse()[0] ?? null }],
    warnings,
  };
}

// Where driver pay stands right now, by the payment status records. Separate from delivery periods: these are as-of figures.
export async function paymentOverview(db, { cityIds }) {
  await assertCities(db, cityIds);
  const { rows } = await db.query(
    `SELECT CASE WHEN f.deposit_returned THEN 'returned' ELSE f.state END AS bucket,
            (count(*))::int AS statements, (count(DISTINCT f.driver_id))::int AS drivers,
            (COALESCE(sum(f.net), 0))::${MONEY} AS total,
            (count(*) FILTER (WHERE f.paid_at >= now() - interval '30 days'))::int AS recent_statements,
            (COALESCE(sum(f.net) FILTER (WHERE f.paid_at >= now() - interval '30 days'), 0))::${MONEY} AS recent_total
       FROM reporting.payment_facts f WHERE ${cityScope('f')} GROUP BY 1`,
    [cityIds]
  );
  const bucket = (name) => rows.find((r) => r.bucket === name) ?? { statements: 0, drivers: 0, total: ZERO, recent_statements: 0, recent_total: ZERO };
  const shape = (name) => ({ statements: bucket(name).statements, drivers: bucket(name).drivers, amount: bucket(name).total });
  const { rows: byCity } = await db.query(
    `SELECT f.city_id, f.city_name,
            (COALESCE(sum(f.net) FILTER (WHERE NOT f.deposit_returned AND f.state = 'approved'), 0))::${MONEY} AS approved,
            (COALESCE(sum(f.net) FILTER (WHERE NOT f.deposit_returned AND f.state IN ('submitted', 'unconfirmed')), 0))::${MONEY} AS processing,
            (COALESCE(sum(f.net) FILTER (WHERE NOT f.deposit_returned AND f.state = 'failed'), 0))::${MONEY} AS failed,
            (COALESCE(sum(f.net) FILTER (WHERE f.deposit_returned), 0))::${MONEY} AS returned
       FROM reporting.payment_facts f WHERE ${cityScope('f')}
      GROUP BY f.city_id, f.city_name
     HAVING count(*) FILTER (WHERE f.deposit_returned OR f.state IN ('approved', 'submitted', 'unconfirmed', 'failed')) > 0
      ORDER BY f.city_name, f.city_id`,
    [cityIds]
  );
  const { rows: attention } = await db.query(
    `SELECT f.statement_id, f.driver_name, f.city_name, to_char(f.period_start, 'YYYY-MM-DD') AS period_start, to_char(f.period_end, 'YYYY-MM-DD') AS period_end,
            f.net::text AS net, CASE WHEN f.deposit_returned THEN 'returned' ELSE f.state END AS state
       FROM reporting.payment_facts f
      WHERE ${cityScope('f')} AND (f.deposit_returned OR f.state IN ('failed', 'unconfirmed'))
      ORDER BY f.period_end DESC, f.statement_id DESC LIMIT 20`,
    [cityIds]
  );
  const { rows: info } = await db.query(`SELECT COALESCE(bool_and(f.deposit_info_available), true) AS available FROM reporting.payment_facts f WHERE ${cityScope('f')}`, [cityIds]);
  const returnedVisible = info[0].available;
  const returned = shape('returned');
  const unconfirmed = shape('unconfirmed');
  const failed = shape('failed');
  const warnings = [];
  if (rows.length === 0) warnings.push('There are no payment records in this scope.');
  if (unconfirmed.statements > 0) warnings.push(`${plural(unconfirmed.statements, 'payment is', 'payments are')} unconfirmed (${unconfirmed.amount} USD): the request was sent but the result was not confirmed, so it must be checked before it is retried.`);
  if (failed.statements > 0) warnings.push(`${plural(failed.statements, 'payment has', 'payments have')} failed (${failed.amount} USD).`);
  if (returned.statements > 0) warnings.push(`${plural(returned.statements, 'deposit was', 'deposits were')} returned (${returned.amount} USD). A returned deposit is not a successful payment.`);
  if (!returnedVisible) warnings.push('Returned deposits are NOT visible: the payment view was built before the Everee tables existed. Re-run the claims-and-payments reporting migration after the Everee migrations. Until then a returned deposit would be counted as paid.');
  warnings.push('These are current (as-of) figures from the pay run and payment status records, separate from delivery periods and not month-end balances. Approved is not paid: only the paid bucket means the money landed. Draft runs are shown as pending approval.');
  return {
    data: {
      asOf: new Date().toISOString(),
      cities: cityIds ?? 'all',
      pendingApproval: shape('pending'),
      approvedAwaitingPayment: shape('approved'),
      processing: shape('submitted'),
      unconfirmed,
      failed,
      returned,
      returnedDepositsVisible: returnedVisible,
      paid: { ...shape('paid'), paidInLast30Days: { statements: bucket('paid').recent_statements, amount: bucket('paid').recent_total } },
      byCity: byCity.map((r) => ({ cityId: r.city_id, name: r.city_name, approvedAwaitingPayment: r.approved, processing: r.processing, failed: r.failed, returned: r.returned })),
      needsAttention: attention.map((r) => ({ statementId: Number(r.statement_id), driver: r.driver_name, city: r.city_name, periodStart: r.period_start, periodEnd: r.period_end, amount: r.net, state: r.state })),
    },
    scope: { description: `Driver pay in draft and approved pay runs, ${cityIds ? `cities ${cityIds.join(', ')}` : 'all cities'}, as of now.` },
    coverage: [{ source: 'Pay statements of draft and approved pay runs, and payment status records', statements: rows.reduce((n, r) => n + r.statements, 0) }],
    warnings,
  };
}

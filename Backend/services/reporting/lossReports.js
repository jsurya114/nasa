/**
 * Claim losses and profit after them (Insights). Plain `(db, filters) -> result`, read only, over the `reporting` views.
 *
 * What the carrier charged NASA and NASA has not taken back from a driver is money the company is out. This report adds it up, apart from the
 * approved delivery margin ("gross profit before overheads", which is not changed), and shows the margin after those losses beside it:
 *
 *   Unrecovered claims  matched claims of a driver, less what finalized pay runs have deducted. Every one counts at once. The split into "likely lost"
 *                       (the driver is disabled or has not delivered for INACTIVE_DAYS days) and "still recoverable" only says how much of it is
 *                       probably gone; both reduce profit.
 *   Unmatched claims    claims no driver could be found for, so nobody can be charged.
 *   Exempt claims       claims NASA pays the carrier but never charges a driver (the agreed DFW GOFO + Tracking interruption exemption).
 *   Insurance           the carrier's Driver Service Fee (the driver insurance premium) on each published statement, less the insurance withheld from
 *                       the drivers of that city and billing week. Only a shortfall is a loss; a surplus is shown, not counted as a gain.
 *
 * Claims count by the claim's own date inside the period, and what is recovered is as of now. Insurance counts statements by the last day of their billing
 * week, like the settlement. Nothing here changes a claim, a pay run or a payment.
 */
import { InputError, centsToText, toCents } from './inputs.js';
import { businessSummary } from './deliveryReports.js';

export const INACTIVE_DAYS = 30;
const MONEY = 'numeric(16,2)';
// The expense type the carrier writes its driver insurance premium under (the description is "Driver Insurance Premium").
const INSURANCE_EXPENSE_TYPE = 'driver service fee';

async function assertCities(db, cityIds) {
  if (cityIds === null) return;
  const { rows } = await db.query('SELECT city_id FROM reporting.cities WHERE city_id = ANY($1::int[])', [cityIds]);
  const known = new Set(rows.map((r) => r.city_id));
  const unknown = cityIds.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new InputError(`Unknown city_id: ${unknown.join(', ')}. Use list_reporting_cities to see the valid ones.`);
}

const zero = () => ({ claims: 0, cents: 0n });
const text = (cents) => centsToText(cents);
const money = (bucket) => ({ claims: bucket.claims, amount: text(bucket.cents) });

// asOf: the day "still working" is measured from (default today). A driver is still working when enabled and their last delivery is within
// INACTIVE_DAYS days of it.
export async function claimLosses(db, { period, cityIds, source = null, asOf = null }) {
  await assertCities(db, cityIds);

  const { rows } = await db.query(
    `WITH base AS (
       SELECT f.city_id, f.decision, f.claim_date,
              CASE WHEN f.decision = 'chargeable' THEN GREATEST(COALESCE(f.chargeable_amount, 0) - f.deducted_in_approved_runs, 0)
                   ELSE f.claim_amount END AS amount,
              CASE WHEN f.decision = 'chargeable'
                    THEN CASE WHEN f.driver_enabled AND f.driver_last_delivery_date >= COALESCE($4::date, CURRENT_DATE) - $5::int
                              THEN 'recoverable' ELSE 'likely_lost' END
                   WHEN f.decision = 'exempt' THEN 'exempt'
                   ELSE 'unmatched' END AS bucket
         FROM reporting.claim_loss_facts f
        WHERE f.claim_date BETWEEN $1::date AND $2::date AND ($3::int[] IS NULL OR f.city_id = ANY($3::int[]))
     )
     SELECT b.city_id, c.city_name, b.bucket,
            (count(*) FILTER (WHERE b.amount > 0))::int AS claims,
            (COALESCE(sum(b.amount) FILTER (WHERE b.amount > 0), 0))::${MONEY} AS amount,
            to_char(min(b.claim_date) FILTER (WHERE b.amount > 0), 'YYYY-MM-DD') AS oldest
       FROM base b LEFT JOIN reporting.cities c ON c.city_id = b.city_id
      GROUP BY b.city_id, c.city_name, b.bucket`,
    [period.startDate, period.endDate, cityIds, asOf, INACTIVE_DAYS]
  );

  const total = { recoverable: zero(), likely_lost: zero(), unmatched: zero(), exempt: zero() };
  const oldest = { unmatched: null };
  const cities = new Map();
  for (const r of rows) {
    const cents = toCents(r.amount);
    total[r.bucket].claims += r.claims;
    total[r.bucket].cents += cents;
    if (r.bucket === 'unmatched' && r.oldest && (oldest.unmatched === null || r.oldest < oldest.unmatched)) oldest.unmatched = r.oldest;
    if (r.claims > 0) {
      const city = cities.get(r.city_id) ?? { cityId: r.city_id, name: r.city_name ?? `City ${r.city_id}`, cents: { recoverable: 0n, likely_lost: 0n, unmatched: 0n, exempt: 0n } };
      city.cents[r.bucket] += cents;
      cities.set(r.city_id, city);
    }
  }
  const unrecoveredCents = total.recoverable.cents + total.likely_lost.cents;
  const unrecoveredClaims = total.recoverable.claims + total.likely_lost.claims;
  const claimsTotalCents = unrecoveredCents + total.unmatched.cents + total.exempt.cents;

  // Insurance: only when the carrier statement tables exist.
  let insurance = { available: false, carrierPremium: null, withheldFromDrivers: null, difference: null, notRecovered: null, statements: 0 };
  let insuranceLossCents = 0n;
  const hasStatements = (await db.query("SELECT to_regclass('reporting.carrier_statement_items') IS NOT NULL AS ok")).rows[0].ok;
  if (hasStatements) {
    const { rows: ins } = await db.query(
      `WITH st AS (
         SELECT i.statement_id, i.city_id, i.period_start, i.period_end, (sum(-i.amount))::${MONEY} AS premium
           FROM reporting.carrier_statement_items i
          WHERE i.kind = 'adjustment' AND lower(i.label) = $4::text
            AND i.period_end BETWEEN $1::date AND $2::date AND ($3::int[] IS NULL OR i.city_id = ANY($3::int[]))
          GROUP BY i.statement_id, i.city_id, i.period_start, i.period_end
       )
       SELECT (count(*))::int AS statements,
              (COALESCE(sum(st.premium), 0))::${MONEY} AS premium,
              (COALESCE(sum((SELECT sum(f.insurance_withheld) FROM reporting.delivery_facts f
                              WHERE f.city_id = st.city_id AND f.business_date BETWEEN st.period_start AND st.period_end AND f.counts_for_city)), 0))::${MONEY} AS withheld
         FROM st`,
      [period.startDate, period.endDate, cityIds, INSURANCE_EXPENSE_TYPE]
    );
    const premium = toCents(ins[0].premium);
    const withheld = toCents(ins[0].withheld);
    insuranceLossCents = premium > withheld ? premium - withheld : 0n;
    insurance = {
      available: true, statements: ins[0].statements, carrierPremium: text(premium), withheldFromDrivers: text(withheld),
      difference: text(premium - withheld), notRecovered: text(insuranceLossCents),
    };
  }

  const totalLossCents = claimsTotalCents + insuranceLossCents;

  // The approved margin, read the same way as the overview, and the margin after these losses.
  const summary = await businessSummary(db, { period, cityIds, source, comparePrevious: false });
  const marginText = summary.data.grossMarginBeforeOverheads;
  const marginCents = marginText === null || marginText === undefined ? null : toCents(marginText);
  const profit = marginCents === null ? null : marginCents - totalLossCents;

  const warnings = [];
  if (marginCents === null) warnings.push('There is no delivery margin for this period, so profit after losses cannot be shown. The losses are still listed.');
  if (source) warnings.push(`Claims and insurance are not split by daily or weekly source: the losses below cover every ${source === 'weekly' ? 'weekly and daily' : 'daily and weekly'} claim in the period while the margin is for ${source} records only.`);
  if (!insurance.available) warnings.push('Insurance is not included: there are no carrier statements in this database yet.');
  else if (insurance.statements === 0) warnings.push('No carrier statement with a Driver Service Fee ends in this period, so there is no insurance comparison.');
  else if (insurance.difference !== null && toCents(insurance.difference) < 0n) warnings.push(`Drivers had ${text(-toCents(insurance.difference))} USD more insurance withheld than the carrier charged. That surplus is shown but not counted as a gain.`);
  if (total.unmatched.claims > 0) warnings.push(`${total.unmatched.claims} claim${total.unmatched.claims === 1 ? ' is' : 's are'} not matched to a driver (${text(total.unmatched.cents)} USD). Nobody can be charged until they are matched.`);
  warnings.push(`Claims count by their own date in the period. What is recovered is as of now, from finalized pay runs. "Likely lost" means the driver is disabled or has not delivered for ${INACTIVE_DAYS} days; "still recoverable" claims also reduce profit until they are deducted.`);
  warnings.push('This is profit after claim losses and unrecovered driver insurance. It is not net profit: overheads and operating costs are not recorded in NASA.');

  const byCity = [...cities.values()].sort((a, b) => a.name.localeCompare(b.name) || a.cityId - b.cityId).map((c) => {
    const unrecovered = c.cents.recoverable + c.cents.likely_lost;
    return {
      cityId: c.cityId, name: c.name, unrecovered: text(unrecovered), likelyLost: text(c.cents.likely_lost), stillRecoverable: text(c.cents.recoverable),
      unmatched: text(c.cents.unmatched), exemptAbsorbed: text(c.cents.exempt), total: text(unrecovered + c.cents.unmatched + c.cents.exempt),
    };
  });

  return {
    data: {
      period: { startDate: period.startDate, endDate: period.endDate, days: period.days },
      cities: cityIds ?? 'all',
      inactiveDays: INACTIVE_DAYS,
      margin: {
        grossMarginBeforeOverheads: marginText ?? null,
        totalLosses: text(totalLossCents),
        profitAfterClaimLosses: profit === null ? null : text(profit),
      },
      claimLosses: {
        total: text(claimsTotalCents),
        unrecovered: { claims: unrecoveredClaims, amount: text(unrecoveredCents), likelyLost: money(total.likely_lost), stillRecoverable: money(total.recoverable) },
        unmatched: { ...money(total.unmatched), oldestClaimDate: oldest.unmatched },
        exemptAbsorbed: money(total.exempt),
      },
      insurance,
      byCity,
    },
    scope: { description: `Carrier claims dated ${period.startDate} to ${period.endDate}, ${cityIds ? `cities ${cityIds.join(', ')}` : 'all cities'}, as of now; carrier statements ending in that period.` },
    coverage: [
      { source: 'Carrier claims (latest version of each claim), match decisions and finalized pay run deductions', claims: unrecoveredClaims + total.unmatched.claims + total.exempt.claims },
      { source: 'Carrier statements (Driver Service Fee) and insurance withheld from drivers', statements: insurance.statements },
    ],
    warnings,
  };
}

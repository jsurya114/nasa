/**
 * The one definition of delivery revenue, driver earnings and delivery margin (issue #252), as SQL and a few helpers. Every report that shows these
 * figures (Insights overview, rankings and trends, the Claude connector, the Dashboard totals) builds them from the pieces below, so they cannot drift apart.
 *
 *   Delivery revenue  what the carrier billed (weekly GOFO, from a published carrier statement), or the stored company price figure for daily SpeedX.
 *                     A weekly record in a week with no verified statement keeps the old price-based figure and is labelled "estimated".
 *   Driver earnings   NASA's stored gross driver earnings on the same records (never recalculated, never the carrier's number).
 *   Delivery margin   delivery revenue minus driver earnings.
 *   Unallocated       carrier money that matched no NASA record. It is revenue (and margin) of the statement's city on the carrier's signing day, with no driver.
 *   Settlement        by BILLING WEEK, from the statements: delivery revenue + carrier claims + ledger adjustments = payable. Never mixed into the signing-day figures.
 *
 * The aggregate lines read `reporting.delivery_facts` as `f`. Missing is never zero: a record with no usable amounts contributes nothing and is counted.
 */
import { centsToText, toCents } from './inputs.js';

export const MONEY = 'numeric(16,2)';

// Aggregates over `f` rows, usable in any GROUP BY. Sums ignore NULL, so a record without a figure adds nothing to it.
export const REVENUE_AGGREGATES = `
  (COALESCE(sum(f.delivery_revenue), 0))::${MONEY}                                                   AS revenue,
  (COALESCE(sum(f.gross_driver_earnings) FILTER (WHERE f.revenue_complete), 0))::${MONEY}            AS driver_earnings,
  (COALESCE(sum(f.delivery_margin), 0))::${MONEY}                                                    AS margin,
  (COALESCE(sum(f.insurance_withheld) FILTER (WHERE f.revenue_complete), 0))::${MONEY}               AS insurance_withheld,
  (count(*) FILTER (WHERE f.delivery_revenue IS NOT NULL))::int                                      AS records_with_revenue,
  (count(*) FILTER (WHERE f.revenue_complete))::int                                                  AS records_with_amounts,
  (count(*) FILTER (WHERE f.delivery_revenue IS NOT NULL AND NOT f.revenue_complete))::int           AS records_without_driver_earnings,
  (count(*) FILTER (WHERE f.revenue_basis = 'statement'))::int                                       AS records_statement,
  (count(*) FILTER (WHERE f.revenue_basis = 'recorded'))::int                                        AS records_recorded,
  (count(*) FILTER (WHERE f.revenue_basis = 'estimated'))::int                                       AS records_estimated`;

// Carrier money that matched no NASA record, for a period and cities. $1 start, $2 end, $3 city ids (or null), $4 source ('daily', 'weekly' or null).
// Only weekly (carrier) data has any, so a daily-only question gets none.
export const UNALLOCATED_SCOPE = `u.business_date BETWEEN $1::date AND $2::date AND ($3::int[] IS NULL OR u.city_id = ANY($3::int[])) AND ($4::text IS NULL OR $4::text = 'weekly')`;

export const unallocatedFor = async (db, { startDate, endDate }, cityIds, source = null) => {
  const { rows } = await db.query(
    `SELECT (COALESCE(sum(u.revenue), 0))::${MONEY} AS revenue, (COALESCE(sum(u.groups), 0))::int AS groups, (count(DISTINCT u.statement_id))::int AS statements
       FROM reporting.statement_unallocated u WHERE ${UNALLOCATED_SCOPE}`,
    [startDate, endDate, cityIds, source]
  );
  return { cents: toCents(rows[0].revenue), groups: rows[0].groups, statements: rows[0].statements };
};

// Unallocated money per bucket start (day, week or month), for trends. Returns Map 'YYYY-MM-DD' -> cents.
export const unallocatedByBucket = async (db, { startDate, endDate }, cityIds, source, interval) => {
  const { rows } = await db.query(
    `SELECT to_char(date_trunc($5::text, u.business_date)::date, 'YYYY-MM-DD') AS bucket_start, (sum(u.revenue))::${MONEY} AS revenue
       FROM reporting.statement_unallocated u WHERE ${UNALLOCATED_SCOPE} GROUP BY 1`,
    [startDate, endDate, cityIds, source, interval]
  );
  return new Map(rows.map((r) => [r.bucket_start, toCents(r.revenue)]));
};

// Settlement by billing week. A statement belongs to the period that holds the LAST day of its billing week, so a week that straddles two periods is
// counted once. Claims and ledger adjustments are the carrier's and are shown apart from delivery revenue.
export const settlementFor = async (db, { startDate, endDate }, cityIds) => {
  const { rows } = await db.query(
    `SELECT (count(*))::int AS statements,
            (COALESCE(sum(delivery_revenue), 0))::${MONEY} AS delivery_revenue, (COALESCE(sum(claims), 0))::${MONEY} AS claims,
            (COALESCE(sum(adjustments), 0))::${MONEY} AS adjustments, (COALESCE(sum(settlement_payable), 0))::${MONEY} AS payable
       FROM reporting.carrier_statements
      WHERE period_end BETWEEN $1::date AND $2::date AND ($3::int[] IS NULL OR city_id = ANY($3::int[]))`,
    [startDate, endDate, cityIds]
  );
  const r = rows[0];
  if (r.statements === 0) return null;
  return {
    statements: r.statements,
    deliveryRevenue: centsToText(toCents(r.delivery_revenue)),
    carrierClaims: centsToText(toCents(r.claims)),
    ledgerAdjustments: centsToText(toCents(r.adjustments)),
    payable: centsToText(toCents(r.payable)),
    basis: 'By billing week (a statement is counted in the period that holds the last day of its billing week). Prepayments and withdrawal fees are not included.',
  };
};

// How a figure is based, from the record counts: 'statement', 'recorded', 'estimated', or 'mixed' when more than one applies, null with no records.
export const basisOf = ({ statement = 0, recorded = 0, estimated = 0, unallocated = 0 }) => {
  const present = [statement + unallocated > 0 && 'statement', recorded > 0 && 'recorded', estimated > 0 && 'estimated'].filter(Boolean);
  return present.length === 0 ? null : present.length === 1 ? present[0] : 'mixed';
};

export const basisCounts = (r, unallocatedGroups = 0) => ({
  statement: r.records_statement, recorded: r.records_recorded, estimated: r.records_estimated, unallocatedGroups,
});

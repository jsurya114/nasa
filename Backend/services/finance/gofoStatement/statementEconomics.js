import { centsToText } from './statementMoney.js';

// What one weekly statement means for the company (issue #252), worked out from the SAME reporting view every other report uses (reporting.delivery_facts),
// so these figures cannot differ from Insights or the Dashboard.
//
//   Delivery revenue          the carrier's delivery fees after offsets (all of them, matched or not)
//   Driver earnings           NASA's stored gross driver earnings on the records the statement covers (matched, or inside its billing week)
//   Delivery margin           delivery revenue - driver earnings, BEFORE carrier claims and ledger adjustments
//   Contribution              delivery margin + carrier claims + carrier ledger adjustments (the carrier's debits, kept apart from driver recoveries)
//   Settlement payable        delivery revenue + carrier claims + ledger adjustments, as the carrier states it
//   Driver earnings after insurance   gross minus the stored insurance withholding only. Claim recoveries and advances are settled in Payroll.
// NASA's completed-delivery count is its own definition; the carrier's count (it includes offset tickets) is shown apart and never used for NASA's.
//
// Only the statement that stands (published) has NASA-side figures. The reporting view assigns records to published statements only, so a superseded or voided
// version has no live records to work from; its driver earnings, margin, contribution, insurance and NASA counts are NOT AVAILABLE (null, empty in the list and the CSV),
// never zero, and never copied from the version that replaced it. What the carrier itself stated on that version stays.
export const INACTIVE_REASON = 'This version is no longer the statement that stands, so NASA\'s driver earnings are not attributed to it. The carrier\'s own figures are kept.';

const cents = (numeric) => Math.round(Number(numeric ?? 0) * 100);

export const statementEconomics = async (db, statementIds) => {
  if (statementIds.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT s.id, s.status, s.detail_fee_cents, s.offset_cents, s.claims_cents, s.adjustments_cents, s.settlement_payable_cents, s.carrier_deliveries,
            t.matched_cents, t.unallocated_cents,
            COALESCE(f.driver_cents, 0)::bigint AS driver_cents, COALESCE(f.insurance_cents, 0)::bigint AS insurance_cents,
            COALESCE(f.records, 0)::int AS records, COALESCE(f.unbilled_records, 0)::int AS unbilled_records, COALESCE(f.nasa_deliveries, 0)::bigint AS nasa_deliveries,
            COALESCE(f.without_driver_earnings, 0)::int AS without_driver_earnings
       FROM carrier_statements s
       JOIN carrier_statement_totals t ON t.statement_id = s.id
       LEFT JOIN (
         SELECT f.statement_id,
                (sum(f.gross_driver_earnings) * 100)::bigint AS driver_cents,
                (sum(f.insurance_withheld) FILTER (WHERE f.gross_driver_earnings IS NOT NULL) * 100)::bigint AS insurance_cents,
                count(*) AS records,
                count(*) FILTER (WHERE f.delivery_revenue = 0) AS unbilled_records,
                count(*) FILTER (WHERE f.gross_driver_earnings IS NULL) AS without_driver_earnings,
                sum(f.delivered) AS nasa_deliveries
           FROM reporting.delivery_facts f
          WHERE f.statement_id = ANY($1::bigint[])
          GROUP BY f.statement_id
       ) f ON f.statement_id = s.id
      WHERE s.id = ANY($1::bigint[])`,
    [statementIds]
  );
  return new Map(rows.map((r) => {
    const revenue = Number(r.detail_fee_cents) + Number(r.offset_cents);
    const active = r.status === 'published';
    const driver = Number(r.driver_cents);
    const insurance = Number(r.insurance_cents);
    const margin = revenue - driver;
    const claims = Number(r.claims_cents);
    const adjustments = Number(r.adjustments_cents);
    const ifActive = (value) => (active ? value : null);
    return [String(r.id), {
      deliveryRevenue: centsToText(revenue),
      driverEarnings: ifActive(centsToText(driver)),
      deliveryMargin: ifActive(centsToText(margin)),
      carrierClaims: centsToText(claims),
      ledgerAdjustments: centsToText(adjustments),
      contribution: ifActive(centsToText(margin + claims + adjustments)),
      settlementPayable: centsToText(Number(r.settlement_payable_cents)),
      insuranceWithheld: ifActive(centsToText(insurance)),
      driverEarningsAfterInsurance: ifActive(centsToText(driver - insurance)),
      matchedRevenue: centsToText(Number(r.matched_cents)),
      unallocatedRevenue: centsToText(Number(r.unallocated_cents)),
      nasaRecords: ifActive(r.records),
      nasaDeliveries: ifActive(Number(r.nasa_deliveries)),
      recordsWithoutBilledFee: ifActive(r.unbilled_records),
      recordsWithoutDriverEarnings: ifActive(r.without_driver_earnings),
      carrierDeliveries: r.carrier_deliveries,
      carrierDeliveriesNote: 'The carrier counts offset tickets as deliveries; NASA keeps its own completed-delivery count.',
      economicsAvailable: active,
      unavailableReason: active ? null : INACTIVE_REASON,
    }];
  }));
};

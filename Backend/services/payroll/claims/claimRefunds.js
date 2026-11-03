// Claim refunds (#143): how much may still be refunded to one driver for one claim. Checked when a refund is recorded
// (ledgerStore.createEntry, under the claim's subject lock), so one over-recovery can never be refunded twice: not by
// two admins, two stale forms, or a draft and a later run. Needs the pay run tables (#143 migration).

// The claim-type key in SQL, the same rule as claimTypeKey(): trimmed, single spaces, lower case.
export const CLAIM_TYPE_KEY_SQL = (column) => `lower(regexp_replace(btrim(${column}), '\\s+', ' ', 'g'))`;

const cents = (v) => Math.round(Number(v ?? 0) * 100);
const money = (c) => (c / 100).toFixed(2);

// claim: { driverId, cityId, courier, waybill, typeKey }. Returns { refundable: "12.34", reason }.
// refundable = what finalized runs in this city deducted from this driver for any version of the claim
//              - what this driver owes for it now (only if the claim is now theirs, in this city)
//              - every refund already recorded for it (voided ones excepted), paid or not.
// A claim that is not decided yet (unmatched, ambiguous, held) has nothing refundable until it is.
export const refundableForClaim = async (db, { driverId, cityId, courier, waybill, typeKey }) => {
  const { rows: current } = await db.query(
    `SELECT c.claim_key, m.status, m.driver_id, m.city_id, m.eligible_deduction
       FROM courier_claims c JOIN courier_claim_matches m ON m.claim_id = c.id
      WHERE c.courier = $1 AND c.waybill = $2 AND c.claim_type_key = $3 AND c.superseded_at IS NULL`,
    [courier, waybill, typeKey]
  );
  const claim = current[0];
  if (!claim) return { refundable: '0.00', reason: 'there is no carrier claim with this courier, waybill and claim type' };
  if (!['chargeable', 'exempt'].includes(claim.status)) return { refundable: '0.00', reason: 'this claim is not matched to a driver yet; refund it once it is' };

  const { rows: sums } = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(-l.amount), 0)
          FROM pay_statement_lines l
          JOIN courier_claims cv ON cv.id = l.claim_id
          JOIN pay_statements s ON s.id = l.statement_id
          JOIN pay_runs r ON r.id = s.pay_run_id
         WHERE cv.claim_key = $1 AND l.active AND l.line_type = 'claim' AND r.status = 'finalized'
           AND s.driver_id = $2 AND r.city_id = $3) AS taken,
       (SELECT COALESCE(SUM(e.amount), 0)
          FROM driver_ledger_entries e
         WHERE e.entry_type = 'correction' AND e.direction = 'credit' AND e.driver_id = $2 AND e.city_id = $3
           AND e.claim_courier = $4 AND e.waybill = $5 AND ${CLAIM_TYPE_KEY_SQL('e.claim_type')} = $6
           AND NOT EXISTS (SELECT 1 FROM driver_ledger_entries v WHERE v.voids_entry_id = e.id)) AS refunded`,
    [claim.claim_key, driverId, cityId, courier, waybill, typeKey]
  );
  const owes = claim.status === 'chargeable' && claim.driver_id === driverId && claim.city_id === cityId ? cents(claim.eligible_deduction) : 0;
  const left = cents(sums[0].taken) - owes - cents(sums[0].refunded);
  return { refundable: money(Math.max(0, left)), reason: left > 0 ? null : 'nothing more is refundable to this driver for this claim' };
};

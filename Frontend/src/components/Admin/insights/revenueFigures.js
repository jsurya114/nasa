// What the Insights cards say about where revenue comes from, and the owner's separate figures (issue #252). Display only: nothing here recomputes a total; every
// number is the exact text the server sent. An older server that has not sent the new fields still works: the older names carry the same numbers.

export const ESTIMATED = "Estimated";

export const deliveryRevenueOf = (d) => d.deliveryRevenue ?? d.earnedDeliveryRevenue;
export const deliveryMarginOf = (d) => d.deliveryMargin ?? d.grossMarginBeforeOverheads;
export const driverEarningsOf = (d) => d.driverEarnings ?? d.grossDriverEarnings;

// One sentence under the revenue figure: where it comes from. Never colour alone: the word "Estimated" is in the text and on a badge.
export const basisNote = (d) => {
  const by = d.recordsByBasis ?? {};
  switch (d.revenueBasis) {
    case "statement": return "What the carrier billed, from verified carrier statements.";
    case "recorded": return "The stored daily figures.";
    case "estimated": return `${ESTIMATED} from route prices: no verified carrier statement for these weekly records.`;
    case "mixed": return by.estimated > 0
      ? `Includes ${by.estimated} weekly record${by.estimated === 1 ? "" : "s"} with no verified carrier statement (${ESTIMATED.toLowerCase()} from route prices).`
      : "Carrier statements for weekly records, stored figures for daily ones.";
    default: return null;
  }
};

// The GOFO settlement block as labelled lines, or null when the period holds no statement's billing week.
export const settlementLines = (d) => (d.settlement
  ? [
    { id: "delivery-revenue", label: "Delivery revenue", value: d.settlement.deliveryRevenue },
    { id: "carrier-claims", label: "Carrier claims", value: d.settlement.carrierClaims },
    { id: "ledger-adjustments", label: "Ledger adjustments", value: d.settlement.ledgerAdjustments },
  ]
  : null);

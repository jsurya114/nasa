import { describe, expect, it } from "vitest";
import { basisNote, deliveryMarginOf, deliveryRevenueOf, driverEarningsOf, settlementLines } from "./revenueFigures.js";

describe("the revenue figures Insights shows", () => {
  it("read the new names and fall back to the older ones from an older server", () => {
    expect([deliveryRevenueOf({ deliveryRevenue: "4.91", earnedDeliveryRevenue: "4.91" }), deliveryMarginOf({ deliveryMargin: "-1.59" }), driverEarningsOf({ driverEarnings: "6.50" })]).toEqual(["4.91", "-1.59", "6.50"]);
    expect([deliveryRevenueOf({ earnedDeliveryRevenue: "9.00" }), deliveryMarginOf({ grossMarginBeforeOverheads: "2.50" }), driverEarningsOf({ grossDriverEarnings: "6.50" })]).toEqual(["9.00", "2.50", "6.50"]);
    expect(deliveryRevenueOf({ earnedDeliveryRevenue: null })).toBeNull();
  });

  it("say where the revenue comes from, and the word Estimated is in the text", () => {
    expect(basisNote({ revenueBasis: "statement" })).toMatch(/what the carrier billed/i);
    expect(basisNote({ revenueBasis: "recorded" })).toMatch(/stored daily/i);
    expect(basisNote({ revenueBasis: "estimated" })).toMatch(/^Estimated from route prices/);
    expect(basisNote({ revenueBasis: "mixed", recordsByBasis: { statement: 5, estimated: 1 } })).toBe("Includes 1 weekly record with no verified carrier statement (estimated from route prices).");
    expect(basisNote({ revenueBasis: "mixed", recordsByBasis: { statement: 5, estimated: 3 } })).toMatch(/3 weekly records/);
    expect(basisNote({ revenueBasis: "mixed", recordsByBasis: { statement: 5, recorded: 2, estimated: 0 } })).toMatch(/Carrier statements for weekly/);
    expect(basisNote({ revenueBasis: null })).toBeNull();
    expect(basisNote({})).toBeNull();
  });

  it("list the settlement as separate lines, or nothing when no statement's billing week is in the period", () => {
    expect(settlementLines({ settlement: { deliveryRevenue: "4.91", carrierClaims: "-0.70", ledgerAdjustments: "-2.00", payable: "2.21" } }).map((l) => [l.label, l.value])).toEqual([
      ["Delivery revenue", "4.91"], ["Carrier claims", "-0.70"], ["Ledger adjustments", "-2.00"]]);
    expect(settlementLines({ settlement: null })).toBeNull();
    expect(settlementLines({})).toBeNull();
  });
});

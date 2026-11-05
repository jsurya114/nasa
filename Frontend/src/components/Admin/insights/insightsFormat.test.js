import { describe, expect, it } from "vitest";
import { NA, describeChange, formatBusinessDate, formatCount, formatDecimal, formatPercent, formatUsd, formatUsdCompact } from "./insightsFormat.js";

describe("Insights number display", () => {
  it("shows exact cents and never turns a missing value into zero", () => {
    expect(formatUsd("25447.80")).toBe("$25,447.80");
    expect(formatUsd("0.00")).toBe("$0.00");
    expect(formatUsd("-12.5")).toBe("-$12.50");
    for (const missing of [null, undefined, "", "abc"]) {
      expect(formatUsd(missing)).toBe(NA);
      expect(formatCount(missing)).toBe(NA);
      expect(formatPercent(missing)).toBe(NA);
      expect(formatDecimal(missing)).toBe(NA);
      expect(formatUsdCompact(missing)).toBe(NA);
    }
    expect(NA).toBe("N/A");
  });

  it("formats counts, percentages and per-unit figures", () => {
    expect(formatCount(16151)).toBe("16,151");
    expect(formatCount("0")).toBe("0");
    expect(formatPercent("17.12")).toBe("17.12%");
    expect(formatPercent("0.00")).toBe("0.00%");
    expect(formatDecimal("27.8571")).toBe("27.86");
    expect(formatDecimal("3")).toBe("3.00");
  });

  it("keeps compact money readable for axes and exact for small amounts", () => {
    expect(formatUsdCompact("450")).toBe("$450");
    expect(formatUsdCompact("25447.8")).toBe("$25,448");
    expect(formatUsdCompact("1250000")).toMatch(/^\$1\.3M$|^\$1\.25M$/);
  });

  it("shows a business date as that date in every time zone", () => {
    expect(formatBusinessDate("2026-10-19")).toBe("Oct 19, 2026");
    expect(formatBusinessDate(null)).toBe(NA);
    expect(formatBusinessDate("2026-1-9")).toBe(NA);
  });
});

describe("Insights comparison with the previous period", () => {
  const complete = { status: "complete", change: { deliveries: { absolute: "15", percent: "50.00" }, earnedDeliveryRevenue: { absolute: "-120.50", percent: "-8.00" }, grossMarginBeforeOverheads: { absolute: "0.00", percent: "0.00" } }, note: "x" };

  it("shows an increase, a decrease and no change with their sign, amount and percent", () => {
    expect(describeChange(complete, "deliveries", "count")).toEqual({ tone: "up", text: "+15 (+50.00%)", note: null });
    expect(describeChange(complete, "earnedDeliveryRevenue", "money")).toEqual({ tone: "down", text: "−$120.50 (−8.00%)", note: null });
    expect(describeChange(complete, "grossMarginBeforeOverheads", "money")).toEqual({ tone: "flat", text: "$0.00 (0.00%)", note: null });
  });

  it("shows only the amount when there is no meaningful percentage", () => {
    const noPercent = { status: "complete", change: { deliveries: { absolute: "10", percent: null } } };
    expect(describeChange(noPercent, "deliveries", "count").text).toBe("+10");
  });

  it("says Insufficient data, with the server's reason, when there is nothing to compare with", () => {
    const none = { status: "insufficient_data", change: null, note: "There is no delivery data in the previous equal-length period, so no change is shown." };
    expect(describeChange(none, "deliveries", "count")).toEqual({ tone: "none", text: "Insufficient data", note: none.note });
    expect(describeChange({ status: "complete", change: { deliveries: { absolute: null, percent: null } } }, "deliveries", "count").text).toBe("Insufficient data");
    expect(describeChange({ status: "complete", change: {} }, "earnedDeliveryRevenue", "money").text).toBe("Insufficient data");
  });

  it("passes on the server's note when the previous period is only partly covered", () => {
    const partly = { ...complete, status: "incomplete", note: "Delivery data starts on 2091-02-20, so the previous period is only partly covered." };
    expect(describeChange(partly, "deliveries", "count").note).toBe(partly.note);
  });

  it("says the comparison is off when it was not asked for", () => {
    expect(describeChange(undefined, "deliveries", "count").text).toBe("Comparison off");
  });
});

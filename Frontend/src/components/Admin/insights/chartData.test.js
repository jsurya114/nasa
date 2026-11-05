import { describe, expect, it } from "vitest";
import { bucketLabel, heatLevel, heatLevels, heatmapWeeks, monthMarks, seriesToPoints, tickLabel } from "./chartData.js";
import { DAILY_MAX, autoInterval, effectiveInterval } from "./insightsDates.js";

const bucket = (start, end, extra = {}) => ({ bucketStart: start, bucketEnd: end, partialBucket: false, hasRecords: true, deliveries: 10, earnedDeliveryRevenue: "40.00", grossMarginBeforeOverheads: "6.00", activeDrivers: 2, recordsWithoutStoredAmounts: 0, ...extra });

describe("Insights bucket size", () => {
  it("is chosen from the length of the period, and a choice is honoured only when it is allowed", () => {
    expect([autoInterval(7), autoInterval(30), autoInterval(45), autoInterval(46), autoInterval(420), autoInterval(421), autoInterval(1096)]).toEqual(["day", "day", "day", "week", "week", "month", "month"]);
    expect(effectiveInterval("auto", 30)).toBe("day");
    expect(effectiveInterval("week", 30)).toBe("week");
    expect(effectiveInterval("month", 5)).toBe("month");
    expect(effectiveInterval("day", DAILY_MAX)).toBe("day");
    expect(effectiveInterval("day", DAILY_MAX + 1)).toBe("week"); // a daily trend is limited to a year
    expect(effectiveInterval("hourly", 30)).toBe("day");
  });
});

describe("Insights chart points", () => {
  it("labels ticks and tooltips by bucket size", () => {
    expect(tickLabel("day", "2026-10-08")).toBe("Oct 8");
    expect(tickLabel("week", "2026-10-05")).toBe("Oct 5");
    expect(tickLabel("month", "2026-10-01")).toBe("Oct 2026");
    expect(bucketLabel("day", bucket("2026-10-08", "2026-10-08"))).toBe("Oct 8, 2026");
    expect(bucketLabel("week", bucket("2026-10-05", "2026-10-11"))).toBe("Oct 5, 2026 – Oct 11, 2026");
  });

  it("keeps a bucket with no records as null, never zero, and keeps the exact text beside the plotted number", () => {
    const [full, gap] = seriesToPoints([bucket("2026-10-05", "2026-10-11"), bucket("2026-10-12", "2026-10-18", { hasRecords: false, deliveries: null, earnedDeliveryRevenue: null, grossMarginBeforeOverheads: null, activeDrivers: null })], "week");
    expect([full.deliveries, full.revenue, full.margin, full.revenueText, full.hasRecords]).toEqual([10, 40, 6, "40.00", true]);
    expect([gap.deliveries, gap.revenue, gap.margin, gap.hasRecords]).toEqual([null, null, null, false]);
  });

  it("a bucket with deliveries but no stored amounts has volume and no money", () => {
    const [p] = seriesToPoints([bucket("2026-10-05", "2026-10-05", { earnedDeliveryRevenue: null, grossMarginBeforeOverheads: null, recordsWithoutStoredAmounts: 1 })], "day");
    expect([p.deliveries, p.revenue, p.margin, p.withoutAmounts]).toEqual([10, null, null, 1]);
  });
});

describe("Insights calendar heatmap", () => {
  // 2026-10-21 is a Wednesday; the period runs to Sunday 2026-11-01
  const days = [bucket("2026-10-21", "2026-10-21", { deliveries: 40 }), bucket("2026-10-22", "2026-10-22", { hasRecords: false, deliveries: null }), bucket("2026-10-26", "2026-10-26", { deliveries: 100 })];

  it("has one column per Monday-to-Sunday week and marks days outside the period, without records, and with deliveries", () => {
    const weeks = heatmapWeeks(days, { start: "2026-10-21", end: "2026-11-01" });
    expect(weeks.map((w) => w.monday)).toEqual(["2026-10-19", "2026-10-26"]);
    expect(weeks[0].cells.map((c) => c.status)).toEqual(["outside", "outside", "records", "empty", "empty", "empty", "empty"]);
    expect(weeks[1].cells[0]).toMatchObject({ date: "2026-10-26", status: "records", deliveries: 100 });
    expect(weeks[1].cells.slice(1).every((c) => c.status === "empty")).toBe(true);
    // a day with no record is "empty", never 0 deliveries
    expect(weeks.flatMap((w) => w.cells).filter((c) => c.status === "empty").every((c) => c.deliveries === null)).toBe(true);
  });

  it("a period inside one week still gets that whole week, with the days outside it blank", () => {
    const weeks = heatmapWeeks([], { start: "2026-10-22", end: "2026-10-23" });
    expect(weeks).toHaveLength(1);
    expect(weeks[0].cells.map((c) => c.status)).toEqual(["outside", "outside", "outside", "empty", "empty", "outside", "outside"]);
  });

  it("shades by quarters of the busiest day, and zero or missing is the lightest", () => {
    const levels = heatLevels([0, 10, 40, 100]);
    expect(levels).toEqual({ max: 100, thresholds: [25, 50, 75] });
    expect([0, 10, 25, 26, 50, 51, 75, 76, 100].map((v) => heatLevel(v, levels))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(heatLevel(null, levels)).toBe(0);
    expect(heatLevels([])).toEqual({ max: 0, thresholds: [] });
    expect(heatLevel(5, heatLevels([]))).toBe(0);
  });

  it("marks where each month begins above the grid", () => {
    const weeks = heatmapWeeks([], { start: "2026-10-26", end: "2026-12-06" });
    expect(monthMarks(weeks).map((m) => m.label)).toEqual(["Oct", "Nov", "Dec"]);
    expect(monthMarks(weeks)[0].column).toBe(0);
  });
});

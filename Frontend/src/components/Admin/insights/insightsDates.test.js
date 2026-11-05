import { describe, expect, it } from "vitest";
import { MAX_RANGE_DAYS, PRESETS, daysInRange, describeRange, isRealDate, previousRange, rangeForPreset, rangeProblem } from "./insightsDates.js";

// Made-up "today" values; local calendar dates, never a time zone conversion.
const at = (y, m, d) => new Date(y, m - 1, d, 15, 30);

describe("Insights date presets", () => {
  it("lists the five presets the owner asked for, in order", () => {
    expect(PRESETS.map((p) => p.label)).toEqual(["Last 7 days", "Last 30 days", "This month", "Last month", "Custom"]);
  });

  it("Last 7 and Last 30 days end today and count today", () => {
    expect(rangeForPreset("last7", at(2026, 11, 6))).toEqual({ start: "2026-10-31", end: "2026-11-06" });
    expect(rangeForPreset("last30", at(2026, 11, 6))).toEqual({ start: "2026-10-08", end: "2026-11-06" });
    expect(daysInRange(rangeForPreset("last7", at(2026, 11, 6)))).toBe(7);
    expect(daysInRange(rangeForPreset("last30", at(2026, 11, 6)))).toBe(30);
  });

  it("crosses a month and a year without skipping or repeating a day", () => {
    expect(rangeForPreset("last7", at(2027, 1, 3))).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(rangeForPreset("last30", at(2024, 3, 1))).toEqual({ start: "2024-02-01", end: "2024-03-01" }); // leap year: Feb has 29 days, so 30 days ending 1 Mar start on 1 Feb
    expect(daysInRange(rangeForPreset("last30", at(2024, 3, 1)))).toBe(30);
  });

  it("This month runs from the 1st to today, Last month is the whole previous month", () => {
    expect(rangeForPreset("thisMonth", at(2026, 11, 6))).toEqual({ start: "2026-11-01", end: "2026-11-06" });
    expect(rangeForPreset("thisMonth", at(2026, 11, 1))).toEqual({ start: "2026-11-01", end: "2026-11-01" });
    expect(rangeForPreset("lastMonth", at(2026, 11, 6))).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(rangeForPreset("lastMonth", at(2027, 1, 15))).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(rangeForPreset("lastMonth", at(2024, 3, 10))).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });

  it("Custom has no range of its own", () => {
    expect(rangeForPreset("custom", at(2026, 11, 6))).toBeNull();
    expect(rangeForPreset("nonsense", at(2026, 11, 6))).toBeNull();
  });
});

describe("Insights range checks", () => {
  it("accepts only real calendar dates", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("2026-1-1")).toBe(false);
    expect(isRealDate(null)).toBe(false);
  });

  it("explains why a range cannot be asked for, and allows long ranges up to three years", () => {
    expect(rangeProblem({ start: "2026-10-01", end: "2026-10-31" })).toBeNull();
    expect(rangeProblem({ start: "", end: "2026-10-31" })).toMatch(/Choose a start and an end date/);
    expect(rangeProblem({ start: "2026-10-31", end: "2026-10-01" })).toMatch(/must not be after/);
    expect(rangeProblem({ start: "2024-01-01", end: "2026-12-31" })).toBeNull(); // 1096 days, more than a pay run's 31
    expect(daysInRange({ start: "2024-01-01", end: "2026-12-31" })).toBe(MAX_RANGE_DAYS);
    expect(rangeProblem({ start: "2023-12-31", end: "2026-12-31" })).toMatch(/at most 1096 days/);
  });
});

describe("Insights previous period", () => {
  it("is the same number of days immediately before", () => {
    expect(previousRange({ start: "2026-10-01", end: "2026-10-30" })).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(previousRange({ start: "2026-11-01", end: "2026-11-06" })).toEqual({ start: "2026-10-26", end: "2026-10-31" });
    expect(previousRange({ start: "2026-03-01", end: "2026-03-31" })).toEqual({ start: "2026-01-29", end: "2026-02-28" });
    expect(previousRange({ start: "2026-01-01", end: "2026-01-01" })).toEqual({ start: "2025-12-31", end: "2025-12-31" });
  });

  it("matches the server's rule: equal length, ending the day before", () => {
    for (const range of [{ start: "2026-10-08", end: "2026-11-06" }, { start: "2024-02-01", end: "2024-02-29" }]) {
      const prev = previousRange(range);
      expect(daysInRange(prev)).toBe(daysInRange(range));
      expect(daysInRange({ start: prev.end, end: range.start })).toBe(2); // adjacent days
    }
  });
});

describe("Insights range heading", () => {
  it("is not moved by the viewer's time zone", () => {
    expect(describeRange({ start: "2026-10-01", end: "2026-10-31" })).toBe("Oct 1 – Oct 31, 2026");
    expect(describeRange({ start: "2026-12-28", end: "2027-01-03" })).toBe("Dec 28, 2026 – Jan 3, 2027");
  });
});

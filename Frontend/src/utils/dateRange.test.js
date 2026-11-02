import { describe, expect, it } from "vitest";
import { HISTORY_DEFAULT_DAYS, lastDaysRange, toLocalDateString } from "./dateRange";

describe("lastDaysRange", () => {
  it("covers ten calendar days by default, today included", () => {
    expect(HISTORY_DEFAULT_DAYS).toBe(10);
    expect(lastDaysRange(undefined, new Date(2026, 10, 3, 9, 0))).toEqual({ from_date: "2026-10-25", to_date: "2026-11-03" });
  });

  it("crosses a month and a year boundary", () => {
    expect(lastDaysRange(10, new Date(2026, 0, 4, 12, 0))).toEqual({ from_date: "2025-12-26", to_date: "2026-01-04" });
  });

  it("crosses a leap day", () => {
    expect(lastDaysRange(10, new Date(2028, 2, 5, 12, 0))).toEqual({ from_date: "2028-02-25", to_date: "2028-03-05" });
  });

  it("uses the local date late at night and just after midnight", () => {
    expect(lastDaysRange(10, new Date(2026, 10, 3, 23, 59)).to_date).toBe("2026-11-03");
    expect(lastDaysRange(10, new Date(2026, 10, 4, 0, 1)).to_date).toBe("2026-11-04");
  });

  it("does not skip or repeat a date across a daylight-saving change", () => {
    const { from_date, to_date } = lastDaysRange(10, new Date(2026, 10, 3, 1, 30));
    const days = [];
    for (let d = new Date(`${from_date}T12:00:00`); toLocalDateString(d) <= to_date; d.setDate(d.getDate() + 1)) {
      days.push(toLocalDateString(d));
    }
    expect(days).toHaveLength(10);
    expect(new Set(days).size).toBe(10);
  });

  it("one day means today only", () => {
    expect(lastDaysRange(1, new Date(2026, 10, 3, 9, 0))).toEqual({ from_date: "2026-11-03", to_date: "2026-11-03" });
  });
});

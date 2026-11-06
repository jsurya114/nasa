import { describe, expect, it } from "vitest";
import { mergeBatches, needsCheck, needsRetry } from "./mergeBatches.js";

const view = (id, createdAt, items, total, over = {}) => ({
  batch: { id, drivers: items.length, total, createdAt },
  counts: { submitted: items.filter((i) => i.status === "submitted").length, paid: items.filter((i) => i.status === "paid").length, failed: items.filter((i) => i.status === "failed").length, unconfirmed: 0 },
  items, canRetry: items.some((i) => i.status === "failed"), ...over,
});
const row = (itemId, driverName, status, extra = {}) => ({ itemId, driverName, amount: "10.00", status, everee: {}, ...extra });

describe("mergeBatches", () => {
  it("returns nothing for no batches and the batch itself for one", () => {
    const one = view(1, "2026-11-05T00:00:00Z", [row(1, "Dee", "paid")], "10.00");
    expect(mergeBatches([])).toBeNull();
    expect(mergeBatches([one])).toBe(one);
  });

  it("joins several sends of one run into one list with summed counts, drivers and total", () => {
    const first = view(1, "2026-11-05T00:00:00Z", [row(1, "Eli", "paid")], "10.10");
    const second = view(2, "2026-11-06T00:00:00Z", [row(2, "Dee", "submitted"), row(3, "Fay", "failed")], "20.20");
    const merged = mergeBatches([second, first]);
    expect(merged.items.map((i) => i.driverName)).toEqual(["Dee", "Eli", "Fay"]);
    expect(merged.counts).toEqual({ submitted: 1, paid: 1, failed: 1, unconfirmed: 0 });
    expect(merged.batch).toMatchObject({ drivers: 3, total: "30.30", sends: 2, createdAt: "2026-11-06T00:00:00Z" });
    expect(merged.canRetry).toBe(true);
    expect(first.items).toHaveLength(1); // the server's views are not changed
  });

  it("adds cents exactly", () => {
    const a = view(1, "2026-11-05T00:00:00Z", [row(1, "A", "paid")], "0.10");
    const b = view(2, "2026-11-05T01:00:00Z", [row(2, "B", "paid")], "0.20");
    expect(mergeBatches([a, b]).batch.total).toBe("0.30");
  });

  it("picks the batches an action applies to", () => {
    const done = view(1, "2026-11-05T00:00:00Z", [row(1, "A", "paid")], "10.00");
    const waiting = view(2, "2026-11-05T01:00:00Z", [row(2, "B", "submitted")], "10.00");
    const returned = view(3, "2026-11-05T02:00:00Z", [row(3, "C", "paid", { everee: { depositReturned: true } })], "10.00");
    const failed = view(4, "2026-11-05T03:00:00Z", [row(4, "D", "failed")], "10.00");
    expect([done, waiting, returned, failed].filter(needsCheck).map((v) => v.batch.id)).toEqual([2, 3]);
    expect([done, waiting, returned, failed].filter(needsRetry).map((v) => v.batch.id)).toEqual([4]);
  });
});

import { describe, expect, it } from "vitest";
import { ownerRevenueRows } from "./ownerRevenueRows.js";

const FULL = { deliveryRevenue: "4.91", driverEarnings: "6.50", deliveryMargin: "-1.59", unallocatedRevenue: null, revenueEstimated: false };

describe("the owner's revenue lines of the Dashboard summary", () => {
  it("show delivery revenue, gross driver earnings and delivery margin from the shared definition", () => {
    expect(ownerRevenueRows(FULL).map((r) => [r.label, r.text])).toEqual([["Delivery Revenue", "$4.91"], ["Driver Earnings (gross)", "$6.50"], ["Delivery Margin", "-$1.59"]]);
  });

  it("mark revenue and margin as estimated when some weekly records have no verified statement", () => {
    const rows = ownerRevenueRows({ ...FULL, revenueEstimated: true });
    expect(rows[0].text).toBe("$4.91 (estimated)");
    expect(rows[2].text).toBe("-$1.59 (estimated)");
    expect(rows[1].text).toBe("$6.50");
  });

  it("show unallocated carrier revenue apart, only when there is some", () => {
    expect(ownerRevenueRows({ ...FULL, unallocatedRevenue: "2.30" }).at(-1)).toMatchObject({ label: "Unallocated (carrier)", text: "$2.30" });
    expect(ownerRevenueRows({ ...FULL, unallocatedRevenue: "0.00" })).toHaveLength(3);
  });

  it("fall back to the old single line from a server that has not sent the new figures", () => {
    expect(ownerRevenueRows({ deliveryRevenue: null })).toEqual([{ field: "companyEarnings", label: "Total Company Earnings", highlight: true }]);
  });
});

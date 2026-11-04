import { describe, expect, it } from "vitest";
import { buildFilterParams, summaryParamsOf } from "./filterParams.js";

const BLANK = { job: "All", driver: "All", route: "All", startDate: "", endDate: "", paymentStatus: "All", companyEarnings: false };

describe("buildFilterParams", () => {
  it("with nothing chosen asks for all the data", () => {
    expect(buildFilterParams(BLANK, { limit: 10, isSuperAdmin: false })).toEqual({ page: 1, limit: 10, dataType: "all", allData: true });
  });

  it("sends only what was chosen", () => {
    const form = { ...BLANK, job: "Dallas", driver: "Dee Test", startDate: "2026-11-01", paymentStatus: "Pending" };
    expect(buildFilterParams(form, { limit: 25, isSuperAdmin: false })).toEqual({
      page: 1, limit: 25, dataType: "all", job: "Dallas", driver: "Dee Test", startDate: "2026-11-01", paymentStatus: "Pending",
    });
  });

  it("sends the company earnings flag to a super admin only", () => {
    const form = { ...BLANK, route: "R1", companyEarnings: true };
    expect(buildFilterParams(form, { limit: 10, isSuperAdmin: true }).companyEarnings).toBe(true);
    expect(buildFilterParams(form, { limit: 10, isSuperAdmin: false }).companyEarnings).toBeUndefined();
  });
});

describe("summaryParamsOf", () => {
  it("drops paging and the earnings flag", () => {
    expect(summaryParamsOf({ page: 1, limit: 10, dataType: "all", job: "Dallas", companyEarnings: true })).toEqual({ dataType: "all", job: "Dallas" });
  });
});

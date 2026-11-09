import { describe, expect, it } from "vitest";
import { companyPriceCell, companyRatesRetired, visiblePriceFields } from "./routeCompanyRates.js";

const FIELDS = [
  { label: "Company Route Price", field: "companyRoutePrice" },
  { label: "Driver Route Price", field: "driverRoutePrice" },
  { label: "Company Double Stop Price", field: "companyDoubleStopPrice" },
  { label: "Driver Double Stop Price", field: "driverDoubleStopPrice" },
];
const WEEKLY_VERIFIED = { city_type: "WEEKLY", has_verified_statements: true };

describe("company price fields of a route", () => {
  it("are retired only for a weekly city that has a verified carrier statement", () => {
    expect(companyRatesRetired(WEEKLY_VERIFIED)).toBe(true);
    expect(companyRatesRetired({ city_type: "WEEKLY", has_verified_statements: false })).toBe(false);
    expect(companyRatesRetired({ city_type: "DAILY", has_verified_statements: true })).toBe(false);
    expect(companyRatesRetired({ city_type: "WEEKLY" })).toBe(false);
    expect(companyRatesRetired(undefined)).toBe(false);
  });

  it("hide the two company inputs for a retired city and keep all four otherwise (daily SpeedX keeps them)", () => {
    expect(visiblePriceFields(FIELDS, WEEKLY_VERIFIED).map((f) => f.field)).toEqual(["driverRoutePrice", "driverDoubleStopPrice"]);
    expect(visiblePriceFields(FIELDS, { city_type: "DAILY", has_verified_statements: false })).toHaveLength(4);
    expect(visiblePriceFields(FIELDS, undefined)).toHaveLength(4);
  });

  it("show the stored company price in the route table, 0 for a weekly GOFO route with no statement", () => {
    expect(companyPriceCell({ companyRoutePrice: 0 })).toBe(0);
    expect(companyPriceCell({ companyRoutePrice: 2.5, statementPrice: null })).toBe(2.5);
  });

  it("show what the latest statement paid per delivery for a weekly route that has one", () => {
    const statementPrice = { perDelivery: "1.63", deliveries: 6453, week: "Week 43-2026" };
    expect(companyPriceCell({ companyRoutePrice: 0, statementPrice })).toBe("Carrier statement: $1.63 per delivery · Week 43-2026");
    expect(companyPriceCell({ companyRoutePrice: 2.5, statementPrice })).toBe("Carrier statement: $1.63 per delivery · Week 43-2026 (stored price 2.5)");
  });
});

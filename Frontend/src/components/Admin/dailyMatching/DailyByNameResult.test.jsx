import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import DailyByNameResult from "./DailyByNameResult";
import { mainRoutesWithSubs } from "./dailyMatchingApi.js";

afterEach(cleanup);

// Made-up answers, shaped as the daily upload returns them with the switch on.
const none = { total: 0, list: [] };
const RESULT = {
  rows: { inFile: 10, placed: 6, unreadable: 1, name_not_matched: 2, driver_disabled: 1, route_not_in_app: 0, route_disabled: 0, route_without_city: 0, paid_day: 0, clash: 0, counted: 10 },
  days: { created: 2, extended: 0 },
  unmatchedNames: { total: 1, list: [{ cityId: 3, city: "Test City", fileName: "Ana P.", parcels: 2, routes: ["TST 001-1"] }] },
  disabledDrivers: { total: 1, list: [{ cityId: 3, city: "Test City", fileName: "Cy Old", driverId: 7, parcels: 1, routes: ["TST 002-1"] }] },
  missingRoutes: none,
  atMainPrice: { total: 1, list: [{ driverId: 5, driverName: "Bo Li", route: "TST 001-1", parcels: 4 }] },
  movedToSub: { total: 1, list: [{ driverId: 6, driverName: "Di Ng", mainRoute: "TST 001-1", subRoute: "TST 001-1:A" }] },
  clashes: none,
  paidDays: none,
};
const show = (byName) => render(<MemoryRouter><DailyByNameResult byName={byName} /></MemoryRouter>);

describe("drivers found by name, after a daily upload", () => {
  it("adds up every row and lists what needs a look, with a link to match a name", () => {
    show(RESULT);
    expect(screen.getByTestId("daily-reconciliation").textContent).toBe("10 rows in the file = 6 added to a driver + 2 name not matched + 1 driver disabled + 1 could not be read");
    expect(screen.getByRole("link", { name: "Match" }).getAttribute("href")).toBe("/admin/daily-matching"); // the name is handed over in page state, not the address
    expect(screen.getByText(/Paid at the main route's price/)).toBeTruthy();
    expect(screen.getByText(/Bo Li · TST 001-1 · 4 parcels/)).toBeTruthy();
    expect(screen.getByText(/Di Ng · TST 001-1 → TST 001-1:A/)).toBeTruthy();
  });

  it("flags counts that do not add up, and shows nothing when the server sent nothing", () => {
    show({ ...RESULT, rows: { ...RESULT.rows, counted: 9 } });
    expect(screen.getByText(/the counts do not add up: 9 counted/)).toBeTruthy();
    cleanup();
    show(undefined);
    expect(screen.queryByTestId("daily-by-name")).toBeNull();
  });
});

describe("main routes and their sub-routes", () => {
  it("groups each ':X' route under its main route, and leaves out routes without sub-routes", () => {
    const routes = [{ id: 1, code: "TST 001-1" }, { id: 2, code: "TST 001-1:B" }, { id: 3, code: "TST 001-1:A" }, { id: 4, code: "TST 002-1" }];
    expect(mainRoutesWithSubs(routes).map((g) => [g.main.code, g.subs.map((s) => s.code)])).toEqual([["TST 001-1", ["TST 001-1:B", "TST 001-1:A"]]]);
  });
});

describe("the Match link", () => {
  it("opens the Daily drivers page with the city and the name filled in, and the name not in the address", () => {
    const Target = () => {
      const loc = useLocation();
      return <p data-testid="target">{`${loc.pathname}${loc.search}|${loc.state?.cityId}|${loc.state?.name}`}</p>;
    };
    render(<MemoryRouter><Routes><Route path="/" element={<DailyByNameResult byName={RESULT} />} /><Route path="/admin/daily-matching" element={<Target />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Match" }));
    expect(screen.getByTestId("target").textContent).toBe("/admin/daily-matching|3|Ana P.");
  });
});

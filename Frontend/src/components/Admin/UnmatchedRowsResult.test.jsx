import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import UploadResultSummary from "./UploadResultSummary";

afterEach(cleanup);

// Made-up answers, shaped as the weekly upload returns them.
const ROWS = { inFile: 28, unreadable: 3, counted: 28, to_add: 5, already_on_dashboard: 1, driver_not_in_app: 8, driver_disabled: 3, route_not_in_app: 7, route_disabled: 1, route_without_city: 0 };
const UNMATCHED = {
  checked: true,
  rows: ROWS,
  drivers: {
    total: 2, shown: 2, list: [
      { deliveryId: 7710002, reason: "driver_disabled", routes: ["TST-001"], days: ["2026-11-02"], packages: 3, fs: 3, ds: 0, estimate: "4.80", unpricedPackages: 0 },
      { deliveryId: 9999992, reason: "driver_not_in_app", routes: ["TST-404"], days: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"], packages: 2, fs: 2, ds: 0, estimate: null, unpricedPackages: 2 },
    ],
  },
  routes: { total: 1, shown: 1, list: [{ route: "TST-404", reason: "route_not_in_app", deliveryIds: 1, days: ["2026-11-02"], packages: 7, fs: 7, ds: 0, estimate: null }] },
};
const show = (unmatched) => render(<UploadResultSummary result={{ unmatched }} />);

describe("in the file but not in the app, after a weekly upload", () => {
  it("adds up every row of the file, and lists each Delivery ID with its reason, route, days, counts and estimate", () => {
    show(UNMATCHED);
    expect(screen.getByTestId("unmatched-reconciliation").textContent).toBe(
      "28 rows in the file = 5 will be added + 1 already on the dashboard + 8 Delivery ID not in the app + 3 driver disabled + 7 route not in the app + 1 route disabled + 3 could not be read",
    );
    expect(screen.getByText("Delivery ID 7710002")).toBeTruthy();
    expect(screen.getByText("Driver is disabled")).toBeTruthy();
    expect(screen.getByText("$4.80")).toBeTruthy();
    expect(screen.getByText("estimate from route prices")).toBeTruthy();
    expect(screen.getByText("Not in the app")).toBeTruthy();
    expect(screen.getByText(/4 days, 2026-11-02 to 2026-11-05/)).toBeTruthy();
    expect(screen.getByText("no route price")).toBeTruthy();
    expect(screen.getByText(/Route TST-404/, { selector: "li" }).textContent).toContain("Route not in the app");
    expect(screen.getByText(/will be left out when you press Calculate Driver Payment/)).toBeTruthy();
  });

  it("says so when everything in the file is in the app", () => {
    show({ checked: true, rows: { ...ROWS, inFile: 6, unreadable: 0, counted: 6, to_add: 6, already_on_dashboard: 0, driver_not_in_app: 0, driver_disabled: 0, route_not_in_app: 0, route_disabled: 0 }, drivers: { total: 0, shown: 0, list: [] }, routes: { total: 0, shown: 0, list: [] } });
    expect(screen.getByText("Every Delivery ID and route in this file is in the app.")).toBeTruthy();
    expect(screen.getByTestId("unmatched-reconciliation").textContent).toBe("6 rows in the file = 6 will be added");
  });

  it("flags counts that do not add up, says when the check could not run, and shows nothing when the server sent nothing", () => {
    show({ ...UNMATCHED, rows: { ...ROWS, counted: 27 } });
    expect(screen.getByText(/the counts do not add up: 27 counted/)).toBeTruthy();
    cleanup();
    show({ checked: false });
    expect(screen.getByText(/Could not check the file against the app/)).toBeTruthy();
    cleanup();
    show(undefined);
    expect(screen.queryByTestId("unmatched-rows")).toBeNull();
  });
});

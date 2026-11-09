import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import dashboardReducer, { selectAppliedRevenue, updateWeeklyExcelToDashboard } from "../../redux/slice/admin/dashboardUpdateSlice.js";
import { manualLogout } from "../../redux/slice/admin/adminSlice.js";
import RevenueResult from "./RevenueResult";
import UploadResultSummary from "./UploadResultSummary";

afterEach(cleanup);

// The GOFO revenue answer of the one weekly upload (#252), as the server shapes it.
const show = (revenue, props = {}) => render(<MemoryRouter><RevenueResult revenue={revenue} {...props} /></MemoryRouter>);

describe("the revenue result in the upload flow", () => {
  it.each([
    ["updated", "Revenue updated"],
    ["already_imported", "Already imported"],
    ["needs_review", "Revenue needs review"],
  ])("says %s in plain words", (state, message) => {
    show({ state, message, reasons: [], importId: null });
    expect(screen.getByTestId("revenue-message").textContent).toBe(message);
  });

  it("lists the reasons a review is needed, and tells a city admin nothing about company figures", () => {
    show({ state: "needs_review", message: "Revenue needs review", reasons: ["Only an owner publishes company revenue."], importId: null });
    expect(screen.getByText("Only an owner publishes company revenue.")).toBeTruthy();
    expect(screen.queryByText(/delivery revenue \$/)).toBeNull();
    expect(screen.queryByRole("link", { name: /GOFO import history/ })).toBeNull();
  });

  it("gives the owner the figures and a link to review the saved file, with nothing to upload again", () => {
    show({ state: "needs_review", message: "Revenue needs review", reasons: ["It corrects a statement that already stands."], importId: "4", city: "Test GOFO", week: "Week 43-2026", deliveryRevenue: "4.91" });
    expect(screen.getByText(/Test GOFO · Week 43-2026 · delivery revenue \$4.91/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /review it in the GOFO import history/ }).getAttribute("href")).toBe("/admin/carrier-statements");
    expect(screen.getByText(/Nothing needs to be uploaded again/)).toBeTruthy();
    expect(screen.getByText(/Pay, claims and the weekly data are not affected/)).toBeTruthy();
  });

  it("shows nothing when the server sent no revenue answer, and the upload summary carries it", () => {
    const { container } = show(undefined);
    expect(container.textContent).toBe("");
    cleanup();
    render(<MemoryRouter><UploadResultSummary result={{ claims: { found: false }, assignmentHistory: null, revenue: { state: "updated", message: "Revenue updated", reasons: [] } }} /></MemoryRouter>);
    expect(screen.getByTestId("revenue-message").textContent).toBe("Revenue updated");
  });
});

it("keeps a weekly apply result in the same admin session and discards a late answer after sign-out", () => {
  const revenue = { state: "updated", deliveryRevenue: "4.91" };
  const pending = dashboardReducer(undefined, updateWeeklyExcelToDashboard.pending("owner-request"));
  const answer = updateWeeklyExcelToDashboard.fulfilled({ revenue, revenueAdminId: 1, revenueAdminRole: "superadmin" }, "owner-request");
  const dashboard = dashboardReducer(pending, answer);
  const read = (dashboard, id, role) => selectAppliedRevenue({ dashboard, admin: { isAuthenticated: true, admin: { id, role } } });
  expect(read(dashboard, 1, "superadmin")).toEqual(revenue);
  expect(read(dashboard, 2, "admin")).toBeNull();
  expect(read(dashboard, 1, "admin")).toBeNull();
  expect(read(dashboardReducer(dashboardReducer(pending, manualLogout()), answer), 1, "superadmin")).toBeNull();
});

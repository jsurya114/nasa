import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PenaltyRows, { PayRunNetRow } from "./PenaltyRows.jsx";
import { describePenalty } from "./usePenaltySummary.js";

// Made-up figures, shaped as GET /admin/payroll/drivers/:id/dashboard-summary returns them (#166).
const none = { deducted: "0.00", claimDeductions: "0.00", recoveries: "0.00", net: "0.00", count: 0 };
const summary = (period, outstanding = { penalties: "250.00", other: "0.00", total: "250.00" }) =>
  ({ status: "ready", expected: true, cityId: 3, driverId: 7, data: { period: { status: "none", approved: none, preview: none, statements: [], crossingRuns: 0, ...period }, outstanding } });
const approved = { status: "approved", approved: { deducted: "50.00", claimDeductions: "0.00", recoveries: "50.00", net: "246.49", count: 1 } };
const preview = { status: "preview", preview: { deducted: "50.00", claimDeductions: "0.00", recoveries: "50.00", net: "246.49", count: 1 } };

const show = (penalty) => render(<MemoryRouter><table><tbody><PenaltyRows penalty={penalty} /><PayRunNetRow penalty={penalty} /></tbody></table></MemoryRouter>);
afterEach(cleanup);

describe("PenaltyRows", () => {
  it("shows this payday's $50, not the $300 debt: $250 stays outstanding, and the net is the pay run's own", () => {
    show(summary(approved));
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$50.00");
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("Approved");
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("not subtracted again");
    expect(screen.getByTestId("penalty-outstanding-row").textContent).toContain("$250.00");
    expect(screen.getByTestId("penalty-net-row").textContent).toContain("Net Payment (approved pay run)");
    expect(screen.getByTestId("penalty-net-row").textContent).toContain("$246.49");
    expect(screen.getByRole("link", { name: "View entries and history" }).getAttribute("href")).toBe("/admin/payroll?cityId=3&driverId=7");
  });

  it("labels a draft as a preview, never as approved", () => {
    show(summary(preview));
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("Preview");
    expect(screen.getByTestId("penalty-deduction-row").textContent).not.toContain("Approved");
    expect(screen.getByTestId("penalty-net-row").textContent).toContain("Net Payment preview (draft pay run, not approved)");
  });

  it("with no pay run in the dates it shows only what is outstanding, and says nothing is deducted yet", () => {
    show(summary({}));
    expect(screen.queryByTestId("penalty-deduction-row")).toBeNull();
    expect(screen.queryByTestId("penalty-net-row")).toBeNull();
    expect(screen.getByTestId("penalty-outstanding-row").textContent).toContain("$250.00");
  });

  it("says when a pay run crosses the dates and is not counted", () => {
    show(summary({ ...approved, crossingRuns: 1 }));
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("1 pay run crosses these dates and is not counted");
  });

  it("says so when there is nothing to show, asks for dates when they are missing, and is silent only while idle, loading or on an error row", () => {
    expect(describePenalty({ status: "loading", expected: true, data: null })).toBeNull();
    expect(describePenalty({ status: "error", expected: true, data: null })).toBeNull();
    expect(describePenalty(summary({}, { penalties: "0.00", other: "0.00", total: "0.00" }))).toBeNull();
    show(summary({}, { penalties: "0.00", other: "0.00", total: "0.00" }));
    expect(screen.getByTestId("penalty-none-row").textContent).toContain("none for this driver in these dates");
    cleanup();
    show({ status: "idle", expected: false, needsDates: true, data: null });
    expect(screen.getByTestId("penalty-dates-row").textContent).toContain("choose a start and an end date");
    cleanup();
    const { container } = show({ status: "idle", expected: false, data: null });
    expect(container.querySelectorAll("tr").length).toBe(0);
  });
});

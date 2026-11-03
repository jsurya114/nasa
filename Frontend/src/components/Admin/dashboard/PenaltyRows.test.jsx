import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PenaltyRows from "./PenaltyRows.jsx";
import { deductions, netAfter, netLine, summaryItems } from "./penaltyDisplay.js";

// Made-up figures, shaped as GET /admin/payroll/drivers/:id/dashboard-summary returns them (#166).
const ready = (penalties, other = "0.00") => ({ status: "ready", expected: true, cityId: 3, driverId: 7, data: { outstanding: { penalties, other, total: (Number(penalties) + Number(other)).toFixed(2) } } });
const show = (penalty) => render(<MemoryRouter><table><tbody><PenaltyRows penalty={penalty} /></tbody></table></MemoryRouter>);
afterEach(cleanup);

describe("deductions and the net", () => {
  it("takes penalties and others off the net, to the cent", () => {
    expect(deductions(ready("25.00", "10.10"))).toEqual({ penalties: 25, other: 10.1, total: 35.1 });
    expect(netAfter("80.00", ready("25.00", "10.10"))).toBe(44.9);
    expect(netAfter("80.00", ready("0.00"))).toBe(80);
  });

  it("leaves the net as it is, and marks it not final, while the figures are loading or failed", () => {
    expect(netAfter("80.00", { status: "loading", expected: true })).toBe(80);
    expect(netLine({ status: "loading", expected: true }, "Net Payment")).toEqual({ label: "Net Payment (deductions loading, not final)", muted: true });
    expect(netLine({ status: "error", expected: true }, "Net Payment").label).toContain("not loaded, not final");
    expect(netLine(ready("1.00"), "Net Payment")).toEqual({ label: "Net Payment", muted: false });
    expect(netLine({ status: "idle", expected: false }, "Net Payment")).toEqual({ label: "Net Payment", muted: false });
  });

  it("the Summary lines: Penalties and Others only when something is owed", () => {
    expect(summaryItems(ready("25.00", "10.00")).afterInsurance.map((i) => [i.label, i.text])).toEqual([["Penalties", "-$25.00"], ["Others", "-$10.00"]]);
    expect(summaryItems(ready("0.00", "10.00")).afterInsurance.map((i) => i.label)).toEqual(["Others"]);
    expect(summaryItems(ready("0.00")).afterInsurance).toEqual([]);
    expect(summaryItems({ status: "error", expected: true }).afterInsurance[0].kind).toBe("notice");
  });
});

describe("PenaltyRows", () => {
  it("shows a Penalties row and an Others row, each with its own amount", () => {
    show(ready("25.00", "10.00"));
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$25.00");
    expect(screen.getByTestId("other-deduction-row").textContent).toContain("-$10.00");
    expect(screen.getByRole("link", { name: "View entries and history" }).getAttribute("href")).toBe("/admin/payroll?cityId=3&driverId=7");
  });

  it("shows nothing when nothing is owed, nothing while idle, and a row while loading or on an error", () => {
    show(ready("0.00"));
    expect(document.querySelectorAll("tr").length).toBe(0);
    cleanup();
    show({ status: "idle", expected: false });
    expect(document.querySelectorAll("tr").length).toBe(0);
    cleanup();
    show({ status: "loading", expected: true });
    expect(screen.getByTestId("penalty-loading-row")).toBeTruthy();
    cleanup();
    show({ status: "error", expected: true, retry: () => {} });
    expect(screen.getByTestId("penalty-error-row")).toBeTruthy();
  });
});

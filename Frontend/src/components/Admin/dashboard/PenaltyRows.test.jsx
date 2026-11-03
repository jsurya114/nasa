import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PenaltyRows from "./PenaltyRows.jsx";
import { netFor, rowInfo, showRow, summaryItems } from "./penaltyDisplay.js";

// Made-up figures, shaped as GET /admin/payroll/drivers/:id/dashboard-summary returns them (#166).
const ready = ({ source = "estimate", deducted = "0.00", net = null, penalties = "0.00", other = "0.00", flags = [] } = {}) => ({
  status: "ready", expected: true, cityId: 3, driverId: 7,
  data: { payday: { source, deducted, net, flags }, outstanding: { penalties, other, total: (Number(penalties) + Number(other)).toFixed(2) } },
});
const show = (penalty) => render(<MemoryRouter><table><tbody><PenaltyRows penalty={penalty} /></tbody></table></MemoryRouter>);
afterEach(cleanup);

describe("the net", () => {
  it("a preview takes only this payday's share off the table net, never the whole debt, and never below zero", () => {
    const debt = ready({ deducted: "50.00", penalties: "250.00" });
    expect(netFor(80, debt).net).toBe(30);
    expect(netFor(80, debt).preview).toBe(true);
    expect(netFor(30, ready({ deducted: "50.00", penalties: "250.00" })).net).toBe(0);
  });

  it("an approved pay run's frozen net is used as it is; a draft's net is a preview", () => {
    expect(netFor(80, ready({ source: "approved", deducted: "40.00", net: "40.00", penalties: "250.00" }))).toMatchObject({ net: 40, preview: false, label: "Net Payment (approved pay run)" });
    expect(netFor(80, ready({ source: "draft", deducted: "40.00", net: "40.00" }))).toMatchObject({ net: 40, preview: true });
  });

  it("with nothing taken, or no dates, the net is the table's own; while loading or failed it is marked not final", () => {
    expect(netFor(80, ready({ deducted: "0.00", penalties: "100.00" }))).toMatchObject({ net: 80, label: "Net Payment", preview: false });
    expect(netFor(80, ready({ source: "none", penalties: "100.00" })).net).toBe(80);
    expect(netFor(80, { status: "loading", expected: true })).toMatchObject({ net: 80, muted: true });
    expect(netFor(80, { status: "error", expected: true }).label).toContain("not loaded, not final");
    expect(netFor(80, { status: "idle", expected: false })).toMatchObject({ net: 80, label: "Net Payment" });
  });
});

describe("the row and the Summary", () => {
  it("the Summary keeps this payday's deduction and the balance as two lines", () => {
    const items = summaryItems(ready({ deducted: "50.00", penalties: "250.00" }), 80);
    expect(items.afterInsurance.map((i) => [i.label, i.text])).toEqual([["Penalty & Others (this payday)", "-$50.00"], ["Still Owed (all)", "$250.00"]]);
    expect(items.net.net).toBe(30);
    expect(summaryItems(ready(), 80).afterInsurance).toEqual([]);
    expect(summaryItems({ status: "error", expected: true }, 80).afterInsurance[0].kind).toBe("notice");
  });

  it("is shown when something is taken or owed, and not otherwise", () => {
    expect(showRow(ready({ penalties: "1.00" }))).toBe(true);
    expect(showRow(ready({ deducted: "1.00" }))).toBe(true);
    expect(showRow(ready())).toBe(false);
    expect(showRow({ status: "loading", expected: true })).toBe(false);
    expect(rowInfo({ status: "idle" })).toBeNull();
  });

  it("the row shows this payday's amount, the balance with its parts, and the reason when nothing is taken", () => {
    show(ready({ deducted: "50.00", penalties: "240.00", other: "10.00" }));
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$50.00");
    expect(screen.getByTestId("penalty-owed").textContent).toContain("Still owed in all: $250.00 (Penalties $240.00 · Others $10.00)");
    expect(screen.getByRole("link", { name: "View entries and history" }).getAttribute("href")).toBe("/admin/payroll?cityId=3&driverId=7");
    cleanup();
    show(ready({ penalties: "100.00", flags: [{ code: "recovery_limit_not_set", message: "no recovery limit is set" }] }));
    expect(screen.getByTestId("penalty-note").textContent).toContain("no recovery limit is set");
  });

  it("shows nothing when idle or when nothing is owed, and a row while loading or on an error", () => {
    show(ready());
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

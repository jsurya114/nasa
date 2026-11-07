import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installServer, resetBrowser } from "../../test/fakeShell";

vi.mock("../../reuse/Header", () => ({ default: () => null }));
vi.mock("../../reuse/Nav", () => ({ default: () => null }));
beforeEach(resetBrowser);
afterEach(cleanup);

// The real page with made-up statements from a fake server. Every request is recorded so the tests can say exactly what was asked.
const ECONOMICS = { deliveryRevenue: "4.91", driverEarnings: "6.50", deliveryMargin: "-1.59", carrierClaims: "-0.70", ledgerAdjustments: "-2.00", contribution: "-4.29", settlementPayable: "2.21", insuranceWithheld: "1.92", driverEarningsAfterInsurance: "4.58", matchedRevenue: "2.61", unallocatedRevenue: "2.30", nasaRecords: 3, nasaDeliveries: 6, recordsWithoutBilledFee: 1, recordsWithoutDriverEarnings: 0, carrierDeliveries: 5 };
const statement = (extra = {}) => ({ id: "7", fleet: "TST-NLC", cityId: 1, city: "Test GOFO", periodStart: "2026-10-19", periodEnd: "2026-10-25", billingWeek: "Week 43-2026", billNumber: "AP1", version: 1, status: "published", origin: "upload", unallocatedGroups: 1, economics: ECONOMICS, ...extra });
const PREVIEW = { status: "ready", city: { id: 1, name: "Test GOFO" }, period: { start: "2026-10-19", end: "2026-10-25", label: "Week 43-2026" }, identity: { billNumber: "AP1" },
  amounts: { deliveryRevenue: "4.91", claims: "-0.70", adjustments: "-2.00", settlementPayable: "2.21" },
  matching: { matchedRevenue: "2.61", unallocatedRevenue: "2.30", states: { matched: { groups: 1, revenue: "2.61" }, no_pay_group: { groups: 1, revenue: "2.30" }, no_route: { groups: 0, revenue: "0.00" }, unknown_route: { groups: 0, revenue: "0.00" }, unknown_driver: { groups: 0, revenue: "0.00" } }, nasaOnly: { rows: 1, driverEarnings: "2.00" } },
  outcome: { kind: "new" } };

const mount = async (handler) => {
  const calls = [];
  await installServer(async (config) => { calls.push(config); return handler(config, calls); });
  const { default: Page } = await import("./CarrierStatements.jsx");
  render(<MemoryRouter><Page /></MemoryRouter>);
  return calls;
};
const FILE = () => new File(["x"], "statement.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const choose = (file = FILE()) => fireEvent.change(screen.getByLabelText("Carrier statement file"), { target: { files: [file] } });

describe("Carrier statements: the list", () => {
  it("shows each statement's revenue, driver earnings, margin, contribution and settlement apart, with the carrier's count beside NASA's", async () => {
    await mount(async () => ({ status: 200, data: { statements: [statement()] } }));
    const card = await screen.findByTestId("statement-7");
    const text = (id) => within(card).getByTestId(id).textContent;
    expect([text("fig-revenue"), text("fig-driver"), text("fig-margin"), text("fig-contribution"), text("fig-payable"), text("fig-after-insurance"), text("fig-unallocated")]).toEqual(["$4.91", "$6.50", "-$1.59", "-$4.29", "$2.21", "$4.58", "$2.30"]);
    expect(text("fig-deliveries")).toBe("6 · 5");
    expect(within(card).getByText(/carrier's count includes offset tickets/)).toBeTruthy();
    expect(within(card).getByText(/Week 43-2026/)).toBeTruthy();
  });

  it("says plainly when there is no statement yet, and shows a recoverable error", async () => {
    let fail = true;
    await mount(async () => (fail ? { status: 500, data: {} } : { status: 200, data: { statements: [] } }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("statements-empty")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export CSV" }).disabled).toBe(true);
  });

  it("shows the unallocated lines with the reason, on request", async () => {
    await mount(async (config) => (config.url.endsWith("/7/unallocated")
      ? { status: 200, data: { unallocated: [{ deliveryId: "90000102", day: "2026-10-20", route: "TS01-002", state: "no_pay_group", reason: "NASA has no recorded work for this driver, day and route", revenue: "2.30" }] } }
      : { status: 200, data: { statements: [statement()] } }));
    fireEvent.click(await screen.findByRole("button", { name: "Show unallocated (1)" }));
    const table = await screen.findByTestId("unallocated-table");
    expect(within(table).getByText("NASA has no recorded work for this driver, day and route")).toBeTruthy();
    expect(within(table).getByText("$2.30")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide unallocated" }));
    expect(screen.queryByTestId("unallocated-table")).toBeNull();
  });
});

describe("Carrier statements: adding one", () => {
  it("checks the file first, stores nothing until Publish, then reloads the list", async () => {
    let published = false;
    const calls = await mount(async (config) => {
      if (config.url.endsWith("/preview")) return { status: 200, data: PREVIEW };
      if (config.url.endsWith("/publish")) { published = true; return { status: 201, data: { status: "published", statementId: 7, version: 1 } }; }
      return { status: 200, data: { statements: published ? [statement()] : [] } };
    });
    await screen.findByTestId("statements-empty");
    expect(screen.getByRole("button", { name: "Check statement" }).disabled).toBe(true);
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Check statement" }));
    const preview = await screen.findByTestId("statement-preview");
    expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(false);
    expect(within(preview).getByTestId("amount-revenue").textContent).toBe("$4.91");
    expect(within(preview).getByTestId("amount-unallocated").textContent).toBe("$2.30");
    expect(within(preview).getByTestId("statement-outcome").textContent).toMatch(/first statement for this fleet and week/);
    expect(within(preview).getByTestId("statement-unmatched").textContent).toMatch(/No recorded work for that driver, day and route: 1 group, \$2\.30\. Kept as unallocated revenue/);
    expect(within(preview).getByText(/1 NASA record \(\$2\.00 of driver earnings\) the carrier did not bill/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish statement" }));
    expect(await screen.findByTestId("statement-7")).toBeTruthy();
    expect(screen.queryByTestId("statement-preview")).toBeNull();
  });

  it("refuses a statement that does not reconcile and lists every reason, with no way to publish it", async () => {
    await mount(async (config) => (config.url.endsWith("/preview")
      ? { status: 200, data: { status: "rejected", reasons: ["Check failed: DSP Summary total billing = revenue + claims + adjustments", "Details of Delivery Fees row 5 (Fee): not an amount"] } }
      : { status: 200, data: { statements: [] } }));
    await screen.findByTestId("statements-empty");
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Check statement" }));
    const rejected = await screen.findByTestId("statement-rejected");
    expect(within(rejected).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Publish statement" })).toBeNull();
  });

  it("explains a correction, and refuses to offer Publish for the same statement or an older version", async () => {
    const outcomes = [{ kind: "correction", replaces: "7", replacesVersion: 1 }, { kind: "already_published", version: 1 }, { kind: "older_version", version: 1 }];
    let next = 0;
    await mount(async (config) => (config.url.endsWith("/preview") ? { status: 200, data: { ...PREVIEW, outcome: outcomes[next++] } } : { status: 200, data: { statements: [] } }));
    await screen.findByTestId("statements-empty");
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Check statement" }));
    expect((await screen.findByTestId("statement-outcome")).textContent).toMatch(/corrects version 1\. Publishing makes it version 2; the earlier version stays as history/);
    expect(screen.getByRole("button", { name: "Publish statement" }).disabled).toBe(false);
    choose(new File(["y"], "again.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Check statement" }));
    await waitFor(() => expect(screen.getByTestId("statement-outcome").textContent).toMatch(/already published/));
    expect(screen.getByRole("button", { name: "Publish statement" }).disabled).toBe(true);
    choose(new File(["z"], "old.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Check statement" }));
    await waitFor(() => expect(screen.getByTestId("statement-outcome").textContent).toMatch(/earlier version/));
    expect(screen.getByRole("button", { name: "Publish statement" }).disabled).toBe(true);
  });

  it("shows a refused request in plain words", async () => {
    await mount(async (config) => (config.url.endsWith("/preview") ? { status: 400, data: { message: "This is not an Excel (.xlsx) file. Upload the statement as downloaded." } } : { status: 200, data: { statements: [] } }));
    await screen.findByTestId("statements-empty");
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Check statement" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This is not an Excel (.xlsx) file. Upload the statement as downloaded.");
  });
});

describe("Carrier statements: voiding", () => {
  it("needs a reason of at least five characters, then voids and reloads", async () => {
    let voided = false;
    const calls = await mount(async (config) => {
      if (config.url.endsWith("/7/void")) { voided = true; return { status: 200, data: { voided: true } }; }
      return { status: 200, data: { statements: [statement(voided ? { status: "voided", voidReason: "uploaded for the wrong week" } : {})] } };
    });
    fireEvent.click(await screen.findByRole("button", { name: "Void" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Void statement" });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "oops" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "uploaded for the wrong week" } });
    fireEvent.click(confirm);
    expect(await screen.findByText(/Voided: uploaded for the wrong week/)).toBeTruthy();
    expect(JSON.parse(calls.find((c) => c.url.endsWith("/7/void")).data)).toEqual({ reason: "uploaded for the wrong week" });
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
  });
});

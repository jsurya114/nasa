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
const mount = async (handler, { imports = [] } = {}) => {
  const calls = [];
  await installServer(async (config) => { calls.push(config); return config.url.endsWith("/imports") ? { status: 200, data: { imports } } : handler(config, calls); });
  const { default: Page } = await import("./CarrierStatements.jsx");
  render(<MemoryRouter><Page /></MemoryRouter>);
  return calls;
};
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

describe("Carrier statements: a replaced version", () => {
  it("shows the figures that are not available as such, never as zero, and says why", async () => {
    const economics = { ...ECONOMICS, driverEarnings: null, deliveryMargin: null, contribution: null, insuranceWithheld: null, driverEarningsAfterInsurance: null, nasaRecords: null, nasaDeliveries: null,
      recordsWithoutBilledFee: null, recordsWithoutDriverEarnings: null, economicsAvailable: false, unavailableReason: "This version is no longer the statement that stands, so NASA's driver earnings are not attributed to it." };
    await mount(async () => ({ status: 200, data: { statements: [statement({ status: "superseded", economics })] } }));
    const card = await screen.findByTestId("statement-7");
    expect(within(card).getByTestId("fig-revenue").textContent).toBe("$4.91");
    for (const id of ["fig-driver", "fig-margin", "fig-contribution", "fig-after-insurance"]) expect(within(card).getByTestId(id).textContent).not.toMatch(/\$0\.00|\$[0-9]/);
    expect(within(card).getByTestId("economics-unavailable").textContent).toMatch(/no longer the statement that stands/);
  });
});

describe("Carrier statements: how far the driver cost is known", () => {
  it("labels a margin whose driver cost is incomplete as provisional and gives the reasons, keeping the carrier's figures", async () => {
    const economics = { ...ECONOMICS, marginStatus: "provisional", marginReasons: ["1 NASA record has no driver earnings yet, so its cost is not in this margin."], economicsAvailable: true };
    await mount(async () => ({ status: 200, data: { statements: [statement({ economics })] } }));
    const card = await screen.findByTestId("statement-7");
    expect(within(card).getByTestId("margin-provisional").textContent).toMatch(/provisional.*1 NASA record has no driver earnings yet/);
    expect(within(card).getByText(/Delivery margin.*provisional/)).toBeTruthy();
    expect(within(card).getByText(/Contribution · provisional/)).toBeTruthy();
    expect(within(card).getByTestId("fig-revenue").textContent).toBe("$4.91");
    expect(within(card).getByTestId("fig-payable").textContent).toBe("$2.21");
  });

  it("shows no provisional note when the cost is complete", async () => {
    await mount(async () => ({ status: 200, data: { statements: [statement({ economics: { ...ECONOMICS, marginStatus: "complete", marginReasons: [], economicsAvailable: true } })] } }));
    const card = await screen.findByTestId("statement-7");
    expect(within(card).queryByTestId("margin-provisional")).toBeNull();
  });

  it("shows unavailable cost and margin as Not available (never $0.00) when no NASA work is recorded yet, with the carrier figures intact", async () => {
    const economics = { ...ECONOMICS, driverEarnings: null, deliveryMargin: null, contribution: null, insuranceWithheld: null, driverEarningsAfterInsurance: null, marginStatus: "unavailable",
      marginReasons: ["No NASA work is recorded against this statement yet, so driver cost and margin are not available."], economicsAvailable: false, unavailableReason: "No NASA work is recorded against this statement yet, so driver cost and margin are not available." };
    await mount(async () => ({ status: 200, data: { statements: [statement({ economics })] } }));
    const card = await screen.findByTestId("statement-7");
    for (const id of ["fig-driver", "fig-margin", "fig-contribution"]) expect(within(card).getByTestId(id).textContent).not.toMatch(/\$/);
    expect(within(card).getByTestId("economics-unavailable").textContent).toMatch(/No NASA work is recorded/);
    expect(within(card).getByTestId("fig-revenue").textContent).toBe("$4.91");
    expect(within(card).getByTestId("fig-payable").textContent).toBe("$2.21");
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

const waiting = (extra = {}) => ({ id: "4", sourceLabel: "weekly week 43.xlsx", uploadedAt: "2026-11-08T10:00:00Z", reasonKind: "owner_required", canPublish: true, reasons: ["Only an owner publishes company revenue. The saved import is waiting for the owner; nothing needs to be uploaded again."],
  city: "Test GOFO", week: "Week 43-2026", billNumber: "AP1", deliveryRevenue: "4.91", settlementPayable: "2.21", outcome: { kind: "new" }, ...extra });

describe("GOFO import history: no upload here", () => {
  it("has no file chooser: the weekly workbook is uploaded once under File Upload", async () => {
    await mount(async () => ({ status: 200, data: { statements: [] } }));
    expect(await screen.findByRole("heading", { name: "GOFO import history" })).toBeTruthy();
    expect(screen.queryByLabelText("Carrier statement file")).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(await screen.findByTestId("imports-empty")).toBeTruthy();
  });
});

describe("GOFO import history: a weekly upload waiting for the owner", () => {
  it("publishes the saved import without choosing the file again, then reloads", async () => {
    let published = false;
    const calls = await mount(async (config) => (config.url.endsWith("/imports/4/publish") ? ((published = true), { status: 201, data: { status: "published", version: 1 } }) : { status: 200, data: { statements: [] } }), { imports: [waiting()] });
    const card = await screen.findByTestId("import-4");
    expect(within(card).getByText(/A city admin added this week's data/)).toBeTruthy();
    expect(within(card).getByText(/Delivery revenue \$4.91/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(published).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/imports/4/publish"));
    expect(post.method).toBe("post");
    expect(post.data instanceof FormData).toBe(false);
    expect(JSON.parse(post.data)).toEqual({ confirmCorrection: false });
    expect(await screen.findByText("Revenue updated")).toBeTruthy();
  });

  it("asks for a confirmation before a correction replaces the statement that stands", async () => {
    const calls = await mount(async (config) => (config.url.endsWith("/publish") ? { status: 201, data: { status: "published", version: 2 } } : { status: 200, data: { statements: [] } }),
      { imports: [waiting({ reasonKind: "correction", reasons: ["This corrects the statement that stands for Test GOFO Week 43-2026 (version 1). An owner confirms a correction."] })] });
    const card = await screen.findByTestId("import-4");
    fireEvent.click(within(card).getByRole("button", { name: "Review correction" }));
    expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(false);
    expect(within(card).getByText(/replaces the statement that stands for this week/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Confirm correction" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/publish"))).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.url.endsWith("/publish")).data)).toEqual({ confirmCorrection: true });
  });

  it("shows why a failed check still fails when the owner checks again, and dismissal needs a reason", async () => {
    const calls = await mount(async (config) => {
      if (config.url.endsWith("/publish")) return { status: 422, data: { status: "rejected", reasons: ["Check failed: settlement payable"] } };
      if (config.url.endsWith("/dismiss")) return { status: 200, data: { dismissed: true } };
      return { status: 200, data: { statements: [] } };
    }, { imports: [waiting({ reasonKind: "check_failed", reasons: ["Check failed: settlement payable"], city: null, deliveryRevenue: null })] });
    const card = await screen.findByTestId("import-4");
    fireEvent.click(within(card).getByRole("button", { name: "Check again" }));
    expect((await within(card).findByRole("alert")).textContent).toMatch(/settlement payable/);
    fireEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
    const confirm = within(card).getByRole("button", { name: "Dismiss import" });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(card).getByLabelText(/Why is it being dismissed/), { target: { value: "wrong file from the carrier" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/dismiss"))).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.url.endsWith("/dismiss")).data)).toEqual({ reason: "wrong file from the carrier" });
  });
});

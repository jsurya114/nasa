import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../../test/fakeShell";

// The QuickBooks panel with made-up answers. Nothing leaves this machine.
const base = { configured: true, enabled: true, environment: "sandbox", problems: [], disabledReason: null };
const CONNECTED = { ...base, connection: { connected: true, realmId: "12345678", needsReconnect: false } };
const vendorList = () => ({ environment: "sandbox", summary: { drivers: 2, linked: 1, unlinked: 1, blocked: 0 }, drivers: [
  { driverId: 7, name: "Desi One", issues: [], link: { vendorId: "58", vendor1099: true } },
  { driverId: 8, name: "Desi Two", issues: [], link: null }] });

const startServer = async ({ status = CONNECTED, lookup = { result: "match", matches: [{ vendorId: "77", displayName: "Desi Two LLC", vendor1099: false, linkedTo: null }], warnings: ["vendor_not_1099"] } } = {}) => {
  const state = { calls: [] };
  await installServer(async (config) => {
    state.calls.push(`${config.method} ${config.url}`);
    if (config.url === "/admin/payroll/quickbooks/status") return { status: 200, data: status };
    if (config.url === "/admin/payroll/quickbooks/vendors") return { status: 200, data: vendorList() };
    if (config.url === "/admin/payroll/quickbooks/vendors/lookup") return { status: 200, data: lookup };
    if (config.url === "/admin/payroll/quickbooks/vendors/link") { state.linked = typeof config.data === "string" ? JSON.parse(config.data) : config.data; return { status: 200, data: { link: { vendorId: "77" } } }; }
    if (config.url === "/admin/payroll/quickbooks/settings" && config.method === "get") return { status: 200, data: { saved: null, expenseAccounts: [{ id: "61", name: "Contract labor" }], bankAccounts: [{ id: "35", name: "Checking" }] } };
    if (config.url === "/admin/payroll/quickbooks/settings" && config.method === "put") { state.saved = typeof config.data === "string" ? JSON.parse(config.data) : config.data; return { status: 200, data: {} }; }
    if (config.url === "/admin/payroll/quickbooks/check") return { status: 200, data: { ...status, ok: true, companyName: "Sandbox Company" } };
    return { status: 200, data: {} };
  });
  return state;
};
const mount = async (props = { cityId: "1" }) => { const { default: QuickbooksPanel } = await import("./QuickbooksPanel.jsx"); return render(<QuickbooksPanel {...props} />); };

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("QuickBooks panel", () => {
  it("says what is missing and offers no connect button when the backend is not set up", async () => {
    await startServer({ status: { ...base, configured: false, enabled: false, problems: ["QUICKBOOKS_CLIENT_ID is not set"], connection: { connected: false } } });
    await mount();
    expect(await screen.findByText("QUICKBOOKS_CLIENT_ID is not set")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /connect quickbooks/i })).toBeNull();
  });

  it("says why it is off when the switch is off", async () => {
    await startServer({ status: { ...base, enabled: false, disabledReason: "QuickBooks is switched off (QUICKBOOKS_ENABLED is not \"true\")", connection: { connected: false } } });
    await mount();
    expect(await screen.findByText(/switched off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /connect quickbooks/i })).toBeNull();
  });

  it("tests the connection on request and shows the company name", async () => {
    await startServer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected to Sandbox Company.")).toBeTruthy();
  });

  it("lists the city's Desi drivers, looks one up and links the exact vendor found, warning about a non-1099 vendor", async () => {
    const server = await startServer();
    await mount();
    expect(await screen.findByText("Linked to vendor 58")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText(/not marked for 1099 tracking/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Link this vendor" }));
    await screen.findByText(/Found vendor/).catch(() => null);
    expect(server.linked).toEqual({ cityId: 1, driverId: 8, vendorId: "77" });
  });

  it("lets the admin choose the expense and bank accounts for Desi payments once payments are on", async () => {
    const server = await startServer({ status: { ...CONNECTED, paymentsEnabled: true } });
    await mount();
    fireEvent.change(await screen.findByLabelText(/Expense account/), { target: { value: "61" } });
    fireEvent.change(screen.getByLabelText(/Bank account/), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Save accounts" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(server.saved).toEqual({ expenseAccountId: "61", bankAccountId: "35" });
  });

  it("asks for a city before listing drivers", async () => {
    await startServer();
    await mount({ cityId: "" });
    expect(await screen.findByText(/Choose a city below/)).toBeTruthy();
  });
});

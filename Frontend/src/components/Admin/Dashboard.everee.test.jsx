import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The real Dashboard with made-up data (#31): after Filter Data, the Pay with Everee section sits under the Driver Jobs table and follows the
// filter that was applied. Nothing leaves this machine.
const ROW = { id: 1, driver_name: "Dee Test", job_date: "2026-11-03", route_name: "R1", packages: 10, no_scanned: 0, failed_attempt: 0, fs: 0, ds: 0, delivered: 10,
  driver_payment: "100.00", insurance_deduction: "0.00", closed: true, paid: false, data_type: "daily" };
const RUN = { id: 17, city_id: 3, city: "Test City", data_type: "daily", period_start: "2026-11-01", period_end: "2026-11-07", drivers: 1, remaining: "100.00", processing: 0 };

const startServer = async ({ configured = true, runs = [RUN], dupName = false } = {}) => {
  const state = { calls: [], runParams: [] };
  await installServer(async (config) => {
    const url = config.url;
    state.calls.push(`${config.method} ${url}`);
    if (url === "/admin/dashboard/data") return { status: 200, data: { success: true, data: { cities: [{ id: 3, job: "Test City" }, { id: 4, job: "Other City" }], drivers: [{ id: 7, name: "Dee Test" }, ...(dupName ? [{ id: 9, name: "Dee Test" }] : [])], routes: [] } } };
    if (url === "/admin/dashboard/drivers-by-city") return { status: 200, data: { success: true, data: [{ id: 7, name: "Dee Test" }] } };
    if (url === "/admin/dashboard/routes-by-city") return { status: 200, data: { success: true, data: [] } };
    if (url === "/admin/dashboard/paymentTable") return { status: 200, data: { success: true, data: [ROW], pagination: { total: 1, page: 1, limit: 10, totalPages: 1 } } };
    if (url === "/admin/dashboard/summary") return { status: 200, data: { success: true, data: { total_driver_payment: 100, total_insurance_deduction: 0, total_company_earnings: 10 } } };
    if (url === "/admin/payroll/everee/status") return { status: 200, data: { configured, environment: "sandbox" } };
    if (url === "/admin/payroll/everee/payable-runs") { state.runParams.push(config.params ?? {}); return { status: 200, data: { runs } }; }
    if (url === "/admin/payroll/payments/runs") return { status: 200, data: { runs: [], nextBeforeId: null } };
    if (url.endsWith("/dashboard-summary")) return { status: 200, data: { payday: { source: "estimate", claimDeductions: "0.00", recoveries: "0.00", deducted: "0.00", net: "100.00", flags: [] }, period: { status: "none", approved: {}, preview: {}, statements: [], crossingRuns: 0 }, outstanding: { penalties: "0.00", other: "0.00", total: "0.00" } } };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async ({ superAdmin = true } = {}) => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const dashReducer = (await import("../../redux/slice/admin/dashSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Dashboard } = await import("./Dashboard.jsx");
  const signedIn = { ...adminReducer(undefined, { type: "init" }), admin: { id: 1, role: superAdmin ? "superadmin" : "admin" }, isSuperAdmin: superAdmin, isAuthenticated: true };
  const store = configureStore({ reducer: { admin: adminReducer, dash: dashReducer, language: languageReducer }, preloadedState: { admin: signedIn } });
  return render(<Provider store={store}><MemoryRouter><Dashboard /></MemoryRouter></Provider>);
};

const select = (container, name) => container.querySelector(`select[name="${name}"]`);
const apply = async (container, { city, driver, status = "Pending" } = {}) => {
  if (city) {
    await waitFor(() => expect(within(select(container, "job")).getByRole("option", { name: city })).toBeTruthy());
    fireEvent.change(select(container, "job"), { target: { name: "job", value: city } });
  }
  if (driver) {
    await waitFor(() => expect(within(select(container, "driver")).getAllByRole("option", { name: driver }).length).toBeGreaterThan(0));
    fireEvent.change(select(container, "driver"), { target: { name: "driver", value: driver } });
  }
  fireEvent.change(select(container, "paymentStatus"), { target: { name: "paymentStatus", value: status } });
  fireEvent.click(screen.getByRole("button", { name: "Filter Data" }));
};

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("Dashboard: Pay with Everee under the Driver Jobs table", () => {
  it("a city, a driver and payment status Pending, then Filter Data: the section appears under the table with a button for the approved run, limited to that driver", async () => {
    const server = await startServer();
    const { container } = await mount();
    expect(screen.queryByRole("region", { name: "Pay with Everee" })).toBeNull(); // nothing before a filter is applied
    await apply(container, { city: "Test City", driver: "Dee Test" });
    const section = await screen.findByRole("region", { name: "Pay with Everee" });
    // it is below the Driver Jobs table
    const jobs = document.querySelector("table").closest("section");
    expect(jobs.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(section).findByRole("button", { name: "Pay with Everee" })).toBeTruthy();
    expect(within(section).getByText("Approved pay for Dee Test.", { exact: false })).toBeTruthy();
    expect(within(section).getByText("$100.00")).toBeTruthy();
    expect(server.runParams.at(-1)).toEqual({ cityId: 3, driverId: 7 });
  });

  it("a driver without a city works too, and a city without a driver asks for the whole city", async () => {
    const server = await startServer();
    const { container } = await mount();
    await apply(container, { driver: "Dee Test" });
    await screen.findByRole("button", { name: "Pay with Everee" });
    expect(server.runParams.at(-1)).toEqual({ driverId: 7 });
    cleanup();
    const second = await startServer();
    const again = await mount();
    await apply(again.container, { city: "Test City" });
    await screen.findByRole("button", { name: "Pay with Everee" });
    expect(second.runParams.at(-1)).toEqual({ cityId: 3 });
    expect(screen.getByText(/all drivers in Test City/)).toBeTruthy();
  });

  it("says so when no approved run is waiting, and shows nothing for payment status Paid, a city admin, or a server without Everee", async () => {
    await startServer({ runs: [] });
    const first = await mount();
    await apply(first.container, { city: "Test City", driver: "Dee Test" });
    expect(await screen.findByText(/No approved pay run is waiting to be paid/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pay with Everee" })).toBeNull();
    cleanup();

    await startServer();
    const paid = await mount();
    await apply(paid.container, { city: "Test City", driver: "Dee Test", status: "Paid" });
    await waitFor(() => expect(document.querySelector("table tbody tr")).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Pay with Everee" })).toBeNull();
    cleanup();

    await startServer();
    const cityAdmin = await mount({ superAdmin: false });
    await apply(cityAdmin.container, { city: "Test City", driver: "Dee Test" });
    await waitFor(() => expect(document.querySelector("table tbody tr")).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Pay with Everee" })).toBeNull();
    cleanup();

    await startServer({ configured: false });
    const off = await mount();
    await apply(off.container, { city: "Test City", driver: "Dee Test" });
    await waitFor(() => expect(document.querySelector("table tbody tr")).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Pay with Everee" })).toBeNull();
  });

  it("two drivers with the same name and no city: it does not guess, it asks for a city and sends nothing", async () => {
    const server = await startServer({ dupName: true });
    const { container } = await mount();
    await apply(container, { driver: "Dee Test" });
    expect(await screen.findByText(/More than one driver is called Dee Test/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pay with Everee" })).toBeNull();
    expect(server.runParams).toEqual([]);
  });
});

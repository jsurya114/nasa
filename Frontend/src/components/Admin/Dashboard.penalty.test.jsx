import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The real Dashboard with made-up data: a driver with $100 of earnings and $20 of insurance (table net $80). The server gives
// this payday's deduction (by how each record was created) apart from what is still owed in all (#166).
const reply = ({ source = "none", deducted = "0.00", net = null, flags = [], penalties = "0.00", other = "0.00" } = {}) => ({ status: 200, data: {
  payday: { source, claimDeductions: deducted, recoveries: "0.00", deducted, net, flags },
  period: { status: "none", approved: {}, preview: {}, statements: [], crossingRuns: 0 },
  outstanding: { penalties, other, total: (Number(penalties) + Number(other)).toFixed(2) },
} });
const ROW = { id: 1, driver_name: "Dee Test", job_date: "2026-11-03", route_name: "R1", packages: 10, no_scanned: 0, failed_attempt: 0, fs: 0, ds: 0, delivered: 10,
  driver_payment: "100.00", insurance_deduction: "20.00", closed: true, paid: false, data_type: "daily" };

const startServer = async (payroll) => {
  const state = { payrollCalls: 0 };
  await installServer(async (config) => {
    const url = config.url;
    if (url === "/admin/dashboard/data") return { status: 200, data: { success: true, data: { cities: [{ id: 3, job: "Test City" }, { id: 4, job: "Other City" }], drivers: [{ id: 7, name: "Dee Test" }], routes: [] } } };
    if (url === "/admin/dashboard/drivers-by-city") {
      const list = config.params?.cityJob === "Other City" ? [{ id: 8, name: "Eli Other" }] : [{ id: 7, name: "Dee Test" }];
      return { status: 200, data: { success: true, data: list } };
    }
    if (url === "/admin/dashboard/routes-by-city") return { status: 200, data: { success: true, data: [] } };
    if (url === "/admin/dashboard/paymentTable") return { status: 200, data: { success: true, data: [{ ...ROW, driver_name: config.params?.driver && config.params.driver !== "All" ? config.params.driver : "Dee Test" }], pagination: { total: 1, page: 1, limit: 10, totalPages: 1 } } };
    if (url === "/admin/dashboard/summary") return { status: 200, data: { success: true, data: { total_driver_payment: 100, total_insurance_deduction: 20, total_company_earnings: 10 } } };
    const driver = url.match(/^\/admin\/payroll\/drivers\/(\d+)\/dashboard-summary$/);
    if (driver) {
      state.payrollCalls += 1;
      state.lastParams = config.params;
      return typeof payroll === "function" ? payroll(state, Number(driver[1])) : payroll;
    }
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async () => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([
    import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom"),
  ]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const dashReducer = (await import("../../redux/slice/admin/dashSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Dashboard } = await import("./Dashboard.jsx");
  const store = configureStore({ reducer: { admin: adminReducer, dash: dashReducer, language: languageReducer } });
  return render(<Provider store={store}><MemoryRouter><Dashboard /></MemoryRouter></Provider>);
};

const filter = async (container, city = "Test City", driver = "Dee Test", { dates = true } = {}) => {
  const select = (name) => container.querySelector(`select[name="${name}"]`);
  await waitFor(() => expect(within(select("job")).getByRole("option", { name: city })).toBeTruthy());
  fireEvent.change(select("job"), { target: { name: "job", value: city } });
  await waitFor(() => expect(within(select("driver")).getByRole("option", { name: driver })).toBeTruthy());
  fireEvent.change(select("driver"), { target: { name: "driver", value: driver } });
  if (dates) {
    fireEvent.change(container.querySelector('input[name="startDate"]'), { target: { name: "startDate", value: "2026-11-01" } });
    fireEvent.change(container.querySelector('input[name="endDate"]'), { target: { name: "endDate", value: "2026-11-07" } });
  }
  fireEvent.click(container.querySelector('input[name="companyEarnings"]'));
  fireEvent.click(screen.getByRole("button", { name: "Filter Data" }));
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("Dashboard: this payday's Penalty & Others, apart from what is still owed", () => {
  it("a $250 debt paid $50 an instalment takes $50 this payday, not $250: the net is $30, never -$170", async () => {
    const server = await startServer(reply({ source: "estimate", deducted: "50.00", penalties: "250.00" }));
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-deduction-row")).toBeTruthy();
    const row = screen.getByTestId("penalty-deduction-row");
    expect(row.textContent).toContain("Penalty & Others");
    expect(row.textContent).toContain("-$50.00");
    expect(screen.getByTestId("penalty-owed").textContent).toContain("Still owed in all: $250.00 (Penalties $250.00). Not all of it is due this payday.");
    expect(screen.getByTestId("penalty-note").textContent).toContain("Preview: what the next pay run would take");
    // order: insurance, Penalty & Others, net
    const rows = [...container.querySelectorAll("tr")].map((r) => r.textContent);
    const at = (text) => rows.findIndex((r) => r.includes(text));
    expect(at("Penalty & Others")).toBe(at("Insurance Payment Deduction") + 1);
    expect(at("Net Payment")).toBe(at("Penalty & Others") + 1);
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$30.00");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("preview (before the pay run is approved)");
    expect(screen.getByTestId("net-payment-row").textContent).not.toContain("-$");
    // summary: this payday and the balance are separate lines, and the net is the same
    await waitFor(() => expect(screen.getByTestId("summary-deducted")).toBeTruthy());
    expect(within(screen.getByTestId("summary-deducted")).getByRole("textbox").value).toBe("-$50.00");
    expect(within(screen.getByTestId("summary-owed")).getByRole("textbox").value).toBe("$250.00");
    expect(within(screen.getByTestId("summary-net")).getByRole("textbox").value).toBe("$30.00");
    expect(server.lastParams).toEqual({ cityId: 3, from: "2026-11-01", to: "2026-11-07" });
  });

  it("approved: the pay run's frozen net is the net, and the row says it is already inside it", async () => {
    await startServer(reply({ source: "approved", deducted: "40.00", net: "40.00", penalties: "250.00" }));
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-deduction-row")).toBeTruthy();
    expect(screen.getByTestId("net-payment-row").textContent).toContain("Net Payment (approved pay run)");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$40.00");
    expect(screen.getByTestId("penalty-note").textContent).toContain("already in the pay run net below");
    expect(screen.getByTestId("penalty-owed").textContent).toContain("$250.00");
    await waitFor(() => expect(within(screen.getByTestId("summary-net")).getByRole("textbox").value).toBe("$40.00"));
  });

  it("a draft pay run is a preview, never approved", async () => {
    await startServer(reply({ source: "draft", deducted: "40.00", net: "40.00", penalties: "250.00" }));
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-deduction-row")).toBeTruthy();
    expect(screen.getByTestId("net-payment-row").textContent).toContain("preview (draft pay run, not approved)");
    expect(screen.getByTestId("net-payment-row").textContent).not.toContain("approved pay run)");
    expect(screen.getByTestId("penalty-note").textContent).toContain("Draft pay run: a preview");
  });

  it("with no recovery limit set nothing is taken, the reason is shown, and the net keeps its usual name", async () => {
    await startServer(reply({ source: "estimate", deducted: "0.00", penalties: "100.00", flags: [{ code: "recovery_limit_not_set", message: "no recovery limit is set; nothing was recovered automatically" }] }));
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-deduction-row")).toBeTruthy();
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$0.00");
    expect(screen.getByTestId("penalty-note").textContent).toContain("no recovery limit is set");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$80.00");
    expect(screen.getByTestId("net-payment-row").textContent).not.toContain("preview");
  });

  it("with no dates the balance is still shown, the deduction asks for dates, and the net is the usual one", async () => {
    const server = await startServer(reply({ source: "none", penalties: "250.00" }));
    const { container } = await mount();
    await filter(container, "Test City", "Dee Test", { dates: false });
    expect(await screen.findByTestId("penalty-deduction-row")).toBeTruthy();
    expect(screen.getByTestId("penalty-note").textContent).toContain("Choose a start and an end date");
    expect(screen.getByTestId("penalty-owed").textContent).toContain("$250.00");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$80.00");
    expect(server.lastParams).toEqual({ cityId: 3 });
  });

  it("nothing owed and nothing taken: no row, and the net is unchanged", async () => {
    await startServer(reply({ source: "estimate" }));
    const { container } = await mount();
    await filter(container);
    await waitFor(() => expect(screen.getByTestId("net-payment-row")).toBeTruthy());
    expect(screen.queryByTestId("penalty-deduction-row")).toBeNull();
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$80.00");
  });

  it("marking a record complete lowers what is owed when the tab is visible again; the deduction follows the server", async () => {
    let now = reply({ source: "estimate", deducted: "50.00", penalties: "250.00" });
    await startServer(() => now);
    const { container } = await mount();
    await filter(container);
    expect((await screen.findByTestId("penalty-owed")).textContent).toContain("$250.00");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$30.00");
    now = reply({ source: "estimate", deducted: "30.00", penalties: "30.00" }); // $220 was marked complete: only $30 is left to take
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByTestId("penalty-owed").textContent).toContain("$30.00"));
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$30.00");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$50.00");
  });

  it("while the figures load, and when they fail, the net is marked not final, with a retry that recovers", async () => {
    let fail = true;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const server = await startServer(async () => { await gate; return fail ? { status: 500, data: { message: "could not load" } } : reply({ source: "estimate", deducted: "50.00", penalties: "250.00" }); });
    const { container } = await mount();
    await filter(container);
    expect((await screen.findByTestId("penalty-loading-row")).textContent).toContain("does not yet include them");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("deductions loading, not final");
    release();
    const alert = await screen.findByTestId("penalty-error-row");
    expect(alert.textContent).toContain("do not treat it as the amount to pay");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("deductions not loaded, not final");
    expect(within(screen.getByTestId("summary-notice")).getByRole("textbox").value).toContain("Could not be loaded");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("penalty-deduction-row")).toBeTruthy();
    expect(screen.getByTestId("net-payment-row").textContent).not.toContain("not final");
    expect(server.payrollCalls).toBe(2);
  });

  it("editing the city in the form before Filter Data keeps the applied driver's figures", async () => {
    const server = await startServer(reply({ source: "estimate", deducted: "50.00", penalties: "250.00" }));
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-deduction-row")).toBeTruthy();
    const callsBefore = server.payrollCalls;
    fireEvent.change(container.querySelector('select[name="job"]'), { target: { name: "job", value: "Other City" } });
    await waitFor(() => expect(within(container.querySelector('select[name="driver"]')).queryByRole("option", { name: "Dee Test" })).toBeNull());
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$50.00");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$30.00");
    expect(server.payrollCalls).toBe(callsBefore);
  });

  it("applying another driver while the first reply is held: loading, then the new driver's figures; the late reply is ignored", async () => {
    let releaseFirst;
    const first = new Promise((resolve) => { releaseFirst = resolve; });
    await startServer(async (_state, driverId) => {
      if (driverId === 7) { await first; return reply({ source: "estimate", deducted: "50.00", penalties: "250.00" }); }
      return reply({ source: "estimate", deducted: "5.00", penalties: "5.00" });
    });
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-loading-row")).toBeTruthy();
    await filter(container, "Other City", "Eli Other");
    expect((await screen.findByTestId("penalty-deduction-row")).textContent).toContain("-$5.00");
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$5.00");
    expect(screen.queryByText("-$50.00")).toBeNull();
  });
});

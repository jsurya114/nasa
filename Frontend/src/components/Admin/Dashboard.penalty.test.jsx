import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The real Dashboard with made-up data: a driver with $100 of earnings and $20 of insurance. What the driver still owes comes
// from the summary endpoint in the shape it returns (#166): penalties and everything else, as outstanding balances.
const owing = (penalties, other = "0.00") => ({ status: 200, data: {
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

const filter = async (container, city = "Test City", driver = "Dee Test", { dates = false } = {}) => {
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

describe("Dashboard deductions: Penalty & Others comes off the net", () => {
  it("shows one Penalty & Others row right below the insurance deduction, and Net Payment = payment - insurance - penalties - others, in the table and the Summary, with no dates", async () => {
    const server = await startServer(owing("25.00", "10.00"));
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-deduction-row")).toBeTruthy();
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("Penalty & Others");
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$35.00");
    expect(screen.getByTestId("penalty-breakdown").textContent).toBe("Penalties $25.00 · Others $10.00");
    // the order in the table: insurance, then Penalty & Others, then the net
    const rows = [...container.querySelectorAll("tr")].map((r) => r.textContent);
    const at = (text) => rows.findIndex((r) => r.includes(text));
    expect(at("Insurance Payment Deduction")).toBeGreaterThan(-1);
    expect(at("Penalty & Others")).toBe(at("Insurance Payment Deduction") + 1);
    expect(at("Net Payment")).toBe(at("Penalty & Others") + 1);
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$45.00"); // 100 - 20 - 25 - 10
    // summary
    await waitFor(() => expect(screen.getAllByTestId("summary-deducted")).toHaveLength(1));
    expect(within(screen.getByTestId("summary-deducted")).getByRole("textbox").value).toBe("-$35.00");
    expect(screen.getByTestId("summary-deducted").textContent).toContain("Penalty & Others");
    expect(screen.getByDisplayValue("$45.00")).toBeTruthy();
    expect(server.lastParams).toEqual({ cityId: 3 }); // no dates needed
  });

  it("with no penalty and nothing else owed, no deduction row shows and the net is unchanged", async () => {
    await startServer(owing("0.00"));
    const { container } = await mount();
    await filter(container);
    await waitFor(() => expect(screen.getByTestId("net-payment-row")).toBeTruthy());
    expect(screen.queryByTestId("penalty-deduction-row")).toBeNull();
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$80.00");
  });

  it("only penalties: one row, and the history link opens the Payroll page on that driver", async () => {
    await startServer(owing("40.00"));
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-deduction-row")).toBeTruthy();
    expect(screen.getByTestId("penalty-breakdown").textContent).toBe("Penalties $40.00");
    expect(within(screen.getByTestId("penalty-deduction-row")).getByRole("link", { name: "View entries and history" }).getAttribute("href")).toBe("/admin/payroll?cityId=3&driverId=7");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$40.00");
  });

  it("marking a record complete lowers Penalty & Others and raises the net, when the tab is visible again or Filter Data is pressed", async () => {
    let owed = owing("25.00", "10.00");
    await startServer(() => owed);
    const { container } = await mount();
    await filter(container);
    expect((await screen.findByTestId("penalty-deduction-row")).textContent).toContain("-$35.00");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$45.00");
    owed = owing("5.00", "10.00"); // $20 of the penalty was marked complete on the Payroll page
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$15.00"));
    expect(screen.getByTestId("penalty-breakdown").textContent).toBe("Penalties $5.00 · Others $10.00");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$65.00");
    owed = owing("0.00", "10.00"); // the rest of the penalty is completed too: only Others remain
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByTestId("penalty-breakdown").textContent).toBe("Others $10.00"));
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$70.00");
  });

  it("a record saved or completed later shows when the filters are applied again", async () => {
    let owed = owing("25.00");
    await startServer(() => owed);
    const { container } = await mount();
    await filter(container);
    expect((await screen.findByTestId("net-payment-row")).textContent).toContain("$55.00");
    owed = owing("5.00"); // part of the penalty was marked complete
    fireEvent.click(screen.getByRole("button", { name: "Filter Data" }));
    await waitFor(() => expect(screen.getByTestId("net-payment-row").textContent).toContain("$75.00"));
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$5.00");
  });

  it("while the deductions load, and when they fail, the net is marked not final, with a retry that recovers", async () => {
    let fail = true;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const server = await startServer(async () => { await gate; return fail ? { status: 500, data: { message: "could not load" } } : owing("25.00"); });
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

  it("editing the city in the form before Filter Data keeps the applied driver's deductions", async () => {
    const server = await startServer(owing("25.00"));
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-deduction-row")).toBeTruthy();
    const callsBefore = server.payrollCalls;
    fireEvent.change(container.querySelector('select[name="job"]'), { target: { name: "job", value: "Other City" } });
    await waitFor(() => expect(within(container.querySelector('select[name="driver"]')).queryByRole("option", { name: "Dee Test" })).toBeNull());
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$25.00");
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$55.00");
    expect(server.payrollCalls).toBe(callsBefore);
  });

  it("applying another driver while the first reply is held: loading, then the new driver's figures; the late reply is ignored", async () => {
    let releaseFirst;
    const first = new Promise((resolve) => { releaseFirst = resolve; });
    await startServer(async (_state, driverId) => {
      if (driverId === 7) { await first; return owing("25.00"); }
      return owing("5.00");
    });
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-loading-row")).toBeTruthy();
    await filter(container, "Other City", "Eli Other");
    expect((await screen.findByTestId("penalty-deduction-row")).textContent).toContain("-$5.00");
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$5.00");
    expect(screen.queryByText("-$25.00")).toBeNull();
  });
});

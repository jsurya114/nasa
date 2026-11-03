import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The real Dashboard with made-up data: a driver with $100 of earnings and $20 of insurance. Payroll figures come from the
// summary endpoint (#170) in the shapes it returns (#166).
const none = { deducted: "0.00", claimDeductions: "0.00", recoveries: "0.00", net: "0.00", count: 0 };
const run40 = { deducted: "40.00", claimDeductions: "40.00", recoveries: "0.00", net: "40.00", count: 1 };
const summaryFor = (period) => ({ status: 200, data: {
  period: { status: "none", approved: none, preview: none, statements: [], crossingRuns: 0, ...period },
  outstanding: { penalties: "250.00", other: "0.00", total: "250.00" },
} });
const APPROVED = summaryFor({ status: "approved", approved: run40 });
const PREVIEW = summaryFor({ status: "preview", preview: run40 });
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

const filter = async (container, city = "Test City", driver = "Dee Test") => {
  const select = (name) => container.querySelector(`select[name="${name}"]`);
  await waitFor(() => expect(within(select("job")).getByRole("option", { name: city })).toBeTruthy());
  fireEvent.change(select("job"), { target: { name: "job", value: city } });
  await waitFor(() => expect(within(select("driver")).getByRole("option", { name: driver })).toBeTruthy());
  fireEvent.change(select("driver"), { target: { name: "driver", value: driver } });
  fireEvent.change(container.querySelector('input[name="startDate"]'), { target: { name: "startDate", value: "2026-11-01" } });
  fireEvent.change(container.querySelector('input[name="endDate"]'), { target: { name: "endDate", value: "2026-11-07" } });
  fireEvent.click(container.querySelector('input[name="companyEarnings"]'));
  fireEvent.click(screen.getByRole("button", { name: "Filter Data" }));
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("Dashboard with payroll figures", () => {
  it("approved: the pay run's net is the one payable net, in the table and in the Summary; the older net is only an explanation", async () => {
    const server = await startServer(APPROVED);
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-net-row")).toBeTruthy();
    // table
    expect(screen.getByTestId("penalty-net-row").textContent).toContain("Net Payment (approved pay run)");
    expect(screen.getByTestId("penalty-net-row").textContent).toContain("$40.00");
    expect(screen.getByTestId("net-before-row").textContent).toContain("Net before claims / recoveries");
    expect(screen.getByTestId("net-before-row").textContent).toContain("$80.00");
    expect(screen.queryByText("Net Payment", { exact: true })).toBeNull(); // no second row simply called Net Payment
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$40.00");
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("not subtracted again");
    // summary
    await waitFor(() => expect(screen.getByTestId("summary-net")).toBeTruthy());
    expect(within(screen.getByTestId("summary-net")).getByRole("textbox").value).toBe("$40.00");
    expect(screen.getByTestId("summary-net").textContent).toContain("Net Payment (approved pay run)");
    expect(within(screen.getByTestId("summary-deducted")).getByRole("textbox").value).toBe("-$40.00");
    expect(screen.queryByDisplayValue("$80.00")).not.toBeNull();
    expect(screen.getByText(/Net before claims \/ recoveries/, { selector: "label" })).toBeTruthy();
    expect(screen.queryByText(/Net Driver Payment/)).toBeNull();
    expect(server.lastParams).toEqual({ cityId: 3, from: "2026-11-01", to: "2026-11-07" });
  });

  it("preview: a draft is visibly a preview, never approved", async () => {
    await startServer(PREVIEW);
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-net-row")).toBeTruthy();
    expect(screen.getByTestId("penalty-net-row").textContent).toContain("Net Payment preview (draft pay run, not approved)");
    expect(screen.getByTestId("penalty-net-row").textContent).not.toContain("approved pay run)");
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("Preview");
    expect(screen.getByTestId("net-before-row").textContent).toContain("Net before claims / recoveries");
  });

  it("while loading, and when the payroll summary fails, the page says so and the unadjusted net is not shown as the payable net", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await startServer(async () => { await gate; return APPROVED; });
    const { container } = await mount();
    await filter(container);
    expect((await screen.findByTestId("penalty-loading-row")).textContent).toContain("does not yet include claims or recoveries");
    expect(screen.getByTestId("net-before-row").textContent).toContain("not final");
    expect(screen.queryByText("Net Payment", { exact: true })).toBeNull();
    expect(within(screen.getByTestId("summary-notice")).getByRole("textbox").value).toContain("Loading");
    release();
    expect(await screen.findByTestId("penalty-net-row")).toBeTruthy();
  });

  it("a failed payroll summary shows an error with Try again, and the older net is marked not final", async () => {
    let fail = true;
    const server = await startServer(() => (fail ? { status: 500, data: { message: "could not load" } } : APPROVED));
    const { container } = await mount();
    await filter(container);
    const alert = await screen.findByTestId("penalty-error-row");
    expect(alert.textContent).toContain("could not be loaded");
    expect(alert.textContent).toContain("do not treat it as the amount to pay");
    expect(screen.getByTestId("net-before-row").textContent).toContain("not loaded, not final");
    expect(within(screen.getByTestId("summary-notice")).getByRole("textbox").value).toContain("Could not be loaded");
    expect(screen.queryByTestId("penalty-net-row")).toBeNull();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("penalty-net-row")).toBeTruthy();
    expect(server.payrollCalls).toBe(2);
  });

  it("with no dates chosen nothing is asked of payroll and the net keeps its usual name", async () => {
    const server = await startServer(APPROVED);
    const { container } = await mount();
    const select = (name) => container.querySelector(`select[name="${name}"]`);
    await waitFor(() => expect(within(select("job")).getByRole("option", { name: "Test City" })).toBeTruthy());
    fireEvent.change(select("job"), { target: { name: "job", value: "Test City" } });
    await waitFor(() => expect(within(select("driver")).getByRole("option", { name: "Dee Test" })).toBeTruthy());
    fireEvent.change(select("driver"), { target: { name: "driver", value: "Dee Test" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter Data" }));
    await waitFor(() => expect(screen.getByTestId("net-before-row")).toBeTruthy());
    expect(screen.getByTestId("net-before-row").textContent).toContain("Net Payment");
    expect(server.payrollCalls).toBe(0);
    expect(screen.queryByTestId("penalty-net-row")).toBeNull();
    expect(screen.getByTestId("penalty-dates-row").textContent).toContain("choose a start and an end date");
  });

  it("editing the city in the form, before Filter Data, keeps the applied driver's approved figures (and never restores the unadjusted net)", async () => {
    const server = await startServer(APPROVED);
    const { container } = await mount();
    await filter(container);
    expect(await screen.findByTestId("penalty-net-row")).toBeTruthy();
    const callsBefore = server.payrollCalls;
    // the drivers in the form are now another city's; the table still shows Dee Test
    fireEvent.change(container.querySelector('select[name="job"]'), { target: { name: "job", value: "Other City" } });
    await waitFor(() => expect(within(container.querySelector('select[name="driver"]')).queryByRole("option", { name: "Dee Test" })).toBeNull());
    expect(screen.getByTestId("penalty-net-row").textContent).toContain("Net Payment (approved pay run)");
    expect(screen.getByTestId("penalty-net-row").textContent).toContain("$40.00");
    expect(screen.getByTestId("net-before-row").textContent).toContain("Net before claims / recoveries");
    expect(screen.queryByText("Net Payment", { exact: true })).toBeNull();
    expect(screen.queryByTestId("penalty-loading-row")).toBeNull();
    expect(server.payrollCalls).toBe(callsBefore); // nothing re-asked and nothing lost
  });

  it("applying another driver while the first reply is still in flight: the late reply never replaces the new scope's figures, and a loading state shows meanwhile", async () => {
    let releaseFirst;
    const first = new Promise((resolve) => { releaseFirst = resolve; });
    const OTHER = summaryFor({ status: "approved", approved: { ...run40, deducted: "10.00", net: "90.00" } });
    await startServer(async (_state, driverId) => {
      if (driverId === 7) { await first; return APPROVED; }
      return OTHER;
    });
    const { container } = await mount();
    await filter(container); // driver 7: reply held
    expect(await screen.findByTestId("penalty-loading-row")).toBeTruthy();
    await filter(container, "Other City", "Eli Other"); // driver 8: answers at once
    expect(await screen.findByTestId("penalty-net-row")).toBeTruthy();
    expect(screen.getByTestId("penalty-net-row").textContent).toContain("$90.00");
    releaseFirst(); // the first scope's reply arrives late
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId("penalty-net-row").textContent).toContain("$90.00");
    expect(screen.getByTestId("penalty-net-row").textContent).not.toContain("$40.00");
  });

  it("with dates chosen but no penalty and no pay run, a row says there is nothing, instead of showing nothing", async () => {
    await startServer({ status: 200, data: { period: { status: "none", approved: none, preview: none, statements: [], crossingRuns: 0 }, outstanding: { penalties: "0.00", other: "0.00", total: "0.00" } } });
    const { container } = await mount();
    await filter(container);
    expect((await screen.findByTestId("penalty-none-row")).textContent).toContain("none for this driver in these dates");
    expect(screen.getByTestId("net-before-row").textContent).toContain("Net Payment");
  });
});

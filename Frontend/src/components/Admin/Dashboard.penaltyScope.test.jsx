import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The real Dashboard filtered to one city and driver, with the Payment status switched between All, Paid and Pending (review of #219). The
// server answers by the status it is sent: a table of paid history ($200 earned, $20 insurance) must keep its own net, and the unpaid run's
// figures ($100 pay, $40 taken, net $60) show only for Pending. Every change of status must ask again; no earlier answer is reused.
const summary = (payday) => ({ status: 200, data: {
  payday: { claimDeductions: "0.00", recoveries: "0.00", flags: [], net: null, deducted: "0.00", source: "estimate", ...payday },
  period: { status: "none", approved: {}, preview: {}, statements: [], crossingRuns: 0 },
  outstanding: { penalties: "0.00", other: "0.00", total: "0.00" },
} });
const BY_STATUS = {
  none: summary({}), // All: paid and unpaid rows together, not described by the run
  Paid: summary({}),
  Pending: summary({ source: "approved", deducted: "40.00", recoveries: "40.00", net: "60.00" }),
};
const ROW = { id: 1, driver_name: "Dee Test", job_date: "2026-10-01", route_name: "R1", packages: 10, no_scanned: 0, failed_attempt: 0, fs: 0, ds: 0, delivered: 10,
  driver_payment: "200.00", insurance_deduction: "20.00", closed: true, paid: true, data_type: "daily" };

const startServer = async () => {
  const state = { calls: [] };
  await installServer(async (config) => {
    const url = config.url;
    if (url === "/admin/dashboard/data") return { status: 200, data: { success: true, data: { cities: [{ id: 3, job: "Test City" }], drivers: [{ id: 7, name: "Dee Test" }], routes: [] } } };
    if (url === "/admin/dashboard/drivers-by-city") return { status: 200, data: { success: true, data: [{ id: 7, name: "Dee Test" }] } };
    if (url === "/admin/dashboard/routes-by-city") return { status: 200, data: { success: true, data: [] } };
    if (url === "/admin/dashboard/paymentTable") return { status: 200, data: { success: true, data: [ROW], pagination: { total: 1, page: 1, limit: 10, totalPages: 1 } } };
    if (url === "/admin/dashboard/summary") return { status: 200, data: { success: true, data: { total_driver_payment: 200, total_insurance_deduction: 20, total_company_earnings: 10 } } };
    if (/^\/admin\/payroll\/drivers\/\d+\/dashboard-summary$/.test(url)) {
      state.calls.push(config.params?.paymentStatus);
      return BY_STATUS[config.params?.paymentStatus ?? "none"];
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

const select = (container, name) => container.querySelector(`select[name="${name}"]`);
const apply = async (container, status) => {
  fireEvent.change(select(container, "paymentStatus"), { target: { name: "paymentStatus", value: status } });
  fireEvent.click(screen.getByRole("button", { name: "Filter Data" }));
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("Dashboard: the penalty summary follows the Payment status filter", () => {
  it("Paid keeps the table's own net, Pending shows the unpaid run, and switching back never reuses the run's net", async () => {
    const server = await startServer();
    const { container } = await mount();
    await waitFor(() => expect(within(select(container, "job")).getByRole("option", { name: "Test City" })).toBeTruthy());
    fireEvent.change(select(container, "job"), { target: { name: "job", value: "Test City" } });
    await waitFor(() => expect(within(select(container, "driver")).getByRole("option", { name: "Dee Test" })).toBeTruthy());
    fireEvent.change(select(container, "driver"), { target: { name: "driver", value: "Dee Test" } });

    // Paid history: the request says so, and the net stays the table's own ($200 - $20 = $180), not an approved run's
    await apply(container, "Paid");
    await waitFor(() => expect(server.calls).toContain("Paid"));
    await waitFor(() => expect(screen.getByTestId("net-payment-row")).toBeTruthy());
    expect(screen.getByTestId("net-payment-row").textContent).not.toContain("approved pay run");
    expect(screen.getByTestId("net-payment-row").textContent).not.toContain("$60.00");

    // Pending: the unpaid run's own figures, labelled as approved
    await apply(container, "Pending");
    await waitFor(() => expect(server.calls).toContain("Pending"));
    await waitFor(() => expect(screen.getByTestId("net-payment-row").textContent).toContain("Net Payment (approved pay run)"));
    expect(screen.getByTestId("net-payment-row").textContent).toContain("$60.00");
    expect(screen.getByTestId("penalty-deduction-row").textContent).toContain("-$40.00");

    // back to Paid: a new request is made and the run's net is gone, with no stale figure in between
    await apply(container, "Paid");
    await waitFor(() => expect(server.calls.filter((s) => s === "Paid").length).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getByTestId("net-payment-row").textContent).not.toContain("approved pay run"));
    expect(screen.getByTestId("net-payment-row").textContent).not.toContain("$60.00");

    // All: no status is sent
    await apply(container, "All");
    await waitFor(() => expect(server.calls).toContain(undefined));
  });
});

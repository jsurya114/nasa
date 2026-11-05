import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The real Dashboard's table: the Paid column says "Yes" only once the money is confirmed, "Submitted" while the payment is with Everee and
// not confirmed (the server marks such a row `payout_state: "processing"`), and "No" otherwise.
const row = (id, name, extra = {}) => ({ id, driver_name: name, job_date: "2026-10-20", journey_date: "2026-10-20", route_name: "R1", packages: 10, no_scanned: 0, failed_attempt: 0,
  fs: 0, ds: 0, delivered: 10, driver_payment: "50.00", insurance_deduction: "0.00", closed: true, paid: false, data_type: "weekly", ...extra });
const ROWS = [row(1, "Paid Driver", { paid: true }), row(2, "Sent Driver", { payout_state: "processing" }), row(3, "Waiting Driver")];

const mount = async () => {
  await installServer(async (config) => {
    const url = config.url;
    if (url === "/admin/dashboard/data") return { status: 200, data: { success: true, data: { cities: [{ id: 3, job: "Test City" }], drivers: [], routes: [] } } };
    if (url === "/admin/dashboard/paymentTable" || url === "/admin/dashboard/paymentTableAll") {
      return { status: 200, data: { success: true, data: ROWS, pagination: { total: 3, page: 1, limit: 10, totalPages: 1 } } };
    }
    if (url === "/admin/dashboard/summary") return { status: 200, data: { success: true, data: { total_driver_payment: 150, total_insurance_deduction: 0, total_company_earnings: 10 } } };
    return { status: 200, data: { success: true, data: [], pagination: { total: 0, page: 1, limit: 10, totalPages: 1 } } };
  });
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const dashReducer = (await import("../../redux/slice/admin/dashSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Dashboard } = await import("./Dashboard.jsx");
  const store = configureStore({ reducer: { admin: adminReducer, dash: dashReducer, language: languageReducer } });
  return render(<Provider store={store}><MemoryRouter><Dashboard /></MemoryRouter></Provider>);
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("Dashboard: the table's Paid column and a payment in progress", () => {
  it("says Yes for a confirmed payment, Submitted for one with Everee that is not confirmed, and No for the rest", async () => {
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("paid-cell").length).toBe(3));
    expect(screen.getAllByTestId("paid-cell").map((c) => c.textContent)).toEqual(["Yes", "Submitted", "No"]);
  });
});

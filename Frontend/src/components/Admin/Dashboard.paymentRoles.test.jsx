import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The real Dashboard with made-up data, as an ordinary admin and as the super admin. The driver payment list is a super admin call
// on the server (#216), so an ordinary admin's Dashboard must not ask for it or show its card (review of #217).
const startServer = async () => {
  const state = { paymentListCalls: 0 };
  await installServer(async (config) => {
    const url = config.url;
    if (url === "/admin/dashboard/data") return { status: 200, data: { success: true, data: { cities: [{ id: 3, job: "Test City" }], drivers: [], routes: [] } } };
    if (url === "/admin/payroll/payments/runs") {
      state.paymentListCalls += 1;
      return { status: 200, data: { runs: [] } };
    }
    return { status: 200, data: { success: true, data: [], pagination: { total: 0, page: 1, limit: 10, totalPages: 1 } } };
  });
  return state;
};

const mount = async (isSuperAdmin) => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([
    import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom"),
  ]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const dashReducer = (await import("../../redux/slice/admin/dashSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Dashboard } = await import("./Dashboard.jsx");
  const initial = adminReducer(undefined, { type: "test/init" });
  const store = configureStore({
    reducer: { admin: adminReducer, dash: dashReducer, language: languageReducer },
    preloadedState: { admin: { ...initial, isSuperAdmin } },
  });
  return render(<Provider store={store}><MemoryRouter><Dashboard /></MemoryRouter></Provider>);
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("Dashboard: the Driver payments card by role", () => {
  it("an ordinary admin makes no payment list request and sees no payment card, error or pay run link", async () => {
    const server = await startServer();
    await mount(false);
    await screen.findByText("Data Filters");
    // give any request a chance to go out, including the one made when the window regains focus
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.paymentListCalls).toBe(0);
    expect(screen.queryByText("Driver payments")).toBeNull();
    expect(screen.queryByText("FORBIDDEN")).toBeNull();
    expect(screen.queryByRole("link", { name: "Prepare a pay run" })).toBeNull();
  });

  it("the super admin keeps the payment card and its list request", async () => {
    const server = await startServer();
    await mount(true);
    expect(await screen.findByText("Driver payments")).toBeTruthy();
    await waitFor(() => expect(server.paymentListCalls).toBeGreaterThan(0));
    expect(screen.getByRole("link", { name: "Prepare a pay run" })).toBeTruthy();
  });
});

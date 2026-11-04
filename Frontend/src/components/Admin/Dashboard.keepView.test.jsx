import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The dashboard keeps what the admin set when they leave it and come back: the filter form, the narrowed dropdowns and the table
// they filtered (not today's table). Made-up data.
const ROW = { id: 1, driver_name: "Dee Test", job_date: "2026-11-03", route_name: "R1", packages: 10, no_scanned: 0, failed_attempt: 0, fs: 0, ds: 0, delivered: 10,
  driver_payment: "100.00", insurance_deduction: "20.00", closed: true, paid: false, data_type: "daily" };

const startServer = async () => {
  const state = { tableCalls: [], hold: null }; // hold: a promise the filtered table waits for before it answers
  await installServer(async (config) => {
    const url = config.url;
    if (url === "/admin/dashboard/data") return { status: 200, data: { success: true, data: { cities: [{ id: 3, job: "Test City" }, { id: 4, job: "Other City" }], drivers: [{ id: 7, name: "Dee Test" }, { id: 8, name: "Eli Other" }], routes: [] } } };
    if (url === "/admin/dashboard/drivers-by-city") {
      const list = config.params?.cityJob === "Other City" ? [{ id: 8, name: "Eli Other" }] : [{ id: 7, name: "Dee Test" }];
      return { status: 200, data: { success: true, data: list } };
    }
    if (url === "/admin/dashboard/routes-by-city") return { status: 200, data: { success: true, data: [] } };
    if (url === "/admin/dashboard/paymentTable") {
      state.tableCalls.push(config.params);
      const today = config.params?.defaultToday === "true";
      if (!today && state.hold) await state.hold;
      const driver = today ? "Today Driver" : (config.params?.driver && config.params.driver !== "All" ? config.params.driver : "Dee Test");
      return { status: 200, data: { success: true, data: [{ ...ROW, driver_name: driver }], pagination: { total: 1, page: 1, limit: 10, totalPages: 1 } } };
    }
    if (url === "/admin/dashboard/summary") return { status: 200, data: { success: true, data: { total_driver_payment: 100, total_insurance_deduction: 20, total_company_earnings: 10 } } };
    if (/^\/admin\/payroll\/drivers\/\d+\/dashboard-summary$/.test(url)) return { status: 200, data: { payday: { source: "none", deducted: "0.00", net: null, flags: [] }, outstanding: { penalties: "0.00", other: "0.00", total: "0.00" } } };
    return { status: 200, data: {} };
  });
  return state;
};

const makeStore = async (adminId = 1) => {
  const { configureStore } = await import("@reduxjs/toolkit");
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const dashReducer = (await import("../../redux/slice/admin/dashSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const signedIn = { ...adminReducer(undefined, { type: "init" }), admin: { id: adminId, role: "admin" } };
  return configureStore({ reducer: { admin: adminReducer, dash: dashReducer, language: languageReducer }, preloadedState: { admin: signedIn } });
};

const mount = async (store) => {
  const [{ Provider }, { MemoryRouter }] = await Promise.all([import("react-redux"), import("react-router-dom")]);
  const { default: Dashboard } = await import("./Dashboard.jsx");
  return render(<Provider store={store}><MemoryRouter><Dashboard /></MemoryRouter></Provider>);
};

const select = (container, name) => container.querySelector(`select[name="${name}"]`);

const applyFilter = async (container) => {
  await waitFor(() => expect(within(select(container, "job")).getByRole("option", { name: "Other City" })).toBeTruthy());
  fireEvent.change(select(container, "job"), { target: { name: "job", value: "Other City" } });
  await waitFor(() => expect(within(select(container, "driver")).getByRole("option", { name: "Eli Other" })).toBeTruthy());
  fireEvent.change(select(container, "driver"), { target: { name: "driver", value: "Eli Other" } });
  fireEvent.change(container.querySelector('input[name="startDate"]'), { target: { name: "startDate", value: "2026-11-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Filter Data" }));
  await waitFor(() => expect(container.textContent).toContain("Eli Other"));
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("Dashboard keeps the admin's view when they leave and come back", () => {
  it("comes back with the form as it was, the dropdowns narrowed to the city, and the filtered table instead of today's", async () => {
    const server = await startServer();
    const store = await makeStore();
    const first = await mount(store);
    await applyFilter(first.container);
    const callsBefore = server.tableCalls.length;
    cleanup(); // the admin opens another page and returns
    const { container } = await mount(store);
    await waitFor(() => expect(select(container, "job").value).toBe("Other City"));
    expect(container.querySelector('input[name="startDate"]').value).toBe("2026-11-01");
    await waitFor(() => expect(within(select(container, "driver")).queryByRole("option", { name: "Dee Test" })).toBeNull()); // narrowed to the city
    expect(select(container, "driver").value).toBe("Eli Other");
    expect(container.textContent).toContain("Eli Other");
    expect(container.textContent).not.toContain("Today Driver");
    expect(server.tableCalls.slice(callsBefore).some((p) => p.defaultToday === "true")).toBe(false); // today's table was not asked for
  });

  it("after a reload, asks again with the same filters and shows that table", async () => {
    const server = await startServer();
    const first = await mount(await makeStore());
    await applyFilter(first.container);
    cleanup();
    const callsBefore = server.tableCalls.length;
    const { container } = await mount(await makeStore()); // a new page load: Redux is empty, the browser still remembers
    await waitFor(() => expect(container.textContent).toContain("Eli Other"));
    const asked = server.tableCalls.slice(callsBefore).find((p) => p.defaultToday !== "true");
    expect(asked).toMatchObject({ job: "Other City", driver: "Eli Other", startDate: "2026-11-01", page: 1 });
    expect(select(container, "job").value).toBe("Other City");
  });

  it("Clear Filters forgets the view, and so does signing out; another person never sees it", async () => {
    const server = await startServer();
    const first = await mount(await makeStore());
    await applyFilter(first.container);
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    await waitFor(() => expect(select(first.container, "job").value).toBe("All"));
    cleanup();
    const again = await mount(await makeStore());
    await waitFor(() => expect(select(again.container, "job").value).toBe("All"));
    cleanup();
    // set it again, then another person opens the dashboard on the same browser
    const third = await mount(await makeStore(1));
    await applyFilter(third.container);
    cleanup();
    const other = await mount(await makeStore(2));
    await waitFor(() => expect(select(other.container, "job").value).toBe("All"));
    expect(server.tableCalls.at(-1).defaultToday).toBe("true");
  });
});

const signInAs = async (store, id) => {
  const { manualLogout } = await import("../../redux/slice/admin/adminSlice.js");
  store.dispatch(manualLogout()); // the real sign-out, without leaving the page (a client-side navigation)
  store.dispatch({ type: "admin/login/fulfilled", payload: { admin: { id, role: "admin" } }, meta: { requestId: `login-${id}`, requestStatus: "fulfilled" } });
};

describe("Dashboard: one administrator's table is never shown to the next", () => {
  it("signing out and in as someone else on the same tab asks for their own table and shows none of the previous one", async () => {
    const server = await startServer();
    const store = await makeStore(1);
    const first = await mount(store);
    await applyFilter(first.container);
    cleanup();
    await signInAs(store, 2);
    const callsBefore = server.tableCalls.length;
    const { container } = await mount(store);
    await waitFor(() => expect(server.tableCalls.length).toBeGreaterThan(callsBefore));
    await waitFor(() => expect(container.querySelector("table")?.textContent).toContain("Today Driver"));
    expect(container.querySelector("table").textContent).not.toContain("Eli Other"); // the table, not the dropdown that lists every driver
    expect(select(container, "job").value).toBe("All");
  });

  it("the same administrator coming back still keeps the table (the person is the same)", async () => {
    const server = await startServer();
    const store = await makeStore(1);
    const first = await mount(store);
    await applyFilter(first.container);
    cleanup();
    const callsBefore = server.tableCalls.length;
    const { container } = await mount(store);
    await waitFor(() => expect(select(container, "job").value).toBe("Other City"));
    expect(container.textContent).toContain("Eli Other");
    expect(server.tableCalls.slice(callsBefore).some((p) => p.defaultToday === "true")).toBe(false);
  });

  it("a table still on its way when the session changes is dropped when it arrives", async () => {
    const server = await startServer();
    let release;
    server.hold = new Promise((resolve) => { release = resolve; });
    const store = await makeStore(1);
    const first = await mount(store);
    const { container } = first;
    await waitFor(() => expect(within(select(container, "job")).getByRole("option", { name: "Other City" })).toBeTruthy());
    fireEvent.change(select(container, "job"), { target: { name: "job", value: "Other City" } });
    await waitFor(() => expect(within(select(container, "driver")).getByRole("option", { name: "Eli Other" })).toBeTruthy());
    fireEvent.change(select(container, "driver"), { target: { name: "driver", value: "Eli Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter Data" }));
    cleanup(); // the first administrator leaves while the answer is still coming
    await signInAs(store, 2);
    release(); // ... and it arrives now
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.getState().dash.filteredPaymentData.some((row) => row.driver_name === "Eli Other")).toBe(false);
    expect(store.getState().dash.tableOwnerId).not.toBe(1);
  });
});

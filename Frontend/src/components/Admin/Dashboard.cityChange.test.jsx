import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// Choosing a city must not reload the page: only the driver and route lists wait, and they show that city's drivers only.
const ROW = { id: 1, driver_name: "Dee Test", job_date: "2026-11-03", route_name: "R1", packages: 10, no_scanned: 0, failed_attempt: 0, fs: 0, ds: 0, delivered: 10,
  driver_payment: "100.00", insurance_deduction: "20.00", closed: true, paid: false, data_type: "daily" };
const DRIVERS = { "Test City": [{ id: 7, name: "Dee Test" }], "Other City": [{ id: 8, name: "Eli Other" }] };

// Each driver-list answer waits until the test lets it go, so the "loading" moment can be looked at.
const startServer = async () => {
  const waiting = []; // { city, release }
  const open = (...cities) => waiting.filter((w) => cities.includes(w.city)).forEach((w) => w.release());
  await installServer(async (config) => {
    const url = config.url;
    if (url === "/admin/dashboard/data") return { status: 200, data: { success: true, data: { cities: [{ id: 3, job: "Test City" }, { id: 4, job: "Other City" }], drivers: [{ id: 7, name: "Dee Test" }, { id: 8, name: "Eli Other" }], routes: [] } } };
    if (url === "/admin/dashboard/drivers-by-city") {
      const city = config.params?.cityJob;
      if (city === "All") return { status: 200, data: { success: true, data: [{ id: 7, name: "Dee Test" }, { id: 8, name: "Eli Other" }] } };
      await new Promise((release) => waiting.push({ city, release }));
      return { status: 200, data: { success: true, data: DRIVERS[city] } };
    }
    if (url === "/admin/dashboard/routes-by-city") return { status: 200, data: { success: true, data: [] } };
    if (url === "/admin/dashboard/paymentTable") return { status: 200, data: { success: true, data: [ROW], pagination: { total: 1, page: 1, limit: 10, totalPages: 1 } } };
    return { status: 200, data: { success: true, data: {} } };
  });
  return { open };
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
const optionNames = (el) => [...el.options].map((o) => o.textContent);

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("Dashboard: choosing a city", () => {
  it("calls the first filter City, not Job", async () => {
    await startServer();
    const { container } = await mount();
    await waitFor(() => expect(select(container, "job")).toBeTruthy());
    const labels = [...container.querySelectorAll("div.text-gray-600")].map((d) => d.textContent);
    expect(labels.slice(0, 3)).toEqual(["City", "Driver", "Route"]);
  });

  it("keeps the page on screen while the drivers load, then lists only that city's drivers", async () => {
    const server = await startServer();
    const { container } = await mount();
    await waitFor(() => expect(within(select(container, "job")).getByRole("option", { name: "Other City" })).toBeTruthy());
    fireEvent.change(select(container, "job"), { target: { name: "job", value: "Other City" } });
    // loading: the form is still there (the page was not replaced by a loader), the driver box waits, and no other city's driver is offered
    await waitFor(() => expect(select(container, "driver").disabled).toBe(true));
    expect(screen.getByRole("button", { name: "Filter Data" })).toBeTruthy();
    expect(select(container, "job").value).toBe("Other City");
    expect(optionNames(select(container, "driver"))).toEqual(["All"]);
    server.open("Other City");
    await waitFor(() => expect(select(container, "driver").disabled).toBe(false));
    expect(optionNames(select(container, "driver"))).toEqual(["All", "Eli Other"]);
  });

  it("uses the answer to the latest choice when an earlier one arrives late", async () => {
    const server = await startServer();
    const { container } = await mount();
    await waitFor(() => expect(within(select(container, "job")).getByRole("option", { name: "Other City" })).toBeTruthy());
    fireEvent.change(select(container, "job"), { target: { name: "job", value: "Other City" } });
    fireEvent.change(select(container, "job"), { target: { name: "job", value: "Test City" } });
    await waitFor(() => expect(select(container, "driver").disabled).toBe(true));
    server.open("Test City"); // the newer answer lands first ...
    await waitFor(() => expect(select(container, "driver").disabled).toBe(false));
    server.open("Other City"); // ... then the older one arrives late and must be ignored
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => expect(select(container, "driver").disabled).toBe(false));
    expect(optionNames(select(container, "driver"))).toEqual(["All", "Dee Test"]);
  });
});

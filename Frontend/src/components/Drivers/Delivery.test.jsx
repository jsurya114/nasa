import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";
import { lastDaysRange } from "../../utils/dateRange";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("../../utils/toast", () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// Synthetic history for one driver: 14 working dates over 3 weeks, a gap, and two routes on one date.
const row = (id, date, route, earning) => ({
  id, driver_id: 7, journey_date: date, route_id: route, route_name: `Route ${route}`, packages: 10, no_scanned: 0, failed_attempt: 0,
  first_stop: 8, double_stop: 2, delivered: 10, earning, insurance_deduction: "0.00", start_seq: 1, end_seq: 10,
  closed: true, paid: false, data_type: "daily",
});
const HISTORY = (() => {
  const rows = [];
  let id = 1;
  for (let back = 0; back < 20; back += 1) {
    if (back === 4 || back === 5 || back === 11 || back === 12 || back === 13 || back === 18) continue; // days off
    const d = new Date(2026, 10, 3 - back);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    rows.push(row(id++, date, 1, "20.00"));
    if (back === 2) rows.push(row(id++, date, 2, "15.00")); // second route on the same date
  }
  return rows;
})();

const startServer = async () => {
  const state = { requests: [] };
  await installServer(async (config) => {
    if (config.url.includes("/driver/deliveries/")) {
      const { from_date, to_date } = config.params;
      state.requests.push({ url: config.url, from_date, to_date });
      return { status: 200, data: HISTORY.filter((r) => r.journey_date >= from_date && r.journey_date <= to_date) };
    }
    if (config.url.includes("/driver/access-driver")) return { status: 200, data: { driver: { id: 7, name: "Dee", agreement_signed: true } } };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async () => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([
    import("@reduxjs/toolkit"),
    import("react-redux"),
    import("react-router-dom"),
  ]);
  const driverSlice = await import("../../redux/slice/driver/driverSlice.js");
  const deliveryReducer = (await import("../../redux/slice/driver/deliverySlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Delivery } = await import("./Delivery.jsx");
  const store = configureStore({ reducer: { driver: driverSlice.default, delivery: deliveryReducer, language: languageReducer } });
  store.dispatch(driverSlice.setDriver({ id: 7, name: "Dee", agreement_signed: true }));
  const view = render(
    <Provider store={store}>
      <MemoryRouter>
        <Delivery />
      </MemoryRouter>
    </Provider>
  );
  return { ...view, store };
};

// The table body rows (the phone card list renders the same rows a second time).
const tableRows = (container) => container.querySelectorAll("tbody tr");

beforeEach(async () => {
  removeShell();
  await resetBrowser();
  toastSuccess.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 3, 9, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("driver Deliveries: ten days of history", () => {
  it("opens on the last ten calendar days, today included, and loads them without a click", async () => {
    const server = await startServer();
    const { container } = await mount();
    await waitFor(() => expect(server.requests).toHaveLength(1));
    expect(server.requests[0]).toMatchObject({ url: "/driver/deliveries/7", from_date: "2026-10-25", to_date: "2026-11-03" });
    expect(container.querySelector('input[name="from_date"]').value).toBe("2026-10-25");
    expect(container.querySelector('input[name="to_date"]').value).toBe("2026-11-03");
    // 10 calendar days hold 8 working dates (2 days off) and 9 rows (two routes on 1 Nov)
    await waitFor(() => expect(tableRows(container)).toHaveLength(9));
    expect(screen.getAllByText("2026-10-25").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("2026-10-24")).toHaveLength(0);
  });

  it("keeps a longer range the driver picks: nothing is cut to ten days", async () => {
    const server = await startServer();
    const { container } = await mount();
    await waitFor(() => expect(tableRows(container)).toHaveLength(9));
    fireEvent.change(container.querySelector('input[name="from_date"]'), { target: { name: "from_date", value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await waitFor(() => expect(server.requests).toHaveLength(2));
    expect(server.requests[1]).toMatchObject({ from_date: "2026-10-01", to_date: "2026-11-03" });
    // every synthetic row: 14 working dates plus the second route
    await waitFor(() => expect(tableRows(container)).toHaveLength(HISTORY.length));
    expect(HISTORY).toHaveLength(15);
  });

  it("loads quietly on opening, and announces only new results with their own count", async () => {
    const server = await startServer();
    const { container } = await mount();
    await waitFor(() => expect(tableRows(container)).toHaveLength(9));
    expect(toastSuccess).not.toHaveBeenCalled();
    // editing a date is not a new result: no announcement, and the saved dates stay those of the shown rows
    fireEvent.change(container.querySelector('input[name="from_date"]'), { target: { name: "from_date", value: "2026-10-01" } });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("deliveryFilters"))).toEqual({ from_date: "2026-10-25", to_date: "2026-11-03" });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0][0]).toContain("15");
    expect(server.requests).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem("deliveryFilters"))).toEqual({ from_date: "2026-10-01", to_date: "2026-11-03" });
  });

  it("Reset goes back to the last ten days and reloads them", async () => {
    const server = await startServer();
    const { container } = await mount();
    await waitFor(() => expect(server.requests).toHaveLength(1));
    fireEvent.change(container.querySelector('input[name="from_date"]'), { target: { name: "from_date", value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await waitFor(() => expect(tableRows(container)).toHaveLength(15));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(server.requests).toHaveLength(3));
    expect(server.requests[2]).toMatchObject(lastDaysRange());
    await waitFor(() => expect(tableRows(container)).toHaveLength(9));
  });

  const saveCache = (driverId) => {
    localStorage.setItem("deliveryData", JSON.stringify(HISTORY.slice(0, 2)));
    localStorage.setItem("deliveryFilters", JSON.stringify({ from_date: "2026-11-02", to_date: "2026-11-03" }));
    localStorage.setItem("deliveryTimestamp", String(Date.now()));
    localStorage.setItem("deliveryDriverId", String(driverId));
  };

  it("shows this driver's recent cached result instead of loading again", async () => {
    saveCache(7);
    const server = await startServer();
    const { container } = await mount();
    await waitFor(() => expect(tableRows(container)).toHaveLength(2));
    expect(server.requests).toHaveLength(0);
    expect(container.querySelector('input[name="from_date"]').value).toBe("2026-11-02");
  });

  it("never shows a result another driver saved on the same phone", async () => {
    saveCache(8);
    const server = await startServer();
    const { container } = await mount();
    await waitFor(() => expect(server.requests).toHaveLength(1));
    expect(server.requests[0]).toMatchObject({ url: "/driver/deliveries/7", from_date: "2026-10-25" });
    await waitFor(() => expect(tableRows(container)).toHaveLength(9));
    expect(localStorage.getItem("deliveryDriverId")).toBe("7");
  });

  it("ignores a cached result from before this change (no driver recorded)", async () => {
    saveCache(7);
    localStorage.removeItem("deliveryDriverId");
    const server = await startServer();
    await mount();
    await waitFor(() => expect(server.requests).toHaveLength(1));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("../../utils/confirmDialog", () => ({ confirmDialog: vi.fn(async () => true), default: vi.fn(async () => true) }));

// The admin availability screen with made-up drivers. Choosing a day lists only the drivers available that day (the server does it, as the
// fake does here) and shows only that day for them; the other days come back when the day is cleared or a driver is being edited.
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const avail = (...on) => Object.fromEntries(DAYS.map((d) => [d, on.includes(d)]));
const DRIVERS = [
  { id: 1, driver_code: 11, name: "Dee Test", email: "dee@example.com", enabled: true, city: "Test City", availability: avail("monday", "tuesday") },
  { id: 2, driver_code: 12, name: "Eli Test", email: "eli@example.com", enabled: true, city: "Test City", availability: avail("tuesday", "friday") },
  { id: 3, driver_code: 13, name: "Fay Test", email: "fay@example.com", enabled: true, city: "Test City", availability: avail() },
];

const startServer = async () => {
  const state = { lists: [] };
  await installServer(async (config) => {
    if (config.url === "/admin/drivers/availability") {
      state.lists.push(config.params ?? {});
      const day = config.params?.day;
      const data = DRIVERS.filter((d) => !day || d.availability[day]);
      return { status: 200, data: { success: true, data, pagination: { currentPage: 1, totalPages: 1, totalRecords: data.length, limit: 10 } } };
    }
    if (config.url === "/admin/drivers/availability/cities") return { status: 200, data: { success: true, data: ["Test City"] } };
    if (config.url === "/admin/drivers/availability/counts") return { status: 200, data: { success: true, data: { monday: 1, tuesday: 2, wednesday: 0, thursday: 0, friday: 1, saturday: 0, sunday: 0 } } };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async () => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const availabilityReducer = (await import("../../redux/slice/driver/availabilitySlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Page } = await import("./AdminDriverAvailability.jsx");
  const signedIn = { ...adminReducer(undefined, { type: "init" }), admin: { id: 1, role: "superadmin" }, isSuperAdmin: true, isAuthenticated: true };
  const store = configureStore({ reducer: { admin: adminReducer, availability: availabilityReducer, language: languageReducer }, preloadedState: { admin: signedIn } });
  return render(<Provider store={store}><MemoryRouter><Page /></MemoryRouter></Provider>);
};

const table = () => document.querySelector("table");
const headerDays = () => [...table().querySelectorAll("thead tr:nth-child(2) th")].map((th) => th.textContent.replace("Today", "").trim()).filter(Boolean);

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("Admin availability: choosing a day", () => {
  it("lists only the drivers available that day and shows only that day; All Days brings the whole week back", async () => {
    const server = await startServer();
    await mount();
    await waitFor(() => expect(within(table()).getByText("Fay Test")).toBeTruthy());
    expect(headerDays()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

    const dayFilter = screen.getAllByRole("combobox").find((s) => within(s).queryByRole("option", { name: "All Days" }));
    fireEvent.change(dayFilter, { target: { value: "tuesday" } });
    await waitFor(() => expect(within(table()).queryByText("Fay Test")).toBeNull());
    expect(server.lists.at(-1).day).toBe("tuesday");
    expect(within(table()).getByText("Dee Test")).toBeTruthy();
    expect(within(table()).getByText("Eli Test")).toBeTruthy();
    expect(headerDays()).toEqual(["Tue"]);
    expect(table().querySelectorAll("tbody tr:first-child td button").length).toBeGreaterThanOrEqual(1);

    // editing a driver works as before: all days can be set, then only the chosen day is shown again
    fireEvent.click(within(table()).getAllByRole("button", { name: /Edit/ })[0]);
    await waitFor(() => expect(headerDays()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]));
    fireEvent.click(within(table()).getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(headerDays()).toEqual(["Tue"]));

    fireEvent.change(dayFilter, { target: { value: "monday" } });
    await waitFor(() => expect(within(table()).queryByText("Eli Test")).toBeNull());
    expect(within(table()).getByText("Dee Test")).toBeTruthy();
    expect(headerDays()).toEqual(["Mon"]);

    fireEvent.change(dayFilter, { target: { value: "" } });
    await waitFor(() => expect(within(table()).getByText("Fay Test")).toBeTruthy());
    expect(headerDays()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

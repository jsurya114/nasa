import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../test/fakeShell";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("../utils/toast", () => ({ toast }));

// The Drivers table with made-up drivers: a Driver Type column, row and page checkboxes, a Change button that appears only when someone
// is selected, and a confirm modal that sends ONE bulk request. The fake server stands in for GET /admin/get-users and PATCH /admin/drivers/type.
const PAGES = {
  1: [
    { id: 1, driver_code: 11, name: "Dee Test", email: "dee@example.com", phone_number: "1", job: "Test City", enabled: true, driver_type: "LOCAL" },
    { id: 2, driver_code: 12, name: "Eli Test", email: "eli@example.com", phone_number: "2", job: "Test City", enabled: true, driver_type: "DESI" },
    { id: 3, driver_code: 13, name: "Fay Test", email: "fay@example.com", phone_number: "3", job: "Test City", enabled: false, driver_type: null },
  ],
  2: [{ id: 4, driver_code: 14, name: "Gus Test", email: "gus@example.com", phone_number: "4", job: "Test City", enabled: true, driver_type: "DESI" }],
};

const startServer = async ({ patch } = {}) => {
  const state = { lists: [], patches: [] };
  await installServer(async (config) => {
    if (config.url === "/admin/get-users") {
      state.lists.push(config.params ?? {});
      const page = config.params?.page ?? 1;
      return { status: 200, data: { drivers: PAGES[page] ?? [], page, totalPages: 2 } };
    }
    if (config.url === "/admin/drivers/type" && config.method === "patch") {
      const body = JSON.parse(config.data);
      state.patches.push(body);
      if (patch) return patch(body);
      return { status: 200, data: { message: "Driver type updated", updated: body.driverIds.length, unchanged: 0, driverIds: body.driverIds, driverType: body.driverType } };
    }
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async () => {
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const usersReducer = (await import("../redux/slice/admin/userLoadSlice.js")).default;
  const { default: DriversList } = await import("./DriversList.jsx");
  const store = configureStore({ reducer: { users: usersReducer } });
  render(<Provider store={store}><DriversList onEdit={() => {}} /></Provider>);
  await waitFor(() => expect(screen.getByText("Dee Test")).toBeTruthy());
  return store;
};

const rowOf = (name) => screen.getByText(name).closest("tr");
const pick = (name) => fireEvent.click(within(rowOf(name)).getByRole("checkbox", { name: `Select ${name}` }));
const changeButton = () => screen.queryByRole("button", { name: /^Change \(/ });
const modal = () => screen.queryByRole("dialog");

beforeEach(async () => { removeShell(); await resetBrowser(); Object.values(toast).forEach((f) => f.mockClear()); });
afterEach(cleanup);

describe("Drivers table: driver type and bulk change", () => {
  it("shows a Driver Type column: Local, Desi, and Not set for a driver nobody has classified", async () => {
    await startServer();
    await mount();
    expect(screen.getByRole("button", { name: "Driver Type" })).toBeTruthy();
    expect(within(rowOf("Dee Test")).getByText("Local")).toBeTruthy();
    expect(within(rowOf("Eli Test")).getByText("Desi")).toBeTruthy();
    expect(within(rowOf("Fay Test")).getByText("Not set")).toBeTruthy();
  });

  it("hides the Change button until a driver is selected, then counts the selection", async () => {
    await startServer();
    await mount();
    expect(changeButton()).toBeNull();
    pick("Dee Test");
    expect(changeButton().textContent).toBe("Change (1)");
    pick("Eli Test");
    expect(changeButton().textContent).toBe("Change (2)");
    pick("Dee Test");
    pick("Eli Test");
    expect(changeButton()).toBeNull();
  });

  it("selects every driver on the page at once, with a half-selected header while only some are chosen", async () => {
    await startServer();
    await mount();
    const header = screen.getByRole("checkbox", { name: "Select all drivers on this page" });
    pick("Dee Test");
    expect(header.indeterminate).toBe(true);
    expect(header.checked).toBe(false);
    fireEvent.click(header);
    expect(changeButton().textContent).toBe("Change (3)");
    expect(header.checked).toBe(true);
    fireEvent.click(header);
    expect(changeButton()).toBeNull();
  });

  it("changes a mixed selection with ONE request, updates the rows at once, clears the selection and closes the modal", async () => {
    const server = await startServer();
    await mount();
    pick("Dee Test");
    pick("Eli Test");
    pick("Fay Test");
    fireEvent.click(changeButton());
    expect(modal()).toBeTruthy();
    expect(within(modal()).getByText("Change Driver Type")).toBeTruthy();
    expect(within(modal()).getByText(/3 drivers selected/)).toBeTruthy();
    expect(within(modal()).getByText(/1 Local, 1 Desi, 1 not set/)).toBeTruthy();

    const confirm = within(modal()).getByRole("button", { name: "Confirm" });
    expect(confirm.disabled).toBe(true); // nothing chosen yet: no accidental update
    fireEvent.click(within(modal()).getByLabelText("Change to Desi"));
    fireEvent.click(confirm);

    await waitFor(() => expect(modal()).toBeNull());
    expect(server.patches).toEqual([{ driverIds: [1, 2, 3], driverType: "DESI" }]);
    for (const name of ["Dee Test", "Eli Test", "Fay Test"]) expect(within(rowOf(name)).getByText("Desi")).toBeTruthy();
    expect(changeButton()).toBeNull();
    expect(toast.success).toHaveBeenCalled();
  });

  it("Cancel closes the modal and sends nothing; the selection stays", async () => {
    const server = await startServer();
    await mount();
    pick("Dee Test");
    fireEvent.click(changeButton());
    fireEvent.click(within(modal()).getByRole("button", { name: "Cancel" }));
    expect(modal()).toBeNull();
    expect(server.patches).toEqual([]);
    expect(changeButton().textContent).toBe("Change (1)");
  });

  it("choosing the type everyone selected already has sends nothing", async () => {
    const server = await startServer();
    await mount();
    pick("Eli Test");
    fireEvent.click(changeButton());
    fireEvent.click(within(modal()).getByLabelText("Change to Desi"));
    fireEvent.click(within(modal()).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(modal()).toBeNull());
    expect(server.patches).toEqual([]);
    expect(toast.info).toHaveBeenCalled();
  });

  it("keeps the modal and the selection when the server refuses, and says why", async () => {
    await startServer({ patch: () => ({ status: 403, data: { message: "You can only manage drivers in your assigned cities" } }) });
    await mount();
    pick("Dee Test");
    fireEvent.click(changeButton());
    fireEvent.click(within(modal()).getByLabelText("Change to Desi"));
    fireEvent.click(within(modal()).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You can only manage drivers in your assigned cities"));
    expect(modal()).toBeTruthy();
    expect(within(rowOf("Dee Test")).getByText("Local")).toBeTruthy();
    expect(changeButton().textContent).toBe("Change (1)");
  });

  it("blocks a second submit while the first is running", async () => {
    let release;
    const server = await startServer({ patch: (body) => new Promise((resolve) => { release = () => resolve({ status: 200, data: { updated: 1, unchanged: 0, driverIds: body.driverIds, driverType: body.driverType } }); }) });
    await mount();
    pick("Dee Test");
    fireEvent.click(changeButton());
    fireEvent.click(within(modal()).getByLabelText("Change to Desi"));
    const confirm = within(modal()).getByRole("button", { name: "Confirm" });
    fireEvent.click(confirm);
    await waitFor(() => expect(within(modal()).getByRole("button", { name: "Updating..." }).disabled).toBe(true));
    fireEvent.click(within(modal()).getByRole("button", { name: "Updating..." }));
    fireEvent.click(within(modal()).getByRole("button", { name: "Cancel" }));
    expect(modal()).toBeTruthy(); // cannot be closed while it runs
    release();
    await waitFor(() => expect(modal()).toBeNull());
    expect(server.patches).toHaveLength(1);
  });

  it("keeps the selection when moving between pages, and the count covers drivers on other pages", async () => {
    const server = await startServer();
    await mount();
    pick("Dee Test");
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(screen.getByText("Gus Test")).toBeTruthy());
    expect(changeButton().textContent).toBe("Change (1)");
    pick("Gus Test");
    expect(changeButton().textContent).toBe("Change (2)");
    fireEvent.click(changeButton());
    expect(within(modal()).getByText(/2 drivers selected/)).toBeTruthy();
    fireEvent.click(within(modal()).getByLabelText("Change to Local"));
    fireEvent.click(within(modal()).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(modal()).toBeNull());
    expect(server.patches).toEqual([{ driverIds: [1, 4], driverType: "LOCAL" }]);
    expect(within(rowOf("Gus Test")).getByText("Local")).toBeTruthy();
  });

  it("starts the selection again when the search changes, so hidden drivers are never changed by accident", async () => {
    await startServer();
    await mount();
    pick("Dee Test");
    expect(changeButton()).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: "Eli" } });
    await waitFor(() => expect(changeButton()).toBeNull(), { timeout: 3000 });
  });
});

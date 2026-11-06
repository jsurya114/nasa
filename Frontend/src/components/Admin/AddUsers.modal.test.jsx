import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("../../utils/toast", () => ({ toast }));
vi.mock("../../reuse/Header", () => ({ default: () => null }));
vi.mock("../../reuse/Nav", () => ({ default: () => null }));

// The Drivers / Admins page: the Add forms are not on the page any more, each opens in a dialog from its own button; the tabs work as before.
const DRIVER = { id: 1, driver_code: 11, name: "Dee Test", email: "dee@example.com", phone_number: "1", job: "Test City", enabled: true, driver_type: null };
const ADMIN = { id: 9, admin_name: "Ann Admin", admin_email: "ann@example.com", admin_role: "admin", is_active: true, cities: "Test City" };

const startServer = async ({ createDriver, createAdmin } = {}) => {
  const state = { posts: [], drivers: [DRIVER], admins: [ADMIN] };
  await installServer(async (config) => {
    if (config.url === "/admin/get-admin-cities") return { status: 200, data: { cities: [{ id: 1, job: "Test City" }] } };
    if (config.url === "/admin/get-users") return { status: 200, data: { drivers: state.drivers, page: 1, totalPages: 1 } };
    if (config.url === "/admin/get-admins") return { status: 200, data: { admins: state.admins, page: 1, totalPages: 1 } };
    if (config.url === "/admin/create-users") {
      const body = JSON.parse(config.data);
      state.posts.push(["driver", body]);
      if (createDriver) return createDriver(body);
      return { status: 200, data: { message: "User Added Successfully!!", insertUser: { id: 2, driver_code: body.driver_code, name: body.name, email: body.email, phone_number: null, job: body.city, enabled: true, driver_type: body.driverType ?? null } } };
    }
    if (config.url === "/admin/create-admin") {
      const body = JSON.parse(config.data);
      state.posts.push(["admin", body]);
      if (createAdmin) return createAdmin(body);
      return { status: 200, data: { message: "Admin Added", insertAdmin: { id: 10, admin_name: body.name, admin_email: body.email, admin_role: body.role, is_active: true, cities: "" } } };
    }
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async ({ isSuperAdmin = true } = {}) => {
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const usersReducer = (await import("../../redux/slice/admin/userLoadSlice.js")).default;
  const { default: AddUsers } = await import("./AddUsers.jsx");
  const signedIn = { ...adminReducer(undefined, { type: "init" }), admin: { id: 1, role: isSuperAdmin ? "superadmin" : "admin" }, isSuperAdmin, isAuthenticated: true };
  const store = configureStore({ reducer: { admin: adminReducer, users: usersReducer }, preloadedState: { admin: signedIn } });
  render(<Provider store={store}><AddUsers /></Provider>);
  await waitFor(() => expect(screen.getByText("Dee Test")).toBeTruthy());
};

const fillDriver = () => {
  fireEvent.change(screen.getByPlaceholderText("Driver Name"), { target: { value: "New Driver" } });
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "new@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Driver Code"), { target: { value: "555" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "secret1" } });
  fireEvent.change(screen.getByPlaceholderText("Confirm Password"), { target: { value: "secret1" } });
  fireEvent.change(document.querySelector("select[name=city]"), { target: { value: "Test City" } });
};

beforeEach(async () => { removeShell(); await resetBrowser(); Object.values(toast).forEach((f) => f.mockClear()); });
afterEach(cleanup);

describe("Drivers page: Add Driver in a dialog", () => {
  it("has no add form on the page, only the table and a + Add Driver button", async () => {
    await startServer();
    await mount();
    expect(screen.getByRole("button", { name: "+ Add Driver" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Driver Name")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Dee Test")).toBeTruthy();
  });

  it("opens the same form in a dialog titled Add Driver, and Cancel, X, Escape and the backdrop close it", async () => {
    await startServer();
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Add Driver" })).toBeTruthy();
    for (const placeholder of ["Driver Name", "Email", "Phone Number (optional)", "Driver Code", "Password", "Confirm Password"]) expect(within(dialog).getByPlaceholderText(placeholder)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Add Driver" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the validation: an empty form is not sent and the dialog stays open", async () => {
    const server = await startServer();
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add Driver" }));
    expect(screen.getByText("Name is required")).toBeTruthy();
    expect(server.posts).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("a successful save closes the dialog, shows the success message and the new driver in the table", async () => {
    const server = await startServer();
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    fillDriver();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add Driver" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0][1]).toMatchObject({ name: "New Driver", email: "new@example.com", city: "Test City" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("User Added Successfully!!"));
    expect(screen.getByText("New Driver")).toBeTruthy();
    // opening it again gives an empty form
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    expect(screen.getByPlaceholderText("Driver Name").value).toBe("");
  });

  it("the Add Driver dialog has the Driver Type dropdown (Not set, Local, Desi); the choice is sent and shows in the table", async () => {
    const server = await startServer();
    await mount();
    expect(within(screen.getByText("Dee Test").closest("tr")).getByText("Not set")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    const type = within(screen.getByRole("dialog")).getByLabelText("Driver Type");
    expect([...type.options].map((o) => o.textContent)).toEqual(["Not set", "Local", "Desi"]);
    fillDriver();
    fireEvent.change(type, { target: { value: "DESI" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add Driver" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.posts[0][1]).toMatchObject({ name: "New Driver", driverType: "DESI" });
    expect(within(screen.getByText("New Driver").closest("tr")).getByText("Desi")).toBeTruthy();
  });

  it("Edit shows the driver's current type in the dialog", async () => {
    await startServer();
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Driver Type").value).toBe("");
  });

  it("a failed save keeps the dialog open with everything that was typed, and shows the error", async () => {
    await startServer({ createDriver: () => ({ status: 409, data: { message: "User already Exists" } }) });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    fillDriver();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add Driver" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("User already Exists"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByPlaceholderText("Driver Name").value).toBe("New Driver");
    expect(screen.getByPlaceholderText("Email").value).toBe("new@example.com");
    expect(screen.getByPlaceholderText("Password").value).toBe("secret1");
    expect(document.querySelector("select[name=city]").value).toBe("Test City");
  });

  it("cannot be dismissed while the save is running", async () => {
    let release;
    await startServer({ createDriver: (body) => new Promise((resolve) => { release = () => resolve({ status: 200, data: { message: "ok", insertUser: { id: 3, name: body.name, email: body.email, driver_code: 1, job: "Test City", enabled: true } } }); }) });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    fillDriver();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add Driver" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" }).disabled).toBe(true));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(screen.getByRole("dialog")).toBeTruthy();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Edit on a row opens the same dialog, filled in and titled Edit Driver", async () => {
    await startServer();
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit Driver" })).toBeTruthy();
    expect(within(dialog).getByPlaceholderText("Driver Name").value).toBe("Dee Test");
    expect(within(dialog).getByRole("button", { name: "Update Driver" })).toBeTruthy();
  });
});

describe("Admins tab", () => {
  it("switches tabs as before: each tab has its own table and its own Add button, and the forms never mix", async () => {
    await startServer();
    await mount();
    expect(screen.queryByRole("button", { name: "+ Add Admin" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Admins" }));
    await waitFor(() => expect(screen.getByText("Ann Admin")).toBeTruthy());
    expect(screen.getByRole("button", { name: "+ Add Admin" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Add Driver" })).toBeNull();
    expect(screen.queryByPlaceholderText("Admin Name")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ Add Admin" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Add Admin" })).toBeTruthy();
    expect(within(dialog).getByPlaceholderText("Admin Name")).toBeTruthy();
    expect(within(dialog).queryByPlaceholderText("Driver Name")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Drivers" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Add Driver" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ Add Driver" }));
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Add Driver" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Admin Name")).toBeNull();
  });

  it("Add Admin saves, closes the dialog and lists the new admin; a failure keeps the dialog and the typed values", async () => {
    let fail = true;
    const server = await startServer({ createAdmin: (body) => (fail ? { status: 409, data: { message: "Admin already exists" } } : { status: 200, data: { message: "Admin Added", insertAdmin: { id: 10, admin_name: body.name, admin_email: body.email, admin_role: body.role, is_active: true, cities: "" } } }) });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Admins" }));
    await waitFor(() => expect(screen.getByText("Ann Admin")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ Add Admin" }));
    const dialog = () => screen.getByRole("dialog");
    fireEvent.change(within(dialog()).getByPlaceholderText("Admin Name"), { target: { value: "Bo Boss" } });
    fireEvent.change(within(dialog()).getByPlaceholderText("Email"), { target: { value: "bo@example.com" } });
    fireEvent.change(within(dialog()).getByPlaceholderText("Password"), { target: { value: "secret1" } });
    fireEvent.change(within(dialog()).getByPlaceholderText("Confirm Password"), { target: { value: "secret1" } });
    fireEvent.change(dialog().querySelector("select[name=role]"), { target: { value: "superadmin" } });

    fireEvent.click(within(dialog()).getByRole("button", { name: "Add Admin" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Admin already exists"));
    expect(within(dialog()).getByPlaceholderText("Admin Name").value).toBe("Bo Boss");

    fail = false;
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add Admin" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.posts).toHaveLength(2);
    expect(screen.getByText("Bo Boss")).toBeTruthy();
  });

  it("an admin who is not a super admin still cannot open the Admins tab", async () => {
    await startServer();
    await mount({ isSuperAdmin: false });
    expect(screen.getByRole("button", { name: "Admins" }).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "+ Add Admin" })).toBeNull();
  });
});

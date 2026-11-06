import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("../../utils/toast", () => ({ toast }));
vi.mock("../../reuse/Header", () => ({ default: () => null }));
vi.mock("../../reuse/Nav", () => ({ default: () => null }));

// Cities, Routes and Access Codes: the Add form is not on the page; a + Add button opens it in a dialog. Success closes it and the table
// refreshes; failure keeps it open with the typed values; Cancel / X / Escape / the backdrop close it, but not while a save is running.

const slices = async () => {
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const usersReducer = (await import("../../redux/slice/admin/userLoadSlice.js")).default;
  const jobs = (await import("../../redux/slice/admin/jobSlice.js")).default;
  const routes = (await import("../../redux/slice/admin/routeSlice.js")).default;
  const accessCodes = (await import("../../redux/slice/admin/accessCodeSlice.js")).default;
  const language = (await import("../../redux/slice/languageSlice.js")).default;
  const signedIn = { ...adminReducer(undefined, { type: "init" }), admin: { id: 1, role: "superadmin" }, isSuperAdmin: true, isAuthenticated: true };
  const store = configureStore({ reducer: { admin: adminReducer, users: usersReducer, jobs, routes, accessCodes, language }, preloadedState: { admin: signedIn } });
  return { store, Provider };
};

const closers = () => {
  fireEvent.keyDown(document, { key: "Escape" });
};

beforeEach(async () => { removeShell(); await resetBrowser(); Object.values(toast).forEach((f) => f.mockClear()); });
afterEach(cleanup);

describe("Cities page", () => {
  const CITY = { id: 1, job: "Dallas", city_code: "DAL", enabled: true, city_type: "DAILY" };

  const start = async ({ addJob } = {}) => {
    const state = { cities: [CITY], posts: [], lists: 0 };
    await installServer(async (config) => {
      if (config.url === "/admin/jobs") { state.lists += 1; return { status: 200, data: { jobs: state.cities, total: state.cities.length, totalPages: 1, page: 1, isSuperAdmin: true } }; }
      if (config.url === "/admin/addjob") {
        const body = JSON.parse(config.data);
        state.posts.push(body);
        if (addJob) return addJob(body);
        state.cities = [...state.cities, { id: 2, ...body }];
        return { status: 200, data: { message: "ok", job: { id: 2, ...body } } };
      }
      return { status: 200, data: {} };
    });
    const { store, Provider } = await slices();
    const { default: Jobs } = await import("./Jobs.jsx");
    render(<Provider store={store}><Jobs /></Provider>);
    await waitFor(() => expect(screen.getByText("Dallas")).toBeTruthy());
    return state;
  };

  it("shows the table and a + Add City button, and no add form on the page", async () => {
    await start();
    expect(screen.getByRole("button", { name: "+ Add City" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Enter City")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the existing form in a dialog titled Add City and closes it with Cancel, X, Escape and the backdrop", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "+ Add City" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Add City" })).toBeTruthy();
    for (const p of ["Enter City", "Enter city code"]) expect(within(dialog).getByPlaceholderText(p)).toBeTruthy();
    expect(within(dialog).getByText("City Type")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add City" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add City" }));
    closers();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add City" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the validation: an empty form shows its errors, nothing is sent, the dialog stays", async () => {
    const server = await start();
    fireEvent.click(screen.getByRole("button", { name: "+ Add City" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add City" }));
    expect(screen.getByText("Job name is required")).toBeTruthy();
    expect(screen.getByText("City code is required")).toBeTruthy();
    expect(server.posts).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("a successful save closes the dialog, says City added, refreshes the table, and reopens empty", async () => {
    const server = await start();
    fireEvent.click(screen.getByRole("button", { name: "+ Add City" }));
    fireEvent.change(screen.getByPlaceholderText("Enter City"), { target: { value: "Tyler" } });
    fireEvent.change(screen.getByPlaceholderText("Enter city code"), { target: { value: "TYL" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add City" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.posts).toEqual([{ job: "Tyler", city_code: "TYL", enabled: true, city_type: "DAILY" }]);
    expect(toast.success).toHaveBeenCalledWith("City added");
    await waitFor(() => expect(screen.getByText("Tyler")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ Add City" }));
    expect(screen.getByPlaceholderText("Enter City").value).toBe("");
  });

  it("a failed save keeps the dialog open with the typed values", async () => {
    await start({ addJob: () => ({ status: 409, data: { message: "City already exists" } }) });
    fireEvent.click(screen.getByRole("button", { name: "+ Add City" }));
    fireEvent.change(screen.getByPlaceholderText("Enter City"), { target: { value: "Tyler" } });
    fireEvent.change(screen.getByPlaceholderText("Enter city code"), { target: { value: "TYL" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add City" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add City" }).disabled).toBe(false));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter City").value).toBe("Tyler");
    expect(screen.getByPlaceholderText("Enter city code").value).toBe("TYL");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("cannot be dismissed while the save is running", async () => {
    let release;
    await start({ addJob: (body) => new Promise((resolve) => { release = () => resolve({ status: 200, data: { job: { id: 3, ...body } } }); }) });
    fireEvent.click(screen.getByRole("button", { name: "+ Add City" }));
    fireEvent.change(screen.getByPlaceholderText("Enter City"), { target: { value: "Tyler" } });
    fireEvent.change(screen.getByPlaceholderText("Enter city code"), { target: { value: "TYL" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add City" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" }).disabled).toBe(true));
    closers();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(screen.getByRole("dialog")).toBeTruthy();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Edit on a row opens the same dialog filled in, titled Edit City", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit City" })).toBeTruthy();
    expect(within(dialog).getByPlaceholderText("Enter City").value).toBe("Dallas");
    expect(within(dialog).getByRole("button", { name: "Update City" })).toBeTruthy();
  });
});

describe("Routes page", () => {
  const ROUTE = { id: 1, route: "R-100", routeCodeInString: "", job: "Dallas", companyRoutePrice: 10, driverRoutePrice: 8, companyDoubleStopPrice: 5, driverDoubleStopPrice: 4, enabled: true };

  const start = async ({ addRoute } = {}) => {
    const state = { routes: [ROUTE], posts: [] };
    await installServer(async (config) => {
      if (config.url === "/admin/jobs") return { status: 200, data: { jobs: [{ id: 1, job: "Dallas", enabled: true }], total: 1, totalPages: 1, page: 1, isSuperAdmin: true } };
      if (config.url === "/admin/routes" && config.method === "get") return { status: 200, data: { routes: state.routes, total: state.routes.length, page: 1, totalPages: 1 } };
      if (config.url === "/admin/routes" && config.method === "post") {
        const body = JSON.parse(config.data);
        state.posts.push(body);
        if (addRoute) return addRoute(body);
        return { status: 200, data: { id: 2, ...body } };
      }
      return { status: 200, data: {} };
    });
    const { store, Provider } = await slices();
    const { default: RoutesForm } = await import("./routes-form.jsx");
    render(<Provider store={store}><RoutesForm /></Provider>);
    await waitFor(() => expect(screen.getByText("R-100")).toBeTruthy());
    return state;
  };

  const fill = () => {
    fireEvent.change(screen.getByPlaceholderText("Enter route name"), { target: { value: "R-200" } });
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("combobox"), { target: { value: "Dallas" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox"));
  };

  it("shows the table and a + Add Route button, and no add form on the page", async () => {
    await start();
    expect(screen.getByRole("button", { name: "+ Add Route" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Enter route name")).toBeNull();
  });

  it("opens the existing form in a dialog titled Add Route; every field is there; it closes four ways", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Route" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Add Route" })).toBeTruthy();
    for (const label of ["Route", "Route Code (String)", "Job (City)", "Company Route Price", "Driver Route Price", "Company Double Stop Price", "Driver Double Stop Price", "Enabled (to save)"]) expect(within(dialog).getByText(label)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Route" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Route" }));
    closers();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Route" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the rules: Enabled must be ticked to save, and a name and city are required", async () => {
    const server = await start();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Route" }));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Add Route" }).disabled).toBe(true);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add Route" }));
    expect(screen.getByText("Route name is required.")).toBeTruthy();
    expect(server.posts).toEqual([]);
  });

  it("a successful save closes the dialog, says so, and the new route is in the table", async () => {
    const server = await start();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Route" }));
    fill();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add Route" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.posts[0]).toMatchObject({ route: "R-200", job: "Dallas", enabled: true });
    expect(toast.success).toHaveBeenCalledWith("Route added successfully!", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "+ Add Route" }));
    expect(screen.getByPlaceholderText("Enter route name").value).toBe("");
  });

  it("a failed save keeps the dialog open with the typed values and shows the error", async () => {
    await start({ addRoute: () => ({ status: 500, data: { message: "boom" } }) });
    fireEvent.click(screen.getByRole("button", { name: "+ Add Route" }));
    fill();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add Route" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter route name").value).toBe("R-200");
    expect(within(screen.getByRole("dialog")).getByRole("combobox").value).toBe("Dallas");
  });

  it("Edit on a row opens the same dialog filled in, titled Edit Route", async () => {
    await start();
    fireEvent.click(screen.getAllByRole("button", { name: /Edit/ })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit Route" })).toBeTruthy();
    expect(within(dialog).getByPlaceholderText("Enter route name").value).toBe("R-100");
    expect(within(dialog).getByRole("button", { name: "Update Route" })).toBeTruthy();
  });
});

describe("Access Codes page", () => {
  const CODE = { id: 1, zip_code: "75001", address: "1 Main Street Dallas", access_code: "AB12CD", images: [], created_at: "2026-11-01T00:00:00Z" };

  const start = async ({ create } = {}) => {
    const state = { codes: [CODE], posts: [] };
    await installServer(async (config) => {
      if (config.url === "/admin/get-admin-cities") return { status: 200, data: { cities: [{ id: 1, job: "Dallas" }] } };
      if (config.url === "/admin/access-codes/list") return { status: 200, data: { data: state.codes, pagination: { totalPages: 1, total: state.codes.length, hasMore: false } } };
      if (config.url === "/admin/access-codes" && config.method === "post") {
        const fields = Object.fromEntries(config.data.entries());
        state.posts.push(fields);
        if (create) return create(fields);
        state.codes = [...state.codes, { id: 2, zip_code: fields.zip_code, address: fields.address, access_code: fields.access_code, images: [], created_at: "2026-11-02T00:00:00Z" }];
        return { status: 200, data: { message: "created" } };
      }
      return { status: 200, data: {} };
    });
    const { store, Provider } = await slices();
    const { default: Page } = await import("./AccessCode.jsx");
    render(<Provider store={store}><Page /></Provider>);
    await waitFor(() => expect(screen.getAllByText("AB12CD").length).toBeGreaterThan(0));
    return state;
  };

  const fill = () => {
    fireEvent.change(screen.getByLabelText(/Zip Code/), { target: { value: "75002" } });
    fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: "2 Elm Street Dallas" } });
    fireEvent.change(screen.getByLabelText(/^Access Code/), { target: { value: "ZZ99YY" } });
  };

  it("shows the table and a + Add Access Code button, and no add form on the page", async () => {
    await start();
    expect(screen.getByRole("button", { name: "+ Add Access Code" })).toBeTruthy();
    expect(screen.queryByLabelText(/Zip Code/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the existing form in a dialog titled Add Access Code; it closes four ways", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Access Code" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Add Access Code" })).toBeTruthy();
    for (const label of [/Zip Code/, /^Address/, /^Access Code/, /Upload Images/, /^City/]) expect(within(dialog).getByLabelText(label)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Access Code" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Access Code" }));
    closers();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Access Code" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the validation: a bad zip code or a short access code is not sent", async () => {
    const server = await start();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Access Code" }));
    fireEvent.change(screen.getByLabelText(/Zip Code/), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText(/^Access Code/), { target: { value: "ab" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Save Access Code/ }));
    expect(toast.error).toHaveBeenCalledWith("Please fix all validation errors", expect.anything());
    expect(server.posts).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("a successful save closes the dialog, says so, refreshes the table, and reopens empty", async () => {
    const server = await start();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Access Code" }));
    fill();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Save Access Code/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.posts[0]).toMatchObject({ zip_code: "75002", address: "2 Elm Street Dallas", access_code: "ZZ99YY" });
    expect(toast.success).toHaveBeenCalledWith("Access code created successfully!", expect.anything());
    await waitFor(() => expect(screen.getAllByText("ZZ99YY").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "+ Add Access Code" }));
    expect(screen.getByLabelText(/Zip Code/).value).toBe("");
  });

  it("a failed save keeps the dialog open with the typed values and shows the error", async () => {
    await start({ create: () => ({ status: 409, data: { message: "Access code already exists" } }) });
    fireEvent.click(screen.getByRole("button", { name: "+ Add Access Code" }));
    fill();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Save Access Code/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Access code already exists", expect.anything()));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText(/Zip Code/).value).toBe("75002");
    expect(screen.getByLabelText(/^Address/).value).toBe("2 Elm Street Dallas");
    expect(screen.getByLabelText(/^Access Code/).value).toBe("ZZ99YY");
  });

  it("cannot be dismissed while the save is running", async () => {
    let release;
    await start({ create: () => new Promise((resolve) => { release = () => resolve({ status: 200, data: { message: "created" } }); }) });
    fireEvent.click(screen.getByRole("button", { name: "+ Add Access Code" }));
    fill();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Save Access Code/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" }).disabled).toBe(true));
    closers();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(screen.getByRole("dialog")).toBeTruthy();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, installShell, removeShell, resetBrowser } from "../test/fakeShell";

// The real guards, slices, interceptor and session store, with a fake shell and a fake server.
const GOOD = "good";
const accessServer = () => async (config) => {
  if (config.url.includes("/refresh-token")) return { status: 401, data: {} };
  if (config.headers?.Authorization !== `Bearer ${GOOD}`) return { status: 401, data: {} };
  if (config.url.includes("/driver/access-driver")) return { status: 200, data: { driver: { id: 1, name: "D", agreement_signed: true } } };
  return { status: 200, data: { admin: { id: 2, name: "A", role: "superadmin" } } };
};

const mount = async (initialPath) => {
  const [{ configureStore }, { Provider }, { MemoryRouter, Routes, Route }] = await Promise.all([
    import("@reduxjs/toolkit"),
    import("react-redux"),
    import("react-router-dom"),
  ]);
  const driverSlice = await import("../redux/slice/driver/driverSlice.js");
  const adminSlice = await import("../redux/slice/admin/adminSlice.js");
  const languageReducer = (await import("../redux/slice/languageSlice.js")).default;
  const { default: DProtectRoutes } = await import("./driver/DProtectedRoutes.jsx");
  const { default: DPublicRoutes } = await import("./driver/DPublicRoutes.jsx");
  const { default: ProtectedRoutes } = await import("./admin/ProtectedRoute.jsx");
  const { default: AdminPublicOnlyRoute } = await import("./admin/PublicOnlyRoute.jsx");
  const { default: SignOutNotice } = await import("../native/SignOutNotice.jsx");
  const { default: DriverHeader } = await import("../reuse/driver/Header.jsx");

  const store = configureStore({
    reducer: { driver: driverSlice.default, admin: adminSlice.default, language: languageReducer },
  });

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<DProtectRoutes />}>
            <Route
              path="/driver/dashboard"
              element={
                <div>
                  <DriverHeader />
                  Driver dashboard
                </div>
              }
            />
          </Route>
          <Route element={<DPublicRoutes />}>
            <Route
              path="/driver/login"
              element={
                <div>
                  <SignOutNotice area="driver" />
                  Driver login form
                </div>
              }
            />
          </Route>
          <Route element={<ProtectedRoutes />}>
            <Route path="/admin/dashboard" element={<div>Admin dashboard</div>} />
          </Route>
          <Route element={<AdminPublicOnlyRoute />}>
            <Route
              path="/admin/login"
              element={
                <div>
                  <SignOutNotice area="admin" />
                  Admin login form
                </div>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  return { store, driverSlice, adminSlice };
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(() => {
  cleanup();
  removeShell();
});

describe("a temporary connection problem in the app", () => {
  it("driver: keeps the session, offers Try again, and opens the dashboard once it works", async () => {
    const shell = installShell({ "session.get": { accessToken: "stale" }, "session.refresh": { error: "network_error" } });
    const net = await installServer(accessServer());
    await mount("/driver/dashboard");

    expect(await screen.findByText("Can't reach NASA")).toBeTruthy();
    expect(screen.queryByText("Driver login form")).toBeNull();
    expect(shell.count("session.clear")).toBe(0);

    shell.set("session.refresh", { accessToken: GOOD });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Driver dashboard")).toBeTruthy();
    expect(net.calls.filter((c) => c.url.includes("access-driver")).length).toBeGreaterThanOrEqual(2);
  });

  it("admin: the same, and a later check failing does not sign out someone already signed in", async () => {
    const shell = installShell({ "session.get": { accessToken: "stale" }, "session.refresh": { error: "server_error" } });
    await installServer(accessServer());
    const { store, adminSlice } = await mount("/admin/dashboard");
    expect(await screen.findByText("Can't reach NASA")).toBeTruthy();
    expect(shell.count("session.clear")).toBe(0);

    shell.set("session.refresh", { accessToken: GOOD });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Admin dashboard")).toBeTruthy();

    // later the connection drops again: the person stays signed in
    shell.set("session.refresh", { error: "network_error" });
    shell.set("session.get", { accessToken: "stale" });
    await store.dispatch(adminSlice.accessAdminUser());
    expect(store.getState().admin.isAuthenticated).toBe(true);
    expect(screen.getByText("Admin dashboard")).toBeTruthy();
  });
});

describe("a fresh start with nobody signed in", () => {
  it("shows the sign-in form after one check, with no reload loop", async () => {
    const shell = installShell({ "session.get": { accessToken: null }, "session.refresh": { error: "no_session" } });
    const net = await installServer(accessServer());
    await mount("/driver/login");
    expect(await screen.findByText("Driver login form")).toBeTruthy();
    expect(net.calls.filter((c) => c.url.includes("access-driver"))).toHaveLength(1);
    expect(shell.count("session.clear")).toBe(0);
  });
});

describe("a sign-out the phone could not confirm", () => {
  it("is shown on the sign-in screen, is never undone silently, and can be retried", async () => {
    const shell = installShell({
      "session.get": { accessToken: GOOD },
      "session.refresh": { accessToken: GOOD },
      "session.clear": { error: "native_error" },
    });
    const net = await installServer(accessServer());
    const { store, driverSlice } = await mount("/driver/login");

    // someone is signed in, and signs out while the phone cannot clear the session
    await screen.findByText("Driver dashboard");
    const result = await store.dispatch(driverSlice.driverLogout());
    expect(result.type).toMatch(/rejected/);

    // back on the sign-in screen: the notice is shown and the old session does not come back
    const before = net.calls.filter((c) => c.url.includes("access-driver")).length;
    window.history.pushState({}, "", "/");
    cleanup();
    await mount("/driver/login");
    expect(await screen.findByText("Sign-out not confirmed")).toBeTruthy();
    expect(screen.getByText("Driver login form")).toBeTruthy();
    expect(screen.queryByText("Driver dashboard")).toBeNull();
    expect(net.calls.filter((c) => c.url.includes("access-driver")).length).toBe(before);

    // retry works once the phone can clear it
    shell.set("session.clear", {});
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("Sign-out not confirmed")).toBeNull());
  });
});

describe("signing out through the real driver header", () => {
  it("failed: lands on the sign-in screen with the notice, and the old session does not come back", async () => {
    const shell = installShell({
      "session.get": { accessToken: GOOD },
      "session.refresh": { accessToken: GOOD },
      "session.clear": { error: "native_error" },
    });
    const net = await installServer(accessServer());
    await mount("/driver/dashboard");
    expect(await screen.findByText("Driver dashboard")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /logout/i })[0]);

    expect(await screen.findByText("Driver login form")).toBeTruthy();
    expect(await screen.findByText("Sign-out not confirmed")).toBeTruthy();
    expect(screen.queryByText("Driver dashboard")).toBeNull();
    const checks = net.calls.filter((c) => c.url.includes("access-driver")).length;
    // give the public route time to recheck: it must not call the server or go back to the dashboard
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByText("Driver dashboard")).toBeNull();
    expect(net.calls.filter((c) => c.url.includes("access-driver")).length).toBe(checks);

    shell.set("session.clear", {});
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("Sign-out not confirmed")).toBeNull());
    expect(screen.getByText("Driver login form")).toBeTruthy();
  });

  it("succeeded: lands on the sign-in screen with no notice", async () => {
    installShell({ "session.get": { accessToken: GOOD }, "session.refresh": { accessToken: GOOD }, "session.clear": {} });
    await installServer(accessServer());
    await mount("/driver/dashboard");
    expect(await screen.findByText("Driver dashboard")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /logout/i })[0]);
    expect(await screen.findByText("Driver login form")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText("Sign-out not confirmed")).toBeNull();
  });
});

// A sign-out that was interrupted (the page closed while it ran, state "1") or that failed earlier (state "2"),
// then the app is opened again. Through the real public route of each area, never by calling the store directly.
describe("restarting the app with an unfinished sign-out", () => {
  const areas = [
    { area: "driver", path: "/driver/login", form: "Driver login form", dashboard: "Driver dashboard", accessUrl: "access-driver" },
    { area: "admin", path: "/admin/login", form: "Admin login form", dashboard: "Admin dashboard", accessUrl: "access-admin" },
  ];

  for (const { area, path, form, dashboard, accessUrl } of areas) {
    for (const state of ["1", "2"]) {
      const key = `nasa.signOutPending.${area}`;
      const seed = (shell) => {
        localStorage.setItem(key, state);
        // the shell would still hand back a session: it must not be used
        shell.set("session.get", { accessToken: GOOD });
        shell.set("session.refresh", { accessToken: GOOD });
      };

      it(`${area}, saved state ${state}: finishes the sign-out by itself and shows the sign-in form`, async () => {
        const shell = installShell({ "session.clear": {} });
        const net = await installServer(accessServer());
        seed(shell);
        await mount(path);

        expect(await screen.findByText(form)).toBeTruthy();
        await waitFor(() => expect(shell.count("session.clear")).toBe(1));
        await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
        expect(screen.queryByText("Sign-out not confirmed")).toBeNull();
        expect(screen.queryByText(dashboard)).toBeNull();
        expect(net.calls.filter((c) => c.url.includes(accessUrl))).toHaveLength(0);
        expect(shell.count("session.refresh")).toBe(0);
      });

      it(`${area}, saved state ${state}: when the phone still cannot confirm, shows the notice and can retry`, async () => {
        const shell = installShell({ "session.clear": { error: "native_error" } });
        const net = await installServer(accessServer());
        seed(shell);
        await mount(path);

        expect(await screen.findByText(form)).toBeTruthy();
        expect(await screen.findByText("Sign-out not confirmed")).toBeTruthy();
        expect(localStorage.getItem(key)).toBe("2");
        expect(shell.count("session.clear")).toBe(2); // one recovery: one try and its retry
        expect(screen.queryByText(dashboard)).toBeNull();
        expect(net.calls.filter((c) => c.url.includes(accessUrl))).toHaveLength(0);

        shell.set("session.clear", {});
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await waitFor(() => expect(screen.queryByText("Sign-out not confirmed")).toBeNull());
        expect(localStorage.getItem(key)).toBeNull();
        expect(screen.getByText(form)).toBeTruthy();
      });
    }
  }
});

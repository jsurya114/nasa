import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, installShell, removeShell, resetBrowser } from "../../test/fakeShell";

// The real sign-in page, slices, interceptor and session store, with a fake server (and a fake shell for the app).
beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

const mount = async (path = "/login") => {
  const [{ configureStore }, { Provider }, { MemoryRouter, Routes, Route }] = await Promise.all([
    import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom"),
  ]);
  const admin = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const driver = (await import("../../redux/slice/driver/driverSlice.js")).default;
  const language = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: SignIn } = await import("./SignIn.jsx");
  const { default: Launch } = await import("../../routes/Launch.jsx");
  const store = configureStore({ reducer: { admin, driver, language } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<Launch />} />
          <Route path="/login" element={<SignIn />} />
          <Route path="/admin/dashboard" element={<p>Admin home</p>} />
          <Route path="/driver/dashboard" element={<p>Driver home</p>} />
          <Route path="/driver/agreement" element={<p>Agreement page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return store;
};

const fill = (email, password) => {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
};

const ok = (area, extra = {}) => ({
  status: 200,
  data: { area, accessToken: `${area}-access`, refreshToken: `${area}-refresh`, next: `/${area}/dashboard`, ...extra },
});

it("one page signs in an admin or a driver; the server's answer decides where they go", async () => {
  const { calls } = await installServer(async (config) => (JSON.parse(config.data).email === "a@example.test"
    ? ok("admin", { admin: { id: 1, role: "superadmin" } })
    : ok("driver", { driver: { id: 2, agreement_signed: true, timezone: "UTC" } })));
  const store = await mount();
  fill("a@example.test", "pw");
  expect(await screen.findByText("Admin home")).toBeTruthy();
  expect(store.getState().admin.isSuperAdmin).toBe(true);
  expect(localStorage.getItem("adminToken")).toBe("admin-access");
  expect(calls[0].url).toBe("/auth/login");
  cleanup();

  await mount();
  fill("d@example.test", "pw");
  expect(await screen.findByText("Driver home")).toBeTruthy();
  expect(localStorage.getItem("driverRefreshToken")).toBe("driver-refresh");
});

it("a driver without a signed agreement starts at the agreement", async () => {
  await installServer(async () => ok("driver", { next: "/driver/agreement", driver: { id: 2, agreement_signed: false } }));
  await mount();
  fill("d@example.test", "pw");
  expect(await screen.findByText("Agreement page")).toBeTruthy();
});

it("a refusal shows the server's generic message and keeps the person on the page", async () => {
  await installServer(async () => ({ status: 401, data: { code: "invalid_credentials", message: "The email or password is not correct." } }));
  await mount();
  fill("x@example.test", "bad");
  expect((await screen.findByRole("alert")).textContent).toContain("The email or password is not correct.");
  expect(localStorage.getItem("adminToken")).toBeNull();
  expect(localStorage.getItem("driverToken")).toBeNull();
});

it("when one email opens two accounts the person chooses, and the choice is sent to the server", async () => {
  const bodies = [];
  await installServer(async (config) => {
    const body = JSON.parse(config.data);
    bodies.push(body);
    if (!body.area) return { status: 409, data: { code: "choose_account", areas: ["admin", "driver"] } };
    return ok(body.area, { driver: { id: 2, agreement_signed: true } });
  });
  await mount();
  fill("both@example.test", "pw");
  fireEvent.click(await screen.findByRole("button", { name: "Driver account" }));
  expect(await screen.findByText("Driver home")).toBeTruthy();
  expect(bodies.map((b) => b.area)).toEqual([undefined, "driver"]);
  expect(localStorage.getItem("adminToken")).toBeNull();
});

it("in the app the tokens go to the shell, the other area is signed out first, and nothing is written to localStorage", async () => {
  const shell = installShell({ "session.get": { accessToken: null } });
  await installServer(async () => ok("driver", { driver: { id: 2, agreement_signed: true } }));
  await mount();
  fill("d@example.test", "pw");
  expect(await screen.findByText("Driver home")).toBeTruthy();
  const actions = shell.received.map((m) => `${m.action}:${m.payload.area ?? ""}`);
  expect(actions.indexOf("session.clear:admin")).toBeGreaterThan(-1);
  expect(actions.indexOf("session.clear:admin")).toBeLessThan(actions.indexOf("session.set:driver"));
  expect(localStorage.getItem("driverToken")).toBeNull();
  expect(localStorage.getItem("driverRefreshToken")).toBeNull();
});

it("the app's start address goes to the signed-in area, or to sign-in, never to a 404", async () => {
  installShell({ "session.get": (m) => ({ data: { accessToken: m.payload.area === "driver" ? "d" : null } }) });
  await installServer(async () => ({ status: 200, data: {} }));
  await mount("/");
  expect(await screen.findByText("Driver home")).toBeTruthy();
  cleanup();
  await resetBrowser();
  installShell({ "session.get": { accessToken: null } });
  await mount("/");
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
});

it("a stored session the phone cannot check offers Try again instead of the sign-in form", async () => {
  const shell = installShell({ "session.get": { accessToken: null, offline: true } });
  await mount("/");
  expect(await screen.findByText("Can't reach NASA")).toBeTruthy();
  shell.set("session.get", (m) => ({ data: { accessToken: m.payload.area === "admin" ? "a" : null } }));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByText("Admin home")).toBeTruthy());
});

it("the sign-in page links to privacy, terms and support", async () => {
  await mount();
  for (const [name, href] of [["Privacy policy", "/privacy-policy"], ["Terms of use", "/enduser-license/agreements"], ["Help and support", "/support"]]) {
    expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
  }
});

it("the real route table has a start address, one sign-in page and the old sign-in addresses as aliases", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync("src/App.jsx", "utf8");
  expect(app).toMatch(/<Route path="\/" element={<Launch \/>} \/>/);
  expect(app).toMatch(/<Route path="\/login" element={<SignIn \/>} \/>/);
  expect(app).toMatch(/<Route path="\/admin\/login" element={<SignIn \/>} \/>/);
  expect(app).toMatch(/<Route path="\/driver\/login" element={<SignIn \/>} \/>/);
  expect(app).toMatch(/<Route path="\/support" element={<Support \/>} \/>/);
});

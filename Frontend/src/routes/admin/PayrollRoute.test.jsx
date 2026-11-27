import { afterEach, beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

// The Payroll page is for the super admin and the admins the super admin switched Payroll on for. The server decides; the route only follows its answer.
beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

const mount = async ({ superAdmin = false, allowed = false } = {}) => {
  const asked = [];
  await installServer(async (config) => {
    asked.push(config.url);
    if (config.url === "/admin/payroll/access") return { status: 200, data: { allowed } };
    return { status: 200, data: {} };
  });
  const [{ configureStore }, { Provider }, { MemoryRouter, Routes, Route }] = await Promise.all([
    import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom"),
  ]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const { default: PayrollRoute } = await import("./PayrollRoute.jsx");
  const admin = { ...adminReducer(undefined, { type: "init" }), isAuthenticated: true, isSuperAdmin: superAdmin, admin: { id: 2, role: superAdmin ? "superadmin" : "admin" } };
  const store = configureStore({ reducer: { admin: adminReducer }, preloadedState: { admin } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/payroll"]}>
        <Routes>
          <Route element={<PayrollRoute />}><Route path="/admin/payroll" element={<p>Payroll page</p>} /></Route>
          <Route path="/admin/dashboard" element={<p>Dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return asked;
};

it("an admin switched on opens Payroll; one switched off is sent to the dashboard", async () => {
  await mount({ allowed: true });
  expect(await screen.findByText("Payroll page")).toBeTruthy();
  cleanup();
  await mount({ allowed: false });
  expect(await screen.findByText("Dashboard")).toBeTruthy();
});

it("the super admin opens it without asking", async () => {
  const asked = await mount({ superAdmin: true });
  expect(await screen.findByText("Payroll page")).toBeTruthy();
  expect(asked).not.toContain("/admin/payroll/access");
});

it("the real route table puts Payroll behind PayrollRoute, not the super admin guard", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  expect(app).toMatch(/<Route element={<PayrollRoute \/>}>\s*<Route path="\/admin\/payroll" element={<AdminPayroll \/>} \/>\s*<\/Route>/);
  const superBlock = app.slice(app.indexOf("<Route element={<SuperAdminRoute />}>"), app.indexOf("</Route>", app.indexOf("<Route element={<SuperAdminRoute />}>")));
  expect(superBlock).not.toContain('path="/admin/payroll"');
});

import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import SuperAdminRoute from "./SuperAdminRoute.jsx";
import Nav from "../../reuse/Nav.jsx";

afterEach(cleanup);
const store = (isSuperAdmin) => configureStore({ reducer: { admin: (state = { isSuperAdmin }) => state } });
const open = (path, isSuperAdmin) => render(
  <Provider store={store(isSuperAdmin)}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/dashboard" element={<p>Dashboard page</p>} />
        <Route element={<SuperAdminRoute />}>
          <Route path="/admin/payroll" element={<p>Payroll page</p>} />
          <Route path="/admin/pay-runs" element={<p>Pay runs page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  </Provider>,
);

it("a super admin opens payroll and pay runs", () => {
  open("/admin/payroll", true);
  expect(screen.getByText("Payroll page")).toBeTruthy();
  cleanup();
  open("/admin/pay-runs", true);
  expect(screen.getByText("Pay runs page")).toBeTruthy();
});

it("any other admin is sent to the dashboard", () => {
  open("/admin/payroll", false);
  expect(screen.getByText("Dashboard page")).toBeTruthy();
  expect(screen.queryByText("Payroll page")).toBeNull();
  cleanup();
  open("/admin/pay-runs", false);
  expect(screen.getByText("Dashboard page")).toBeTruthy();
});

const navLinks = (isSuperAdmin) => {
  render(<Provider store={store(isSuperAdmin)}><MemoryRouter><Nav /></MemoryRouter></Provider>);
  return [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
};

it("the menu lists Payroll and Pay runs for the super admin only", () => {
  const forAdmin = navLinks(false);
  expect(forAdmin).toContain("/admin/dashboard");
  expect(forAdmin).not.toContain("/admin/payroll");
  expect(forAdmin).not.toContain("/admin/pay-runs");
  cleanup();
  const forSuper = navLinks(true);
  expect(forSuper).toContain("/admin/payroll");
  expect(forSuper).toContain("/admin/pay-runs");
});

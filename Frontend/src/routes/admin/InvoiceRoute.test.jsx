import { afterEach, beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";
import InvoiceRoute from "./InvoiceRoute.jsx";
import Nav from "../../reuse/Nav.jsx";

// Invoices are for the super admin and for the admins the super admin switched them on for. The server decides; the page and the menu only follow its answer.
beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);
const store = (isSuperAdmin) => configureStore({ reducer: { admin: (state = { isSuperAdmin }) => state } });
const serve = async (answer) => {
  const asked = [];
  await installServer(async (config) => {
    asked.push(config.url);
    if (config.url === "/admin/invoices/access") return answer();
    return { status: 200, data: {} };
  });
  return asked;
};
const open = (isSuperAdmin) => render(
  <Provider store={store(isSuperAdmin)}>
    <MemoryRouter initialEntries={["/admin/invoices"]}>
      <Routes>
        <Route path="/admin/dashboard" element={<p>Dashboard page</p>} />
        <Route element={<InvoiceRoute />}>
          <Route path="/admin/invoices" element={<p>Invoices page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  </Provider>,
);

it("the super admin opens Invoices without asking the server", async () => {
  const asked = await serve(() => ({ status: 200, data: { allowed: true } }));
  open(true);
  expect(screen.getByText("Invoices page")).toBeTruthy();
  expect(asked).toEqual([]);
});

it("an admin with Invoices switched on opens the page", async () => {
  await serve(() => ({ status: 200, data: { allowed: true } }));
  open(false);
  expect(await screen.findByText("Invoices page")).toBeTruthy();
});

it("an admin without access, or when the answer cannot be had, is sent to the dashboard", async () => {
  await serve(() => ({ status: 200, data: { allowed: false } }));
  open(false);
  expect(await screen.findByText("Dashboard page")).toBeTruthy();
  expect(screen.queryByText("Invoices page")).toBeNull();
  cleanup();
  await serve(() => ({ status: 500, data: { message: "no" } }));
  open(false);
  expect(await screen.findByText("Dashboard page")).toBeTruthy();
});

const navLinks = () => [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const showMenu = (isSuperAdmin) => render(<Provider store={store(isSuperAdmin)}><MemoryRouter><Nav /></MemoryRouter></Provider>);

it("the menu lists Invoices for the super admin and for an admin who has access, and for no one else", async () => {
  await serve(() => ({ status: 200, data: { allowed: true } }));
  showMenu(true);
  expect(navLinks()).toContain("/admin/invoices");
  cleanup();
  showMenu(false);
  await waitFor(() => expect(navLinks()).toContain("/admin/invoices"));
  expect(navLinks()).not.toContain("/admin/payroll");
  cleanup();
  await serve(() => ({ status: 200, data: { allowed: false } }));
  showMenu(false);
  await waitFor(() => expect(navLinks()).toContain("/admin/dashboard"));
  expect(navLinks()).not.toContain("/admin/invoices");
});

it("the real route table puts the Invoices page behind the Invoices guard, outside the super admin guard", () => {
  const app = readFileSync("src/App.jsx", "utf8") /* the tests run from the Frontend folder */;
  const page = app.indexOf('path="/admin/invoices"');
  const superGuard = app.indexOf("<Route element={<SuperAdminRoute />}>");
  const superClose = app.indexOf("</Route>", superGuard);
  const guard = app.indexOf("<Route element={<InvoiceRoute />}>");
  expect(app.match(/path="\/admin\/invoices"/g)).toHaveLength(1);
  expect(guard).toBeGreaterThan(-1);
  expect(page).toBeGreaterThan(guard);
  expect(page).toBeLessThan(app.indexOf("</Route>", guard));
  expect(page > superClose || page < superGuard).toBe(true);
});

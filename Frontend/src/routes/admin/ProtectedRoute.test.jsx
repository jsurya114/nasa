import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import ProtectedRoute from "./ProtectedRoute.jsx";

// The sign-in check itself is not under test: it is replaced by a plain action that does nothing.
vi.mock("../../redux/slice/admin/adminSlice", () => ({ accessAdminUser: () => ({ type: "test/noop" }) }));
vi.mock("../../native/PushSetup.jsx", () => ({ default: () => null }));

afterEach(cleanup);
const open = (admin) => render(
  <Provider store={configureStore({ reducer: { admin: (state = admin) => state } })}>
    <MemoryRouter initialEntries={["/admin/double-stop"]}>
      <Routes>
        <Route path="/admin/login" element={<p>Login page</p>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/admin/double-stop" element={<p>Double stop page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  </Provider>,
);

it("shows Loading, not an empty screen, while the sign-in check is running", () => {
  open({ isAuthenticated: null, loading: true, authCheckFailed: false });
  expect(screen.getByText("Loading, please wait...")).toBeTruthy();
  expect(screen.queryByText("Double stop page")).toBeNull();
});

it("shows Loading while the sign-in state is still unknown", () => {
  open({ isAuthenticated: null, loading: false, authCheckFailed: false });
  expect(screen.getByText("Loading, please wait...")).toBeTruthy();
});

it("opens the page for a signed-in admin and the login page for a signed-out one", () => {
  open({ isAuthenticated: true, loading: false, authCheckFailed: false });
  expect(screen.getByText("Double stop page")).toBeTruthy();
  cleanup();
  open({ isAuthenticated: false, loading: false, authCheckFailed: false });
  expect(screen.getByText("Login page")).toBeTruthy();
});

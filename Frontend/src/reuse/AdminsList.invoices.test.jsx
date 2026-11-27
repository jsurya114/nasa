import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../test/fakeShell";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("../utils/toast", () => ({ toast }));

// The super admin chooses which ordinary admins can use Invoices: one switch per admin, saved on the server; a super admin shows "Always".
const ANN = { id: 9, admin_name: "Ann Admin", admin_email: "ann@example.com", admin_role: "admin", is_active: true, cities: "Test City", can_use_invoices: false };
const BOSS = { id: 4, admin_name: "Bea Boss", admin_email: "bea@example.com", admin_role: "superadmin", is_active: true, cities: "", can_use_invoices: false };

const mount = async (patch, ann = ANN) => {
  const state = { patches: [], bodies: [] };
  await installServer(async (config) => {
    if (config.url === "/admin/get-admins") return { status: 200, data: { admins: [ann, BOSS], page: 1, totalPages: 1 } };
    if (config.url.startsWith("/admin/toggle-admin-")) { state.patches.push(config.url); state.bodies.push(JSON.parse(config.data)); return patch(); }
    return { status: 200, data: {} };
  });
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const adminReducer = (await import("../redux/slice/admin/adminSlice.js")).default;
  const usersReducer = (await import("../redux/slice/admin/userLoadSlice.js")).default;
  const { default: AdminsList } = await import("./AdminsList.jsx");
  const signedIn = { ...adminReducer(undefined, { type: "init" }), admin: { id: 1, role: "superadmin" }, isSuperAdmin: true, isAuthenticated: true };
  const store = configureStore({ reducer: { admin: adminReducer, users: usersReducer }, preloadedState: { admin: signedIn } });
  render(<Provider store={store}><AdminsList onEdit={() => {}} /></Provider>);
  await screen.findByText("Ann Admin");
  return state;
};

beforeEach(async () => { removeShell(); await resetBrowser(); Object.values(toast).forEach((f) => f.mockClear()); });
afterEach(cleanup);

it("an ordinary admin has a switch, off at first; a super admin shows Always instead", async () => {
  await mount(() => ({ status: 200, data: {} }));
  const ann = screen.getByRole("checkbox", { name: "Invoices for Ann Admin" });
  expect(ann.checked).toBe(false);
  const bossRow = screen.getByText("Bea Boss").closest("tr");
  expect(within(bossRow).getAllByText("Always")).toHaveLength(2); // Invoices and Payroll
  expect(within(bossRow).queryByRole("checkbox", { name: /Invoices for|Payroll for/ })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Payroll for Ann Admin" }).checked).toBe(false);
});

it("the Payroll switch is saved on its own route, with the wanted state, and leaves Invoices as it was", async () => {
  const s = await mount(() => ({ status: 200, data: { message: "Payroll switched on", data: { id: 9, can_use_payroll: true } } }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Payroll for Ann Admin" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Payroll for Ann Admin" }).checked).toBe(true));
  expect(s.patches).toEqual(["/admin/toggle-admin-payroll/9"]);
  expect(s.bodies).toEqual([{ enabled: true }]);
  expect(toast.success).toHaveBeenCalledWith("Payroll switched on");
  expect(screen.getByRole("checkbox", { name: "Invoices for Ann Admin" }).checked).toBe(false);
});

it("switching it on is saved on the server and shown as saved; a failure leaves the switch as it was and says so", async () => {
  const s = await mount(() => ({ status: 200, data: { message: "Invoices switched on", data: { id: 9, can_use_invoices: true } } }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Invoices for Ann Admin" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Invoices for Ann Admin" }).checked).toBe(true));
  expect(s.patches).toEqual(["/admin/toggle-admin-invoices/9"]);
  expect(s.bodies).toEqual([{ enabled: true }]); // the wanted state is sent, not a flip
  expect(toast.success).toHaveBeenCalledWith("Invoices switched on");
  cleanup();
  await mount(() => ({ status: 500, data: { message: "Server error" } }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Invoices for Ann Admin" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Server error"));
  expect(screen.getByRole("checkbox", { name: "Invoices for Ann Admin" }).checked).toBe(false);
});

it("switching it off sends the wanted state, off, so a repeated request cannot switch it back on", async () => {
  const s = await mount(() => ({ status: 200, data: { message: "Invoices switched off", data: { id: 9, can_use_invoices: false } } }));
  const box = () => screen.getByRole("checkbox", { name: "Invoices for Ann Admin" });
  fireEvent.click(box());
  await waitFor(() => expect(box().checked).toBe(false));
  expect(s.bodies).toEqual([{ enabled: true }]); // it was off, so the wanted state is on
  cleanup();
  const t = await mount(() => ({ status: 200, data: { message: "Invoices switched off", data: { id: 9, can_use_invoices: false } } }), { ...ANN, can_use_invoices: true });
  expect(screen.getByRole("checkbox", { name: "Invoices for Ann Admin" }).checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Invoices for Ann Admin" }));
  await waitFor(() => expect(t.bodies).toEqual([{ enabled: false }]));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Invoices for Ann Admin" }).checked).toBe(false));
});

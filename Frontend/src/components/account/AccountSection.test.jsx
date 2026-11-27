import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

beforeEach(async () => { removeShell(); await resetBrowser(); await installServer(async () => ({ status: 200, data: {} })); });
afterEach(cleanup);

const hrefsIn = (region) => within(region).getAllByRole("link").map((a) => a.getAttribute("href"));

const mountAdminProfile = async (admin) => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([
    import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom"),
  ]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const language = (await import("../../redux/slice/languageSlice.js")).default;
  const { signedIn } = await import("../../redux/slice/admin/adminSlice.js");
  const { default: AdminProfile } = await import("../Admin/Profile.jsx");
  const store = configureStore({ reducer: { admin: adminReducer, language } });
  store.dispatch(signedIn(admin));
  render(<Provider store={store}><MemoryRouter><AdminProfile /></MemoryRouter></Provider>);
};

it("a super admin's profile shows who they are and every account link, deletion requests included", async () => {
  await mountAdminProfile({ id: 1, name: "Test Owner", email: "owner@example.test", role: "superadmin" });
  expect(screen.getByRole("heading", { name: "My profile" })).toBeTruthy();
  expect(screen.getAllByText("Test Owner").length).toBeGreaterThan(0);
  expect(screen.getByText("owner@example.test")).toBeTruthy();
  expect(screen.getByText("Super admin")).toBeTruthy();
  const account = screen.getByRole("region", { name: "Account" });
  expect(hrefsIn(account)).toEqual(["/support", "/privacy-policy", "/admin/deletion-requests", "/admin/delete-account"]);
});

it("a city admin's profile has no deletion requests link", async () => {
  await mountAdminProfile({ id: 7, name: "Test City Admin", email: "city@example.test", role: "admin" });
  expect(screen.getByText("City admin")).toBeTruthy();
  expect(hrefsIn(screen.getByRole("region", { name: "Account" }))).toEqual(["/support", "/privacy-policy", "/admin/delete-account"]);
});

it("the admin header no longer carries the account links; its name opens the profile", async () => {
  await mountAdminProfile({ id: 7, name: "Test City Admin", email: "city@example.test", role: "admin" });
  expect(document.querySelector("header [aria-label='Account']")).toBeNull();
  expect(screen.getAllByRole("button", { name: "My profile: Test City Admin" }).length).toBeGreaterThan(0);
});

it("the driver's account section links to help, privacy and the driver's Delete account", async () => {
  const { MemoryRouter } = await import("react-router-dom");
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const language = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: AccountSection } = await import("./AccountSection.jsx");
  render(<Provider store={configureStore({ reducer: { language } })}><MemoryRouter><AccountSection area="driver" /></MemoryRouter></Provider>);
  expect(hrefsIn(screen.getByRole("region", { name: "Account" }))).toEqual(["/support", "/privacy-policy", "/driver/delete-account"]);
});

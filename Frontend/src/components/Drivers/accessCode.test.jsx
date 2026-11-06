import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../reuse/driver/Header", () => ({ default: () => null }));
vi.mock("../../reuse/driver/Nav", () => ({ default: () => null }));

// The driver's Access codes page: a driver can look codes up, but cannot add one. Admins add them from their own page.
const CODE = { id: 1, zip_code: "70501", address: "12 Test Street", access_code: "4321", image_url1: null, image_url2: null, image_url3: null, created_at: "2026-11-01T00:00:00Z" };

const mount = async () => {
  const calls = [];
  await installServer(async (config) => {
    calls.push(`${config.method} ${config.url}`);
    if (config.url === "/driver/access-codes/list") return { status: 200, data: { data: [CODE], pagination: { total: 1, page: 1, limit: 10, totalPages: 1, hasMore: false } } };
    return { status: 200, data: {} };
  });
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const driverAccessCodes = (await import("../../redux/slice/driver/driverAccessCodeSlice.js")).default;
  const store = configureStore({ reducer: { driverAccessCodes, language: (s = { currentLanguage: "en" }) => s } });
  const { default: DriverAccessCodePage } = await import("./accessCode.jsx");
  render(<Provider store={store}><DriverAccessCodePage /></Provider>);
  return calls;
};

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

it("shows the saved access codes and has no form to add one", async () => {
  const calls = await mount();
  await waitFor(() => expect(screen.getAllByText("12 Test Street").length).toBeGreaterThan(0));
  expect(document.querySelector("form")).toBeNull();
  expect(document.querySelector("input[type=file]")).toBeNull();
  expect(screen.queryByRole("button", { name: /save access code/i })).toBeNull();
  expect(screen.queryByText(/add new access code/i)).toBeNull();
  expect(calls.filter((c) => c.startsWith("post"))).toEqual([]);
});

it("the driver slice has no create action any more", async () => {
  const slice = await import("../../redux/slice/driver/driverAccessCodeSlice.js");
  expect(slice.createAccessCode).toBeUndefined();
  expect(slice.fetchAccessCodes).toBeTypeOf("function");
});

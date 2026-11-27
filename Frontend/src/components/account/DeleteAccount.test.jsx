import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

beforeEach(async () => { removeShell(); await resetBrowser(); localStorage.setItem("driverToken", "t"); });
afterEach(cleanup);

const mount = async () => {
  const { default: DeleteAccount } = await import("./DeleteAccount.jsx");
  render(<MemoryRouter><DeleteAccount area="driver" /></MemoryRouter>);
};

it("explains what is removed and kept, needs the password and a confirmation, and shows the request only after the server has it", async () => {
  let request = null;
  const sent = [];
  await installServer(async (config) => {
    if (config.method === "get") return { status: 200, data: { request, completionDays: 30 } };
    sent.push(JSON.parse(config.data));
    request = { status: "requested", requestedAt: "2026-11-27T10:00:00Z", dueBy: "2026-12-27T10:00:00Z" };
    return { status: 200, data: { request, completionDays: 30 } };
  });
  await mount();
  expect(await screen.findByText("Kept by NASA")).toBeTruthy();
  const button = screen.getByRole("button", { name: "Request account deletion" });
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "pw" } });
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(button);
  expect(await screen.findByText("Deletion requested")).toBeTruthy();
  expect(sent).toEqual([{ password: "pw" }]);
  expect(screen.getByRole("button", { name: "Withdraw request" })).toBeTruthy();
});

it("a wrong password or a lost connection says so and claims nothing", async () => {
  await installServer(async (config) => (config.method === "get"
    ? { status: 200, data: { request: null, completionDays: 30 } }
    : { status: 403, data: { code: "wrong_password", message: "The password is not correct." } }));
  await mount();
  fireEvent.change(await screen.findByLabelText("Your password"), { target: { value: "bad" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Request account deletion" }));
  expect(await screen.findByText("The password is not correct.")).toBeTruthy();
  expect(screen.queryByText("Deletion requested")).toBeNull();
});

it("the delete page stays open for a driver who has not signed the agreement", async () => {
  const { readFileSync } = await import("node:fs");
  const guard = readFileSync("src/routes/driver/DProtectedRoutes.jsx", "utf8");
  expect(guard.indexOf("if (location.pathname === ALWAYS_OPEN) return <Outlet />;")).toBeLessThan(guard.indexOf("agreement_signed === false"));
  expect(readFileSync("src/components/Drivers/everee/SetupLock.jsx", "utf8")).toMatch(/pathname === "\/driver\/delete-account"\) return children/);
  const app = readFileSync("src/App.jsx", "utf8");
  expect(app).toMatch(/path="\/driver\/delete-account"/);
  expect(app).toMatch(/path="\/admin\/delete-account"/);
});

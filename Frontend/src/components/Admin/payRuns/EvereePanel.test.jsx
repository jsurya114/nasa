import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../../test/fakeShell";

// The Everee connection panel (#31) with made-up answers. Nothing leaves this machine.
const NOT_SET_UP = { configured: false, environment: "sandbox", tenantId: null, problems: ["EVEREE_API_TOKEN is not set", "EVEREE_TENANT_ID is not set"] };
const SET_UP = { configured: true, environment: "sandbox", tenantId: "4321", problems: [] };

const startServer = async ({ status = SET_UP, check = { ...SET_UP, ok: true, reason: null, payCodes: [{ code: "C", label: "Contractor pay", type: "EARNING" }], requestId: "req-1" } } = {}) => {
  const state = { calls: [] };
  await installServer(async (config) => {
    state.calls.push(`${config.method} ${config.url}`);
    if (config.url === "/admin/payroll/everee/status") return typeof status === "number" ? { status, data: { message: "no" } } : { status: 200, data: status };
    if (config.url === "/admin/payroll/everee/check") return { status: 200, data: check };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async () => {
  const { default: EvereePanel } = await import("./EvereePanel.jsx");
  return render(<EvereePanel />);
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("Everee panel", () => {
  it("says what is missing and offers no test when the backend is not set up", async () => {
    await startServer({ status: NOT_SET_UP });
    await mount();
    expect(await screen.findByText("EVEREE_API_TOKEN is not set")).toBeTruthy();
    expect(screen.getByText("Sandbox")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
  });

  it("tests the connection on request and lists the pay codes", async () => {
    const server = await startServer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Connected\. Everee accepted the token/)).toBeTruthy();
    expect(screen.getByText(/Pay codes: Contractor pay/)).toBeTruthy();
    expect(screen.getByText(/request ID \(for support\): req-1/)).toBeTruthy();
    expect(server.calls.filter((c) => c === "post /admin/payroll/everee/check")).toHaveLength(1);
  });

  it("shows the reason when Everee refuses, and labels a production setup", async () => {
    await startServer({ status: { ...SET_UP, environment: "production" }, check: { ...SET_UP, ok: false, reason: "Everee refused the token", payCodes: [], requestId: "req-401" } });
    await mount();
    expect(await screen.findByText("Production")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Not connected: Everee refused the token/)).toBeTruthy();
    expect(screen.queryByText(/Connected\./)).toBeNull();
  });

  it("says so when the status cannot be loaded", async () => {
    await startServer({ status: 403 });
    await mount();
    expect(await screen.findByText("The Everee status could not be loaded.")).toBeTruthy();
  });
});

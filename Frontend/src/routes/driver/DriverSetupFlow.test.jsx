import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

// The signed-in driver guard with the payment setup: agreement -> payment setup -> work, with no redirect loop. Real guard, slices and provider; fake server.
const status = (over = {}) => ({ state: "not-started", required: true, canStart: true, blockedBy: null, enforced: true, driverType: "LOCAL", agreementSigned: true, needsFromDriver: ["homeAddress"], ...over });

const serve = async ({ signed, setup }) => {
  const state = { signed, setup, calls: [] };
  await installServer(async (config) => {
    state.calls.push(`${config.method} ${config.url}`);
    if (config.url.includes("/refresh-token")) return { status: 401, data: {} };
    if (config.url === "/driver/access-driver") return { status: 200, data: { driver: { id: 1, name: "Dee Test", agreement_signed: state.signed } } };
    if (config.url === "/driver/agreement") { state.signed = true; state.setup = status(); return { status: 200, data: { message: "ok" } }; }
    if (config.url === "/driver/everee/status") return { status: 200, data: state.setup };
    if (config.url.startsWith("/driver/language/")) return { status: 200, data: { preferredLanguage: "en" } };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async (path) => {
  const [{ configureStore }, { Provider }, { MemoryRouter, Routes, Route, useLocation }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const driverSlice = (await import("../../redux/slice/driver/driverSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: DProtectRoutes } = await import("./DProtectedRoutes.jsx");
  const { default: DriverAgreement } = await import("../../components/Drivers/DriverAgreement.jsx");
  const { default: PaymentSetup } = await import("../../components/Drivers/PaymentSetup.jsx");
  const trail = [];
  const Where = () => { const { pathname } = useLocation(); trail.push(pathname); return null; };
  const store = configureStore({ reducer: { driver: driverSlice, language: languageReducer } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route element={<DProtectRoutes />}>
            <Route path="/driver/agreement" element={<DriverAgreement />} />
            <Route path="/driver/payment-setup" element={<PaymentSetup />} />
            <Route path="/driver/dashboard" element={<p>Driver dashboard</p>} />
            <Route path="/driver/pay" element={<p>Driver pay</p>} />
          </Route>
          <Route path="/driver/login" element={<p>Login</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return trail;
};

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("the way in for a driver", () => {
  it("a driver who has not signed is sent to the agreement from anywhere", async () => {
    await serve({ signed: false, setup: status({ blockedBy: "agreement", canStart: false, agreementSigned: false }) });
    await mount("/driver/dashboard");
    expect(await screen.findByRole("button", { name: /agreement|submit|sign/i })).toBeTruthy();
  });

  it("a new Local driver signs, lands on the payment setup (not the dashboard), and the old 'sign first' state is gone", async () => {
    const server = await serve({ signed: false, setup: status({ blockedBy: "agreement", canStart: false, agreementSigned: false }) });
    await mount("/driver/agreement");
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Dee Test" } });
    fireEvent.change(document.querySelector("input[name=joining_date]"), { target: { value: "2026-11-01" } });
    fireEvent.click(document.querySelector("input[name=agreed]"));
    fireEvent.submit(document.querySelector("form"));
    expect(await screen.findByRole("button", { name: "Start setup" })).toBeTruthy();
    expect(screen.queryByText("Driver dashboard")).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign the agreement first" })).toBeNull();
    expect(server.calls.filter((c) => c === "get /driver/everee/status").length).toBeGreaterThanOrEqual(2); // read again after signing
  });

  it("a signed driver who opens the agreement is sent on, and a driver with nothing to set up ends on the dashboard, without a loop", async () => {
    await serve({ signed: true, setup: status({ state: "not-required", required: false, canStart: false, driverType: "DESI" }) });
    const trail = await mount("/driver/agreement");
    expect(await screen.findByText("Driver dashboard")).toBeTruthy();
    expect(trail.length).toBeLessThan(8);
    expect(trail.at(-1)).toBe("/driver/dashboard");
    expect(trail.filter((p) => p === "/driver/agreement").length).toBe(1);
  });

  it("a signed Local driver with an unfinished setup who opens the agreement lands on the setup page and stays there", async () => {
    await serve({ signed: true, setup: status({ state: "in-progress", canStart: false }) });
    const trail = await mount("/driver/agreement");
    expect(await screen.findByRole("button", { name: "Continue setup" })).toBeTruthy();
    expect(trail.at(-1)).toBe("/driver/payment-setup");
    await waitFor(() => expect(trail.length).toBeLessThan(8));
  });

  it("the menu has a Payment setup entry only while the setup is unfinished", async () => {
    await serve({ signed: true, setup: status({ state: "in-progress", canStart: false, enforced: false }) });
    await mount("/driver/payment-setup");
    await screen.findByRole("button", { name: "Continue setup" });
    expect(document.querySelector('a[href="/driver/payment-setup"]')).not.toBeNull();
    cleanup();
    await serve({ signed: true, setup: status({ state: "complete", required: false, canStart: false }) });
    await mount("/driver/payment-setup");
    await screen.findByText("Your payment setup is complete.");
    expect(document.querySelector('nav a[href="/driver/payment-setup"]')).toBeNull();
  });

  it("an unfinished Local driver is locked out of every other page and told to use the same email", async () => {
    await serve({ signed: true, setup: status({ state: "in-progress", canStart: false }) });
    const trail = await mount("/driver/pay");
    expect(await screen.findByRole("button", { name: "Continue setup" })).toBeTruthy();
    expect(screen.queryByText("Driver pay")).toBeNull();
    await waitFor(() => expect(trail.at(-1)).toBe("/driver/payment-setup"));
    expect(screen.getByText(/same email address you use to sign in/i)).toBeTruthy();
    expect(document.querySelector("nav")).toBeNull(); // no menu to leave by
  });

  it("without enforcement the driver is only reminded, not locked", async () => {
    await serve({ signed: true, setup: status({ state: "in-progress", canStart: false, enforced: false }) });
    await mount("/driver/pay");
    expect(await screen.findByText("Driver pay")).toBeTruthy();
  });

  it("a driver whose setup is complete reaches every page", async () => {
    await serve({ signed: true, setup: status({ state: "complete", required: false, canStart: false }) });
    await mount("/driver/pay");
    expect(await screen.findByText("Driver pay")).toBeTruthy();
  });

  it("a driver who has not signed, or is still to be classified, is not locked by the setup", async () => {
    await serve({ signed: true, setup: status({ state: "classification-required", canStart: false }) });
    await mount("/driver/pay");
    expect(await screen.findByText("Driver pay")).toBeTruthy();
  });

  it("when the setup status cannot be read the pages stay open (the server gate still holds work)", async () => {
    await installServer(async (config) => {
      if (config.url === "/driver/everee/status") return { status: 500, data: {} };
      if (config.url === "/driver/access-driver") return { status: 200, data: { driver: { id: 1, name: "Dee Test", agreement_signed: true } } };
      return { status: 200, data: {} };
    });
    await mount("/driver/pay");
    expect(await screen.findByText("Driver pay")).toBeTruthy();
  });
});

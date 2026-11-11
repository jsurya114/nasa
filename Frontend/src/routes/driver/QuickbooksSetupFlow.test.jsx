import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

// A new Desi driver's QuickBooks setup through the real driver guard, with a fake server. Nothing leaves this machine.
const qbStatus = (over = {}) => ({ state: "not-started", required: true, canStart: true, blockedBy: null, enforced: true, driverType: "DESI", agreementSigned: true, needsFromDriver: ["legalName"], ...over });
const everee = { state: "not-required", required: false, canStart: false, blockedBy: null, enforced: true, driverType: "DESI", agreementSigned: true, needsFromDriver: [] };

const serve = async ({ qb, startAnswer }) => {
  const state = { qb, posts: [] };
  await installServer(async (config) => {
    if (config.url.includes("/refresh-token")) return { status: 401, data: {} };
    if (config.url === "/driver/access-driver") return { status: 200, data: { driver: { id: 1, name: "Dee Test", agreement_signed: true } } };
    if (config.url === "/driver/everee/status") return { status: 200, data: everee };
    if (config.url === "/driver/quickbooks/status") return { status: 200, data: state.qb };
    if (config.url === "/driver/quickbooks/onboarding") {
      state.posts.push(typeof config.data === "string" ? JSON.parse(config.data) : config.data);
      if (startAnswer) return startAnswer(state);
      state.qb = qbStatus({ state: "complete", required: false, canStart: false });
      return { status: 200, data: state.qb };
    }
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
  const { default: QuickbooksSetup } = await import("../../components/Drivers/QuickbooksSetup.jsx");
  const trail = [];
  const Where = () => { const { pathname } = useLocation(); trail.push(pathname); return null; };
  const store = configureStore({ reducer: { driver: driverSlice, language: languageReducer } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route element={<DProtectRoutes />}>
            <Route path="/driver/quickbooks-setup" element={<QuickbooksSetup />} />
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
const fill = (labelPattern, value) => fireEvent.change(screen.getByLabelText(labelPattern), { target: { value } });
const fillAll = (over = {}) => {
  fill(/Full legal name/, "Dee Test"); fill(/Street address/, "1 Test Street"); fill(/^City/, "Austin"); fill(/State/, "tx"); fill(/ZIP code/, "78701"); fill(/Tax ID/, over.taxId ?? "123-45-6789");
  if (over.certify !== false) fireEvent.click(screen.getByRole("checkbox"));
};

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("a new Desi driver's QuickBooks setup", () => {
  it("is locked to the setup page, with no menu, and told which email is used", async () => {
    await serve({ qb: qbStatus() });
    const trail = await mount("/driver/pay");
    expect(await screen.findByRole("button", { name: "Save my details" })).toBeTruthy();
    expect(screen.queryByText("Driver pay")).toBeNull();
    await waitFor(() => expect(trail.at(-1)).toBe("/driver/quickbooks-setup"));
    expect(screen.getByText(/same address everywhere/)).toBeTruthy();
    expect(document.querySelector("nav")).toBeNull();
    expect((screen.getByLabelText(/Tax ID/)).type).toBe("password");
  });

  it("sends the details once, clears the tax ID from the page, and opens the app when QuickBooks confirms", async () => {
    const server = await serve({ qb: qbStatus() });
    await mount("/driver/quickbooks-setup");
    await screen.findByRole("button", { name: "Save my details" });
    fillAll();
    fireEvent.click(screen.getByRole("button", { name: "Save my details" }));
    expect(await screen.findByText("Your payment setup is complete.")).toBeTruthy();
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]).toMatchObject({ legalName: "Dee Test", state: "tx", taxId: "123-45-6789", certified: true });
    expect(document.body.innerHTML.includes("123-45-6789")).toBe(false);
    fireEvent.click(within(document.querySelector("main")).getByRole("link", { name: /dashboard/i }));
    expect(await screen.findByText("Driver dashboard")).toBeTruthy();
  });

  it("marks the fields the server names, keeps the driver on the form, and a review answer says to contact the admin", async () => {
    await serve({ qb: qbStatus(), startAnswer: () => ({ status: 400, data: { code: "missing_fields", missing: ["taxId"] } }) });
    await mount("/driver/quickbooks-setup");
    await screen.findByRole("button", { name: "Save my details" });
    fillAll({ taxId: "12" });
    fireEvent.click(screen.getByRole("button", { name: "Save my details" }));
    expect(await screen.findByText(/Some details are missing/)).toBeTruthy();
    expect(screen.getByLabelText(/Tax ID/).getAttribute("aria-invalid")).toBe("true");
    cleanup();
    await serve({ qb: qbStatus(), startAnswer: () => ({ status: 409, data: { code: "needs_review", message: "provider words that must not be shown" } }) });
    await mount("/driver/quickbooks-setup");
    await screen.findByRole("button", { name: "Save my details" });
    fillAll();
    fireEvent.click(screen.getByRole("button", { name: "Save my details" }));
    expect(await screen.findByText(/Your admin needs to check your record/)).toBeTruthy();
    expect(screen.queryByText(/provider words/)).toBeNull();
  });

  it("without enforcement the driver is not locked and has a menu entry; a Local driver or a finished setup is never sent here", async () => {
    await serve({ qb: qbStatus({ enforced: false }) });
    await mount("/driver/pay");
    expect(await screen.findByText("Driver pay")).toBeTruthy();
    cleanup();
    await serve({ qb: qbStatus({ state: "complete", required: false, canStart: false }) });
    await mount("/driver/pay");
    expect(await screen.findByText("Driver pay")).toBeTruthy();
    cleanup();
    await serve({ qb: qbStatus({ state: "not-required", required: false, canStart: false, driverType: "LOCAL" }) });
    await mount("/driver/quickbooks-setup");
    expect(await screen.findByText("Driver dashboard")).toBeTruthy();
  });

  it("a driver whose new email or phone waits for an admin sees that, not the form", async () => {
    await serve({ qb: qbStatus({ state: "needs-review", canStart: false, blockedBy: "contact_changed", needsFromDriver: [] }) });
    await mount("/driver/pay");
    expect(await screen.findByText(/Your admin will check your new email or phone/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save my details" })).toBeNull();
  });

  it("a driver who has not signed the agreement is not locked here", async () => {
    await serve({ qb: qbStatus({ blockedBy: "agreement", canStart: false, agreementSigned: false }) });
    await mount("/driver/pay");
    expect(await screen.findByText("Driver pay")).toBeTruthy();
  });
});

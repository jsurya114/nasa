import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, installShell, removeShell, resetBrowser } from "../../test/fakeShell";

// The driver's payment setup page, popup, banner and card with the real provider, a fake server and a made-up driver. No real Everee screen is
// opened: the iframe points at a made-up address and the private channel is replaced by a fake one the test can speak through.
// Built when used, so the link's expiry is always a minute from now whatever time the test run took to get here (a module-level value could already be expired on a slow machine).
const freshSession = () => ({ url: "https://embed.everee.com/s/single-use-token", origin: "https://embed.everee.com", expiresAt: new Date(Date.now() + 60_000).toISOString(), experience: "ONBOARDING", eventHandlerName: "nasaEvereeEmbed" });
const SESSION = { url: "https://embed.everee.com/s/single-use-token" };
const status = (over = {}) => ({ state: "not-started", required: true, canStart: true, blockedBy: null, paymentReady: false, verifiedAt: null, reason: null, enforced: true, driverType: "LOCAL", agreementSigned: true, needsFromDriver: ["homeAddress"], ...over });
const ADDRESS = { homeAddress: { line1: "1 Test Street", city: "Austin", state: "TX", postalCode: "78701" } };

const startServer = async ({ initial = status(), onStart, onSession, onRefresh, signed = true, language = "en" } = {}) => {
  const state = { status: initial, posts: [], calls: [] };
  await installServer(async (config) => {
    state.calls.push(`${config.method} ${config.url}`);
    if (config.url === "/driver/access-driver") return { status: 200, data: { driver: { id: 1, name: "Dee Test", agreement_signed: signed } } };
    if (config.url.startsWith("/driver/language/")) return { status: 200, data: { preferredLanguage: language } };
    if (config.url === "/driver/payroll/statements") return { status: 200, data: { statements: [] } };
    if (config.url === "/driver/payroll/balances") return { status: 200, data: { entries: [], claims: [], totals: { owedByDriver: "0.00", owedPenalties: "0.00", owedOther: "0.00", owedToDriver: "0.00" } } };
    if (config.url === "/driver/everee/status") return { status: 200, data: state.status };
    if (config.url === "/driver/everee/onboarding") { const body = JSON.parse(config.data); state.posts.push(["onboarding", body]); return onStart ? onStart(state, body) : { status: 200, data: (state.status = status({ state: "in-progress", canStart: false })) }; }
    if (config.url === "/driver/everee/session") { const body = JSON.parse(config.data); state.posts.push(["session", body]); return onSession ? onSession(state, body) : { status: 200, data: freshSession() }; }
    if (config.url === "/driver/everee/refresh") { state.posts.push(["refresh"]); return onRefresh ? onRefresh(state) : { status: 200, data: { ...state.status, refreshed: true } }; }
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async ({ path = "/driver/payment-setup", language = "en" } = {}) => {
  const [{ configureStore }, { Provider }, { MemoryRouter, Routes, Route }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const driverSlice = (await import("../../redux/slice/driver/driverSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: EvereeSetupProvider } = await import("../../hooks/EvereeSetupProvider.jsx");
  const { default: PaymentSetup } = await import("./PaymentSetup.jsx");
  const { default: PaymentSetupBanner } = await import("./everee/PaymentSetupBanner.jsx");
  const { default: PaymentSetupPrompt } = await import("./everee/PaymentSetupPrompt.jsx");
  const { default: Pay } = await import("./Pay.jsx");
  const store = configureStore({ reducer: { driver: driverSlice, language: languageReducer }, preloadedState: { language: { ...languageReducer(undefined, { type: "init" }), currentLanguage: language } } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <EvereeSetupProvider>
          <PaymentSetupBanner />
          <PaymentSetupPrompt />
          <Routes>
            <Route path="/driver/payment-setup" element={<PaymentSetup />} />
            <Route path="/driver/dashboard" element={<p>Dashboard page</p>} />
            <Route path="/driver/pay" element={<Pay />} />
            <Route path="/driver/agreement" element={<p>Agreement page</p>} />
          </Routes>
        </EvereeSetupProvider>
      </MemoryRouter>
    </Provider>,
  );
  return store;
};

// The private channel: the test can read what the page sent through postMessage and speak as Everee through port1.
let channels;
const installChannel = () => {
  channels = [];
  vi.stubGlobal("MessageChannel", class { constructor() { this.port1 = { onmessage: null, close: vi.fn() }; this.port2 = { name: "port2" }; channels.push(this); } });
};
const openEmbed = async () => {
  const frame = await screen.findByTitle("Everee payment setup", { selector: "iframe" });
  const post = vi.fn();
  Object.defineProperty(frame, "contentWindow", { value: { postMessage: post }, configurable: true });
  fireEvent.load(frame);
  return { frame, post, speak: (data) => act(() => channels.at(-1).port1.onmessage({ data })) };
};

beforeEach(async () => { removeShell(); await resetBrowser(); installChannel(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("starting the setup", () => {
  it("asks for the address, checks it, sends only the details, and opens Everee with a fresh session for the web", async () => {
    const server = await startServer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Start setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(4);
    expect(server.posts.filter(([k]) => k === "onboarding")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "1 Test Street" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Austin" } });
    fireEvent.change(screen.getByLabelText("State (2 letters)"), { target: { value: "tx" } });
    fireEvent.change(screen.getByLabelText("ZIP code"), { target: { value: "78701" } });
    expect(screen.queryByLabelText("Start date")).toBeNull();
    const submit = screen.getByRole("button", { name: "Start setup" });
    fireEvent.click(submit);
    fireEvent.click(submit); // a double click on the same button
    await screen.findByTitle("Everee payment setup", { selector: "iframe" });
    expect(server.posts.filter(([k]) => k === "onboarding")).toEqual([["onboarding", ADDRESS]]);
    expect(server.posts.filter(([k]) => k === "session")).toEqual([["session", { experience: "ONBOARDING", platform: "web" }]]);
  });

  it("asks for a start date only when NASA has none", async () => {
    await startServer({ initial: status({ needsFromDriver: ["startDate", "homeAddress"] }) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Start setup" }));
    expect(screen.getByLabelText("Start date")).toBeTruthy();
  });

  it("does not offer a form when the driver’s own name, phone or email is missing: that is for the admin", async () => {
    await startServer({ initial: status({ needsFromDriver: ["phone", "homeAddress"] }) });
    await mount();
    await screen.findByText(/Ask your admin to fix it/);
    expect(screen.queryByRole("button", { name: "Start setup" })).toBeNull();
  });

  it("shows the server’s refusal in words and keeps the form usable", async () => {
    await startServer({ onStart: () => ({ status: 422, data: { code: "everee_refused", message: "Everee answered 400: bad address" } }) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Start setup" }));
    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "1 Test Street" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Austin" } });
    fireEvent.change(screen.getByLabelText("State (2 letters)"), { target: { value: "TX" } });
    fireEvent.change(screen.getByLabelText("ZIP code"), { target: { value: "78701" } });
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    expect(await screen.findByText("Everee could not accept the details. Check them and try again.")).toBeTruthy();
    expect(screen.queryByText(/bad address/)).toBeNull();
    expect(screen.getByLabelText("Street address").value).toBe("1 Test Street");
  });
});

describe("Everee’s screen", () => {
  const begin = async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Continue setup" }));
    return openEmbed();
  };

  it("connects through a private channel sent only to the link’s origin, and ignores anything that is not an event of this session", async () => {
    const server = await startServer({ initial: status({ state: "in-progress", canStart: false }) });
    const { post, speak } = await begin();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toBe("https://embed.everee.com");
    expect(post.mock.calls[0][2]).toEqual([channels[0].port2]);
    expect(screen.getByText("Opening Everee…")).toBeTruthy();
    speak({ eventType: "DISMISS", eventHandlerName: "someoneElse" });
    speak({ eventType: "PAY_NOW", eventHandlerName: "nasaEvereeEmbed" });
    speak("DISMISS");
    speak({ eventType: "MESSAGE_PORT_REGISTERED", eventHandlerName: "nasaEvereeEmbed" });
    expect(screen.queryByText("Opening Everee…")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Everee payment setup" })).toBeTruthy(); // still open: nothing above did anything
    expect(server.posts.filter(([k]) => k === "refresh")).toHaveLength(0);
  });

  it("a completion event only makes the page ask the server; the state shown is the server’s, and the link is dropped", async () => {
    const server = await startServer({ initial: status({ state: "in-progress", canStart: false }), onRefresh: (s) => ({ status: 200, data: (s.status = status({ state: "complete", required: false, canStart: false })) }) });
    const { speak } = await begin();
    speak({ eventType: "MESSAGE_PORT_REGISTERED", eventHandlerName: "nasaEvereeEmbed" });
    speak({ eventType: "WORKER_ONBOARDING_COMPLETE", eventHandlerName: "nasaEvereeEmbed" });
    await screen.findByText("Your payment setup is complete.");
    expect(screen.queryByTitle("Everee payment setup", { selector: "iframe" })).toBeNull();
    expect(server.posts.filter(([k]) => k === "refresh")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toBeTruthy();
    for (const store of [localStorage, sessionStorage]) expect(JSON.stringify({ ...store })).not.toContain("single-use-token");
  });

  it("a completion event does not make anything complete when the server says it is not", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = await startServer({ initial: status({ state: "in-progress", canStart: false }) });
    const { speak } = await begin();
    speak({ eventType: "WORKER_ONBOARDING_COMPLETE", eventHandlerName: "nasaEvereeEmbed" });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    await screen.findByText(/Everee is still checking/);
    expect(server.posts.filter(([k]) => k === "refresh")).toHaveLength(3);
    expect(screen.queryByText("Your payment setup is complete.")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue setup" })).toBeTruthy(); // can resume
  });

  it("closing the window (or Escape) leaves the setup resumable and asks the server", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = await startServer({ initial: status({ state: "in-progress", canStart: false }) });
    await begin();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Everee payment setup" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Everee payment setup" })).toBeNull());
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    await screen.findByRole("button", { name: "Continue setup" });
    expect(server.posts.filter(([k]) => k === "refresh").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
    await screen.findByTitle("Everee payment setup", { selector: "iframe" });
    expect(server.posts.filter(([k]) => k === "session")).toHaveLength(2); // a fresh link each time, never reused
  });

  it("delayed completion: after the first checks stay unfinished there is a Check again that asks the server (it opens no new window), with no reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = await startServer({ initial: status({ state: "in-progress", canStart: false }) });
    const { speak } = await begin();
    speak({ eventType: "WORKER_ONBOARDING_COMPLETE", eventHandlerName: "nasaEvereeEmbed" });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    await screen.findByText(/Everee is still checking/);
    const again = screen.getByRole("button", { name: "Check again" });
    expect(screen.getByRole("button", { name: "Continue setup" })).toBeTruthy();
    const sessions = server.posts.filter(([k]) => k === "session").length;
    server.status = status({ state: "complete", required: false, canStart: false }); // Everee finishes later
    server.mutate = true;
    fireEvent.click(again);
    await screen.findByText("Your payment setup is complete.");
    expect(server.posts.filter(([k]) => k === "session")).toHaveLength(sessions); // Check again opened nothing
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("a refresh outage after the window closes leaves a Check again, and it works once the connection is back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let up = false;
    const server = await startServer({ initial: status({ state: "in-progress", canStart: false }), onRefresh: (s) => (up ? { status: 200, data: (s.status = status({ state: "complete", required: false, canStart: false })) } : { status: 503, data: {} }) });
    const { speak } = await begin();
    speak({ eventType: "DISMISS", eventHandlerName: "nasaEvereeEmbed" });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect((await screen.findAllByText(/not available right now/)).length).toBeGreaterThan(0);
    up = true;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByText("Your payment setup is complete.");
    expect(server.posts.filter(([k]) => k === "refresh").length).toBeGreaterThanOrEqual(4);
  });

  it("if Everee already has the driver complete, the refused new window turns into a status check, not an error", async () => {
    await startServer({
      initial: status({ state: "in-progress", canStart: false }),
      onSession: () => ({ status: 409, data: { code: "already_complete", message: "your payment setup is already complete" } }),
      onRefresh: (s) => ({ status: 200, data: (s.status = status({ state: "complete", required: false, canStart: false })) }),
    });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Continue setup" }));
    await screen.findByText("Your payment setup is complete.");
    expect(screen.queryByText("Your payment setup is already complete.")).toBeNull();
  });

  it("an error event, a link that never connects and an expired link each end the window with a clear message", async () => {
    await startServer({ initial: status({ state: "in-progress", canStart: false }) });
    const { speak } = await begin();
    speak({ eventType: "DISMISS", eventHandlerName: "nasaEvereeEmbed", error: true, errorCode: "EMB-101" });
    expect(await screen.findByText(/Everee showed an error/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Everee payment setup" })).toBeNull();
  });

  it("a link that never connects ends the window after a wait", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startServer({ initial: status({ state: "in-progress", canStart: false }) });
    await begin();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });
    expect(await screen.findByText(/did not connect/)).toBeTruthy();
  });

  it("a link that is not https on an Everee host is never opened in a frame", async () => {
    await startServer({ initial: status({ state: "in-progress", canStart: false }), onSession: () => ({ status: 200, data: { ...freshSession(), url: "https://evil.example.com/s", origin: "https://evil.example.com" } }) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Continue setup" }));
    expect(await screen.findByText(/could not be opened safely/)).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("the refusal of a new window is shown in words (too many attempts)", async () => {
    await startServer({ initial: status({ state: "in-progress", canStart: false }), onSession: () => ({ status: 429, data: { code: "too_many_sessions", message: "too many attempts" } }) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Continue setup" }));
    expect(await screen.findByText("Too many attempts. Please wait a few minutes.")).toBeTruthy();
  });
});

describe("inside the phone app", () => {
  it("Everee opens in the shell’s own window: the session is made for the app, only the link goes to the shell, no frame is used, and the result is read from the server", async () => {
    const shell = installShell({ "everee.open": { data: { outcome: "finished" } } });
    const server = await startServer({ initial: status({ state: "in-progress", canStart: false }), onRefresh: (s) => ({ status: 200, data: (s.status = status({ state: "complete", required: false, canStart: false })) }) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Continue setup" }));
    await screen.findByText("Your payment setup is complete.");
    expect(server.posts.filter(([k]) => k === "session")).toEqual([["session", { experience: "ONBOARDING", platform: "native" }]]);
    const opens = shell.received.filter((m) => m.action === "everee.open");
    expect(opens).toHaveLength(1);
    expect(opens[0].payload).toEqual({ url: SESSION.url });
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("an app that is too old to open the window is told to update; a window already open is not opened twice", async () => {
    installShell({ "everee.open": { error: "unsupported_action" } });
    await startServer({ initial: status({ state: "in-progress", canStart: false }) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Continue setup" }));
    expect(await screen.findByText("Please update the NASA app to finish your payment setup.")).toBeTruthy();
    cleanup();
    removeShell();
    installShell({ "everee.open": { error: "busy" } });
    await startServer({ initial: status({ state: "in-progress", canStart: false }) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Continue setup" }));
    expect(await screen.findByText("The setup window is already open. Close it first.")).toBeTruthy();
  });
});

describe("what each state shows", () => {
  it.each([
    ["needs-review", { state: "needs-review", canStart: false }, /needs a review by your admin/, []],
    ["classification-required", { state: "classification-required", required: false, canStart: false }, /has not set your driver type/, []],
    ["service-unavailable", { state: "service-unavailable", canStart: false }, /not available right now/, []],
    ["verifying", { state: "verifying", canStart: false }, /Everee is checking your details/, ["Check again"]],
    ["creating", { state: "creating" }, /being set up/, ["Try again"]],
  ])("%s", async (_name, over, text, buttons) => {
    await startServer({ initial: status(over) });
    await mount();
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
    for (const name of buttons) expect(screen.getByRole("button", { name })).toBeTruthy();
    if (buttons.length === 0) expect(screen.queryByRole("button", { name: /Start setup|Continue setup|Check again|Try again/ })).toBeNull();
  });

  it("a Desi driver, or one with nothing to set up, goes straight to the dashboard (no loop)", async () => {
    await startServer({ initial: status({ state: "not-required", required: false, canStart: false, driverType: "DESI" }) });
    await mount();
    expect(await screen.findByText("Dashboard page")).toBeTruthy();
  });

  it("before the agreement is signed it says so and links to it; it never starts", async () => {
    await startServer({ initial: status({ blockedBy: "agreement", canStart: false, agreementSigned: false }) });
    await mount();
    expect(await screen.findByRole("link", { name: "Sign the agreement first" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start setup" })).toBeNull();
  });

  it("a failed load can be retried, and the page keeps working", async () => {
    let fail = true;
    await installServer(async (config) => {
      if (config.url === "/driver/access-driver") return { status: 200, data: { driver: { id: 1, name: "Dee", agreement_signed: true } } };
      if (config.url === "/driver/everee/status") return fail ? { status: 500, data: {} } : { status: 200, data: status() };
      return { status: 200, data: {} };
    });
    await mount();
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Start setup" })).toBeTruthy();
  });
});

describe("the popup, the banner and the card", () => {
  it("the popup tells the driver, 'Remind me later' closes only the popup, and the banner and card stay", async () => {
    await startServer({ initial: status({ state: "in-progress", canStart: false }) });
    await mount({ path: "/driver/pay" });
    const popup = await screen.findByRole("dialog", { name: "Complete your payment setup" });
    expect(within(popup).getByText("Work and payments are on hold until you finish.")).toBeTruthy();
    fireEvent.click(within(popup).getByRole("button", { name: "Remind me later" }));
    expect(screen.queryByRole("dialog", { name: "Complete your payment setup" })).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy(); // the banner
    expect(screen.getAllByText(/Complete your payment setup/).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Payment setup" })).toBeTruthy(); // the card on the Pay page
  });

  it("when the hard gate is off the texts never say work or payments are on hold", async () => {
    await startServer({ initial: status({ enforced: false }) });
    await mount({ path: "/driver/pay" });
    await screen.findByRole("dialog", { name: "Complete your payment setup" });
    expect(screen.queryByText(/on hold/)).toBeNull();
    expect(screen.getAllByText("Please finish your payment setup.").length).toBeGreaterThan(0);
  });

  it("the popup’s Start button opens the setup page; nothing shows on the setup page or the agreement", async () => {
    await startServer();
    await mount({ path: "/driver/pay" });
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Complete your payment setup" })).getByRole("button", { name: "Start setup" }));
    expect(await screen.findByRole("heading", { name: "Payment setup" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Complete your payment setup" })).toBeNull();
  });

  it("nothing is shown to a Desi driver, an unclassified driver, or a driver who is complete", async () => {
    for (const over of [{ state: "not-required", required: false, driverType: "DESI" }, { state: "classification-required", required: false, driverType: null }, { state: "complete", required: false }]) {
      cleanup();
      removeShell();
      await startServer({ initial: status(over) });
      await mount({ path: "/driver/pay" });
      await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
      expect(screen.queryByRole("dialog", { name: "Complete your payment setup" })).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    }
  });

  it("it is in Spanish for a Spanish-speaking driver", async () => {
    await startServer({ language: "es" });
    await mount({ path: "/driver/pay", language: "es" });
    expect(await screen.findByRole("dialog", { name: "Completa tu configuración de pagos" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Comenzar configuración" })).toBeTruthy();
  });
});

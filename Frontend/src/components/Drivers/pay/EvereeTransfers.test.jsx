import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { installServer, installShell, removeShell, resetBrowser } from "../../../test/fakeShell";

// The driver's Pay page with the Everee transfers and the Everee account actions, with the real provider, a fake server and made-up money.
const SESSION = { url: "https://embed.everee.com/s/single-use-token", origin: "https://embed.everee.com", expiresAt: new Date(Date.now() + 60_000).toISOString(), eventHandlerName: "nasaEvereeEmbed" };
const setupStatus = (over = {}) => ({ state: "complete", required: false, canStart: false, enforced: true, driverType: "LOCAL", agreementSigned: true, needsFromDriver: [], ...over });
const TRANSFERS = [
  { id: 5, statementId: 12, periodStart: "2026-11-01", periodEnd: "2026-11-07", amount: "100.10", status: "completed", sentAt: "2026-11-08T12:00:00Z", lastCheckedAt: "2026-11-09T12:00:00Z", paidAt: "2026-11-09T11:00:00Z" },
  { id: 4, statementId: 11, periodStart: "2026-10-25", periodEnd: "2026-10-31", amount: "50.05", status: "pending", sentAt: "2026-11-08T12:00:00Z", lastCheckedAt: "2026-11-09T12:00:00Z", paidAt: null },
  { id: 3, statementId: 10, periodStart: "2026-10-18", periodEnd: "2026-10-24", amount: "40.00", status: "unconfirmed", sentAt: "2026-11-01T12:00:00Z", lastCheckedAt: null, paidAt: null },
  { id: 2, statementId: 9, periodStart: "2026-10-11", periodEnd: "2026-10-17", amount: "30.30", status: "failed", sentAt: "2026-10-25T12:00:00Z", lastCheckedAt: null, paidAt: null },
  { id: 1, statementId: 8, periodStart: "2026-10-04", periodEnd: "2026-10-10", amount: "25.50", status: "returned", sentAt: "2026-10-18T12:00:00Z", lastCheckedAt: "2026-10-19T12:00:00Z", paidAt: null },
];

const startServer = async ({ setup = setupStatus(), transfers = TRANSFERS, onTransfers, onSession, language = "en" } = {}) => {
  const state = { posts: [], calls: [], transfers };
  await installServer(async (config) => {
    state.calls.push(`${config.method} ${config.url}`);
    if (config.url === "/driver/access-driver") return { status: 200, data: { driver: { id: 1, name: "Dee Test", agreement_signed: true } } };
    if (config.url.startsWith("/driver/language/")) return { status: 200, data: { preferredLanguage: language } };
    if (config.url === "/driver/payroll/statements") return { status: 200, data: { statements: [] } };
    if (config.url === "/driver/payroll/balances") return { status: 200, data: { entries: [], claims: [], totals: { owedByDriver: "0.00", owedPenalties: "0.00", owedOther: "0.00", owedToDriver: "0.00" } } };
    if (config.url === "/driver/everee/status") return { status: 200, data: setup };
    if (config.url === "/driver/everee/transfers") return onTransfers ? onTransfers(state) : { status: 200, data: { transfers: state.transfers, lastCheckedAt: state.transfers.length ? "2026-11-09T12:00:00Z" : null } };
    if (config.url === "/driver/everee/session") { state.posts.push(JSON.parse(config.data)); return onSession ? onSession() : { status: 200, data: SESSION }; }
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async ({ language = "en" } = {}) => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const driverSlice = (await import("../../../redux/slice/driver/driverSlice.js")).default;
  const languageReducer = (await import("../../../redux/slice/languageSlice.js")).default;
  const { default: EvereeSetupProvider } = await import("../../../hooks/EvereeSetupProvider.jsx");
  const { default: Pay } = await import("../Pay.jsx");
  const store = configureStore({ reducer: { driver: driverSlice, language: languageReducer }, preloadedState: { language: { ...languageReducer(undefined, { type: "init" }), currentLanguage: language } } });
  render(<Provider store={store}><MemoryRouter initialEntries={["/driver/pay"]}><EvereeSetupProvider><Pay /></EvereeSetupProvider></MemoryRouter></Provider>);
};

let channels;
beforeEach(async () => {
  removeShell();
  await resetBrowser();
  channels = [];
  vi.stubGlobal("MessageChannel", class { constructor() { this.port1 = { onmessage: null, close: vi.fn() }; this.port2 = {}; channels.push(this); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the Everee transfers", () => {
  it("lists every transfer in its own status, with exact amounts, what each means and when it was last checked, apart from the statements", async () => {
    await startServer();
    await mount();
    const section = await screen.findByRole("region", { name: "Everee transfers" });
    const list = within(section);
    expect(list.getByText(/It is the same money|same money, not extra/i)).toBeTruthy();
    for (const label of ["Deposited", "With Everee", "Not confirmed", "Not sent", "Returned by bank"]) expect(list.getByText(label)).toBeTruthy();
    for (const amount of ["$100.10", "$50.05", "$40.00", "$30.30", "$25.50"]) expect(list.getByText(amount)).toBeTruthy();
    expect(list.getByText("Sent to Everee. The money has not reached your bank yet.")).toBeTruthy();
    expect(list.getByText(/Do not count it as paid/)).toBeTruthy();
    expect(list.getByText(/Your bank returned this deposit/)).toBeTruthy();
    expect(list.getAllByText(/Last checked/).length).toBeGreaterThan(0);
    // only the completed one says it was deposited; the others never claim money arrived
    expect(list.getAllByText(/Deposited:/)).toHaveLength(1);
    expect(list.getAllByText("Deposited")).toHaveLength(1);
  });

  it("shows nothing when there are no transfers, and an error can be retried", async () => {
    let fail = true;
    await startServer({ onTransfers: () => (fail ? { status: 500, data: {} } : { status: 200, data: { transfers: TRANSFERS.slice(0, 1), lastCheckedAt: null } }) });
    await mount();
    expect(await screen.findByText(/Everee transfers could not be loaded/)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("$100.10")).toBeTruthy();
    cleanup();
    await startServer({ transfers: [] });
    await mount();
    await screen.findByText("My pay");
    expect(screen.queryByText("Everee transfers")).toBeNull();
  });

  it("a Desi driver (whose type was changed) can still read the transfers made earlier", async () => {
    await startServer({ setup: setupStatus({ state: "not-required", driverType: "DESI" }) });
    await mount();
    expect(await screen.findByText("$100.10")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bank details" })).toBeNull();
  });

  it("is in Spanish for a Spanish-speaking driver", async () => {
    await startServer({ language: "es" });
    await mount({ language: "es" });
    expect(await screen.findByText("Transferencias de Everee")).toBeTruthy();
    expect(screen.getByText("Devuelto por el banco")).toBeTruthy();
  });
});

describe("payment history and bank details", () => {
  it("are offered only when the setup is complete, and each opens its own Everee screen with a fresh link for the web", async () => {
    const server = await startServer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Payment history" }));
    await screen.findByTitle("Everee payment setup", { selector: "iframe" });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Everee payment setup" }), { key: "Escape" });
    expect(screen.queryByTitle("Everee payment setup", { selector: "iframe" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bank details" }));
    await screen.findByTitle("Everee payment setup", { selector: "iframe" });
    expect(server.posts).toEqual([{ experience: "PAYMENT_HISTORY", platform: "web" }, { experience: "PAYMENT_DEPOSIT", platform: "web" }]);
  });

  it("closing a window reads the transfers again", async () => {
    const server = await startServer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Payment history" }));
    await screen.findByTitle("Everee payment setup", { selector: "iframe" });
    const before = server.calls.filter((c) => c === "get /driver/everee/transfers").length;
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Everee payment setup" }), { key: "Escape" });
    await vi.waitFor(() => expect(server.calls.filter((c) => c === "get /driver/everee/transfers").length).toBe(before + 1));
  });

  it.each([
    ["in progress", { state: "in-progress", required: true }],
    ["not started", { state: "not-started", required: true, canStart: true }],
    ["needs review", { state: "needs-review", required: true }],
    ["a Desi driver", { state: "not-required", driverType: "DESI" }],
  ])("are not offered while the setup is %s", async (_name, over) => {
    await startServer({ setup: setupStatus(over) });
    await mount();
    await screen.findByText("My pay");
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Payment history" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bank details" })).toBeNull();
  });

  it("show the server's refusal in words", async () => {
    await startServer({ onSession: () => ({ status: 409, data: { code: "not_complete", message: "finish your payment setup first" } }) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Bank details" }));
    expect(await screen.findByText("Finish your payment setup first.")).toBeTruthy();
  });

  it("inside the phone app they open in the shell’s window: the session is for the app, only the link goes to the shell, no frame", async () => {
    const shell = installShell({ "everee.open": { data: { outcome: "closed" } } });
    const server = await startServer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Payment history" }));
    await vi.waitFor(() => expect(shell.received.filter((m) => m.action === "everee.open")).toHaveLength(1));
    expect(server.posts).toEqual([{ experience: "PAYMENT_HISTORY", platform: "native" }]);
    expect(shell.received.find((m) => m.action === "everee.open").payload).toEqual({ url: SESSION.url });
    expect(document.querySelector("iframe")).toBeNull();
  });
});

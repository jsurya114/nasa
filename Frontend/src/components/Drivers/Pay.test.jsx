import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

// Synthetic statements for one made-up driver, shaped as GET /driver/payroll/* returns them (#145).
const STATEMENTS = [
  { id: 12, city: "Test City", data_type: "daily", period_start: "2026-11-01", period_end: "2026-11-07", state: "approved", net: "106.16" },
  { id: 9, city: "Test City", data_type: "weekly", period_start: "2026-10-20", period_end: "2026-10-26", state: "voided", net: "50.00" },
];
const DETAIL = {
  id: 12, city: "Test City", data_type: "daily", period_start: "2026-11-01", period_end: "2026-11-07", state: "approved",
  gross: "200.00", insurance: "3.84", reimbursements: "0.00", claim_deductions: "40.00", recoveries: "50.00", net: "106.16",
  carried_forward: "150.00", payout_reference: null,
  lines: [
    { id: 1, line_type: "earning", amount: "100.00", journey_date: "2026-11-02", route_name: "Route A" },
    { id: 2, line_type: "insurance", amount: "-1.92", journey_date: "2026-11-02" },
    { id: 3, line_type: "earning", amount: "100.00", journey_date: "2026-11-03", route_name: "Route A" },
    { id: 4, line_type: "claim", amount: "-40.00", waybill: "TESTW001", claim_type: "Damaged Item", claim_at: "2026-10-30 10:00", source_charge: "-40.00" },
    { id: 5, line_type: "recovery", amount: "-50.00", entry_type: "advance", reason: "Fuel advance", entry_amount: "200.00", recovery_plan: "installments", installment_amount: "50.00" },
  ],
};
const BALANCES = {
  entries: [{ id: 3, entry_type: "advance", direction: "debit", amount: "200.00", reason: "Fuel advance", effective_date: "2026-11-01", exempt: false,
    recovery_plan: "installments", installment_amount: "50.00", applied: "50.00", outstanding: "150.00", pay_runs: [{ runId: 4, periodEnd: "2026-11-07", amount: "-50.00" }] }],
  claims: [{ id: 8, waybill: "TESTW002", claim_type: "Tracking interruption", claim_at: "2026-10-29 09:00", source_charge: "-25.00", status: "exempt",
    applied: "0.00", outstanding: "0.00", pay_runs: [] }],
  totals: { owedByDriver: "150.00", owedToDriver: "0.00" },
};

const startServer = async ({ fail = false, statements = STATEMENTS, language = "en" } = {}) => {
  const state = { urls: [], fail };
  await installServer(async (config) => {
    state.urls.push(config.url);
    if (config.url.startsWith("/driver/payroll/")) {
      if (state.fail) return { status: 500, data: { message: "statements could not be loaded; try again" } };
      if (config.url === "/driver/payroll/statements") return { status: 200, data: { statements } };
      if (config.url === "/driver/payroll/balances") return { status: 200, data: BALANCES };
      if (config.url === "/driver/payroll/statements/12") return { status: 200, data: DETAIL };
      return { status: 404, data: { message: "statement not found" } };
    }
    if (config.url.startsWith("/driver/language/")) return { status: 200, data: { preferredLanguage: language } };
    if (config.url.includes("/driver/access-driver")) return { status: 200, data: { driver: { id: 7, name: "Dee", agreement_signed: true } } };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async (language = "en") => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([
    import("@reduxjs/toolkit"),
    import("react-redux"),
    import("react-router-dom"),
  ]);
  const driverSlice = await import("../../redux/slice/driver/driverSlice.js");
  const languageSlice = await import("../../redux/slice/languageSlice.js");
  const { default: Pay } = await import("./Pay.jsx");
  const store = configureStore({ reducer: { driver: driverSlice.default, language: languageSlice.default } });
  store.dispatch(driverSlice.setDriver({ id: 7, name: "Dee", agreement_signed: true }));
  store.dispatch(languageSlice.setLanguageLocal(language));
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <Pay />
      </MemoryRouter>
    </Provider>
  );
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("driver My pay", () => {
  it("shows what is owed and the approved statements, asking only for the signed-in driver's own data", async () => {
    const server = await startServer();
    await mount();
    expect(await screen.findByRole("button", { name: /View statement\s*2026-11-01\s*–\s*2026-11-07/ })).toBeTruthy();
    expect(screen.getByText("$106.16")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getAllByText("$150.00").length).toBeGreaterThan(0);
    // No driver ID in any pay request: the server takes it from the token.
    const payUrls = server.urls.filter((u) => u.startsWith("/driver/payroll/"));
    expect(payUrls.sort()).toEqual(["/driver/payroll/balances", "/driver/payroll/statements"]);
  });

  it("marks an exempt claim as not charged and lists the payday that took an instalment", async () => {
    await startServer();
    await mount();
    expect(await screen.findByText("Exempt: not charged to you")).toBeTruthy();
    expect(screen.getByText(/Carrier charge: -\$25\.00/)).toBeTruthy();
    expect(screen.getByText("Taken on payday: 2026-11-07")).toBeTruthy();
    expect(screen.getByText("Instalments of $50.00")).toBeTruthy();
  });

  it("opens a statement with each source: the carrier's charge next to what was deducted, and the advance's reason", async () => {
    await startServer();
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /View statement\s*2026-11-01/ }));
    expect(await screen.findByText("Damaged Item · TESTW001")).toBeTruthy();
    expect(screen.getByText(/Carrier charge: -\$40\.00/)).toBeTruthy();
    expect(screen.getByText("Advance: Fuel advance")).toBeTruthy();
    const totals = screen.getByText("Net pay").closest("dl");
    expect(within(totals).getByText("-$3.84")).toBeTruthy();
    expect(within(totals).getByText("$106.16")).toBeTruthy();
    expect(screen.getByText("Still owed after this payday")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to pay statements/ }));
    expect(await screen.findByText("Pay statements")).toBeTruthy();
  });

  it("speaks Spanish", async () => {
    await startServer({ language: "es" });
    await mount("es");
    expect(await screen.findByText("Mi pago")).toBeTruthy();
    expect(await screen.findByText("Aprobado")).toBeTruthy();
    expect(screen.getByText("Exento: no se te cobra")).toBeTruthy();
  });

  it("says when there is nothing yet", async () => {
    await startServer({ statements: [] });
    await mount();
    expect(await screen.findByText(/No approved pay statements yet/)).toBeTruthy();
  });

  it("shows an error with a retry that loads again", async () => {
    const server = await startServer({ fail: true });
    await mount();
    expect(await screen.findByRole("alert")).toBeTruthy();
    server.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /View statement\s*2026-11-01\s*–\s*2026-11-07/ })).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// Made-up city, driver and payroll, shaped as the /admin/payroll API returns them (#142, #145).
const BALANCES = {
  entries: [{ id: 5, entry_type: "expense", direction: "debit", amount: "30.00", reason: "Lost scanner", effective_date: "2026-11-01", exempt: false,
    recovery_plan: null, installment_amount: null, applied: "0.00", outstanding: "30.00", pay_runs: [] }],
  claims: [],
  totals: { owedByDriver: "30.00", owedToDriver: "0.00" },
};
const STATEMENTS = [{ id: 21, city: "Test City", data_type: "daily", period_start: "2026-11-01", period_end: "2026-11-07", state: "pending", net: "80.50" }];
const DETAIL = { ...STATEMENTS[0], gross: "80.50", insurance: "0.00", reimbursements: "0.00", claim_deductions: "0.00", recoveries: "0.00", carried_forward: "30.00",
  lines: [{ id: 1, line_type: "earning", amount: "80.50", journey_date: "2026-11-03", route_name: "Route T" }] };

const startServer = async ({ ledgerReplies = [], refundsDue = [] } = {}) => {
  const state = { requests: [], posts: [], refundsDue };
  await installServer(async (config) => {
    state.requests.push({ url: config.url, params: config.params });
    if (config.method === "post" && config.url === "/admin/payroll/ledger") {
      const body = JSON.parse(config.data);
      state.posts.push(body);
      const reply = ledgerReplies.shift() ?? { status: 201, data: { entry: { id: 9 }, replay: false } };
      // As the server does: a refund linked to the claim clears that claim from the refunds due.
      if (reply.status === 201 && body.claimCourier) state.refundsDue = state.refundsDue.filter((r) => r.waybill !== body.waybill);
      return reply;
    }
    if (config.url === "/admin/get-admin-cities") return { status: 200, data: { cities: [{ id: 3, job: "Test City" }] } };
    if (config.url === "/admin/dashboard/drivers-by-city") return { status: 200, data: { data: [{ id: 7, name: "Dee Test" }] } };
    if (config.url === "/admin/payroll/drivers/7/balances") return { status: 200, data: { ...BALANCES, refundsDue: state.refundsDue } };
    if (config.url === "/admin/payroll/drivers/7/statements") return { status: 200, data: { statements: STATEMENTS } };
    if (config.url === "/admin/payroll/statements/21") return { status: 200, data: DETAIL };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async () => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([
    import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom"),
  ]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Payroll } = await import("./Payroll.jsx");
  const store = configureStore({ reducer: { admin: adminReducer, language: languageReducer } });
  return render(<Provider store={store}><MemoryRouter><Payroll /></MemoryRouter></Provider>);
};

const chooseDriver = async () => {
  fireEvent.change(await screen.findByLabelText("City"), { target: { value: "3" } });
  await screen.findByRole("option", { name: "Dee Test" });
  fireEvent.change(screen.getByLabelText("Driver"), { target: { value: "7" } });
  await screen.findByText("Record an entry");
};

const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("admin Payroll", () => {
  it("loads one driver's balances and statements for the chosen city, and opens a draft through the admin route", async () => {
    const server = await startServer();
    await mount();
    await chooseDriver();
    const reads = server.requests.filter((r) => r.url.startsWith("/admin/payroll/"));
    expect(reads.every((r) => r.params?.cityId === "3")).toBe(true);
    expect(screen.getByText(/1 entry has no repayment arrangement/)).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /View statement\s*2026-11-01/ }));
    expect(await screen.findByText("Route T")).toBeTruthy();
    expect(server.requests.some((r) => r.url === "/admin/payroll/statements/21")).toBe(true);
  });

  it("records an advance with its instalment plan, then reloads the driver's payroll", async () => {
    const server = await startServer();
    await mount();
    await chooseDriver();
    fill("Amount (USD)", "200");
    fill("Reason", "Fuel advance");
    fireEvent.click(screen.getByLabelText("Already paid out to the driver outside payroll"));
    fill("Repayment arrangement", "installments");
    fill("Instalment per payday (USD)", "50");
    const before = server.requests.length;
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toMatchObject({
      cityId: 3, driverId: 7, type: "advance", amount: "200", reason: "Fuel advance",
      disbursedOutsidePayroll: true, recoveryPlan: "installments", installmentAmount: "50",
    });
    expect(server.posts[0].requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await waitFor(() => expect(server.requests.slice(before).some((r) => r.url === "/admin/payroll/drivers/7/balances")).toBe(true));
  });

  it("shows the server's field errors and retries with the same request ID", async () => {
    const server = await startServer({ ledgerReplies: [{ status: 400, data: { message: "check the highlighted fields", errors: { reason: "give a reason (at least 3 characters)" } } }] });
    await mount();
    await chooseDriver();
    fill("Amount (USD)", "20");
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    expect(await screen.findByText("give a reason (at least 3 characters)")).toBeTruthy();
    fill("Reason", "Toll");
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    await waitFor(() => expect(server.posts).toHaveLength(2));
    expect(server.posts[1].requestId).toBe(server.posts[0].requestId);
  });

  it("offers no repayment arrangement for money owed to the driver", async () => {
    await startServer();
    await mount();
    await chooseDriver();
    fill("Type", "reimbursement");
    expect(screen.queryByLabelText("Repayment arrangement")).toBeNull();
    expect(screen.queryByLabelText("Already paid out to the driver outside payroll")).toBeNull();
  });

  it("records a refund linked to the claim from Refunds due, and the item clears", async () => {
    const server = await startServer({ refundsDue: [{ claimId: 41, courier: "gofo", waybill: "TESTW041", claimType: "Damaged Item", amount: "10.00" }] });
    await mount();
    await chooseDriver();
    expect(screen.getByText(/Damaged Item · TESTW041 \(GOFO\): \$10\.00 deducted more than is now owed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));
    expect(screen.getByLabelText("Type").value).toBe("correction");
    expect(screen.getByLabelText("Direction").value).toBe("credit");
    expect(screen.getByLabelText("Claim waybill").value).toBe("TESTW041");
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toMatchObject({
      cityId: 3, driverId: 7, type: "correction", direction: "credit", amount: "10.00",
      claimCourier: "gofo", waybill: "TESTW041", claimType: "Damaged Item",
    });
    await waitFor(() => expect(screen.queryByText("Refunds due")).toBeNull());
  });

  it("offers a claim reference only on a refund (credit correction), and sends none when left empty", async () => {
    const server = await startServer();
    await mount();
    await chooseDriver();
    fill("Type", "correction");
    expect(screen.queryByLabelText("Claim waybill")).toBeNull(); // a debit correction cannot name a claim
    fill("Direction", "credit");
    expect(screen.getByLabelText("Claim waybill")).toBeTruthy();
    fill("Amount (USD)", "5");
    fill("Reason", "Goodwill credit");
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).not.toHaveProperty("claimCourier");
    expect(server.posts[0]).not.toHaveProperty("waybill");
  });
});

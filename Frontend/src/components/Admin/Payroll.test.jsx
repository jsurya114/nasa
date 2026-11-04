import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// Made-up city, driver and payroll, shaped as the /admin/payroll API returns them (#142, #145).
const BALANCES = {
  entries: [{ id: 5, entry_type: "expense", direction: "debit", amount: "30.00", reason: "Lost scanner", effective_date: "2026-11-01", exempt: false,
    recovery_plan: null, installment_amount: null, applied: "0.00", outstanding: "30.00", pay_runs: [] }],
  claims: [],
  totals: { owedByDriver: "30.00", owedPenalties: "0.00", owedOther: "30.00", owedToDriver: "0.00" },
};
const STATEMENTS = [{ id: 21, city: "Test City", data_type: "daily", period_start: "2026-11-01", period_end: "2026-11-07", state: "pending", net: "80.50" }];
const DETAIL = { ...STATEMENTS[0], gross: "80.50", insurance: "0.00", reimbursements: "0.00", claim_deductions: "0.00", recoveries: "0.00", carried_forward: "30.00",
  lines: [{ id: 1, line_type: "earning", amount: "80.50", journey_date: "2026-11-03", route_name: "Route T" }] };

const DRIVERS = [{ id: 7, name: "Dee Test" }];
const startServer = async ({ ledgerReplies = [], refundsDue = [], balances = BALANCES, drivers = DRIVERS, payable } = {}) => {
  const state = { requests: [], posts: [], refundsDue, balances: { ...balances, entries: [...balances.entries], ...(payable !== undefined && { payable }) } };
  await installServer(async (config) => {
    state.requests.push({ url: config.url, params: config.params });
    if (config.method === "post" && config.url === "/admin/payroll/ledger") {
      const body = JSON.parse(config.data);
      state.posts.push(body);
      const reply = ledgerReplies.shift() ?? { status: 201, data: { entry: { id: 9 }, replay: false } };
      // As the server does: a refund linked to the claim clears that claim from the refunds due.
      if (reply.status === 201 && body.claimCourier) state.refundsDue = state.refundsDue.filter((r) => r.waybill !== body.waybill);
      // A saved advance or penalty is listed on the next read, as the server would.
      if (reply.status === 201 && ["advance", "manual_claim"].includes(body.type)) {
        state.balances.entries.unshift({ id: 90 + state.posts.length, entry_type: body.type, direction: "debit", amount: body.amount, reason: body.reason, effective_date: body.effectiveDate,
          exempt: false, recovery_plan: body.recoveryPlan ?? null, installment_amount: body.installmentAmount ?? null, outstanding: body.amount, pay_runs: [] });
      }
      return reply;
    }
    if (config.url === "/admin/get-admin-cities") return { status: 200, data: { cities: [{ id: 3, job: "Test City" }] } };
    if (config.url === "/admin/dashboard/drivers-by-city") return { status: 200, data: { data: drivers } };
    if (/^\/admin\/payroll\/drivers\/\d+\/balances$/.test(config.url)) return { status: 200, data: { ...state.balances, refundsDue: state.refundsDue } };
    if (/^\/admin\/payroll\/drivers\/\d+\/statements$/.test(config.url)) return { status: 200, data: { statements: STATEMENTS } };
    if (config.url === "/admin/payroll/statements/21") return { status: 200, data: DETAIL };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async (route = "/") => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([
    import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom"),
  ]);
  const adminReducer = (await import("../../redux/slice/admin/adminSlice.js")).default;
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: Payroll } = await import("./Payroll.jsx");
  const store = configureStore({ reducer: { admin: adminReducer, language: languageReducer } });
  return render(<Provider store={store}><MemoryRouter initialEntries={[route]}><Payroll /></MemoryRouter></Provider>);
};

const chooseDriver = async (name = "Dee Test") => {
  fireEvent.change(await screen.findByLabelText("City"), { target: { value: "3" } });
  const box = await screen.findByRole("combobox", { name: "Driver" });
  await waitFor(() => expect(box.disabled).toBe(false));
  fireEvent.focus(box);
  fireEvent.mouseDown(await screen.findByRole("option", { name }));
  await screen.findByText("Add a record");
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

  it("opens on the city and driver named in the dashboard's link, and ignores a bad link", async () => {
    const server = await startServer();
    await mount("/admin/payroll?cityId=3&driverId=7");
    expect(await screen.findByText("Add a record")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Driver" }).value).toBe("Dee Test");
    expect(server.requests.some((r) => r.url === "/admin/payroll/drivers/7/balances" && r.params?.cityId === "3")).toBe(true);
    cleanup();
    await mount("/admin/payroll?cityId=3;DROP&driverId=abc");
    expect(await screen.findByText("Choose a city and a driver.")).toBeTruthy();
  });

  it("shows two cards only, with penalties apart from other debts, and a saved record listed on the left", async () => {
    const penalty = { ...BALANCES.entries[0], id: 6, entry_type: "manual_claim", amount: "40.00", outstanding: "40.00", reason: "Damaged parcel" };
    await startServer({ balances: { ...BALANCES, entries: [...BALANCES.entries, penalty], totals: { owedByDriver: "70.00", owedPenalties: "40.00", owedOther: "30.00", owedToDriver: "0.00" } } });
    await mount();
    await chooseDriver();
    expect(screen.getByText("Driver owes NASA").nextSibling.textContent).toBe("$30.00");
    expect(screen.getByText("Penalty charges", { selector: "dt" }).nextSibling.textContent).toBe("$40.00");
    expect(document.querySelectorAll("dl > div").length).toBe(2);
    expect(screen.queryByText(/NASA owes driver/)).toBeNull();
    expect(screen.getByText("Penalty: Damaged parcel")).toBeTruthy();
    expect(screen.queryByText("Manage entries")).toBeNull();
  });

  it("after a repayment outside payroll the cards add up to what the server says is owed, and a fully repaid balance shows no penalty", async () => {
    // a $40 penalty with $20 repaid outside payroll: $20 owed, all of it a penalty (the server's split)
    const penalty = { ...BALANCES.entries[0], id: 6, entry_type: "manual_claim", amount: "40.00", outstanding: "40.00", reason: "Damaged parcel" };
    await startServer({ balances: { ...BALANCES, entries: [penalty], totals: { owedByDriver: "20.00", owedPenalties: "20.00", owedOther: "0.00", owedToDriver: "0.00" } } });
    await mount();
    await chooseDriver();
    expect(screen.getByText("Driver owes NASA").nextSibling.textContent).toBe("$0.00");
    expect(screen.getByText("Penalty charges", { selector: "dt" }).nextSibling.textContent).toBe("$20.00");
    expect(screen.getByText(/Total owed:/).textContent).toContain("$20.00");
    cleanup();
    await startServer({ balances: { ...BALANCES, entries: [], totals: { owedByDriver: "0.00", owedPenalties: "0.00", owedOther: "0.00", owedToDriver: "0.00" } } });
    await mount();
    await chooseDriver();
    expect(screen.getByText("Driver owes NASA").nextSibling.textContent).toBe("$0.00");
    expect(screen.getByText("Penalty charges", { selector: "dt" }).nextSibling.textContent).toBe("$0.00");
    expect(screen.queryByText(/Total owed:/)).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toMatchObject({
      cityId: 3, driverId: 7, type: "advance", amount: "200", reason: "Fuel advance",
      disbursedOutsidePayroll: true, recoveryPlan: "installments", installmentAmount: "50",
    });
    expect(server.posts[0].requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await waitFor(() => expect(server.requests.slice(before).some((r) => r.url === "/admin/payroll/drivers/7/balances")).toBe(true));
  });

  it("shows the server's field errors and retries with the same request ID", async () => {
    const server = await startServer({ payable: "100.00", ledgerReplies: [{ status: 400, data: { message: "check the highlighted fields", errors: { reason: "give a reason (at least 3 characters)" } } }] });
    await mount();
    await chooseDriver();
    fill("Amount (USD)", "20");
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    expect(await screen.findByText("give a reason (at least 3 characters)")).toBeTruthy();
    fill("Reason", "Toll");
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    await waitFor(() => expect(server.posts).toHaveLength(2));
    expect(server.posts[1].requestId).toBe(server.posts[0].requestId);
  });

  it("records a refund linked to the claim from Refunds due, and the item clears", async () => {
    const server = await startServer({ refundsDue: [{ claimId: 41, courier: "gofo", waybill: "TESTW041", claimType: "Damaged Item", amount: "10.00" }] });
    await mount();
    await chooseDriver();
    expect(screen.getByText(/Damaged Item · TESTW041 \(GOFO\): \$10\.00 deducted more than is now owed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record refund" }));
    expect(screen.getByLabelText("Type").value).toBe("correction");
    expect(screen.getByLabelText("Type").disabled).toBe(true); // a refund is not picked by hand
    expect(screen.getByLabelText("Claim waybill").value).toBe("TESTW041");
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toMatchObject({
      cityId: 3, driverId: 7, type: "correction", direction: "credit", amount: "10.00",
      claimCourier: "gofo", waybill: "TESTW041", claimType: "Damaged Item",
    });
    await waitFor(() => expect(screen.queryByText("Refunds due")).toBeNull());
  });

  it("the Type list has only Advance and Penalty", async () => {
    await startServer();
    await mount();
    await chooseDriver();
    const options = [...screen.getByLabelText("Type").querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Advance", "Penalty"]);
  });

  it("an amount cannot be negative: a minus sign cannot be typed, and zero is refused before anything is sent", async () => {
    const server = await startServer({ payable: "100.00" });
    await mount();
    await chooseDriver();
    fill("Amount (USD)", "-5");
    expect(screen.getByLabelText("Amount (USD)").value).toBe("5");
    fill("Amount (USD)", "-");
    fill("Amount (USD)", "1e3");
    expect(screen.getByLabelText("Amount (USD)").value).toBe("13");
    fill("Amount (USD)", "12.3456");
    expect(screen.getByLabelText("Amount (USD)").value).toBe("12.34");
    fill("Amount (USD)", "0");
    fill("Reason", "Toll");
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    expect(await screen.findByText("Amount must be more than 0")).toBeTruthy();
    expect(server.posts).toHaveLength(0);
  });

  it("more than the driver's payment must be repaid on the next payday or by instalments; up to it, no arrangement is needed", async () => {
    const server = await startServer({ payable: "100.00" });
    await mount();
    await chooseDriver();
    const plan = () => [...screen.getByLabelText("Repayment arrangement").querySelectorAll("option")].map((o) => o.textContent);
    fill("Amount (USD)", "80");
    expect(plan()).toContain("None yet (needs review)");
    expect(screen.queryByRole("note")).toBeNull();
    fill("Amount (USD)", "150");
    expect(plan()).not.toContain("None yet (needs review)");
    expect(screen.getByRole("note").textContent).toContain("more than the driver's payment ($100.00)");
    fill("Reason", "Fuel advance");
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    expect(await screen.findByText(/Choose how it is repaid/)).toBeTruthy();
    expect(server.posts).toHaveLength(0);
    fill("Repayment arrangement", "full_next_payday");
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toMatchObject({ amount: "150", recoveryPlan: "full_next_payday" });
  });

  it("an instalment must be more than zero and less than the whole amount", async () => {
    const server = await startServer({ payable: "0.00" });
    await mount();
    await chooseDriver();
    fill("Amount (USD)", "200");
    fill("Reason", "Advance");
    fill("Repayment arrangement", "installments");
    fill("Instalment per payday (USD)", "200");
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    expect(await screen.findByText(/An instalment must be less than the whole amount/)).toBeTruthy();
    expect(server.posts).toHaveLength(0);
  });

  it("a record added on the right is listed on the left straight away, with Edit, Mark complete and History in the list", async () => {
    const server = await startServer({ payable: "500.00" });
    await mount();
    await chooseDriver();
    fill("Type", "manual_claim");
    fill("Amount (USD)", "40");
    fill("Reason", "Damaged parcel");
    fill("Claim type", "Damaged item");
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    const item = (await screen.findByText("Penalty: Damaged parcel")).closest("li");
    expect(item.textContent).toContain("$40.00");
    const buttons = [...item.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Edit", "Mark complete", "History"]);
  });

  it("a penalty's claim type is chosen from Fake pod, Lost, Tracking interruption and Damaged item, and one must be chosen", async () => {
    const server = await startServer({ payable: "500.00" });
    await mount();
    await chooseDriver();
    expect(screen.queryByLabelText("Claim type")).toBeNull(); // an advance has no claim type
    fill("Type", "manual_claim");
    const select = screen.getByLabelText("Claim type");
    expect(select.tagName).toBe("SELECT");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choose a claim type", "Fake pod", "Lost", "Tracking interruption", "Damaged item"]);
    fill("Amount (USD)", "40");
    fill("Reason", "Parcel lost");
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    expect(await screen.findByText("Choose the claim type")).toBeTruthy();
    expect(server.posts).toHaveLength(0);
    fill("Claim type", "Lost");
    fireEvent.click(screen.getByRole("button", { name: "Add record" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0].claimType).toBe("Lost");
  });

  it("the driver list can be searched: typing waits for a pause (debounced), then filters; Enter picks", async () => {
    const drivers = [{ id: 7, name: "Dee Test" }, { id: 8, name: "Dana Ray" }, { id: 9, name: "Eli Stone" }];
    const server = await startServer({ drivers });
    await mount();
    fireEvent.change(await screen.findByLabelText("City"), { target: { value: "3" } });
    const box = await screen.findByRole("combobox", { name: "Driver" });
    await waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.focus(box);
    const options = () => within(screen.getByRole("listbox", { name: "Driver" })).queryAllByRole("option");
    await waitFor(() => expect(options()).toHaveLength(3));
    fireEvent.change(box, { target: { value: "dan" } });
    expect(options()).toHaveLength(3); // not filtered on every key
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0].textContent).toBe("Dana Ray");
    fireEvent.change(box, { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText("No driver matches")).toBeTruthy());
    fireEvent.change(box, { target: { value: "ELI" } });
    await waitFor(() => expect(options()).toHaveLength(1)); // case does not matter
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByText("Add a record");
    expect(box.value).toBe("Eli Stone");
    expect(server.requests.some((r) => r.url === "/admin/payroll/drivers/9/balances")).toBe(true);
  });

  it("every field has an info icon that says what it is for", async () => {
    await startServer();
    await mount();
    await chooseDriver();
    for (const field of ["city", "Driver", "Type", "Amount (USD)", "Date", "Reason", "Not before payday (optional)", "Repayment arrangement", "records"]) {
      expect(screen.getByRole("button", { name: `About ${field}` }), field).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "About Amount (USD)" }));
    expect(screen.getByRole("tooltip").textContent).toContain("must be more than zero");
    fireEvent.keyDown(screen.getByRole("button", { name: "About Amount (USD)" }), { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

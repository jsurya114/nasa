import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../test/fakeShell";

vi.mock("../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../utils/confirmDialog", () => ({ confirmDialog: confirm, default: confirm }));

// A made-up city and run, shaped as the /admin/payroll/runs API returns them (#143).
const RUN = { id: 17, city_id: 3, period_start: "2026-11-01", period_end: "2026-11-07", data_type: "daily", status: "draft", recovery_limit: null, close_reason: null };
const detailOf = (run, net = "294.24") => ({
  run,
  totals: { gross: "300.00", insurance: "5.76", reimbursements: "0.00", claim_deductions: "0.00", recoveries: "0.00", net, carried_forward: "40.00" },
  statements: [{ id: 30, driver_name: "Dee Test", gross: "300.00", insurance: "5.76", reimbursements: "0.00", claim_deductions: "0.00", recoveries: "0.00",
    net, carried_forward: "40.00", flags: [{ code: "recovery_limit_not_set", message: "no recovery limit is set; nothing was recovered automatically" }], lines: [] }],
  waiting: { pending_claims: 2, entries_needing_review: 1 },
});

// held: requests matching "METHOD url" wait until the test calls release(key), to test answers that arrive late.
const startServer = async ({ net, held = [] } = {}) => {
  const gates = Object.fromEntries(held.map((key) => {
    let open;
    const promise = new Promise((resolve) => { open = resolve; });
    return [key, { promise, open }];
  }));
  const state = { calls: [], run: { ...RUN }, release: (key) => gates[key].open() };
  await installServer(async (config) => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    state.calls.push({ method: config.method, url: config.url, params: config.params, body });
    const gate = gates[`${config.method.toUpperCase()} ${config.url}`];
    if (gate) await gate.promise;
    if (config.url === "/admin/get-admin-cities") return { status: 200, data: { cities: [{ id: 3, job: "Test City" }, { id: 5, job: "Other City" }] } };
    if (config.url === "/admin/payroll/settings") return { status: 200, data: { recoveryLimit: null } };
    if (config.url === "/admin/payroll/settings/recovery-limit") return { status: 200, data: { recoveryLimit: body.recoveryLimit } };
    if (config.method === "get" && config.url === "/admin/payroll/runs") return { status: 200, data: { runs: String(config.params?.cityId) === "3" ? [state.run] : [] } };
    if (config.method === "post" && config.url === "/admin/payroll/runs") return { status: 201, data: { ...detailOf(state.run, net), replay: false } };
    const action = config.url.match(/^\/admin\/payroll\/runs\/17\/(finalize|discard|void)$/);
    if (action) {
      state.run = { ...state.run, status: { finalize: "finalized", discard: "discarded", void: "voided" }[action[1]], close_reason: body?.reason ?? null };
      return { status: 200, data: { run: state.run, replay: false } };
    }
    if (config.url === "/admin/payroll/runs/17") return { status: 200, data: detailOf(state.run, net) };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async ({ superAdmin = false } = {}) => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([
    import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom"),
  ]);
  const languageReducer = (await import("../../redux/slice/languageSlice.js")).default;
  const { default: PayRuns } = await import("./PayRuns.jsx");
  const store = configureStore({ reducer: { admin: (s = { isSuperAdmin: superAdmin }) => s, language: languageReducer } });
  return render(<Provider store={store}><MemoryRouter><PayRuns /></MemoryRouter></Provider>);
};

const chooseCity = async () => {
  await screen.findByRole("option", { name: "Test City" });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "3" } });
  await screen.findByText("New draft");
};

const posts = (server, suffix) => server.calls.filter((c) => c.method === "post" && c.url.endsWith(suffix));

beforeEach(async () => {
  removeShell();
  await resetBrowser();
  confirm.mockClear();
});
afterEach(cleanup);

describe("admin Pay runs", () => {
  it("drafts a run for the chosen city, shows its statements and what waits outside, then finalizes it", async () => {
    const server = await startServer();
    await mount();
    expect(await screen.findByText("Not set: nothing is recovered automatically")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    await chooseCity();
    expect(server.calls.find((c) => c.url === "/admin/payroll/runs" && c.method === "get").params).toEqual({ cityId: "3" });

    fireEvent.click(screen.getByRole("button", { name: "Draft pay run" }));
    expect(await screen.findByText("Dee Test")).toBeTruthy();
    const [draft] = posts(server, "/admin/payroll/runs");
    expect(draft.body).toMatchObject({ cityId: 3, dataType: "daily" });
    expect(draft.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText(/2 unmatched claim\(s\), never deducted until matched; 1 ledger entry/)).toBeTruthy();
    expect(screen.getByText("no recovery limit is set; nothing was recovered automatically")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Void run" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
    expect(await screen.findByText("finalized")).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(posts(server, "/17/finalize")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Void run" })).toBeNull(); // a city admin cannot void
  });

  it("will not discard without a reason, and sends the reason when given", async () => {
    const server = await startServer();
    await mount();
    await chooseCity();
    fireEvent.click(await screen.findByRole("button", { name: /Open run\s*2026-11-01/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard draft" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(posts(server, "/17/discard")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Reason (needed to discard or void)"), { target: { value: "Wrong period" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(posts(server, "/17/discard")).toHaveLength(1));
    expect(posts(server, "/17/discard")[0].body).toEqual({ reason: "Wrong period" });
  });

  it("blocks finalizing while a statement is below zero", async () => {
    await startServer({ net: "-12.00" });
    await mount();
    await chooseCity();
    fireEvent.click(await screen.findByRole("button", { name: /Open run\s*2026-11-01/ }));
    expect(await screen.findByText(/A statement is below zero/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finalize" }).disabled).toBe(true);
  });

  it("lets a super admin set the recovery limit with a reason, and void a finalized run", async () => {
    const server = await startServer();
    server.run = { ...RUN, status: "finalized" };
    await mount({ superAdmin: true });
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "percent_of_available" } });
    fireEvent.change(screen.getByLabelText("Percent (0 to 100)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Client approved 50%" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    expect(await screen.findByText("Up to 50% of each payday's available pay")).toBeTruthy();
    expect(server.calls.find((c) => c.method === "put").body).toEqual({ recoveryLimit: { type: "percent_of_available", value: 50 }, reason: "Client approved 50%" });

    await chooseCity();
    fireEvent.click(await screen.findByRole("button", { name: /Open run\s*2026-11-01/ }));
    fireEvent.change(await screen.findByLabelText("Reason (needed to discard or void)"), { target: { value: "Bank details wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Void run" }));
    expect(await screen.findByText("voided")).toBeTruthy();
  });

  it("names the run's city in its view and in the confirmation", async () => {
    await startServer();
    await mount();
    await chooseCity();
    fireEvent.click(await screen.findByRole("button", { name: /Open run\s*2026-11-01/ }));
    expect(await screen.findByText("Test City", { selector: "p" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0].title).toMatch(/Test City, 2026-11-01 – 2026-11-07/);
  });
});

// Answers that arrive after the admin switched city must never put the earlier city's run on screen.
describe("admin Pay runs: late answers after a city switch", () => {
  const switchTo = async (id) => {
    fireEvent.change(screen.getByLabelText("City"), { target: { value: id } });
    await screen.findByText("New draft");
  };
  const settle = () => new Promise((r) => setTimeout(r, 50));
  const noRunShown = () => {
    expect(screen.queryByText("Dee Test")).toBeNull();
    expect(screen.queryByRole("button", { name: "Finalize" })).toBeNull();
  };

  it("opening a run, then switching city before it loads", async () => {
    const server = await startServer({ held: ["GET /admin/payroll/runs/17"] });
    await mount();
    await chooseCity();
    fireEvent.click(await screen.findByRole("button", { name: /Open run\s*2026-11-01/ }));
    await switchTo("5");
    server.release("GET /admin/payroll/runs/17");
    await settle();
    noRunShown();
    expect(screen.getByLabelText("City").value).toBe("5");
  });

  it("drafting a run, then switching city before the draft comes back", async () => {
    const server = await startServer({ held: ["POST /admin/payroll/runs"] });
    await mount();
    await chooseCity();
    fireEvent.click(screen.getByRole("button", { name: "Draft pay run" }));
    await switchTo("5");
    server.release("POST /admin/payroll/runs");
    await settle();
    noRunShown();
  });

  it("finalizing a run, then switching city before the result comes back", async () => {
    const server = await startServer({ held: ["POST /admin/payroll/runs/17/finalize"] });
    await mount();
    await chooseCity();
    fireEvent.click(await screen.findByRole("button", { name: /Open run\s*2026-11-01/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalize" }));
    await waitFor(() => expect(posts(server, "/17/finalize")).toHaveLength(1));
    await switchTo("5");
    server.release("POST /admin/payroll/runs/17/finalize");
    await settle();
    noRunShown();
    expect(screen.queryByText("finalized")).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installServer, removeShell, resetBrowser } from "../../../../test/fakeShell";

// The Pay with Everee button and dialog (#31) with made-up answers. Nothing leaves this machine, no money moves.
const RUN = { id: 17, city: "Test City", period_start: "2026-11-01", period_end: "2026-11-07", status: "finalized" };
const person = (id, name, amount, extra = {}) => ({ statementId: id, driverId: id, driverName: name, amount, eligible: true, blockers: [], worker: { linked: true, ready: true }, ...extra });
const previewOf = (over = {}) => ({
  environment: "sandbox", run: RUN,
  drivers: [
    person(1, "Dee Test", "100.00"), person(2, "Eli Test", "130.00"),
    person(3, "Fay Test", "20.00", { eligible: false, blockers: [{ code: "no_everee_worker", severity: "blocking", message: "this driver is not linked to an Everee worker", hint: "link_worker" }] }),
  ],
  summary: { drivers: 3, eligible: 2, blocked: 1, total: "230.00" },
  batchBlockers: [], canSubmit: true, confirm: { allowed: true, reason: null }, previewHash: "a".repeat(64), ...over,
});
const batchOf = (items, over = {}) => ({
  batch: { id: 5, runId: 17, drivers: items.length, total: "230.00", createdAt: "2026-11-04T12:00:00Z" },
  counts: { submitted: items.filter((i) => i.status === "submitted").length, paid: items.filter((i) => i.status === "paid").length, failed: items.filter((i) => i.status === "failed").length, unconfirmed: items.filter((i) => i.status === "unconfirmed").length },
  items, canRetry: items.some((i) => i.status === "failed"), ...over,
});
const item = (id, name, status, extra = {}) => ({ itemId: id, driverName: name, amount: "100.00", status, everee: {}, ...extra });

const startServer = async ({ preview = previewOf(), batches = [], post } = {}) => {
  const state = { preview, batches, posts: [], calls: [] };
  await installServer(async (config) => {
    state.calls.push(`${config.method} ${config.url}`);
    if (config.url === "/admin/payroll/everee/status") return { status: 200, data: { configured: true, environment: "sandbox" } };
    if (config.url.endsWith("/everee-preview")) return { status: 200, data: state.preview };
    if (config.url.endsWith("/everee-batches") && config.method === "get") return { status: 200, data: { batches: state.batches } };
    if (config.url.endsWith("/everee-batches") && config.method === "post") {
      const body = JSON.parse(config.data);
      state.posts.push(body);
      return post ? post(state, body) : { status: 200, data: {} };
    }
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async ({ superAdmin = true } = {}) => {
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const { default: PayWithEvereeButton } = await import("./PayWithEvereeButton.jsx");
  const { default: useEvereeAvailable } = await import("./useEvereeAvailable.js");
  const Host = () => { const on = useEvereeAvailable(); return on ? <PayWithEvereeButton run={RUN} onChanged={() => {}} /> : <p>no button</p>; };
  const store = configureStore({ reducer: { admin: (s = { isSuperAdmin: superAdmin }) => s } });
  return render(<Provider store={store}><MemoryRouter><Host /></MemoryRouter></Provider>);
};
const open = async () => { fireEvent.click(await screen.findByRole("button", { name: "Pay with Everee" })); };

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("Pay with Everee", () => {
  it("is offered only to a super admin on a server where Everee is set up", async () => {
    await startServer();
    await mount({ superAdmin: false });
    expect(await screen.findByText("no button")).toBeTruthy();
    cleanup();
    await startServer();
    await mount();
    expect(await screen.findByRole("button", { name: "Pay with Everee" })).toBeTruthy();
  });

  it("the first click only shows the preview; nothing is sent until the second, which names the count and the total", async () => {
    const server = await startServer();
    await mount();
    await open();
    const preview = await screen.findByRole("region", { name: "Everee payment preview" });
    expect(within(preview).getByText("Sandbox: Everee's test environment. No real money moves.")).toBeTruthy();
    expect(within(within(preview).getByRole("list", { name: "Drivers that will be paid" })).getAllByRole("listitem").length).toBe(2);
    const blocked = within(preview).getByRole("list", { name: "Drivers that will not be paid" });
    expect(within(blocked).getByText("This driver is not linked to an Everee worker")).toBeTruthy();
    expect(within(blocked).getByText("Link this driver to an Everee worker first.")).toBeTruthy();
    expect(server.posts).toEqual([]);
    expect(within(preview).getByRole("button", { name: "Confirm and pay 2 drivers, $230.00" })).toBeTruthy();
  });

  it("confirming sends the shown preview hash with a request ID, then shows the batch as sent and waiting, never as paid", async () => {
    const server = await startServer({
      post: (state) => { state.batches = [batchOf([item(1, "Dee Test", "submitted"), item(2, "Eli Test", "submitted")])]; return { status: 200, data: {} }; },
    });
    await mount();
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and pay 2 drivers, $230.00" }));
    const results = await screen.findByRole("region", { name: "Everee payment results" });
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0].previewHash).toBe("a".repeat(64));
    expect(server.posts[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(within(results).getAllByText("Sent to Everee").length).toBe(2);
    expect(within(results).queryByText("Paid")).toBeNull();
    expect(within(results).getByText(/A payment is paid only when Everee confirms the deposit/)).toBeTruthy();
  });

  it("a lost answer followed by another click repeats the SAME request ID, so it cannot be sent twice", async () => {
    let first = true;
    const server = await startServer({ post: () => { if (first) { first = false; return { status: 500, data: { message: "the payment request could not be completed; check the batch before trying again" } }; } return { status: 200, data: {} }; } });
    await mount();
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and pay 2 drivers, $230.00" }));
    await screen.findByText(/check the batch before trying again/);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and pay 2 drivers, $230.00" }));
    await waitFor(() => expect(server.posts).toHaveLength(2));
    expect(server.posts[1].requestId).toBe(server.posts[0].requestId);
  });

  it("when what would be paid changed, the new preview is shown, nothing was sent, and the next confirm uses a new request ID", async () => {
    const changed = previewOf({ previewHash: "b".repeat(64), summary: { drivers: 3, eligible: 1, blocked: 2, total: "100.00" }, drivers: [person(1, "Dee Test", "100.00")] });
    let first = true;
    const server = await startServer({
      post: () => { if (first) { first = false; return { status: 409, data: { message: "what would be paid has changed since the preview; review the new preview and confirm again", preview: changed } }; } return { status: 200, data: {} }; },
    });
    await mount();
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and pay 2 drivers, $230.00" }));
    expect(await screen.findByRole("button", { name: "Confirm and pay 1 driver, $100.00" })).toBeTruthy();
    expect(screen.getByText(/has changed since the preview/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and pay 1 driver, $100.00" }));
    await waitFor(() => expect(server.posts).toHaveLength(2));
    expect(server.posts[1].previewHash).toBe("b".repeat(64));
    expect(server.posts[1].requestId).not.toBe(server.posts[0].requestId);
  });

  it("cannot be confirmed by the person who finalized the run, or when the batch is blocked, and says why", async () => {
    await startServer({ preview: previewOf({ confirm: { allowed: false, reason: "you finalized this run; another super admin has to confirm the payment" } }) });
    await mount();
    await open();
    expect((await screen.findByRole("button", { name: /Confirm and pay/ })).disabled).toBe(true);
    expect(screen.getByText("You finalized this run; another super admin has to confirm the payment")).toBeTruthy();
    cleanup();
    await startServer({ preview: previewOf({ canSubmit: false, batchBlockers: [{ code: "payments_off", message: "sending payments to Everee is switched off" }] }) });
    await mount();
    await open();
    expect((await screen.findByRole("button", { name: /Confirm and pay/ })).disabled).toBe(true);
    expect(screen.getByText("Sending payments to Everee is switched off")).toBeTruthy();
  });

  it("shows each driver's result in words; paid only where Everee confirmed; failed can be retried and waiting can be checked", async () => {
    const server = await startServer({
      preview: previewOf({ drivers: [], summary: { drivers: 0, eligible: 0, blocked: 0, total: "0.00" }, canSubmit: false, batchBlockers: [{ code: "nobody_to_pay", message: "no driver in this run can be paid right now" }] }),
      batches: [batchOf([
        item(1, "Dee Test", "paid"), item(2, "Eli Test", "failed", { error: "Everee answered 422: Validation failed" }),
        item(3, "Gus Test", "unconfirmed"), item(4, "Hal Test", "submitted", { everee: { depositReturned: true } }),
      ])],
    });
    await mount();
    await open();
    const results = await screen.findByRole("region", { name: "Everee payment results" });
    expect(within(results).getByText("Paid")).toBeTruthy();
    expect(within(results).getByText("Not sent")).toBeTruthy();
    expect(within(results).getByText("Unconfirmed")).toBeTruthy();
    expect(within(results).getByText("Everee answered 422: Validation failed")).toBeTruthy();
    expect(within(results).getByText(/A bank returned this deposit/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Everee payment preview" })).toBeNull(); // nothing left to pay: only the results
    fireEvent.click(within(results).getByRole("button", { name: "Retry what failed" }));
    await waitFor(() => expect(server.calls).toContain("post /admin/payroll/everee-batches/5/retry"));
    fireEvent.click(within(results).getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(server.calls).toContain("post /admin/payroll/everee-batches/5/check"));
  });
  it("shows the unresolved claims and each driver's warning before the confirm button, without blocking it", async () => {
    await startServer({
      preview: previewOf({
        summary: { drivers: 3, eligible: 2, blocked: 1, total: "230.00", withWarnings: 1, pendingClaims: { total: 3, unresolved: 2, ambiguous: 1, review: 0 } },
        drivers: [
          person(1, "Dee Test", "100.00", { blockers: [{ code: "previous_payout_failed", severity: "disclose", message: "an earlier payment attempt failed; check that it did not go through before paying again" }] }),
          person(2, "Eli Test", "130.00"),
          person(3, "Fay Test", "20.00", { eligible: false, blockers: [{ code: "no_everee_worker", severity: "blocking", message: "this driver is not linked to an Everee worker" }] }),
        ],
      }),
    });
    await mount();
    await open();
    const note = await screen.findByRole("note", { name: "Read before confirming" });
    expect(within(note).getByText(/3 city claims are still unresolved/)).toBeTruthy();
    expect(within(note).getByText(/1 of the drivers below has a warning/)).toBeTruthy();
    const paid = within(screen.getByRole("list", { name: "Drivers that will be paid" }));
    expect(paid.getByText(/An earlier payment attempt failed; check that it did not go through/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm and pay 2 drivers, $230.00" }).disabled).toBe(false); // warn only
  });

  it("an open window re-reads the results by itself while payments wait, and tells the page when one is paid", async () => {
    const server = await startServer({
      preview: previewOf({ drivers: [], summary: { drivers: 0, eligible: 0, blocked: 0, total: "0.00" }, canSubmit: false, batchBlockers: [{ code: "nobody_to_pay", message: "no driver in this run can be paid right now" }] }),
      batches: [batchOf([item(1, "Dee Test", "submitted")])],
    });
    const { default: EvereePayDialog } = await import("./EvereePayDialog.jsx");
    const changed = vi.fn();
    render(<EvereePayDialog runId={17} cityName="Test City" refreshMs={40} onClose={() => {}} onChanged={changed} />);
    const results = await screen.findByRole("region", { name: "Everee payment results" });
    expect(within(results).queryByText("Paid")).toBeNull();
    server.batches = [batchOf([item(1, "Dee Test", "paid")])];
    expect(await within(results).findByText("Paid")).toBeTruthy();
    expect(changed).toHaveBeenCalled();
    expect(within(results).queryByRole("button", { name: "Check now" })).toBeNull();
  });

  it("the payment history shows an Everee payment beside the manual receipt, as verified by the system, even after the run is fully paid", async () => {
    const review = {
      run: RUN,
      drivers: [
        { statementId: 1, driverId: 1, driverName: "Dee Test", payoutStatus: "paid", eligible: false, amounts: { net: "100.00" }, blockers: [], payment: null,
          providerPayment: { provider: "everee", systemVerified: true, status: "paid", environment: "sandbox", providerReference: "pay-A", paidOn: "2026-11-09", confirmedAt: "2026-11-09T15:00:00Z", requestedByName: "Sam Super", initiatedAt: "2026-11-08T12:00:00Z", lastCheckedAt: "2026-11-09T15:05:00Z", returned: true, needsReview: true, note: null } },
        { statementId: 2, driverId: 2, driverName: "Eli Test", payoutStatus: "paid", eligible: false, amounts: { net: "50.00" }, blockers: [],
          payment: { paid_on: "2026-11-04", method: "cash", reference: "Cash handed over", recorded_by_name: "Sam Super" }, providerPayment: null },
      ],
      summary: { pendingClaims: { total: 0 } },
    };
    await installServer(async () => ({ status: 200, data: review }));
    const { default: RecordPaymentDialog } = await import("../RecordPaymentDialog.jsx");
    render(<MemoryRouter><RecordPaymentDialog runId={17} cityName="Test City" onClose={() => {}} onRecorded={() => {}} /></MemoryRouter>);
    const card = await screen.findByLabelText("Everee payment");
    expect(within(card).getByText(/Paid through Everee/)).toBeTruthy();
    expect(within(card).getByText(/verified by the system/)).toBeTruthy();
    expect(within(card).getByText(/sandbox: no real money/)).toBeTruthy();
    expect(within(card).getByText(/Reference pay-A/)).toBeTruthy();
    expect(within(card).getByText(/Pay date 2026-11-09/)).toBeTruthy();
    expect(within(card).getByText(/Sent by Sam Super/)).toBeTruthy();
    expect(within(card).getByText(/A bank returned this deposit/)).toBeTruthy();
    expect(screen.getAllByLabelText("Everee payment")).toHaveLength(1); // only the Everee driver
    expect(screen.getByText(/Cash handed over/)).toBeTruthy(); // the manual receipt is unchanged
  });
});

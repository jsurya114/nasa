import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installServer, removeShell, resetBrowser } from "../../../../test/fakeShell";

// "Pay to drivers" with the method Bank transfer (Everee) (#31, #213), with made-up answers. Nothing leaves this machine, no money moves.
const RUN = { id: 17, city: "Test City", period_start: "2026-11-01", period_end: "2026-11-07", status: "finalized" };
const person = (id, name, amount, extra = {}) => ({ statementId: id, driverId: id, driverName: name, amount, eligible: true, blockers: [], worker: { linked: true, ready: true }, ...extra });
const previewOf = (over = {}) => ({
  environment: "sandbox", run: RUN,
  drivers: [
    person(1, "Dee Test", "100.00"), person(2, "Eli Test", "130.00"),
    person(3, "Fay Test", "20.00", { eligible: false, blockers: [{ code: "no_everee_worker", severity: "blocking", message: "this driver is not linked to an Everee worker", hint: "link_worker" }], worker: { linked: false, ready: false } }),
  ],
  summary: { drivers: 3, eligible: 2, blocked: 1, total: "230.00" },
  batchBlockers: [], canSubmit: true, previewHash: "a".repeat(64), ...over,
});
const batchOf = (items, over = {}) => ({
  batch: { id: 5, runId: 17, drivers: items.length, total: "230.00", createdAt: "2026-11-04T12:00:00Z" },
  counts: { submitted: items.filter((i) => i.status === "submitted").length, paid: items.filter((i) => i.status === "paid").length, failed: items.filter((i) => i.status === "failed").length, unconfirmed: items.filter((i) => i.status === "unconfirmed").length },
  items, canRetry: items.some((i) => i.status === "failed"), ...over,
});
const item = (id, name, status, extra = {}) => ({ itemId: id, driverName: name, amount: "100.00", status, everee: {}, ...extra });
// What the manual review (the same dialog) returns for the run: three unpaid drivers.
const reviewOf = (drivers) => ({
  run: RUN,
  drivers: drivers ?? [1, 2, 3].map((id) => ({ statementId: id, driverId: id, driverName: ["", "Dee Test", "Eli Test", "Fay Test"][id], payoutStatus: "not_submitted", eligible: true, amounts: { net: ["", "100.00", "130.00", "20.00"][id] }, blockers: [], payment: null, providerPayment: null })),
  summary: { pendingClaims: { total: 0 } },
});

const startServer = async ({ preview = previewOf(), batches = [], post, act, configured = true, review = reviewOf() } = {}) => {
  const state = { preview, batches, posts: [], records: [], previews: [], calls: [] };
  await installServer(async (config) => {
    state.calls.push(`${config.method} ${config.url}`);
    if (config.url === "/admin/payroll/everee/status") return { status: 200, data: { configured, environment: "sandbox" } };
    if (config.url.endsWith("/everee-preview")) { state.previews.push(config.params); return { status: 200, data: state.preview }; }
    if (config.url.endsWith("/everee-batches") && config.method === "get") return { status: 200, data: { batches: state.batches } };
    if (config.url.endsWith("/everee-batches") && config.method === "post") {
      const body = JSON.parse(config.data);
      state.posts.push(body);
      return post ? post(state, body) : { status: 200, data: {} };
    }
    const acting = config.url.match(/\/everee-batches\/(\d+)\/(check|retry)$/);
    if (acting && config.method === "post" && act) return act(state, Number(acting[1]), acting[2]);
    if (config.url.endsWith("/record") && config.method === "post") {
      const body = JSON.parse(config.data);
      state.records.push(body);
      return { status: 200, data: { receipt: { drivers: 3, total: "250.00", paid_on: body.paidOn, method: body.method, reference: body.reference, recorded_by_name: "Sam Super" } } };
    }
    if (config.url === "/admin/payroll/payments/runs/17") return { status: 200, data: review };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async ({ superAdmin = true } = {}) => {
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const { default: RecordPaymentDialog } = await import("../RecordPaymentDialog.jsx");
  const store = configureStore({ reducer: { admin: (s = { isSuperAdmin: superAdmin }) => s } });
  return render(<Provider store={store}><MemoryRouter><RecordPaymentDialog runId={17} cityName="Test City" onClose={() => {}} onRecorded={() => {}} /></MemoryRouter></Provider>);
};
const methods = () => within(screen.getByLabelText("Payment method")).getAllByRole("option").map((o) => o.textContent);
const toPayment = async () => { fireEvent.click(await screen.findByRole("button", { name: "Continue with payment" })); await screen.findByLabelText("Payment method"); };
const choose = (value) => fireEvent.change(screen.getByLabelText("Payment method"), { target: { value } });
const pay = () => screen.getByRole("button", { name: "Pay" });
const summary = () => screen.findByRole("status", { name: "Payment summary" });

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("Pay to drivers: Bank transfer (Everee)", () => {
  it("has no pre-selected method; Everee is offered only to a super admin on a server where Everee is set up", async () => {
    await startServer();
    await mount();
    await toPayment();
    expect(screen.getByLabelText("Payment method").value).toBe("");
    await waitFor(() => expect(methods()).toEqual(["Choose a method", "Bank transfer (Everee)", "Cash", "Other"]));
    expect(screen.queryByLabelText("Reference / payment note")).toBeNull();
    cleanup();
    await startServer();
    await mount({ superAdmin: false });
    await toPayment();
    expect(methods()).toEqual(["Choose a method", "Cash", "Other"]);
    cleanup();
    await startServer({ configured: false });
    await mount();
    await toPayment();
    expect(methods()).toEqual(["Choose a method", "Cash", "Other"]);
  });

  it("choosing Everee previews the chosen drivers, names method, count and total, and only Pay sends them", async () => {
    const server = await startServer({
      post: (state) => { state.batches = [batchOf([item(1, "Dee Test", "submitted"), item(2, "Eli Test", "submitted")])]; return { status: 200, data: {} }; },
    });
    await mount();
    await toPayment();
    await waitFor(() => expect(methods()).toContain("Bank transfer (Everee)"));
    choose("everee");
    expect((await summary()).textContent).toBe("Bank transfer (Everee) · 2 drivers · $230.00");
    expect(server.previews).toEqual([{ statementIds: "1,2,3" }]);
    expect(screen.getByText("Sandbox: Everee's test environment. No real money moves.")).toBeTruthy();
    expect(screen.getByText("Fay Test cannot be paid yet")).toBeTruthy();
    expect(screen.getByText("Link this driver to an Everee worker first.")).toBeTruthy();
    expect(screen.queryByLabelText("Payment note")).toBeNull();
    expect(server.posts).toEqual([]);

    fireEvent.click(pay());
    const results = await screen.findByRole("region", { name: "Everee payment results" });
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]).toMatchObject({ previewHash: "a".repeat(64), statementIds: [1, 2, 3] });
    expect(server.posts[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(server.records).toEqual([]); // nothing was recorded by hand
    expect(screen.getByText("Submitted to Everee", { selector: "p" })).toBeTruthy();
    expect(within(results).getAllByText("Submitted to Everee").length).toBe(2);
    expect(within(results).queryByText("Transaction successful")).toBeNull();
    expect(within(results).getByText(/A payment is successful only when Everee confirms settlement/)).toBeTruthy();
  });

  it("only the chosen drivers are previewed and sent", async () => {
    const server = await startServer();
    await mount();
    fireEvent.click(await screen.findByLabelText(/Fay Test/));
    await toPayment();
    await waitFor(() => expect(methods()).toContain("Bank transfer (Everee)"));
    choose("everee");
    await summary();
    expect(server.previews).toEqual([{ statementIds: "1,2" }]);
    fireEvent.click(pay());
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0].statementIds).toEqual([1, 2]);
  });

  it("Cash and Other call no Everee; they need a payment note and record as before", async () => {
    const server = await startServer();
    await mount();
    await toPayment();
    choose("cash");
    expect(await summary()).toBeTruthy();
    fireEvent.click(pay());
    expect(await screen.findByText("Add a payment note (at least 3 characters).")).toBeTruthy();
    expect(screen.getByText("Confirm receipt before recording payment.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Payment note"), { target: { value: "Cash handed over" } });
    fireEvent.click(screen.getByLabelText(/I confirm the selected drivers have received/));
    fireEvent.click(pay());
    expect(await screen.findByText("Payment recorded")).toBeTruthy();
    expect(server.records).toHaveLength(1);
    expect(server.records[0]).toMatchObject({ method: "cash", reference: "Cash handed over" });
    expect(server.records[0].statementIds).toBeNull();
    expect(server.previews).toEqual([]);
    expect(server.posts).toEqual([]);
    expect(screen.getByText(/Note: Cash handed over/)).toBeTruthy();
  });

  it("a lost answer followed by another click repeats the SAME request ID, so it cannot be sent twice", async () => {
    let first = true;
    const server = await startServer({ post: () => { if (first) { first = false; return { status: 500, data: { message: "the payment request could not be completed; check the batch before trying again" } }; } return { status: 200, data: {} }; } });
    await mount();
    await toPayment();
    await waitFor(() => expect(methods()).toContain("Bank transfer (Everee)"));
    choose("everee");
    await summary();
    fireEvent.click(pay());
    await screen.findByText(/check the batch before trying again/);
    fireEvent.click(pay());
    await waitFor(() => expect(server.posts).toHaveLength(2));
    expect(server.posts[1].requestId).toBe(server.posts[0].requestId);
  });

  it("when what would be paid changed, the new summary is shown, nothing was sent, and the next Pay uses a new request ID", async () => {
    const changed = previewOf({ previewHash: "b".repeat(64), summary: { drivers: 3, eligible: 1, blocked: 2, total: "100.00" }, drivers: [person(1, "Dee Test", "100.00")] });
    let first = true;
    const server = await startServer({
      post: () => { if (first) { first = false; return { status: 409, data: { message: "what would be paid has changed since the preview; review the new preview and confirm again", preview: changed } }; } return { status: 200, data: {} }; },
    });
    await mount();
    await toPayment();
    await waitFor(() => expect(methods()).toContain("Bank transfer (Everee)"));
    choose("everee");
    await summary();
    fireEvent.click(pay());
    await waitFor(() => expect(screen.getByRole("status", { name: "Payment summary" }).textContent).toBe("Bank transfer (Everee) · 1 driver · $100.00"));
    expect(screen.getByText(/What would be paid changed since it was shown/)).toBeTruthy();
    fireEvent.click(pay());
    await waitFor(() => expect(server.posts).toHaveLength(2));
    expect(server.posts[1].previewHash).toBe("b".repeat(64));
    expect(server.posts[1].requestId).not.toBe(server.posts[0].requestId);
  });

  it("offers the Everee approval portal after submission without treating it as payment completion", async () => {
    const server = await startServer();
    await mount();
    await toPayment();
    await waitFor(() => expect(methods()).toContain("Bank transfer (Everee)"));
    choose("everee");
    await summary();
    fireEvent.click(pay());
    const approval = await screen.findByRole("link", { name: /Open Everee to approve/ });
    expect(approval.getAttribute("href")).toBe("https://app.everee.com");
    expect(approval.getAttribute("target")).toBe("_blank");
    expect(approval.getAttribute("rel")).toContain("noopener");
    expect(approval.getAttribute("rel")).toContain("noreferrer");
    expect(server.posts).toHaveLength(1);
    expect(server.records).toHaveLength(0);
    expect(screen.queryByText("Transaction successful")).toBeNull();
  });

  it("cannot be paid when the batch is blocked, and says why", async () => {
    await startServer({ preview: previewOf({ canSubmit: false, batchBlockers: [{ code: "payments_off", message: "sending payments to Everee is switched off" }] }) });
    await mount();
    await toPayment();
    await waitFor(() => expect(methods()).toContain("Bank transfer (Everee)"));
    choose("everee");
    expect(await screen.findByText("Sending payments to Everee is switched off")).toBeTruthy();
    expect(pay().disabled).toBe(true);
  });

  it("shows the unresolved claims and each driver's warning before Pay, without blocking it", async () => {
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
    await toPayment();
    await waitFor(() => expect(methods()).toContain("Bank transfer (Everee)"));
    choose("everee");
    const note = await screen.findByRole("note", { name: "Read before paying" });
    expect(within(note).getByText(/3 city claims are still unresolved/)).toBeTruthy();
    expect(within(note).getByText(/1 of the drivers has a warning/)).toBeTruthy();
    const payable = screen.getByRole("list", { name: "Drivers that will be paid" });
    const warned = within(payable).getAllByRole("listitem").find((row) => row.textContent.includes("Dee Test"));
    expect(within(warned).getByText(/An earlier payment attempt failed/)).toBeTruthy();
    expect(within(warned).getByText("$100.00")).toBeTruthy();
    await summary();
    expect(pay().disabled).toBe(false); // warn only
  });

  it("shows each driver's result in words; successful only where Everee confirmed; failed can be retried and waiting can be checked", async () => {
    const server = await startServer({
      batches: [batchOf([
        item(1, "Dee Test", "paid"), item(2, "Eli Test", "failed", { error: "Everee answered 422: Validation failed" }),
        item(3, "Gus Test", "unconfirmed"), item(4, "Hal Test", "submitted", { everee: { depositReturned: true } }),
      ])],
    });
    await mount();
    const results = await screen.findByRole("region", { name: "Everee payment results" });
    expect(within(results).getByText("Transaction successful")).toBeTruthy();
    expect(within(results).getByText("Not sent")).toBeTruthy();
    expect(within(results).getByText("Unconfirmed")).toBeTruthy();
    expect(within(results).getByText("Deposit returned")).toBeTruthy();
    expect(within(results).getByText("Everee answered 422: Validation failed")).toBeTruthy();
    expect(within(results).getByText(/A bank returned this deposit/)).toBeTruthy();
    fireEvent.click(within(results).getByRole("button", { name: "Retry what failed" }));
    await waitFor(() => expect(server.calls).toContain("post /admin/payroll/everee-batches/5/retry"));
    fireEvent.click(within(results).getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(server.calls).toContain("post /admin/payroll/everee-batches/5/check"));
  });

  it("pays in several goes but shows one box for the run, and the actions reach every batch that needs them", async () => {
    const first = batchOf([item(1, "Dee Test", "paid")], { batch: { id: 5, runId: 17, drivers: 1, total: "100.00", createdAt: "2026-11-04T12:00:00Z" } });
    const second = batchOf([item(2, "Eli Test", "submitted"), item(3, "Fay Test", "failed")], { batch: { id: 6, runId: 17, drivers: 2, total: "200.00", createdAt: "2026-11-05T12:00:00Z" } });
    const third = batchOf([item(4, "Gus Test", "submitted")], { batch: { id: 7, runId: 17, drivers: 1, total: "100.00", createdAt: "2026-11-06T12:00:00Z" } });
    const server = await startServer({ batches: [third, second, first] });
    await mount();
    const results = await screen.findByRole("region", { name: "Everee payment results" });
    expect(screen.getAllByRole("region", { name: "Everee payment results" })).toHaveLength(1);
    for (const name of ["Dee Test", "Eli Test", "Fay Test", "Gus Test"]) expect(within(results).getByText(name)).toBeTruthy();
    expect(within(results).getByText(/3 payments, last sent .* 4 drivers · \$400\.00/)).toBeTruthy();
    fireEvent.click(within(results).getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(server.calls).toContain("post /admin/payroll/everee-batches/7/check"));
    expect(server.calls).toContain("post /admin/payroll/everee-batches/6/check");
    expect(server.calls).not.toContain("post /admin/payroll/everee-batches/5/check");
    fireEvent.click(within(results).getByRole("button", { name: "Retry what failed" }));
    await waitFor(() => expect(server.calls).toContain("post /admin/payroll/everee-batches/6/retry"));
    expect(server.calls).not.toContain("post /admin/payroll/everee-batches/7/retry");
  });

  const batchSix = () => batchOf([item(2, "Eli Test", "failed")], { batch: { id: 6, runId: 17, drivers: 1, total: "100.00", createdAt: "2026-11-05T12:00:00Z" } });
  const batchSeven = () => batchOf([item(3, "Gus Test", "failed")], { batch: { id: 7, runId: 17, drivers: 1, total: "100.00", createdAt: "2026-11-06T12:00:00Z" } });
  const paidAfter = (state, id, name) => { state.batches = state.batches.map((b) => (b.batch.id === id ? batchOf([item(id, name, "paid")], { batch: b.batch }) : b)); return { status: 200, data: {} }; };

  it("a batch the server refuses does not stop the others: the later batch is still tried, the refusal is shown with its words, and the results refresh", async () => {
    const server = await startServer({
      batches: [batchSeven(), batchSix()],
      act: (state, id) => (id === 7 ? { status: 409, data: { message: "Review the earnings before retrying" } } : paidAfter(state, 6, "Eli Test")),
    });
    await mount();
    const results = await screen.findByRole("region", { name: "Everee payment results" });
    fireEvent.click(within(results).getByRole("button", { name: "Retry what failed" }));
    await waitFor(() => expect(server.calls).toContain("post /admin/payroll/everee-batches/6/retry"));
    expect(server.calls).toContain("post /admin/payroll/everee-batches/7/retry");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Gus Test: Review the earnings before retrying/);
    expect(screen.getByRole("alert").textContent).not.toMatch(/Eli Test/);
    expect(screen.getByRole("alert").textContent).toMatch(/The others were tried/);
    expect(await within(results).findByText("Transaction successful")).toBeTruthy(); // Eli, read again after the partial failure
    expect(server.calls.filter((c) => c === "post /admin/payroll/everee-batches/7/retry")).toHaveLength(1); // not tried again by itself
  });

  it("when an earlier batch goes through and a later one fails, the results still refresh and the failure names the driver", async () => {
    const waiting = (id, name, at) => batchOf([item(id, name, "submitted")], { batch: { id, runId: 17, drivers: 1, total: "100.00", createdAt: at } });
    const server = await startServer({
      batches: [waiting(7, "Gus Test", "2026-11-06T12:00:00Z"), waiting(6, "Eli Test", "2026-11-05T12:00:00Z")],
      act: (state, id) => (id === 7 ? paidAfter(state, 7, "Gus Test") : { status: 500, data: { message: "Everee could not be reached" } }),
    });
    await mount();
    const results = await screen.findByRole("region", { name: "Everee payment results" });
    fireEvent.click(within(results).getByRole("button", { name: "Check now" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Eli Test: Everee could not be reached/);
    expect(await within(results).findByText("Transaction successful")).toBeTruthy(); // Gus, refreshed although Eli failed
    expect(server.calls).toContain("post /admin/payroll/everee-batches/7/check");
    expect(server.calls).toContain("post /admin/payroll/everee-batches/6/check");
    expect(within(results).getByRole("button", { name: "Check now" }).disabled).toBe(false); // Eli can still be checked
  });

  it("the results re-read themselves while payments wait, and tell the page when one succeeds", async () => {
    const server = await startServer({ batches: [batchOf([item(1, "Dee Test", "submitted")])] });
    const { default: EvereeRunResults } = await import("./EvereeRunResults.jsx");
    const changed = vi.fn();
    render(<EvereeRunResults runId={17} refreshMs={40} onChanged={changed} />);
    const results = await screen.findByRole("region", { name: "Everee payment results" });
    expect(within(results).queryByText("Transaction successful")).toBeNull();
    server.batches = [batchOf([item(1, "Dee Test", "paid")])];
    expect(await within(results).findByText("Transaction successful")).toBeTruthy();
    expect(changed).toHaveBeenCalled();
    expect(within(results).queryByRole("button", { name: "Check now" })).toBeNull();
  });

  it("keeps refreshing a returned deposit and notifies history when it settles, even when paid counts do not change", async () => {
    const server = await startServer({ batches: [batchOf([item(1, "Dee Test", "paid", { everee: { depositReturned: true } })])] });
    const { default: EvereeRunResults } = await import("./EvereeRunResults.jsx");
    const changed = vi.fn();
    render(<EvereeRunResults runId={17} refreshMs={40} onChanged={changed} />);
    const results = await screen.findByRole("region", { name: "Everee payment results" });
    expect(within(results).getByText("Deposit returned")).toBeTruthy();
    await waitFor(() => expect(changed).toHaveBeenCalled());
    changed.mockClear();
    server.batches = [batchOf([item(1, "Dee Test", "paid", { everee: { depositReturned: false } })])];
    expect(await within(results).findByText("Transaction successful")).toBeTruthy();
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
    await startServer({ review });
    await mount();
    const card = await screen.findByLabelText("Everee payment");
    expect(within(card).getByText(/Deposit returned/)).toBeTruthy();
    expect(within(card).queryByText(/Transaction successful/)).toBeNull();
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

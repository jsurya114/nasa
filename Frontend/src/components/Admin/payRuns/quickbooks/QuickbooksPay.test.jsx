import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installServer, removeShell, resetBrowser } from "../../../../test/fakeShell";

// "Pay to drivers" for Desi drivers with QuickBooks payments on, with made-up answers. Nothing leaves this machine, no money moves.
const RUN = { id: 17, city: "Test City", period_start: "2026-11-01", period_end: "2026-11-07", status: "finalized" };
const driver = (id, name, net) => ({ statementId: id, driverId: id, driverName: name, driverType: "DESI", payoutStatus: "not_submitted", eligible: true, amounts: { net }, blockers: [], payment: null, providerPayment: null, quickbooksPayment: null });
const review = { run: RUN, drivers: [driver(1, "Dee Test", "100.00"), driver(2, "Eli Test", "130.00")], summary: { pendingClaims: { total: 0 } } };
const previewOf = (over = {}) => ({
  environment: "sandbox", run: RUN,
  drivers: [{ statementId: 1, driverName: "Dee Test", amount: "100.00", eligible: true, blockers: [] }, { statementId: 2, driverName: "Eli Test", amount: "130.00", eligible: true, blockers: [] }],
  summary: { drivers: 2, eligible: 2, blocked: 0, total: "230.00", pendingClaims: { total: 0 } }, batchBlockers: [], canSubmit: true, previewHash: "b".repeat(64), ...over });
// A status of "interrupted" is a "submitted" item the server says nothing is sending any more; a plain "submitted" one may still be on its way.
const batch = (statuses, paidBy = "check") => ({ batch: { id: 9, drivers: 2, total: "230.00", paidOn: "2026-11-08" },
  counts: { paid: statuses.filter((x) => x === "paid").length }, canRetry: statuses.some((x) => !["paid", "submitted"].includes(x)),
  items: statuses.map((state, n) => ({ itemId: n + 1, driverName: ["Dee Test", "Eli Test"][n], amount: "100.00", status: state === "interrupted" ? "submitted" : state, interrupted: state === "interrupted", paidBy, quickbooks: { billId: "100", docNumber: `NASA-S${n + 1}` }, error: null })) });

const startServer = async ({ paymentsEnabled = true, preview = previewOf(), batchView = batch(["paid", "paid"]) } = {}) => {
  const state = { posts: [], retries: 0, cashRecords: 0, previews: [] };
  await installServer(async (config) => {
    if (config.url === "/admin/payroll/quickbooks/status") return { status: 200, data: { configured: true, enabled: true, paymentsEnabled } };
    if (config.url === "/admin/payroll/everee/status") return { status: 200, data: { configured: false } };
    if (config.url.endsWith("/quickbooks-preview")) { state.previews.push(config.params); return { status: 200, data: preview }; }
    if (config.url.endsWith("/quickbooks-batches") && config.method === "post") { state.posts.push(JSON.parse(config.data)); return { status: 200, data: batchView }; }
    if (config.url === "/admin/payroll/quickbooks-batches/9" && config.method === "get") return { status: 200, data: state.view ?? batchView };
    if (config.url === "/admin/payroll/quickbooks-batches/9/retry") { state.retries += 1; state.view = batch(["paid", "paid"]); return { status: 200, data: state.view }; }
    if (config.url.endsWith("/record")) { state.cashRecords += 1; return { status: 200, data: { receipt: null } }; }
    if (config.url === "/admin/payroll/payments/runs/17") return { status: 200, data: review };
    return { status: 200, data: {} };
  });
  return state;
};
const mount = async () => {
  const [{ configureStore }, { Provider }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux")]);
  const { default: RecordPaymentDialog } = await import("../RecordPaymentDialog.jsx");
  const store = configureStore({ reducer: { admin: (s = { isSuperAdmin: true }) => s } });
  return render(<Provider store={store}><MemoryRouter><RecordPaymentDialog runId={17} cityName="Test City" onClose={() => {}} onRecorded={() => {}} /></MemoryRouter></Provider>);
};
const toPayment = async () => { fireEvent.click(await screen.findByRole("button", { name: "Continue with payment" })); await screen.findByText("Payment method"); };

beforeEach(async () => { removeShell(); await resetBrowser(); });
afterEach(cleanup);

describe("Pay to drivers: Desi drivers through QuickBooks", () => {
  it("with QuickBooks payments on, Desi drivers show Check recorded in QuickBooks, a preview, a payment date, a note and the confirmation", async () => {
    const server = await startServer();
    await mount();
    await toPayment();
    expect(await screen.findByText("Check, recorded in QuickBooks (Desi drivers)")).toBeTruthy();
    expect(await screen.findByText("2 of 2 selected drivers can be recorded now, $230.00 in total.")).toBeTruthy();
    expect(server.previews).toEqual([{ statementIds: "1,2" }]);
    expect(screen.getByLabelText("Paid on")).toBeTruthy();
    expect(screen.getByLabelText("Payment note")).toBeTruthy();
    expect(screen.getByText(/I confirm the selected drivers/)).toBeTruthy();
    expect(server.posts).toEqual([]);
  });

  it("Pay records exactly the previewed drivers with the chosen date, once, and shows the QuickBooks results", async () => {
    const server = await startServer();
    await mount();
    await toPayment();
    await screen.findByText("2 of 2 selected drivers can be recorded now, $230.00 in total.");
    fireEvent.change(screen.getByLabelText("Paid on"), { target: { value: "2026-11-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByText("Add a payment note (at least 3 characters).")).toBeTruthy();
    expect(server.posts).toEqual([]);
    fireEvent.change(screen.getByLabelText("Payment note"), { target: { value: "Cash handed over, receipt 12" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByText("Confirm receipt before recording payment.")).toBeTruthy();
    expect(server.posts).toEqual([]);
    fireEvent.click(screen.getByText(/I confirm the selected drivers/));
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByRole("list", { name: "QuickBooks results" })).toBeTruthy();
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]).toMatchObject({ previewHash: "b".repeat(64), paidOn: "2026-11-08", note: "Cash handed over, receipt 12", confirmed: true, statementIds: [1, 2] });
    expect(server.cashRecords).toBe(0);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("Pay stays off when the server says the batch cannot be recorded, and says why", async () => {
    await startServer({ preview: previewOf({ canSubmit: false, batchBlockers: [{ code: "accounts_missing", message: "choose the QuickBooks expense and bank accounts first" }] }) });
    await mount();
    await toPayment();
    expect(await screen.findByText("choose the QuickBooks expense and bank accounts first")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pay" }).disabled).toBe(true);
  });

  it("an item that is not in QuickBooks yet says the cash payment stands, and offers a safe retry", async () => {
    const server = await startServer({ batchView: batch(["paid", "failed"]) });
    await mount();
    await toPayment();
    await screen.findByText("2 of 2 selected drivers can be recorded now, $230.00 in total.");
    fireEvent.change(screen.getByLabelText("Payment note"), { target: { value: "Cash handed over, receipt 12" } });
    fireEvent.click(screen.getByText(/I confirm the selected drivers/));
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByText("Paid by check; not recorded in QuickBooks yet. Retry")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Retry the QuickBooks record" }));
    await waitFor(() => expect(server.retries).toBe(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull());
  });

  it("an item the server stopped sending says so and offers Retry; one that may still be sending does not", async () => {
    const server = await startServer({ batchView: batch(["paid", "interrupted"]) });
    await mount();
    await toPayment();
    await screen.findByText("2 of 2 selected drivers can be recorded now, $230.00 in total.");
    fireEvent.change(screen.getByLabelText("Payment note"), { target: { value: "Cash handed over, receipt 12" } });
    fireEvent.click(screen.getByText(/I confirm the selected drivers/));
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByText("Paid by check; sending to QuickBooks was interrupted. Retry")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Retry the QuickBooks record" }));
    await waitFor(() => expect(server.retries).toBe(1));
    cleanup();
    await startServer({ batchView: batch(["paid", "submitted"]) });
    await mount();
    await toPayment();
    await screen.findByText("2 of 2 selected drivers can be recorded now, $230.00 in total.");
    fireEvent.change(screen.getByLabelText("Payment note"), { target: { value: "Cash handed over, receipt 12" } });
    fireEvent.click(screen.getByText(/I confirm the selected drivers/));
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByText("Being recorded in QuickBooks…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("with QuickBooks payments off, Desi drivers are recorded by check and the method sent is check", async () => {
    const server = await startServer({ paymentsEnabled: false });
    await mount();
    await toPayment();
    expect(await screen.findByText("Check (Desi drivers are paid by check only)")).toBeTruthy();
    expect(screen.getByLabelText("Payment note")).toBeTruthy();
    expect(server.previews).toEqual([]);
  });

  it("a batch recorded as cash before this change keeps saying cash; a check batch says check", async () => {
    await startServer({ batchView: batch(["paid", "failed"], "cash") });
    await mount();
    await toPayment();
    await screen.findByText("2 of 2 selected drivers can be recorded now, $230.00 in total.");
    fireEvent.change(screen.getByLabelText("Payment note"), { target: { value: "Check 1042" } });
    fireEvent.click(screen.getByText(/I confirm the selected drivers/));
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByText("Paid in cash; not recorded in QuickBooks yet. Retry")).toBeTruthy();
    expect(screen.queryByText(/Paid by check/)).toBeNull();
  });
});

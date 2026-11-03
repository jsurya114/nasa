import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../../test/fakeShell";

vi.mock("../../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// Made-up entries, shaped as GET /admin/payroll/drivers/:id/balances returns them (#142, #145, #166).
const ENTRIES = [
  { id: 5, entry_type: "manual_claim", direction: "debit", amount: "100.00", reason: "Broken parcel", effective_date: "2026-11-01", exempt: false, outstanding: "70.00" },
  { id: 6, entry_type: "expense", direction: "debit", amount: "30.00", reason: "Lost scanner", effective_date: "2026-11-01", exempt: false, outstanding: "0.00" },
  { id: 7, entry_type: "manual_claim", direction: "debit", amount: "20.00", reason: "Exempt one", effective_date: "2026-11-01", exempt: true, outstanding: "0.00" },
  { id: 8, entry_type: "reimbursement", direction: "credit", amount: "9.00", reason: "Fuel", effective_date: "2026-11-01", exempt: false, outstanding: "9.00" },
];
const HISTORY = {
  entryId: 5,
  versions: [
    { entry: { id: 4, amount: "120.00", reason: "Broken parcel", effective_date: "2026-11-01", created_by: 2, created_at: "2026-11-01T10:00:00Z", voided_by: 9, entry_type: "manual_claim" }, edit: null },
    { entry: { id: 5, amount: "100.00", reason: "Broken parcel", effective_date: "2026-11-01", created_by: 2, created_at: "2026-11-02T10:00:00Z", voided_by: null, entry_type: "manual_claim",
      intended_payday: null, recovery_plan: null, installment_amount: null, claim_type: "Damaged Item", waybill: "WB1" }, edit: { reason: "Carrier lowered it" } },
  ],
  settlements: [{ id: 31, kind: "outside_repayment", amount: "30.00", settled_on: "2026-11-03", reference: "RCPT-1", reason: "Paid in cash", created_by: 2, reverses_settlement_id: null }],
  payRuns: [{ run_id: 1, run_status: "finalized", line_type: "recovery", amount: "-0.00", period_start: "2026-11-01", period_end: "2026-11-07" }],
};

const startServer = async (handlers = {}) => {
  const state = { posts: [] };
  await installServer(async (config) => {
    if (config.method === "post") {
      state.posts.push({ url: config.url, body: JSON.parse(config.data) });
      return handlers[config.url] ?? { status: 201, data: {} };
    }
    if (config.url === "/admin/payroll/ledger/5/history") return { status: 200, data: HISTORY };
    return { status: 200, data: {} };
  });
  return state;
};

const mount = async ({ isSuperAdmin = false, onChanged = vi.fn() } = {}) => {
  const { default: EntryManager } = await import("./EntryManager.jsx");
  render(<EntryManager entries={ENTRIES} isSuperAdmin={isSuperAdmin} onChanged={onChanged} />);
  return onChanged;
};
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(async () => {
  removeShell();
  await resetBrowser();
});
afterEach(cleanup);

describe("EntryManager", () => {
  it("lists what the driver owes, calls a hand-entered claim a penalty, and leaves out credits and exempt claims", async () => {
    await startServer();
    await mount();
    expect(screen.getByText("Penalty: Broken parcel")).toBeTruthy();
    expect(screen.getByText("Expense: Lost scanner")).toBeTruthy();
    expect(screen.queryByText(/Exempt one/)).toBeNull();
    expect(screen.queryByText(/Fuel/)).toBeNull();
    // a settled entry offers Edit and History but no Mark complete
    expect(screen.getAllByRole("button", { name: "Mark complete" })).toHaveLength(1);
  });

  it("marks part of a penalty repaid outside payroll, with a reference, then reloads", async () => {
    const server = await startServer();
    const onChanged = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(screen.getByLabelText("Amount settled (USD)").value).toBe("70.00");
    fill("Amount settled (USD)", "25");
    fill("Payment reference", "RCPT-9");
    fill("Reason", "Driver paid cash");
    fireEvent.click(screen.getByRole("button", { name: "Record repayment" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const { url, body } = server.posts[0];
    expect(url).toBe("/admin/payroll/ledger/5/settlements");
    expect(body).toMatchObject({ kind: "outside_repayment", amount: "25", reference: "RCPT-9", reason: "Driver paid cash" });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("offers a waiver to a super admin only, and a payroll deduction records nothing here", async () => {
    await startServer();
    await mount({ isSuperAdmin: false });
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(screen.getByRole("radio", { name: /Waived by NASA/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Deducted through payroll" }));
    expect(screen.getByText(/taken, and settled, by a pay run/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record repayment" })).toBeNull();
  });

  it("a super admin records a waiver without a payment reference", async () => {
    const server = await startServer();
    const onChanged = await mount({ isSuperAdmin: true });
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    fireEvent.click(screen.getByRole("radio", { name: "Waived by NASA" }));
    expect(screen.queryByLabelText("Payment reference")).toBeNull();
    fill("Reason for the waiver", "Approved by owner");
    fireEvent.click(screen.getByRole("button", { name: "Record waiver" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(server.posts[0].body).toMatchObject({ kind: "waiver", amount: "70.00", reason: "Approved by owner" });
    expect("reference" in server.posts[0].body).toBe(false);
  });

  it("shows the server's field error and keeps the same request ID on a retry", async () => {
    const server = await startServer({ "/admin/payroll/ledger/5/settlements": { status: 400, data: { message: "check the highlighted fields", errors: { reference: "give the payment reference or evidence of the repayment" } } } });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    fill("Reason", "Driver paid cash");
    fireEvent.click(screen.getByRole("button", { name: "Record repayment" }));
    expect(await screen.findByText(/payment reference or evidence/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record repayment" }));
    await waitFor(() => expect(server.posts).toHaveLength(2));
    expect(server.posts[1].body.requestId).toBe(server.posts[0].body.requestId);
  });

  it("edits from the entry's latest version, sends only what changed with the reason, and refuses an empty edit", async () => {
    const server = await startServer();
    const onChanged = await mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect((await screen.findByLabelText("Amount (USD)")).value).toBe("100.00");
    expect(screen.getByLabelText("Waybill").value).toBe("WB1");
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(await screen.findByText("Change at least one field")).toBeTruthy();
    expect(server.posts).toHaveLength(0);
    fill("Amount (USD)", "80");
    fill("Why are you editing this?", "Carrier lowered it");
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(server.posts[0].url).toBe("/admin/payroll/ledger/5/edit");
    expect(server.posts[0].body).toMatchObject({ reason: "Carrier lowered it", changes: { amount: "80" } });
    expect(Object.keys(server.posts[0].body.changes)).toEqual(["amount"]);
  });

  it("shows every version, the repayment and the pay run; a settlement is reversed with a reason", async () => {
    const server = await startServer();
    const onChanged = await mount();
    fireEvent.click(screen.getAllByRole("button", { name: "History" })[0]);
    expect(await screen.findByText(/Version 1 \(replaced or voided\): \$120\.00/)).toBeTruthy();
    expect(screen.getByText(/Version 2 \(current\): \$100\.00/)).toBeTruthy();
    expect(screen.getByText("Edited because: Carrier lowered it")).toBeTruthy();
    expect(screen.getByText(/Repaid outside payroll: \$30\.00 on 2026-11-03/)).toBeTruthy();
    expect(screen.getByText(/2026-11-01 – 2026-11-07 · finalized · recovery/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reverse" }));
    fill("Reason for the reversal", "Entered on the wrong driver");
    fireEvent.click(screen.getByRole("button", { name: "Confirm reversal" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(server.posts[0]).toMatchObject({ url: "/admin/payroll/ledger/settlements/31/reverse", body: { reason: "Entered on the wrong driver" } });
  });
});

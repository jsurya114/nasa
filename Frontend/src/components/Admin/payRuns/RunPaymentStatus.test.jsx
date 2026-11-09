import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { installServer, resetBrowser } from "../../../test/fakeShell.js";

// The Pay runs page's payment status for one run: a payment already with Everee (submitted or unconfirmed) is neither paid nor left to pay.
const driver = (id, payoutStatus) => ({ statementId: id, driverId: id, driverName: `Driver ${id}`, payoutStatus, eligible: true, amounts: { net: "10.00" }, blockers: [], payment: null });
const show = async (statuses) => {
  await installServer(async () => ({ status: 200, data: { run: { id: 17 }, drivers: statuses.map((s, i) => driver(i + 1, s)), summary: { pendingClaims: { total: 0 } } } }));
  const { default: RunPaymentStatus } = await import("./RunPaymentStatus.jsx");
  render(<RunPaymentStatus runId={17} cityName="Synthetic City" onRecorded={vi.fn()} />);
};
beforeEach(async () => {
  await resetBrowser();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("some paid, one processing, the rest left to pay: it counts each apart and still offers to pay the rest", async () => {
  await show(["paid", "submitted", "not_submitted", "not_submitted"]);
  expect((await screen.findByText(/1 of 4 drivers marked paid\./)).textContent).toContain("1 payment(s) processing.");
  expect(screen.getByText(/Choose the drivers and how they are paid\./)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Pay to drivers" })).toBeTruthy();
});

it("when everything left is processing, it says it is waiting for Everee and offers no new payment", async () => {
  await show(["paid", "submitted", "unconfirmed"]);
  expect((await screen.findByText(/Waiting for Everee to confirm the deposits\./)).textContent).toContain("2 payment(s) processing.");
  expect(screen.getByRole("button", { name: "View payment status" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Pay to drivers" })).toBeNull();
});

it("all paid: the payments are recorded and the records can be viewed", async () => {
  await show(["paid", "paid"]);
  expect(await screen.findByText(/All payments in this run are recorded\./)).toBeTruthy();
  expect(screen.getByRole("button", { name: "View payment records" })).toBeTruthy();
});

import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import EvereeBatchResults from "./EvereeBatchResults.jsx";
import ProviderPaymentLine from "./ProviderPaymentLine.jsx";

afterEach(cleanup);

describe("returned Everee deposits", () => {
  it.each(["paid", "submitted"])("history shows a returned %s payment as needing attention, preserving its evidence", (status) => {
    const payment = Object.freeze({ status, returned: true, systemVerified: status === "paid", providerReference: "test-payment", paidOn: "2026-11-05" });
    const { rerender } = render(<ProviderPaymentLine payment={payment} />);
    const history = screen.getByLabelText("Everee payment");
    expect(within(history).getByText(/Deposit returned/)).toBeTruthy();
    expect(within(history).queryByText(/Transaction successful/)).toBeNull();
    expect(within(history).getByText(/Reference test-payment/)).toBeTruthy();
    expect(within(history).getByRole("alert")).toBeTruthy();

    // Only a fresh server result clears the return flag; the original history remains unchanged.
    rerender(<ProviderPaymentLine payment={{ ...payment, status: "paid", returned: false }} />);
    expect(within(history).getByText(/Transaction successful/)).toBeTruthy();
    expect(within(history).queryByText(/Deposit returned/)).toBeNull();
    expect(payment.returned).toBe(true);
  });

  it.each(["paid", "submitted"])("results keep a returned %s payment checkable until the server confirms settlement", (status) => {
    const view = {
      batch: { createdAt: "2026-11-05T00:00:00Z", drivers: 1, total: "10.00" },
      counts: { paid: status === "paid" ? 1 : 0, submitted: status === "submitted" ? 1 : 0, unconfirmed: 0, failed: 0 },
      items: [{ itemId: 1, driverName: "Test Driver", amount: "10.00", status, everee: { depositReturned: true } }],
      canRetry: false,
    };
    const { rerender } = render(<EvereeBatchResults view={view} />);
    const results = screen.getByRole("region", { name: "Everee payment results" });
    expect(within(results).getByText("Deposit returned")).toBeTruthy();
    expect(within(results).queryByText("Transaction successful")).toBeNull();
    expect(within(results).getByRole("button", { name: "Check now" })).toBeTruthy();
    expect(within(results).getByText(/0 successful/)).toBeTruthy();

    rerender(<EvereeBatchResults view={{ ...view, counts: { ...view.counts, paid: 1, submitted: 0 }, items: [{ ...view.items[0], status: "paid", everee: { depositReturned: false } }] }} />);
    expect(within(results).getByText("Transaction successful")).toBeTruthy();
    expect(within(results).queryByText("Deposit returned")).toBeNull();
    expect(within(results).queryByRole("button", { name: "Check now" })).toBeNull();
  });
});

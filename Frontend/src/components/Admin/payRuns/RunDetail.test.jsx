import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RunDetail from "./RunDetail.jsx";

vi.mock("../../../utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../utils/confirmDialog", () => ({ confirmDialog: vi.fn() }));
const row = (id, name, flags = []) => ({ id, driver_id: id, driver_name: name, gross: "100.00", insurance: "10.00", reimbursements: "0.00", claim_deductions: "0.00", recoveries: "20.00", net: "70.00", carried_forward: "80.00", flags });
const mount = (statements) => render(<MemoryRouter><RunDetail detail={{
  run: { id: 1, city_id: 3, status: "draft", period_start: "2026-11-01", period_end: "2026-11-07", data_type: "weekly", recovery_limit: null },
  totals: row(0, ""), statements, waiting: {},
}} selectedCityId={3} cityName="Synthetic City" onClose={vi.fn()} onChanged={vi.fn()} /></MemoryRouter>);
afterEach(cleanup);

it("keeps pay, this run's deductions and debt separate, with an action for an unconfirmed advance", () => {
  mount([row(7, "Dee Test", [{ code: "advance_not_disbursed", message: "old message" }])]);
  expect(screen.getByText("Driver pay for this run")).toBeTruthy();
  expect(screen.getByText("Drivers still owe NASA")).toBeTruthy();
  expect(screen.getByText(/Cash handover is not confirmed/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /Review this driver/ }).getAttribute("href")).toBe("/admin/payroll?cityId=3&driverId=7");
  const statement = screen.getByText("Dee Test").closest("li");
  expect(within(statement).getByText("Still owes NASA").nextElementSibling.textContent).toBe("$80.00");
  fireEvent.click(within(statement).getByText("Full payment breakdown"));
  expect(within(statement).getByText("Insurance").nextElementSibling.textContent).toBe("−$10.00");
  expect(screen.getByText(/do not update this draft/)).toBeTruthy();
});

it("finds drivers and filters held deductions without changing the run's totals", () => {
  mount([row(7, "Dee Test"), row(8, "Eli Test", [{ code: "not_yet_due", message: "later" }])]);
  fireEvent.click(screen.getByRole("checkbox", { name: /Needs attention/ }));
  expect(screen.queryByText("Dee Test")).toBeNull();
  expect(screen.getByText("Eli Test")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
  expect(screen.getByRole("status").textContent).toBe("No drivers match these filters.");
  expect(screen.getByText("Driver pay for this run").nextElementSibling.textContent).toBe("$70.00");
});

it("explains an empty draft and prevents approving it", () => {
  mount([]);
  expect(screen.getByText("No earnings were included in this draft.")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Check earnings/ }).getAttribute("href")).toBe("/admin/dashboard");
  expect(screen.getByRole("button", { name: "Approve statements" }).disabled).toBe(true);
});

const advance = { id: "5843", entry_type: "advance", direction: "debit", amount: "100.00", recovery_plan: "installments", installment_amount: "50.00", effective_date: "2026-11-04", reason: "Cash" };

it("names an advance and its instalment in the full breakdown, and says why nothing was taken from it", () => {
  mount([{ ...row(7, "Dee Test", [{ code: "not_yet_due", entryId: "5843", message: "m" }]), recoveries: "0.00", records: [{ ...advance, taken: "0.00" }] }]);
  const statement = screen.getByText("Dee Test").closest("li");
  fireEvent.click(within(statement).getByText("Full payment breakdown"));
  expect(within(statement).getByText("Advances, penalties and other records")).toBeTruthy();
  expect(within(statement).getByText("Advance · dated 2026-11-04").nextElementSibling.textContent).toBe("$100.00");
  expect(within(statement).getByText("repaid in instalments of $50.00")).toBeTruthy();
  expect(within(statement).getByText("Taken in this run").nextElementSibling.textContent).toBe("$0.00");
  expect(within(statement).getByText(/Dated after this run ends \(2026-11-07\), so it is taken from a later pay run/)).toBeTruthy();
});

it("shows the instalment taken in this run, with no reason, and the no-limit reason for a record the limit blocked", () => {
  mount([{ ...row(7, "Dee Test"), records: [{ ...advance, effective_date: "2026-11-01", taken: "50.00" }] },
    { ...row(8, "Eve Test", [{ code: "recovery_limit_not_set", message: "m", entryIds: ["5900"] }]), recoveries: "0.00", records: [{ ...advance, id: "5900", taken: "0.00" }] }]);
  const taken = screen.getByText("Dee Test").closest("li");
  fireEvent.click(within(taken).getByText("Full payment breakdown"));
  expect(within(taken).getByText("Taken in this run").nextElementSibling.textContent).toBe("$50.00");
  expect(within(taken).queryByText(/Dated after|No recovery limit/)).toBeNull();
  const blocked = screen.getByText("Eve Test").closest("li");
  fireEvent.click(within(blocked).getByText("Full payment breakdown"));
  expect(within(blocked).getByText("No recovery limit is set, so nothing is taken automatically.")).toBeTruthy();
});

// How the dashboard words and works out the penalty figures (#166). Rule from the owner (3 Nov 2026): what a driver still owes
// as penalties and as other debts shows as soon as the records are saved, below the insurance deduction, and comes off the net
// payment: Net Payment = driver payment - insurance - penalties - others. The amounts are the server's outstanding balances
// (after repayments, settlements and pay-run allocations), so marking an entry complete lowers them. No dates and no pay run
// are needed.

const cents = (v) => Math.round(Number(v) * 100);
const ready = (penalty) => penalty?.status === "ready";

// { penalties, other, total } in dollars, or null while the figures are not there.
export const deductions = (penalty) => {
  if (!ready(penalty)) return null;
  const { penalties, other } = penalty.data.outstanding;
  return { penalties: cents(penalties) / 100, other: cents(other) / 100, total: (cents(penalties) + cents(other)) / 100 };
};

export const netAfter = (baseNet, penalty) => {
  const d = deductions(penalty);
  return d ? (cents(baseNet) - cents(d.total)) / 100 : Number(baseNet);
};

// The net line's label. While the deductions load, or if they fail, the net is marked not final, never shown as payable.
export const netLine = (penalty, baseLabel) => {
  if (!penalty?.expected) return { label: baseLabel, muted: false };
  if (penalty.status === "loading") return { label: `${baseLabel} (deductions loading, not final)`, muted: true };
  if (penalty.status === "error") return { label: `${baseLabel} (deductions not loaded, not final)`, muted: true };
  return { label: baseLabel, muted: false };
};

// What the Summary panel says when the figures are not there.
export const summaryNotice = (penalty) => {
  if (!penalty?.expected) return null;
  if (penalty.status === "loading") return "Loading…";
  if (penalty.status === "error") return "Could not be loaded; the net does not include penalties or others";
  return null;
};

// The extra Summary line, as ready-to-show text: "Penalty & Others" (red) below the insurance deduction.
export const summaryItems = (penalty) => {
  const notice = summaryNotice(penalty);
  const d = deductions(penalty);
  let afterInsurance = [];
  if (notice) afterInsurance = [{ kind: "notice", label: "Penalty & Others", text: notice }];
  else if (d && d.total > 0) afterInsurance = [{ kind: "deducted", label: "Penalty & Others", text: `-$${d.total.toFixed(2)}` }];
  return { afterInsurance, netLabel: netLine(penalty, "Net Driver Payment"), hasDeductions: Boolean(d && d.total > 0) };
};

const TEXT_KIND = { deducted: "text-red-600", notice: "text-red-600" };
export const summaryLook = (item) => {
  let tone;
  if (item.kind) tone = TEXT_KIND[item.kind];
  else if (item.isNegative) tone = "text-red-600";
  else if (item.muted) tone = "text-gray-500";
  else if (item.isBold) tone = "text-green-700 font-bold";
  else tone = "text-gray-600";
  return { label: tone, input: tone.replace(" font-bold", "") };
};

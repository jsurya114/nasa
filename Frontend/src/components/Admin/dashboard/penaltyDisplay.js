// How the dashboard words and works out the penalty figures (#166). Two different numbers, never mixed up:
// - this payday: what comes off the driver now, by how each record was created (all on the next payday, or its instalment),
//   under the recovery limit. The server gives it: an approved pay run's frozen figures, else a draft's, else an estimate
//   from the same calculator. It comes off the net.
// - still owed: the balance in all (penalties, and others), shown beside it. It never comes off the net and never implies the
//   whole amount is due this payday.
// Net Payment: the approved pay run's frozen net when there is one; a draft's net as a preview; otherwise the server's own
// calculation of the next pay run (reimbursements and credits included), marked as a preview until a pay run is approved. With no
// eligible pay rows nothing can be taken, and the table's own net is shown.

const cents = (v) => Math.round(Number(v) * 100);
const ready = (penalty) => penalty?.status === "ready";

// What the row shows, or null while the figures are not there.
export const rowInfo = (penalty) => {
  if (!ready(penalty)) return null;
  const { payday, outstanding } = penalty.data;
  return {
    source: payday.source, deducted: Number(payday.deducted), flags: payday.flags ?? [],
    penalties: Number(outstanding.penalties), other: Number(outstanding.other), owed: Number(outstanding.total),
  };
};

const SOURCE_NOTE = {
  approved: "Approved: already in the pay run net below.",
  draft: "Draft pay run: a preview, not yet approved.",
  estimate: "Preview: what the next pay run would take, by each record's arrangement.",
  none: "Choose a start and an end date, then Filter Data, to see this payday's deduction.",
};
export const sourceNote = (source) => SOURCE_NOTE[source];

// The Net Payment to show: { net, label, preview, muted }. baseNet is the table's own payment minus insurance.
export const netFor = (baseNet, penalty, baseLabel = "Net Payment") => {
  const base = Number(baseNet);
  if (penalty?.expected && penalty.status === "loading") return { net: base, label: `${baseLabel} (deductions loading, not final)`, preview: false, muted: true };
  if (penalty?.expected && penalty.status === "error") return { net: base, label: `${baseLabel} (deductions not loaded, not final)`, preview: false, muted: true };
  const info = rowInfo(penalty);
  if (!info) return { net: base, label: baseLabel, preview: false, muted: false };
  const { payday } = penalty.data;
  if (payday.source === "approved") return { net: Number(payday.net), label: `${baseLabel} (approved pay run)`, preview: false, muted: false };
  if (payday.source === "draft") return { net: Number(payday.net), label: `${baseLabel} preview (draft pay run, not approved)`, preview: true, muted: false };
  if (payday.source === "estimate" && payday.net !== null && payday.net !== undefined) {
    // The server's own calculation for the same earnings (reimbursements and credits included), not one rebuilt here. It is
    // an estimate whatever its value: it keeps the preview label even when it happens to equal the table's net.
    return { net: Number(payday.net), label: `${baseLabel} preview (before the pay run is approved)`, preview: true, muted: false };
  }
  return { net: base, label: baseLabel, preview: false, muted: false };
};

// The row is shown when something comes off this payday or something is still owed.
export const showRow = (penalty) => {
  const info = rowInfo(penalty);
  return Boolean(info && (info.deducted > 0 || info.owed > 0));
};

// What the Summary panel says when the figures are not there.
export const summaryNotice = (penalty) => {
  if (!penalty?.expected) return null;
  if (penalty.status === "loading") return "Loading…";
  if (penalty.status === "error") return "Could not be loaded; the net does not include this payday's deduction";
  return null;
};

// The extra Summary lines, as ready-to-show text: this payday's "Penalty & Others", and what is still owed.
export const summaryItems = (penalty, baseNet) => {
  const notice = summaryNotice(penalty);
  const info = rowInfo(penalty);
  let afterInsurance = [];
  if (notice) afterInsurance = [{ kind: "notice", label: "Penalty & Others", text: notice }];
  else if (info && showRow(penalty)) {
    afterInsurance = [
      { kind: "deducted", label: "Penalty & Others (this payday)", text: info.source === "none" ? "Choose dates" : `-$${info.deducted.toFixed(2)}` },
      { kind: "owed", label: "Still Owed (all)", text: `$${info.owed.toFixed(2)}` },
    ];
  }
  const net = netFor(baseNet, penalty, "Net Driver Payment");
  return { afterInsurance, net, hasRow: showRow(penalty) };
};

const TEXT_KIND = { deducted: "text-red-600", notice: "text-red-600", owed: "text-gray-700" };
export const summaryLook = (item) => {
  let tone;
  if (item.kind === "net") tone = item.preview ? "text-amber-700 font-bold" : "text-green-700 font-bold";
  else if (item.kind) tone = TEXT_KIND[item.kind];
  else if (item.isNegative) tone = "text-red-600";
  else if (item.muted) tone = "text-gray-500";
  else if (item.isBold) tone = "text-green-700 font-bold";
  else tone = "text-gray-600";
  return { label: tone, input: tone.replace(" font-bold", "") };
};

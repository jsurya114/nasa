// How the dashboard words the payroll figures (#166). One net is authoritative: the approved pay run's frozen net. The
// older "payment minus insurance" line stays only as an explanation, labelled as before claims and recoveries, and is never
// shown as a second payable net. A draft is a preview and says so.

const covered = (penalty) => penalty?.status === "ready" && penalty.data.period.status !== "none";

// The label (and whether it is muted) for the older net line.
export const netLine = (penalty, baseLabel) => {
  if (!penalty?.expected) return { label: baseLabel, muted: false };
  if (penalty.status === "loading") return { label: "Net before claims / recoveries (payroll figures loading, not final)", muted: true };
  if (penalty.status === "error") return { label: "Net before claims / recoveries (payroll figures not loaded, not final)", muted: true };
  if (covered(penalty)) return { label: "Net before claims / recoveries (see the pay run net)", muted: true };
  return { label: baseLabel, muted: false };
};

// The payable net from the pay run in these dates, or null. Approved is frozen; a preview is a draft nobody has approved.
export const payRunNet = (penalty) => {
  if (!covered(penalty)) return null;
  const { period } = penalty.data;
  const run = period.status === "approved" ? period.approved : period.preview;
  return { approved: period.status === "approved", net: run.net, label: period.status === "approved" ? "Net Payment (approved pay run)" : "Net Payment preview (draft pay run, not approved)" };
};

// What the Summary panel says when the figures are not there.
export const summaryNotice = (penalty) => {
  if (!penalty?.expected) return null;
  if (penalty.status === "loading") return "Loading…";
  if (penalty.status === "error") return "Could not be loaded; the net does not include claims or recoveries";
  return null;
};

// The extra lines of the Summary panel, as ready-to-show text. `info` is describePenalty(penalty). Kinds: deducted (red),
// net (the one payable net), outstanding, notice (loading or error).
export const summaryItems = (penalty, info) => {
  const notice = summaryNotice(penalty);
  const net = payRunNet(penalty);
  let afterInsurance = [];
  if (notice) afterInsurance = [{ kind: "notice", label: "Claims / Deductions", text: notice }];
  else if (info?.deducted != null) afterInsurance = [{ kind: "deducted", label: `Claims / Deductions this payday (${info.status})`, text: `-$${info.deducted}` }];
  const afterNet = [
    ...(net ? [{ kind: "net", approved: net.approved, label: net.label, text: `$${net.net}` }] : []),
    ...(info ? [{ kind: "outstanding", label: "Penalties Outstanding", text: `$${info.penalties}` }] : []),
  ];
  return { afterInsurance, afterNet, netLabel: netLine(penalty, "Net Driver Payment") };
};

// Colours for a Summary line: the one payable net is green (approved) or amber (preview); the older net is muted.
const TEXT_KIND = { deducted: "text-red-600", notice: "text-red-600", outstanding: "text-gray-700" };
export const summaryLook = (item) => {
  let tone;
  if (item.kind === "net") tone = item.approved ? "text-green-700 font-bold" : "text-amber-700 font-bold";
  else if (item.kind) tone = TEXT_KIND[item.kind];
  else if (item.isNegative) tone = "text-red-600";
  else if (item.muted) tone = "text-gray-500";
  else if (item.isBold) tone = "text-green-700 font-bold";
  else tone = "text-gray-600";
  return { label: tone, input: tone.replace(" font-bold", "") };
};

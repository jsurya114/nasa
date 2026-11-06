// How each state the server reports is shown to the driver: the label, the hint (translation keys) and the colour. Nothing technical is shown.
export const STATE_VIEW = Object.freeze({
  "not-started": { label: "psetStateNotStarted", hint: "psetHintNotStarted", tone: "warn" },
  creating: { label: "psetStateCreating", hint: "psetHintCreating", tone: "info" },
  "in-progress": { label: "psetStateInProgress", hint: "psetHintInProgress", tone: "warn" },
  verifying: { label: "psetStateVerifying", hint: "psetHintVerifying", tone: "info" },
  complete: { label: "psetStateComplete", hint: "psetHintComplete", tone: "good" },
  "needs-review": { label: "psetStateReview", hint: "psetHintReview", tone: "bad" },
  "service-unavailable": { label: "psetStateUnavailable", hint: "psetHintUnavailable", tone: "info" },
  "classification-required": { label: "psetStateClassify", hint: "psetHintClassify", tone: "info" },
});

export const TONE_CLASS = Object.freeze({
  good: "bg-green-50 text-green-800 ring-green-200",
  warn: "bg-amber-50 text-amber-900 ring-amber-200",
  bad: "bg-red-50 text-red-800 ring-red-200",
  info: "bg-brand-50 text-brand-700 ring-brand-100",
});

// The call to action for a state: start (a form), continue (a screen), check (read again) or none.
export const actionOf = (data) => {
  if (!data) return "none";
  if (data.state === "not-started") return data.canStart ? "start" : "none";
  if (data.state === "in-progress") return "continue";
  if (data.state === "creating") return data.canStart === false && data.agreementSigned === false ? "none" : "start"; // press again to look for the worker
  if (data.state === "verifying") return "check";
  return "none";
};

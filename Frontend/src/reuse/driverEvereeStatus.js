// How the Users page shows a driver's Everee onboarding status. The status itself is worked out by the server (Backend/services/admin/driverList.js)
// from NASA's own records; this file only says how each one is worded and coloured. Colour is never the only signal: every status has its own word.
export const EVEREE_STATUS = Object.freeze({
  complete: { label: "Onboarded", tone: "bg-green-100 text-green-800", chip: "Onboarded", hint: "Everee onboarding is complete. The driver is active for work and pay." },
  "in-progress": { label: "In progress", tone: "bg-blue-100 text-blue-800", chip: "In progress", hint: "The driver has started Everee onboarding but has not finished it." },
  "not-started": { label: "Not started", tone: "bg-amber-100 text-amber-800", chip: "Not started", hint: "The driver has not started Everee onboarding." },
  "needs-review": { label: "Needs review", tone: "bg-red-100 text-red-800", chip: "Needs review", hint: "An admin has to check this driver's Everee setup (an older or unverified link, or a possible existing worker). It is not something the driver can fix." },
  "not-required": { label: "Not needed", tone: "bg-gray-100 text-gray-700", chip: "Not needed (Desi)", hint: "Desi drivers do not use Everee." },
  "classification-required": { label: "Type not set", tone: "bg-gray-100 text-gray-700", chip: "Type not set", hint: "Set this driver as Local or Desi first. Only Local drivers onboard with Everee." },
  "service-unavailable": { label: "Everee not set up", tone: "bg-gray-100 text-gray-700", chip: "Everee not set up", hint: "Everee is not configured on this server, so no status can be shown." },
});

// Order of the status chips above the table.
export const STATUS_CHIPS = Object.freeze(["complete", "in-progress", "not-started", "needs-review", "not-required", "classification-required", "service-unavailable"]);

// What a Local driver still needs before Everee onboarding can work (from NASA's own records).
export const NEEDS = Object.freeze({
  no_phone: "Add a valid 10-digit phone number",
  agreement_not_signed: "Agreement not signed",
  one_word_name: "Needs a first and last name",
});

export const ISSUE_OPTIONS = Object.freeze([
  { value: "", label: "Any" },
  { value: "no_phone", label: "No valid phone number" },
  { value: "agreement_not_signed", label: "Agreement not signed" },
  { value: "one_word_name", label: "One-word name" },
]);

export const SORT_OPTIONS = Object.freeze([
  { value: "name", label: "Name" },
  { value: "status", label: "Everee status" },
  { value: "code", label: "Driver code" },
  { value: "city", label: "City" },
  { value: "type", label: "Driver type" },
  { value: "enabled", label: "Account" },
]);

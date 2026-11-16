// How the Users page shows a driver's payment setup status: Everee for a Local driver, QuickBooks for a Desi driver. The status itself is worked out by the
// server (Backend/services/admin/driverList.js) from NASA's own records; this file only says how each one is worded and coloured. Colour is never the only
// signal: every status has its own word.
export const EVEREE_STATUS = Object.freeze({
  complete: { label: "Onboarded", tone: "bg-green-100 text-green-800", chip: "Onboarded", hint: "Everee onboarding is complete. The driver is active for work and pay." },
  "in-progress": { label: "In progress", tone: "bg-blue-100 text-blue-800", chip: "In progress", hint: "The driver has started Everee onboarding but has not finished it." },
  "not-started": { label: "Not started", tone: "bg-amber-100 text-amber-800", chip: "Not started", hint: "The driver has not started Everee onboarding." },
  "needs-review": { label: "Needs review", tone: "bg-red-100 text-red-800", chip: "Needs review", hint: "An admin has to check this driver's Everee setup (an older or unverified link, or a possible existing worker). It is not something the driver can fix." },
  "not-required": { label: "Not needed", tone: "bg-gray-100 text-gray-700", chip: "Not needed", hint: "This driver does not use Everee." },
  "classification-required": { label: "Type not set", tone: "bg-gray-100 text-gray-700", chip: "Type not set", hint: "Set this driver as Local or Desi first. Only Local drivers onboard with Everee." },
  "service-unavailable": { label: "Everee not set up", tone: "bg-gray-100 text-gray-700", chip: "Not set up", hint: "Everee is not configured on this server, so no status can be shown." },
});

// The same statuses for a Desi driver, whose setup is the QuickBooks form in the driver app. Only the hints (and the "not set up" word) differ.
export const QUICKBOOKS_STATUS = Object.freeze({
  ...EVEREE_STATUS,
  complete: { ...EVEREE_STATUS.complete, hint: "The driver filled in the QuickBooks form and is linked to a QuickBooks vendor. They can be paid through QuickBooks." },
  "not-started": { ...EVEREE_STATUS["not-started"], hint: "The driver has not filled in the QuickBooks form yet." },
  "needs-review": { ...EVEREE_STATUS["needs-review"], hint: "An admin has to check this driver's QuickBooks link (a changed email or phone, a removed link, or a link to another QuickBooks company). It is not something the driver can fix." },
  "service-unavailable": { ...EVEREE_STATUS["service-unavailable"], label: "QuickBooks not set up", hint: "QuickBooks is not set up on this server, so no status can be shown." },
});

// The provider and the wording for one driver's row: Local drivers use Everee, Desi drivers use QuickBooks.
export const setupOf = (driver) => (driver.driver_type === "DESI" && driver.quickbooks_status
  ? { provider: "QuickBooks", status: driver.quickbooks_status, needs: driver.quickbooks_needs ?? [], words: QUICKBOOKS_STATUS }
  : { provider: driver.driver_type === "LOCAL" ? "Everee" : null, status: driver.everee_status, needs: driver.everee_needs ?? [], words: EVEREE_STATUS });

// Order of the status chips above the table.
export const STATUS_CHIPS = Object.freeze(["complete", "in-progress", "not-started", "needs-review", "not-required", "classification-required", "service-unavailable"]);

// What a driver still needs before the setup can work (from NASA's own records): a Local driver for Everee, a Desi driver for QuickBooks.
export const NEEDS = Object.freeze({
  no_phone: "Add a valid 10-digit phone number",
  agreement_not_signed: "Agreement not signed",
  one_word_name: "Needs a first and last name",
  no_email: "Add a valid email address",
});

export const ISSUE_OPTIONS = Object.freeze([
  { value: "", label: "Any" },
  { value: "no_phone", label: "No valid phone number" },
  { value: "agreement_not_signed", label: "Agreement not signed" },
  { value: "one_word_name", label: "One-word name" },
]);

export const SORT_OPTIONS = Object.freeze([
  { value: "name", label: "Name" },
  { value: "status", label: "Payment setup status" },
  { value: "code", label: "Driver code" },
  { value: "city", label: "City" },
  { value: "type", label: "Driver type" },
  { value: "enabled", label: "Account" },
]);

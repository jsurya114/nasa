import axios from "../../../redux/slice/axiosInstance";

// The Claims page's two reads. Both are read only: the claims of the admin's own cities (all of them for the super admin), and the cities to pick from.
export const listClaims = async (params, signal) => (await axios.get("/admin/claims", { params, signal })).data;
export const listCities = async () => (await axios.get("/admin/get-admin-cities")).data?.cities ?? [];

// What went wrong, in words for the person.
export const problemOf = (error) => (error?.response?.data?.message && typeof error.response.data.message === "string"
  ? error.response.data.message
  : "The claims could not be loaded. Check your connection and try again.");

// What has come off driver pay for one claim, in words, from the server's deduction history of the claim (every version of it). `none` shows nothing. The amounts
// are labelled for what they are: what was deducted in finalized runs is history, a paid correction's refund is named, and any amount still left to deduct is
// always shown, whatever the badge says. A finalized run is approval, not a payout, so "paid out" is said only when the statements are recorded as paid.
const PAYOUT_WORDS = Object.freeze({ finalized: "in a finalized run, not paid out yet", partly_paid: "partly paid out", paid: "paid out" });
const BADGES = Object.freeze({ full: "Deducted", partial: "Part deducted", refunded: "Deducted, then refunded" });
const positive = (value) => Number(value ?? 0) > 0;
export const deductionWords = (deduction, money) => {
  if (!deduction || deduction.state === "none") return null;
  const parts = [`${money(deduction.applied)} deducted in finalized runs`];
  if (positive(deduction.refunded)) parts.push(`${money(deduction.refunded)} refunded by paid corrections`);
  if (positive(deduction.left)) parts.push(`${money(deduction.left)} left to deduct`);
  const where = PAYOUT_WORDS[deduction.payout];
  return { label: BADGES[deduction.state] ?? "Deducted", detail: `${parts.join(", ")}${where ? ` · ${where}` : ""}` };
};

// How each claim status reads, and where its colour comes from. Colour is never the only signal: every status has its own words.
export const CLAIM_STATUS = Object.freeze({
  chargeable: { label: "Chargeable", tone: "bg-green-100 text-green-800", hint: "Matched to a driver. It comes off the driver's pay when a pay run that includes it is finalized." },
  exempt: { label: "Exempt", tone: "bg-gray-100 text-gray-700", hint: "Matched to a driver, but nothing is taken off pay for this city and claim type." },
  unresolved: { label: "Waiting for delivery history", tone: "bg-amber-100 text-amber-800", hint: "NASA cannot match this claim to a driver yet. It is matched again when the delivery history arrives." },
  ambiguous: { label: "Not clear which driver", tone: "bg-red-100 text-red-800", hint: "More than one driver or city fits this claim, so it is not matched until it is clear." },
  review: { label: "Held for review", tone: "bg-blue-100 text-blue-800", hint: "Held, never deducted, because the same claim was already entered by hand." },
});

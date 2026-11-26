import { typeOf } from "./driverTypes.js";

// One driver's payment state in the payment review, shared by the review list and the Desi drivers PDF so both always say the same thing.
export const paid = (d) => d.payoutStatus === "paid";
// A payment already with Everee (submitted, or unconfirmed) is not left to pay: it is not selected or selectable, and it waits for Everee to confirm.
export const processing = (d) => d.payoutStatus === "submitted" || d.payoutStatus === "unconfirmed";
export const payable = (d) => !paid(d) && !processing(d);

// The short status under the driver's name, and its tone: "paid" (green), "warning" (amber) or "muted" (grey).
export const statusOf = (d) => {
  if (paid(d)) return { label: "Paid", tone: "paid" };
  if (processing(d)) return { label: "Payment processing", tone: "warning" };
  if (typeOf(d) === "NONE") return { label: "Needs a driver type", tone: "warning" };
  if (d.eligible) return { label: "Awaiting payment", tone: "muted" };
  return { label: "Needs review", tone: "warning" };
};

// Why a driver still to pay is held back: the messages shown under the driver.
export const notesOf = (d) => (payable(d) ? d.blockers.filter((b) => b.code !== "already_paid").map((b) => b.message) : []);

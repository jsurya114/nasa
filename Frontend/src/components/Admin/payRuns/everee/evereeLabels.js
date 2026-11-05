// Words for the Everee payment screens (#31). "Paid" is shown only for an item Everee confirmed as deposited; anything else says what it is.

export const ITEM_STATUS = Object.freeze({
  submitted: { label: "Submitted to Everee", tone: "amber", help: "Waiting for approval in the Everee portal and for the deposit. Not paid yet." },
  paid: { label: "Transaction successful", tone: "green", help: "Everee confirmed the money was deposited." },
  returned: { label: "Deposit returned", tone: "red", help: "The bank returned this deposit. It needs attention in Everee before it can be treated as settled." },
  failed: { label: "Not sent", tone: "red", help: "Everee refused it. Nothing was paid; it can be tried again." },
  unconfirmed: { label: "Unconfirmed", tone: "red", help: "It is not known whether Everee took it. Check it in Everee before doing anything else." },
  not_submitted: { label: "Not sent", tone: "gray", help: "" },
});

export const TONE_CLASS = Object.freeze({
  green: "bg-green-50 text-green-800",
  amber: "bg-amber-50 text-amber-900",
  red: "bg-red-50 text-red-700",
  gray: "bg-gray-100 text-gray-700",
});

const HINTS = Object.freeze({
  link_worker: "Link this driver to an Everee worker first.",
  fix_driver_data: "Fix the driver's name or phone number first.",
});

export const sentence = (text) => {
  const t = String(text ?? "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
};

// The reasons a driver cannot be paid, as readable sentences.
export const blockerLines = (driver) =>
  (driver.blockers ?? []).flatMap((b) => [
    sentence(b.message),
    ...(b.hint && HINTS[b.hint] ? [HINTS[b.hint]] : []),
    ...(b.problems ?? []).map((p) => sentence(p.message)),
  ]);

export const readableError = (error, fallback) => error?.response?.data?.message ?? fallback;

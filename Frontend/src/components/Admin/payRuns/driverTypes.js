// Driver types in the payment review: Local drivers, Desi drivers and, when some drivers have no type yet, "Not set" (they cannot be paid).
export const TYPE_TABS = [
  { key: "LOCAL", label: "Local drivers", hint: "Local drivers can be paid in Cash in Hand or through Everee." },
  { key: "DESI", label: "Desi drivers", hint: "Desi drivers are paid in Cash in Hand only. They are never sent to Everee." },
  { key: "NONE", label: "Not set", hint: "These drivers have no type yet, so they cannot be paid. Set Local or Desi for them on the Drivers page." },
];

export const typeOf = (driver) => driver.driverType ?? "NONE";


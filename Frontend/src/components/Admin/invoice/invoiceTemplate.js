// NASA's own block on every invoice. A saved invoice keeps its own copy (the server stores the issuer and terms with it), so the PDF of an invoice
// made before a change here still prints what it was made with; these are only used when a saved invoice carries none.
export const ISSUER = Object.freeze({
  name: "NASA LOGISTICS CARRIERS",
  addressLines: Object.freeze(["ARLINGTON, TEXAS 76015"]),
  phone: "+1 (682) 699-3175",
  emails: Object.freeze(["nasalogisticscarriers@gmail.com", "Info@drivefornlc.com"]),
});

export const TERMS_TITLE = "TERMS AND CONDITIONS";
export const TERMS_TEXT =
  "This invoice covers the items or services listed for the billing period shown. Payment is due according to the terms agreed between NASA " +
  "Logistics Carriers and the billed party. Please include the invoice number with your payment and contact us if you have a billing question or discrepancy.";

export const MAX_ROWS = 7;

export const TYPE_LABEL = Object.freeze({ hourly: "Hourly", item: "Item-based" });
export const STATUS_LABEL = Object.freeze({ pending: "Pending", paid: "Payment received" });

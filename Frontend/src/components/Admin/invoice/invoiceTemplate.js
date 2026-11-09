// The fixed parts of NASA's invoice, as in the template the company supplied. Only the bill-to block, the invoice number, the schedule and the
// job lines change from one invoice to the next; everything here is printed as it stands.
export const COMPANY = Object.freeze({
  name: "NASA LOGISTICS CARRIERS",
  addressLines: Object.freeze(["2306 B MONTE CARLO DR,", "ARLINGTON. TEXAS 76015"]),
  phone: "+1 (682) 699-3175",
  email: "nasalogisticscarriers@gmail.com",
});

export const TERMS_TITLE = "TERMS AND CONDITIONS";
export const TERMS_TEXT =
  "\"Terms and Conditions\" or \"Terms of Service\" are a set of rules, guidelines, and legal agreements that govern the use of products, services, " +
  "websites, or applications provided by businesses and organizations. They are essential for establishing the terms of the relationship between the " +
  "service provider and the user, ensuring clarity, transparency, and protection of both parties' rights. Here's a closer look at the concept of " +
  "\"Terms and Conditions.\"";

// Pre-filled on a new invoice (the usual client). All of it can be changed in the form.
export const DEFAULT_BILL_TO = Object.freeze({
  name: "GOFO INC.",
  line1: "36-47 MAIN STREET,",
  line2: "FLUSHING, NY, 11354, USA",
});

export const MAX_ROWS = 7;

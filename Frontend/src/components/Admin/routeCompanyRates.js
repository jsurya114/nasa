// The company price fields of a route (issue #252). A weekly GOFO city that has a verified carrier statement takes its revenue from the statement, so its routes
// are not edited any more: the fields are hidden and the server keeps the prices a route already has. Those stored prices stay as the fallback for estimating a week
// that has no verified statement, and they come back as editable fields if the last statement is voided. Daily SpeedX cities keep them, and so does a weekly city
// until its first statement.
export const CARRIER_STATEMENT_LABEL = "Carrier statement";

export const companyRatesRetired = (city) => city?.city_type === "WEEKLY" && city?.has_verified_statements === true;

// The price inputs the form shows for the chosen city.
export const visiblePriceFields = (fields, city) => (companyRatesRetired(city) ? fields.filter(({ field }) => !field.startsWith("company")) : fields);

// What the route table shows in the company price column. A weekly route whose city has a published carrier statement shows what the carrier paid per delivery in the
// latest statement (the owner gets it from the server; it follows each weekly upload). Display only: any stored price is kept and shown beside it when it is not 0.
// Every other route shows its stored price.
export const companyPriceCell = (route) => {
  const statement = route.statementPrice;
  if (!statement) return route.companyRoutePrice;
  const stored = route.companyRoutePrice > 0 ? ` (stored price ${route.companyRoutePrice})` : "";
  return `${CARRIER_STATEMENT_LABEL}: $${statement.perDelivery} per delivery · ${statement.week}${stored}`;
};

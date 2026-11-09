// The company price fields of a route (issue #252). A weekly GOFO city that has a verified carrier statement takes its revenue from the statement, so its routes
// are not edited any more: the fields are hidden and the server keeps the prices a route already has. Those stored prices stay as the fallback for estimating a week
// that has no verified statement, and they come back as editable fields if the last statement is voided. Daily SpeedX cities keep them, and so does a weekly city
// until its first statement.
export const CARRIER_STATEMENT_LABEL = "Carrier statement";

export const companyRatesRetired = (city) => city?.city_type === "WEEKLY" && city?.has_verified_statements === true;

// The price inputs the form shows for the chosen city.
export const visiblePriceFields = (fields, city) => (companyRatesRetired(city) ? fields.filter(({ field }) => !field.startsWith("company")) : fields);

// What the route table shows in the company price column: always the stored price. A weekly GOFO route keeps 0.00 there, because its revenue comes from the
// carrier statement, not from a route price.
export const companyPriceCell = (route) => route.companyRoutePrice;

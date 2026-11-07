// The company price fields of a route (issue #252). A weekly GOFO city that has a verified carrier statement takes its revenue from the statement, so its routes
// no longer take company prices (the server stores 0 for them whatever is sent). Daily SpeedX cities keep them, and so does a weekly city until its first statement.
export const CARRIER_STATEMENT_LABEL = "Carrier statement";

export const companyRatesRetired = (city) => city?.city_type === "WEEKLY" && city?.has_verified_statements === true;

// The price inputs the form shows for the chosen city.
export const visiblePriceFields = (fields, city) => (companyRatesRetired(city) ? fields.filter(({ field }) => !field.startsWith("company")) : fields);

// What the route table shows in the company price column.
export const companyPriceCell = (route, city) => (companyRatesRetired(city) ? CARRIER_STATEMENT_LABEL : route.companyRoutePrice);

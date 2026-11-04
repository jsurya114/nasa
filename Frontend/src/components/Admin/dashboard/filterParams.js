// The request for "Filter Data": the form's choices turned into what the server is asked, in one place so the button and the
// restore of an earlier view (after leaving the page and coming back) ask the same thing.
// filters: { job, driver, route, startDate, endDate, paymentStatus, companyEarnings }
export const buildFilterParams = (filters, { limit, isSuperAdmin }) => {
  const hasFilters =
    filters.job !== "All" ||
    filters.driver !== "All" ||
    filters.route !== "All" ||
    filters.startDate ||
    filters.endDate ||
    filters.paymentStatus !== "All";

  const params = { page: 1, limit, dataType: "all" };

  if (!hasFilters) {
    // No filters applied - fetch all data without a date restriction
    params.allData = true;
  } else {
    if (filters.job !== "All") params.job = filters.job;
    if (filters.driver !== "All") params.driver = filters.driver;
    if (filters.route !== "All") params.route = filters.route;
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;
    if (filters.paymentStatus !== "All") params.paymentStatus = filters.paymentStatus;
  }

  if (isSuperAdmin && filters.companyEarnings) params.companyEarnings = filters.companyEarnings;
  return params;
};

// The summary request is the same without paging and the earnings flag.
export const summaryParamsOf = (params) => {
  const { page: _page, limit: _limit, companyEarnings: _earnings, ...rest } = params;
  return rest;
};

// The owner's revenue lines of the Dashboard summary (issue #252): delivery revenue, driver earnings and delivery margin from the shared definition the Insights page
// uses, so the two cannot differ. Only the super admin is sent these figures. A server that has not sent them yet (an older one) gets the old single line.
const usd = (value) => (String(value).startsWith("-") ? `-$${String(value).slice(1)}` : `$${value}`);

export const ownerRevenueRows = (data) => {
  if (data.deliveryRevenue === null || data.deliveryRevenue === undefined) {
    return [{ field: "companyEarnings", label: "Total Company Earnings", highlight: true }];
  }
  const estimate = data.revenueEstimated ? " (estimated)" : "";
  const rows = [
    { field: "deliveryRevenue", label: "Delivery Revenue", text: `${usd(data.deliveryRevenue)}${estimate}`, highlight: true },
    { field: "driverEarnings", label: "Driver Earnings (gross)", text: usd(data.driverEarnings) },
    { field: "deliveryMargin", label: "Delivery Margin", text: `${usd(data.deliveryMargin)}${estimate}`, highlight: true },
  ];
  if (data.unallocatedRevenue !== null && data.unallocatedRevenue !== undefined && Number(data.unallocatedRevenue) !== 0) {
    rows.push({ field: "unallocatedRevenue", label: "Unallocated (carrier)", text: usd(data.unallocatedRevenue) });
  }
  return rows;
};

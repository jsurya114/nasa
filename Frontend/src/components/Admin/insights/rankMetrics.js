// The metrics a city can be ranked by, the field of the server's answer each one reads, and how it is written.
export const RANK_METRICS = Object.freeze([
  { id: "revenue", label: "Delivery revenue", field: "earnedDeliveryRevenue", money: true },
  { id: "deliveries", label: "Deliveries", field: "deliveries", money: false },
  { id: "gross_margin", label: "Delivery margin", field: "grossMarginBeforeOverheads", money: true },
]);

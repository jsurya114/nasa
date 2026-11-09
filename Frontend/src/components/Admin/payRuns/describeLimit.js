import { formatMoney } from "../../../utils/money.js";

// Plain words for the payday recovery limit (#143). null means nothing is recovered automatically.
export const describeLimit = (limit) => {
  if (!limit) return "Not set: nothing is recovered automatically";
  if (limit.type === "percent_of_available") return `Up to ${limit.value}% of each payday's available pay`;
  return `Up to ${formatMoney(limit.value)} per payday`;
};

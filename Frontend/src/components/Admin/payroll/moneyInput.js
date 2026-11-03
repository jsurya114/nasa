// Only digits and one decimal point, at most two decimals: a minus sign, a letter or a third decimal cannot be typed.
export const cleanMoneyInput = (text) => {
  const [whole, ...rest] = String(text).replace(/[^\d.]/g, "").split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
};

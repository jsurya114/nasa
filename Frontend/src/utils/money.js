// Shows a money amount the server sent as text, for example "-12.34". Display only: never used to work out pay.
export const formatMoney = (value, lang = "en") => {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" }).format(n);
};

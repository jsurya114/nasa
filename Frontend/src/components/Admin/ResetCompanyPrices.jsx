import React, { useState } from "react";
import axios from "../../redux/slice/axiosInstance";
import { toast } from "../../utils/toast";

// Owner only: sets the company prices of every route in the chosen weekly city back to 0 ("no company rate"). Two steps, so a stray click changes nothing. Driver prices,
// daily cities and records already saved are not touched. The server checks the role again.
export const resetCompanyPricesRequest = async (job) => (await axios.post("/admin/routes/reset-company-prices", { job })).data;

const messageFor = (error) => error?.response?.data?.error || "The company prices could not be reset. Check your connection and try again.";

export default function ResetCompanyPrices({ city, onDone }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    try {
      const { routesReset } = await resetCompanyPricesRequest(city.job);
      toast.success(routesReset === 0 ? `${city.job}: company prices were already 0.` : `${city.job}: company prices reset to 0 on ${routesReset} route${routesReset === 1 ? "" : "s"}.`);
      setConfirming(false);
      onDone?.();
    } catch (error) {
      toast.error(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="px-3 py-1.5 text-xs rounded-md border border-line bg-white text-ink hover:bg-gray-100 font-medium whitespace-nowrap" data-testid="reset-company-prices">
        Reset company prices to 0
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-ink" role="alertdialog" aria-label="Confirm reset of company prices" data-testid="reset-company-prices-confirm">
      <span>Set the company route and double-stop prices of every {city.job} route to 0? Driver prices and saved records are not changed.</span>
      <button type="button" onClick={reset} disabled={busy} className="px-3 py-1.5 rounded-md bg-purple-700 text-white font-medium hover:bg-purple-800 disabled:opacity-60" data-testid="reset-company-prices-yes">{busy ? "Resetting…" : "Yes, reset"}</button>
      <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="px-3 py-1.5 rounded-md bg-gray-200 text-gray-700 font-medium hover:bg-gray-300 disabled:opacity-60">Cancel</button>
    </div>
  );
}

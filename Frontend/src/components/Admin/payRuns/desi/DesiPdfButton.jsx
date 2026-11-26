import React, { useState } from "react";
import { useSelector } from "react-redux";
import { FileDown } from "lucide-react";
import { buttonClass } from "../../payroll/formParts.jsx";
import { toLocalDateString } from "../../../../utils/dateRange.js";

// Super admin only: saves the Desi drivers of this pay run as a PDF, as they are listed here. The PDF code loads on the first click.
export default function DesiPdfButton({ drivers, run, cityName }) {
  const isSuperAdmin = useSelector((state) => state.admin?.isSuperAdmin === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!isSuperAdmin) return null;

  const download = async () => {
    setBusy(true);
    setError("");
    try {
      const { downloadDesiDriversPdf } = await import("./buildDesiDriversPdf.js");
      await downloadDesiDriversPdf({ drivers, run, cityName, today: toLocalDateString(new Date()) });
    } catch {
      setError("The PDF could not be made. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={download} disabled={busy} className={`${buttonClass} inline-flex items-center gap-2`}>
        <FileDown className="h-4 w-4" aria-hidden="true" />
        {busy ? "Making PDF…" : "Download Desi drivers PDF"}
      </button>
      {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

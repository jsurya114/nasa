import React, { useState } from "react";
import { buttonClass } from "../../payroll/formParts.jsx";
import EvereePayDialog from "./EvereePayDialog.jsx";

// The first click: opens the preview. Nothing is sent until the second, "Confirm and pay".
export default function PayWithEvereeButton({ run, driverIds = null, onChanged }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>Pay with Everee</button>
      {open && <EvereePayDialog key={run.id} runId={run.id} cityName={run.city} driverIds={driverIds} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

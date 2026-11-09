import React, { cloneElement, useId } from "react";
import InfoTip from "../../../reuse/InfoTip.jsx";

export const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20";
export const buttonClass = "min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold hover:border-brand-500 disabled:opacity-50";
export const primaryClass = "min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50";

// The label is linked to its input by id; the info icon sits beside the label, not inside it, so it does not change the field's name.
// The error sits outside the label too, linked with aria-describedby.
export function Field({ label, error, info, children }) {
  const errorId = useId();
  const inputId = useId();
  return (
    <div>
      <div className="flex items-center">
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">{label}</label>
        {info && <InfoTip label={label} text={info} />}
      </div>
      {cloneElement(children, { id: inputId, "aria-invalid": Boolean(error), "aria-describedby": error ? errorId : undefined })}
      {error && <p id={errorId} className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

import React, { cloneElement, useId } from "react";

export const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20";
export const buttonClass = "min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold hover:border-brand-500 disabled:opacity-50";
export const primaryClass = "min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50";

// The error sits outside the label, so the field keeps its short name; it is linked with aria-describedby.
export function Field({ label, error, children }) {
  const errorId = useId();
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {cloneElement(children, { "aria-invalid": Boolean(error), "aria-describedby": error ? errorId : undefined })}
      </label>
      {error && <p id={errorId} className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

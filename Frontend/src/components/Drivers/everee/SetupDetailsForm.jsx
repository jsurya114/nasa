import React, { useState } from "react";
import useTranslation from "../../../hooks/useTranslation.js";
import { validateDetails } from "./setupRules.js";

// The few details Everee needs that NASA does not keep: the home address (always) and a start date (only if NASA has none). Nothing is guessed or
// filled in for the driver. The values go to the server once and are not kept here after the form closes.
const FIELD = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base";

export default function SetupDetailsForm({ needsStartDate, busy, onSubmit, onCancel }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({ line1: "", line2: "", city: "", state: "", postalCode: "", startDate: "" });
  const [errors, setErrors] = useState({});
  const set = (name) => (e) => setValues((v) => ({ ...v, [name]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    const found = validateDetails(values, needsStartDate);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({
      homeAddress: { line1: values.line1.trim(), ...(values.line2.trim() && { line2: values.line2.trim() }), city: values.city.trim(), state: values.state.trim().toUpperCase(), postalCode: values.postalCode.trim() },
      ...(needsStartDate && { startDate: values.startDate }),
    });
  };

  const field = (name, label, props = {}) => (
    <div>
      <label htmlFor={`pset-${name}`} className="block text-sm font-medium text-ink">{t(label)}</label>
      <input
        id={`pset-${name}`}
        value={values[name]}
        onChange={set(name)}
        className={FIELD}
        aria-invalid={errors[name] ? "true" : undefined}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
        {...props}
      />
      {errors[name] && <span id={`${name}-error`} role="alert" className="mt-1 block text-xs text-red-700">{t(errors[name])}</span>}
    </div>
  );

  return (
    <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
      <p className="text-sm text-ink-muted">{t("psetFormIntro")}</p>
      {field("line1", "psetFieldLine1", { autoComplete: "address-line1", maxLength: 100 })}
      {field("line2", "psetFieldLine2", { autoComplete: "address-line2", maxLength: 100 })}
      {field("city", "psetFieldCity", { autoComplete: "address-level2", maxLength: 60 })}
      <div className="grid grid-cols-2 gap-3">
        {field("state", "psetFieldState", { autoComplete: "address-level1", maxLength: 2, placeholder: "TX" })}
        {field("postalCode", "psetFieldZip", { autoComplete: "postal-code", inputMode: "numeric", maxLength: 5 })}
      </div>
      {needsStartDate && field("startDate", "psetFieldStart", { type: "date", max: new Date().toISOString().slice(0, 10) })}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60">
          {busy ? t("saving") : t("psetStart")}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-xl border border-line bg-white px-5 font-semibold text-ink disabled:opacity-60">
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

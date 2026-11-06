import { useEffect, useRef, useState } from "react";
import { DRIVER_TYPE_LABEL } from "./driverType";

const OPTIONS = [
  { value: "LOCAL", label: `Change to ${DRIVER_TYPE_LABEL.LOCAL}` },
  { value: "DESI", label: `Change to ${DRIVER_TYPE_LABEL.DESI}` },
];

// Asks which type the selected drivers should get, and only then calls onConfirm(type). While a request runs (busy) nothing can be
// clicked twice and the modal cannot be closed. `summary` says how the visible selected drivers are split now (can be empty).
export default function DriverTypeModal({ count, summary, busy, onCancel, onConfirm }) {
  const [choice, setChoice] = useState("");
  const firstOption = useRef(null);

  useEffect(() => {
    firstOption.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const noun = count === 1 ? "driver" : "drivers";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="driver-type-title" className="card-surface w-full max-w-md p-5">
        <h2 id="driver-type-title" className="text-lg font-bold text-ink">Change Driver Type</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {count} {noun} selected.{summary ? ` ${summary}` : ""}
        </p>

        <fieldset className="mt-4 space-y-2" disabled={busy}>
          <legend className="sr-only">New driver type</legend>
          {OPTIONS.map((o, i) => (
            <label key={o.value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${choice === o.value ? "border-brand-500 bg-brand-50" : "border-line bg-white"}`}>
              <input
                ref={i === 0 ? firstOption : null}
                type="radio"
                name="driver-type"
                value={o.value}
                checked={choice === o.value}
                onChange={() => setChoice(o.value)}
              />
              {o.label}
            </label>
          ))}
        </fieldset>

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(choice)} disabled={!choice || busy} className="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Updating..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

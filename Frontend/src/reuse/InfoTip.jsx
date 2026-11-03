import React, { useId, useState } from "react";
import { Info } from "lucide-react";

// A small (i) next to a field that says, in plain words, what the field is for. Opens on hover, keyboard focus or tap, and closes
// on Escape or when focus leaves. The text is linked to the button for screen readers.
export default function InfoTip({ label, text }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-500 hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute left-0 top-7 z-20 w-64 max-w-[80vw] rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-snug text-white shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

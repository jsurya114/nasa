import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import useDebouncedValue from "../../../hooks/useDebouncedValue.js";
import InfoTip from "../../../reuse/InfoTip.jsx";
import { inputClass } from "./formParts.jsx";

const normalize = (text) => String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// A dropdown you can search (issue: Payroll page). Typing filters the names, after a short pause (debounced, so it does not
// filter on every key). Options are { id, name }. Arrow keys move, Enter picks, Escape closes. Editing the text after a choice
// clears the choice, so what is shown is always what is selected.
export default function SearchSelect({ label, info, options, value, onChange, placeholder = "Search", emptyText = "No matches", disabled = false, debounceMs = 250 }) {
  const listId = useId();
  const wrapper = useRef(null);
  const selected = options.find((o) => String(o.id) === String(value));
  const [text, setText] = useState(selected?.name ?? "");
  const [typed, setTyped] = useState(false); // the admin has typed since the last choice, so filter; otherwise show everything
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebouncedValue(text, debounceMs);

  // A choice made elsewhere (or cleared by a city change) is reflected in the box.
  useEffect(() => { setText(selected?.name ?? ""); setTyped(false); }, [selected?.name]);

  const shown = useMemo(() => {
    const q = normalize(query);
    return typed && q ? options.filter((o) => normalize(o.name).includes(q)) : options;
  }, [options, query, typed]);
  useEffect(() => { setActive(0); }, [shown]);

  useEffect(() => {
    const away = (e) => { if (wrapper.current && !wrapper.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const choose = (option) => {
    setText(option.name);
    setTyped(false);
    setOpen(false);
    onChange(String(option.id));
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(shown.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && shown[active]) { e.preventDefault(); choose(shown[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={wrapper} className="relative">
      <label className="block text-sm font-medium text-gray-700" htmlFor={`${listId}-input`}>
        {label}
        {info && <InfoTip label={label} text={info} />}
      </label>
      <input
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].id}` : undefined}
        autoComplete="off"
        className={inputClass}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setTyped(true);
          setOpen(true);
          if (value) onChange("");
        }}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && (
        <ul id={listId} role="listbox" aria-label={label} className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-white py-1 shadow-lg">
          {shown.length === 0 ? (
            <li role="status" className="px-3 py-2 text-sm text-ink-muted">{emptyText}</li>
          ) : shown.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${o.id}`}
              role="option"
              aria-selected={String(o.id) === String(value)}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setActive(i)}
              className={`min-h-11 cursor-pointer px-3 py-2 text-base ${i === active ? "bg-brand-50" : ""} ${String(o.id) === String(value) ? "font-semibold" : ""}`}
            >
              {o.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

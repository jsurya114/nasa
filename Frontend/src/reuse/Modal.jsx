import { useEffect, useRef } from "react";
import { X } from "lucide-react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const WIDTH = { md: "max-w-lg", lg: "max-w-2xl" };

// The one dialog the Add forms open in. It closes with the X button, Escape or a click on the backdrop, but never while `busy` (a save is
// running), so a half-sent form cannot be dismissed. A long form scrolls inside the dialog, not the page behind it. Focus moves into the
// dialog when it opens, stays inside while Tab is pressed, and goes back to the button that opened it when it closes.
export default function Modal({ title, onClose, busy = false, size = "md", children }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector("input, select, textarea") ?? panel.current?.querySelector(FOCUSABLE);
    first?.focus();

    const onKey = (e) => {
      if (e.key === "Escape" && !busyRef.current) {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`card-surface flex max-h-[calc(100dvh-1.5rem)] w-full ${WIDTH[size] ?? WIDTH.md} flex-col overflow-hidden sm:max-h-[calc(100dvh-2rem)]`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line bg-brand-50/60 px-4 py-3 sm:px-6">
          <h2 id="modal-title" className="text-lg font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-5 pt-1 sm:px-6">{children}</div>
      </div>
    </div>
  );
}

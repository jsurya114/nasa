// Class names and props shared by the Invoices page forms.
export const INPUT = "w-full bg-white text-ink placeholder:text-ink-muted/70 transition-shadow border-line min-h-11 px-3 py-2 border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/20 aria-[invalid=true]:border-red-500 disabled:bg-canvas disabled:text-ink-muted";

// Props for an input that shows `error`: marked invalid and described by the message under it.
export const invalid = (id, error) => ({ "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-error` : undefined });

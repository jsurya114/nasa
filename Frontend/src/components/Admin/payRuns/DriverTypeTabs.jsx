import { TYPE_TABS } from "./driverTypes.js";

// Each tab shows how many unpaid drivers it holds. The drivers of one tab are paid together, because the payment methods differ by type.
export default function DriverTypeTabs({ tab, counts, onChange, disabled }) {
  const shown = TYPE_TABS.filter((t) => t.key !== "NONE" || counts.NONE.total > 0);
  return (
    <div>
      <div role="tablist" aria-label="Driver type" className="flex flex-wrap gap-2">
        {shown.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            disabled={disabled}
            onClick={() => onChange(t.key)}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold ${tab === t.key ? "border-brand bg-brand text-white" : "border-line bg-white text-ink"}`}
          >
            {t.label} ({counts[t.key].unpaid})
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-ink-muted">{TYPE_TABS.find((t) => t.key === tab).hint}</p>
    </div>
  );
}

import React from "react";
import { RotateCcw } from "lucide-react";
import { PRESETS, describeRange } from "./insightsDates.js";

const fieldClass = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20";

// The header of the Insights page: the period (presets or two dates), the city and the record source. Every card, ranking and chart below reads
// these same filters, so they always agree. "Reset" puts everything back to Last 30 days and All cities.
export default function InsightsFilters({ filters, cities, citiesStatus, onRetryCities }) {
  const { preset, range, cityIds, source, problem, isDefault } = filters;
  const oneCity = cityIds.length === 1 ? String(cityIds[0]) : "";
  const manyCities = cityIds.length > 1;

  return (
    <section aria-label="Insights filters" className="card-surface space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Period</h2>
          {!problem && <p className="text-sm text-ink-muted" data-testid="range-heading">{describeRange(range)}</p>}
        </div>
        {!isDefault && (
          <button type="button" onClick={filters.reset} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />Reset filters
          </button>
        )}
      </div>

      <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            onClick={() => filters.setPreset(p.id)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/20 ${preset === p.id ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-brand-50"}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">From
            <input type="date" value={range.start} max={range.end || undefined} onChange={(e) => filters.setCustomRange(e.target.value, range.end)} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium">To
            <input type="date" value={range.end} min={range.start || undefined} onChange={(e) => filters.setCustomRange(range.start, e.target.value)} className={fieldClass} />
          </label>
          {problem && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{problem}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">City
          <select
            value={manyCities ? "many" : oneCity}
            disabled={citiesStatus !== "ready"}
            onChange={(e) => filters.setCities(e.target.value ? [Number(e.target.value)] : [])}
            className={fieldClass}
          >
            <option value="">All cities</option>
            {manyCities && <option value="many">{cityIds.length} cities selected</option>}
            {cities.map((c) => <option key={c.cityId} value={c.cityId}>{c.name}</option>)}
          </select>
          {citiesStatus === "error" && (
            <span role="alert" className="mt-1 block text-xs text-red-700">The city list could not be loaded. <button type="button" onClick={onRetryCities} className="font-semibold underline">Try again</button></span>
          )}
        </label>
        <label className="block text-sm font-medium">Record source
          <select value={source ?? ""} onChange={(e) => filters.setSource(e.target.value)} className={fieldClass}>
            <option value="">Daily and weekly</option>
            <option value="daily">Daily records only</option>
            <option value="weekly">Weekly records only</option>
          </select>
        </label>
      </div>
    </section>
  );
}

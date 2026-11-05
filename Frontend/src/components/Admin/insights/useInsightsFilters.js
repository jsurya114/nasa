import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { DEFAULT_PRESET, PRESETS, rangeForPreset, rangeProblem } from "./insightsDates.js";

// The filters of the Insights page, kept in the address (?preset=…&cities=…) so a view can be shared and the Back button works. Anything in the
// address that is not a valid value is ignored, so a hand-edited link can only ever show the defaults. Defaults: Last 30 days, all cities, both sources.
const PRESET_IDS = PRESETS.map((p) => p.id);
const SOURCES = ["daily", "weekly"];
const ID_TEXT = /^\d{1,9}$/;

const parseCities = (text) => [...new Set((text ?? "").split(",").filter((p) => ID_TEXT.test(p)).map(Number))].filter((n) => n > 0).sort((a, b) => a - b).slice(0, 50);

export default function useInsightsFilters(now = new Date()) {
  const [params, setParams] = useSearchParams();
  const rawPreset = params.get("preset");
  const preset = PRESET_IDS.includes(rawPreset) ? rawPreset : DEFAULT_PRESET;
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

  const range = useMemo(() => {
    if (preset !== "custom") return rangeForPreset(preset, now);
    return { start: params.get("start") ?? "", end: params.get("end") ?? "" };
    // `now` is a new object each render; the calendar day is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, params, todayKey]);
  const cityIds = useMemo(() => parseCities(params.get("cities")), [params]);
  const rawSource = params.get("source");
  const source = SOURCES.includes(rawSource) ? rawSource : null;
  const problem = rangeProblem(range);

  // Every change builds the address from the current filters, so one filter never drops another.
  const update = useCallback((changes) => {
    const next = { preset, start: range.start, end: range.end, cities: cityIds.join(","), source: source ?? "", ...changes };
    const search = new URLSearchParams();
    if (next.preset !== DEFAULT_PRESET) search.set("preset", next.preset);
    if (next.preset === "custom") { search.set("start", next.start ?? ""); search.set("end", next.end ?? ""); }
    if (next.cities) search.set("cities", next.cities);
    if (next.source) search.set("source", next.source);
    setParams(search, { replace: false });
  }, [preset, range, cityIds, source, setParams]);

  return {
    preset, range, cityIds, source, problem,
    isDefault: preset === DEFAULT_PRESET && cityIds.length === 0 && !source,
    setPreset: (id) => update(id === "custom" ? { preset: "custom", start: range.start, end: range.end } : { preset: id }),
    setCustomRange: (start, end) => update({ preset: "custom", start, end }),
    setCities: (ids) => update({ cities: [...new Set(ids)].sort((a, b) => a - b).join(",") }),
    setSource: (value) => update({ source: SOURCES.includes(value) ? value : "" }),
    reset: () => setParams(new URLSearchParams(), { replace: false }),
  };
}

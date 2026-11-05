import React, { useMemo, useState } from "react";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import InsightsFilters from "./insights/InsightsFilters.jsx";
import KpiCards from "./insights/KpiCards.jsx";
import CityRanking from "./insights/CityRanking.jsx";
import DataStatus from "./insights/DataStatus.jsx";
import TrendSection from "./insights/TrendSection.jsx";
import WeekdayChart from "./insights/WeekdayChart.jsx";
import CalendarHeatmap from "./insights/CalendarHeatmap.jsx";
import useInsightsFilters from "./insights/useInsightsFilters.js";
import useInsightsReport from "./insights/useInsightsReport.js";
import { paramsFor } from "./insights/insightsApi.js";
import { DAILY_MAX, daysInRange, effectiveInterval } from "./insights/insightsDates.js";

// The owner's business overview (#227). Read only: every figure comes from GET /admin/insights, which only the super admin may call and which
// recalculates nothing, changes no rate or claim, marks nobody paid and never calls Everee. The filters at the top apply to everything below.
// Headline figures with the previous-period comparison, trends over time, the busiest weekdays, a calendar and the top cities; drivers come next.
export default function Insights() {
  const filters = useInsightsFilters();
  const [metricId, setMetricId] = useState("revenue");
  const valid = !filters.problem;
  const cityKey = filters.cityIds.join(",");
  const params = useMemo(() => paramsFor(filters), [filters.range.start, filters.range.end, cityKey, filters.source]); // eslint-disable-line react-hooks/exhaustive-deps
  const rankingParams = useMemo(() => ({ ...params, rank_by: metricId, limit: 10 }), [params, metricId]);

  // Trends: the bucket size is the person's choice or follows the length of the period. The calendar needs daily buckets, so it reuses the trend
  // answer when that is already by day and otherwise asks for its own (a period over a year has no calendar).
  const [intervalChoice, setIntervalChoice] = useState("auto");
  const days = valid ? daysInRange(filters.range) : 0;
  const interval = effectiveInterval(intervalChoice, days);
  const trendParams = useMemo(() => ({ ...params, interval }), [params, interval]);
  const dailyParams = useMemo(() => ({ ...params, interval: "day" }), [params]);
  const trends = useInsightsReport("trends", trendParams, { enabled: valid });
  const daily = useInsightsReport("trends", dailyParams, { enabled: valid && interval !== "day" && days <= DAILY_MAX });
  const calendar = interval === "day" ? trends : daily;

  const cities = useInsightsReport("cities", {});
  const definitions = useInsightsReport("definitions", {});
  const overview = useInsightsReport("overview", params, { enabled: valid });
  const ranking = useInsightsReport("rankings/cities", rankingParams, { enabled: valid });

  const cityList = cities.report?.data?.cities ?? [];
  const selectedNames = filters.cityIds.map((id) => cityList.find((c) => c.cityId === id)?.name ?? `City ${id}`);
  // Choosing the city that is already the only filter clears it, so a click is also the way back.
  const chooseCity = (id) => filters.setCities(filters.cityIds.length === 1 && filters.cityIds[0] === id ? [] : [id]);

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />
      <main className="mx-auto max-w-6xl space-y-4 p-3 pb-28 sm:p-6 sm:pb-40">
        <div>
          <h1 className="text-2xl font-bold text-brand">Insights</h1>
          <p className="text-sm text-ink-muted">A read-only overview of deliveries and revenue. Nothing here changes pay, claims or payments.</p>
        </div>

        <InsightsFilters filters={filters} cities={cityList} citiesStatus={cities.status} onRetryCities={cities.reload} />

        {(filters.cityIds.length > 0 || filters.source) && (
          <p className="text-sm text-ink" data-testid="active-filters">
            Showing {filters.cityIds.length > 0 ? selectedNames.join(", ") : "all cities"}
            {filters.source ? `, ${filters.source} records only` : ""}.{" "}
            <button type="button" onClick={filters.reset} className="min-h-11 font-semibold text-brand underline">Show everything</button>
          </p>
        )}

        {!valid ? (
          <div className="card-surface p-5 text-sm text-ink-muted" data-testid="invalid-range">Choose a valid period to see the figures.</div>
        ) : (
          <>
            <KpiCards status={overview.status} report={overview.report} message={overview.message} onRetry={overview.reload} range={filters.range} definitions={definitions.report?.data?.definitions} />
            <TrendSection status={trends.status} report={trends.report} message={trends.message} onRetry={trends.reload} choice={intervalChoice} onChoice={setIntervalChoice} interval={interval} days={days} />
            <div className="grid gap-4 lg:grid-cols-2">
              <WeekdayChart status={trends.status} report={trends.report} message={trends.message} onRetry={trends.reload} />
              <CalendarHeatmap status={calendar.status} report={calendar.report} message={calendar.message} onRetry={calendar.reload} range={filters.range} days={days} />
            </div>
            <CityRanking status={ranking.status} report={ranking.report} message={ranking.message} onRetry={ranking.reload} metricId={metricId} onMetric={setMetricId} selectedCityIds={filters.cityIds} onSelectCity={chooseCity} />
            <DataStatus report={overview.report} />
          </>
        )}
      </main>
      <Nav />
    </div>
  );
}

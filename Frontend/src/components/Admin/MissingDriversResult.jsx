import React from "react";

// After a weekly upload: the enabled drivers of the cities in the file whose driver code is not in the file. The server decides; this only shows it.
// A warning, not an error: the upload is already stored. A server that sends nothing shows nothing. English only; admin screen.
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function MissingDriversResult({ missing }) {
  if (!missing) return null;
  const cityList = (missing.cities ?? []).join(", ");
  if (missing.checked === false) {
    return (
      <section className="card-surface mb-4 p-6" aria-label="Drivers missing from this file" data-testid="missing-drivers">
        <h2 className="mb-2 text-base font-semibold text-ink">Drivers missing from this file</h2>
        <p role="status" className="text-sm text-ink-muted">Could not check which drivers are missing. The upload itself was stored as usual.</p>
      </section>
    );
  }
  const byCity = (missing.drivers ?? []).reduce((groups, d) => ({ ...groups, [d.city]: [...(groups[d.city] ?? []), d] }), {});
  return (
    <section className="card-surface mb-4 p-6" aria-label="Drivers missing from this file" data-testid="missing-drivers">
      <h2 className="mb-2 text-base font-semibold text-ink">Drivers missing from this file</h2>
      {missing.total === 0 ? (
        <p role="status" className="text-sm text-ink">Every enabled driver of {cityList || "the cities in this file"} is in this file.</p>
      ) : (
        <>
          <p role="status" className="text-sm font-semibold text-amber-800">
            {plural(missing.total, "enabled driver")} of {cityList} {missing.total === 1 ? "is" : "are"} not in this file.
          </p>
          {Object.entries(byCity).map(([city, drivers]) => (
            <div key={city} className="mt-2">
              <p className="text-sm font-medium text-ink">{city}</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                {drivers.map((d) => <li key={d.driverId}>{d.name} · code {d.driverCode ?? "none"}</li>)}
              </ul>
            </div>
          ))}
          {missing.total > missing.shown && <p className="mt-2 text-sm text-ink-muted">Showing the first {missing.shown} of {missing.total}.</p>}
        </>
      )}
      <p className="mt-2 text-sm text-ink-muted">A driver can be missing for a good reason, such as time off. Pay, claims and the weekly data are not affected.</p>
    </section>
  );
}

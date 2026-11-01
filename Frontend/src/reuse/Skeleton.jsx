/*
 * Skeleton placeholders shown while data loads. They mirror the shape of the content that is coming,
 * so the page does not jump when it arrives. Each group is announced once to screen readers
 * ("Loading"); the grey shapes themselves are hidden from them. Motion stops under "reduce motion".
 */

export function Skeleton({ className = "" }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} />;
}

function LoadingRegion({ label, className = "", children }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Rows for inside a <tbody>; keeps the table's own header and column count. */
export function SkeletonTableRows({ rows = 5, cols = 5, label = "Loading" }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true" className="border-b border-line">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-3 py-4">
              <Skeleton className={`h-4 ${c === 0 ? "w-24" : c % 3 === 0 ? "w-12" : "w-20"}`} />
            </td>
          ))}
        </tr>
      ))}
      <tr className="sr-only">
        <td role="status">{label}</td>
      </tr>
    </>
  );
}

/** A stack of card-shaped placeholders, for lists and phone layouts. */
export function SkeletonList({ rows = 4, label = "Loading", className = "" }) {
  return (
    <LoadingRegion label={label} className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="h-8 w-16 shrink-0 rounded-lg" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

/** A whole page shell: header bar, a form card and a list card. Used while a screen's code loads. */
export function SkeletonPage({ label = "Loading" }) {
  return (
    <LoadingRegion label={label} className="min-h-dvh bg-canvas">
      <div aria-hidden="true" className="h-[calc(4rem+env(safe-area-inset-top))] bg-[#462976]" />
      <div aria-hidden="true" className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <div className="card-surface space-y-4 p-4 sm:p-6">
          <Skeleton className="h-6 w-48" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
          <Skeleton className="h-11 w-full rounded-xl sm:w-40" />
        </div>
        <div className="card-surface space-y-3 p-4 sm:p-6">
          <Skeleton className="h-5 w-36" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export default Skeleton;

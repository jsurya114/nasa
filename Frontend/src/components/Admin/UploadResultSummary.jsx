// What a weekly upload kept besides the pay data (issues #140, #141, #163): the claims read from the Claims Detail
// sheet and the carrier history saved from the report. English only; admin screen. Shows what the server answered and
// nothing it did not: a field the server leaves out (for example `notStored` for a city admin) is not shown.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const ProblemRows = ({ rows, total }) => {
  if (!rows?.length) return null;
  return (
    <div className="mt-2">
      <p className="text-sm font-medium text-ink">Rows that could not be read ({total}):</p>
      <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
        {rows.map((p, i) => <li key={`${p.row}-${i}`}>Row {p.row}: {p.message ?? p.reason}</li>)}
      </ul>
      {total > rows.length && <p className="mt-1 text-sm text-ink-muted">Showing the first {rows.length}. Fix these and upload again to see the rest.</p>}
    </div>
  );
};

const ClaimsPart = ({ claims }) => {
  if (!claims) return <p className="text-sm text-ink-muted">The server did not report on claims for this upload.</p>;
  if (claims.found === false) {
    return <p className="text-sm text-ink-muted">This file has no Claims Detail sheet, so no claims were read.</p>;
  }
  if (!claims.stored) {
    return (
      <div role="alert" className="text-sm">
        <p className="font-medium text-red-700">The claims in this file were not stored.</p>
        {claims.reason && <p className="mt-1 text-ink">{claims.reason}</p>}
        {claims.inFile > 0 && <p className="mt-1 text-ink-muted">{plural(claims.inFile, 'claim')} in the file. Nothing was deducted. The pay upload itself was not affected.</p>}
        <ProblemRows rows={claims.problemRows} total={claims.problems} />
      </div>
    );
  }
  const matched = claims.matched ?? { chargeable: 0, exempt: 0 };
  const waiting = claims.waiting ?? { unresolved: 0, ambiguous: 0 };
  return (
    <div className="text-sm">
      <p className="font-medium text-ink">{plural(claims.inFile, 'claim')} read from the file.</p>
      <ul className="mt-1 list-disc pl-5 text-ink">
        <li>New: {claims.inserted}. Already recorded: {claims.duplicates}. Changed amount (new version): {claims.amended}.</li>
        <li>Matched to a driver: {matched.chargeable} to charge, {matched.exempt} exempt (no deduction).</li>
        <li>Waiting for delivery history: {waiting.unresolved}. Not clear which driver or city: {waiting.ambiguous}.</li>
        {claims.held > 0 && <li>Held for review, because the same claim was already entered by hand: {claims.held}.</li>}
        {claims.notStored > 0 && <li>Not stored because they already belong to another city: {claims.notStored}.</li>}
      </ul>
      <p className="mt-1 text-ink-muted">Nothing is deducted until a pay run that includes the claim is finalized.</p>
      <ProblemRows rows={claims.problemRows} total={claims.problems} />
    </div>
  );
};

const HistoryPart = ({ history }) => {
  if (!history) return null;
  if (!history.saved) {
    return <p className="text-sm text-ink-muted">Carrier history was not saved{history.reason ? `: ${history.reason}` : '.'} The pay data was stored as usual.</p>;
  }
  return (
    <p className="text-sm text-ink-muted">
      Carrier history: {plural(history.recorded, 'new package record')}, {history.alreadyKnown} already known
      {history.problems > 0 ? `, ${plural(history.problems, 'row')} without a usable waybill or Delivery ID` : ''}.
      {history.leftOut > 0 ? ` ${plural(history.leftOut, 'row')} left out because of the routes you can manage.` : ''}
    </p>
  );
};

// result: the `data` of the weekly upload answer.
export default function UploadResultSummary({ result }) {
  if (!result) return null;
  return (
    <section className="card-surface mb-4 p-6" aria-label="What this upload also kept">
      <h2 className="mb-3 text-base font-semibold text-ink">Claims in this file</h2>
      <ClaimsPart claims={result.claims} />
      <div className="mt-4 border-t border-line pt-3">
        <HistoryPart history={result.assignmentHistory} />
      </div>
    </section>
  );
}

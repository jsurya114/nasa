import React, { useCallback, useEffect, useState } from "react";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import { SkeletonList } from "../../reuse/Skeleton.jsx";
import StatementList from "./statements/StatementList.jsx";
import ImportsWaiting from "./statements/ImportsWaiting.jsx";
import { exportStatementsCsv, listStatements, messageFor } from "./statements/statementsApi.js";
import { csvFileName } from "./statements/statementText.js";

const BUTTON = "min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20 disabled:opacity-50";

// The owner's GOFO import history (#252): the carrier's weekly bills that company revenue comes from, with their versions, unmatched charges, corrections and voids.
// There is no upload here: the weekly workbook is uploaded once under File Upload, and an upload that needs the owner waits below. Super admin only (the route and the server
// both check). Nothing here changes pay: statements are stored apart from payroll, and anything unmatched to a driver stays visible as unallocated.
export default function CarrierStatements() {
  const [status, setStatus] = useState("loading");
  const [statements, setStatements] = useState([]);
  const [message, setMessage] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus((current) => (current === "ready" ? current : "loading"));
    listStatements(controller.signal)
      .then((rows) => { if (!controller.signal.aborted) { setStatements(rows); setStatus("ready"); } })
      .catch((error) => { if (!controller.signal.aborted) { setMessage(messageFor(error)); setStatus("error"); } });
    return () => controller.abort();
  }, [version]);

  const download = async () => {
    setExportError(null);
    try {
      const url = URL.createObjectURL(new Blob([await exportStatementsCsv()], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFileName();
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) { setExportError(messageFor(error)); }
  };

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />
      <main className="mx-auto max-w-5xl space-y-4 p-3 pb-28 sm:p-6 sm:pb-40">
        <div>
          <h1 className="text-2xl font-bold text-brand">GOFO import history</h1>
          <p className="text-sm text-ink-muted">The carrier's weekly GOFO bill is where company revenue comes from. It comes in with the weekly upload under File Upload and is stored apart from payroll: it never changes what a driver is paid.</p>
        </div>
        <ImportsWaiting onChanged={reload} />
        <section aria-labelledby="statements-title" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="statements-title" className="text-lg font-bold text-ink">Statements</h2>
            <button type="button" className={BUTTON} onClick={download} disabled={status !== "ready" || statements.length === 0}>Export CSV</button>
          </div>
          {exportError && <p role="alert" className="text-sm text-red-700">{exportError}</p>}
          {status === "loading" && <SkeletonList rows={3} label="Loading carrier statements" />}
          {status === "error" && (
            <div role="alert" className="card-surface p-4">
              <p className="text-sm text-ink-muted">{message}</p>
              <button type="button" className={`${BUTTON} mt-2`} onClick={reload}>Try again</button>
            </div>
          )}
          {status === "ready" && statements.length === 0 && <p className="card-surface p-4 text-sm text-ink-muted" data-testid="statements-empty">No statement has been imported yet. Weekly GOFO figures stay estimates until a weekly upload brings one in.</p>}
          {status === "ready" && statements.length > 0 && <StatementList statements={statements} onChanged={reload} />}
        </section>
      </main>
      <Nav />
    </div>
  );
}

import React, { useEffect, useState } from "react";
import axios from "../../../redux/slice/axiosInstance";

// Whether payments are connected to Everee (#31), for a super admin. It shows which environment the backend is set up for and runs a
// read-only test call. Nothing is paid or changed in Everee. The token never reaches this page; it stays in the backend settings.

const buttonClass = "min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand disabled:opacity-50";
const badgeClass = (environment) => `rounded-full px-2 py-0.5 text-xs font-semibold ${environment === "production" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`;

export default function EvereePanel() {
  const [status, setStatus] = useState(undefined); // undefined: loading, null: could not be loaded
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    axios.get("/admin/payroll/everee/status").then(({ data }) => setStatus(data)).catch(() => setStatus(null));
  }, []);

  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      const { data } = await axios.post("/admin/payroll/everee/check");
      setResult(data);
    } catch (err) {
      setResult({ ok: false, reason: err.response?.data?.message ?? "The test could not be run", payCodes: [] });
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="card-surface p-4" aria-labelledby="everee">
      <div className="flex items-center gap-2">
        <h2 id="everee" className="text-base font-semibold text-ink">Everee payments</h2>
        {status?.environment && <span className={badgeClass(status.environment)}>{status.environment === "production" ? "Production" : "Sandbox"}</span>}
      </div>
      {status === undefined && <p className="mt-1 text-sm text-ink-muted">Loading…</p>}
      {status === null && <p role="alert" className="mt-1 text-sm text-red-700">The Everee status could not be loaded.</p>}
      {status && !status.configured && (
        <div className="mt-1 text-sm text-ink-muted">
          <p>Everee is not set up in the backend settings:</p>
          <ul className="mt-1 list-disc pl-5">{(status.problems ?? []).map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {status?.configured && <p className="mt-1 text-sm text-ink-muted">Set up for tenant {status.tenantId}. The test only reads the pay codes; no money moves.</p>}
      {status?.configured && (
        <button type="button" onClick={check} disabled={checking} className={`mt-3 ${buttonClass}`}>{checking ? "Testing…" : "Test connection"}</button>
      )}
      {result && (
        <div role="status" className="mt-3 text-sm">
          {result.ok ? (
            <>
              <p className="font-semibold text-green-700">Connected. Everee accepted the token.</p>
              <p className="mt-1 text-ink-muted">{result.payCodes.length === 0 ? "No pay codes are set up yet." : `Pay codes: ${result.payCodes.map((p) => p.label || p.code).join(", ")}`}</p>
            </>
          ) : (
            <p className="font-semibold text-red-700">Not connected: {result.reason}</p>
          )}
          {result.requestId && <p className="mt-1 text-xs text-ink-muted">Everee request ID (for support): {result.requestId}</p>}
        </div>
      )}
    </section>
  );
}

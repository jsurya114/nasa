import { useCallback, useEffect, useState } from "react";
import axios from "../../redux/slice/axiosInstance";
import Header from "../../reuse/Header";

const date = (value) => new Date(value).toLocaleDateString();

// The super admin's list of open account deletion requests (docs/ACCOUNT_DELETION.md). Completing one is shown as done
// only after the server confirms it; the server refuses the last super admin and a super admin's own request.
export default function DeletionRequests() {
  const [rows, setRows] = useState(null);
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState(null);

  const load = useCallback(async () => {
    setProblem("");
    try { setRows((await axios.get("/admin/account-deletions")).data.requests); } catch { setProblem("The requests could not be loaded."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const complete = async (row) => {
    if (working) return;
    if (!window.confirm(`Delete the ${row.userType} account of ${row.name}? Sign-in and contact details are removed; pay records are kept.`)) return;
    setWorking(row.id);
    setProblem("");
    try {
      await axios.post(`/admin/account-deletions/${row.id}/complete`);
      await load();
    } catch (error) {
      setProblem(error.response?.data?.message || "Not confirmed. Reload the list to see whether it was completed.");
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <h1 className="text-2xl font-bold text-brand">Deletion requests</h1>
        <p className="text-sm text-ink-muted">Complete each request within 30 days. Completing removes sign-in, contact details and push; deliveries, statements, payments and claims stay.</p>
        <p role="alert" className="min-h-5 text-sm text-red-700">{problem}</p>
        {rows === null ? <p role="status">Loading…</p> : rows.length === 0 ? <p>No open requests.</p> : (
          <ul className="mt-2 space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="card-surface flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <p className="font-semibold">{row.name} <span className="text-sm font-normal text-ink-muted">({row.userType})</span></p>
                  <p className="text-sm text-ink-muted">{row.email} · asked {date(row.requestedAt)} · due {date(row.dueBy)}</p>
                </div>
                <button type="button" disabled={working !== null} onClick={() => complete(row)} className="min-h-11 rounded-xl bg-red-700 px-4 font-semibold text-white disabled:opacity-50">
                  {working === row.id ? "Completing…" : "Complete deletion"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

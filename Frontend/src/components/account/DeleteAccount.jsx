import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "../../redux/slice/axiosInstance";

const date = (value) => (value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "");

// "Delete account" for a signed-in driver or admin (docs/ACCOUNT_DELETION.md). Explains what is removed and what NASA
// keeps, asks for the password, and shows the request's progress. Nothing is called deleted until the server says so.
export default function DeleteAccount({ area }) {
  const [state, setState] = useState({ phase: "loading" });
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const { data } = await axios.get(`/${area}/account-deletion`);
      setState({ phase: "ready", request: data.request, days: data.completionDays });
    } catch {
      setState({ phase: "error" });
    }
  }, [area]);
  useEffect(() => { load(); }, [load]);

  const send = async (method) => {
    if (busy) return;
    setBusy(true);
    setProblem("");
    try {
      const { data } = method === "post"
        ? await axios.post(`/${area}/account-deletion`, { password })
        : await axios.delete(`/${area}/account-deletion`);
      setPassword("");
      setState((s) => ({ ...s, request: data.request, days: data.completionDays ?? s.days }));
    } catch (error) {
      setProblem(error.response?.data?.message || "We could not confirm this. Check your connection, then reload this page to see the current status.");
    } finally {
      setBusy(false);
    }
  };

  if (state.phase === "loading") return <p role="status" className="p-6 text-ink-muted">Loading…</p>;
  if (state.phase === "error") {
    return (
      <div role="alert" className="p-6">
        <p className="text-ink">The deletion status could not be loaded.</p>
        <button type="button" onClick={load} className="mt-3 min-h-11 rounded-xl bg-brand px-5 font-semibold text-white">Try again</button>
      </div>
    );
  }

  const open = state.request?.status === "requested";
  return (
    <main className="mx-auto max-w-xl px-5 py-6 pb-[calc(env(safe-area-inset-bottom)+6rem)] text-ink">
      <h1 className="text-2xl font-semibold">Delete account</h1>

      {open ? (
        <section className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4" aria-live="polite">
          <h2 className="font-semibold">Deletion requested</h2>
          <p className="mt-1 text-sm">You asked on {date(state.request.requestedAt)}. A NASA super admin will complete it by {date(state.request.dueBy)}. Until then you can still sign in, and you can withdraw the request.</p>
          <button type="button" disabled={busy} onClick={() => send("delete")} className="mt-3 min-h-11 rounded-xl border border-ink/30 px-5 font-semibold disabled:opacity-50">
            {busy ? "Withdrawing…" : "Withdraw request"}
          </button>
        </section>
      ) : (
        <>
          <p className="mt-2 text-ink-muted">You can ask NASA to delete your account. A super admin completes it within {state.days ?? 30} days.</p>
          <h2 className="mt-5 font-semibold">Removed</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
            <li>Your sign-in: the email and password stop working on every device.</li>
            <li>{area === "driver" ? "Your phone number." : "Your city and Invoices access."}</li>
            <li>Notifications to your phones.</li>
          </ul>
          <h2 className="mt-4 font-semibold">Kept by NASA</h2>
          <p className="mt-1 text-sm text-ink-muted">Your name and the business records NASA must keep for pay and accounting: deliveries, pay statements, payments, claims and their history. Everee and QuickBooks keep their own records under their own policies.</p>

          <form className="mt-5" onSubmit={(e) => { e.preventDefault(); if (understood && password) send("post"); }}>
            <label htmlFor="delete-password" className="block text-sm font-medium">Your password</label>
            <input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 h-12 w-full rounded-xl border border-line px-4 text-base" />
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>I understand my account will be deleted and this cannot be undone once completed.</span>
            </label>
            <button type="submit" disabled={busy || !understood || !password} className="mt-4 min-h-12 w-full rounded-xl bg-red-700 font-semibold text-white disabled:opacity-50">
              {busy ? "Sending…" : "Request account deletion"}
            </button>
          </form>
        </>
      )}
      <p role="alert" className="mt-3 min-h-5 text-sm text-red-700">{problem}</p>
      <p className="mt-4 text-sm"><Link to="/support" className="underline">Help and support</Link> · <a href="/privacy-policy" className="underline">Privacy policy</a></p>
    </main>
  );
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { X } from "lucide-react";
import axios from "../../../../redux/slice/axiosInstance";
import { newRequestId } from "../../../../utils/requestId.js";
import EvereeBatchResults from "./EvereeBatchResults.jsx";
import EvereePreview from "./EvereePreview.jsx";
import { readableError } from "./evereeLabels.js";

const base = "/admin/payroll";
export const REFRESH_MS = 60_000; // how often an open window re-reads the results while payments are still waiting

// Pay a finalized run through Everee (#31): the server's preview, then ONE confirm click that sends the exact preview it showed. The confirm
// carries a request ID that stays the same until the preview changes, so a repeated click or a lost answer never sends twice. The result is
// read back from the server; nothing here decides what is paid.
export default function EvereePayDialog({ runId, cityName, onClose, onChanged, refreshMs = REFRESH_MS }) {
  const [state, setState] = useState({ status: "loading", preview: null, batches: [], message: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const confirmId = useRef({ hash: null, requestId: null });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (signal) => {
    try {
      const [preview, batches] = await Promise.all([
        axios.get(`${base}/runs/${runId}/everee-preview`, { signal }),
        axios.get(`${base}/runs/${runId}/everee-batches`, { signal }),
      ]);
      if (signal?.aborted || !mounted.current) return;
      setState({ status: "ready", preview: preview.data, batches: batches.data?.batches ?? [], message: "" });
    } catch (error) {
      if (signal?.aborted || !mounted.current) return;
      setState({ status: "error", preview: null, batches: [], message: readableError(error, "Everee payments could not be loaded.") });
    }
  }, [runId]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const run = async (action, failure) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(readableError(error, failure));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const confirm = () => run(async () => {
    const { preview } = state;
    if (confirmId.current.hash !== preview.previewHash) confirmId.current = { hash: preview.previewHash, requestId: newRequestId() };
    try {
      await axios.post(`${base}/runs/${runId}/everee-batches`, { requestId: confirmId.current.requestId, previewHash: preview.previewHash });
    } catch (error) {
      // What would be paid changed since it was shown: show the new preview and let the person confirm again.
      if (error.response?.status === 409 && error.response.data?.preview) setState((s) => ({ ...s, preview: error.response.data.preview }));
      else await load(); // an answer that was lost may still have created the batch: show what the server has
      throw error;
    }
    await load();
    onChanged?.();
  }, "The payment could not be confirmed. Look at the results below before trying again; pressing confirm again will not send it twice.");

  // While payments wait for Everee, the open window reads the server's results again every minute (a read only: Everee is checked by the server
  // every 15 minutes, or at once with Check now). A failed read is ignored; the last results stay on screen.
  const waiting = state.batches.some((b) => b.counts.submitted + b.counts.unconfirmed > 0);
  const paidCount = useRef(0);
  useEffect(() => { paidCount.current = state.batches.reduce((n, b) => n + b.counts.paid, 0); }, [state.batches]);
  useEffect(() => {
    if (!waiting || busy) return undefined;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const [preview, batches] = await Promise.all([
          axios.get(`${base}/runs/${runId}/everee-preview`, { signal: controller.signal }),
          axios.get(`${base}/runs/${runId}/everee-batches`, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted || !mounted.current) return;
        const list = batches.data?.batches ?? [];
        setState((s) => ({ ...s, status: "ready", preview: preview.data, batches: list }));
        if (list.reduce((n, b) => n + b.counts.paid, 0) > paidCount.current) onChanged?.();
      } catch {
        // keep showing the last results; the next minute tries again
      }
    }, refreshMs);
    return () => { clearInterval(timer); controller.abort(); };
  }, [waiting, busy, runId, onChanged, refreshMs]);

  const afterAction = async () => { await load(); onChanged?.(); };
  const check = (batchId) => run(async () => { await axios.post(`${base}/everee-batches/${batchId}/check`); await afterAction(); }, "Everee could not be checked. Try again in a moment.");
  const retry = (batchId) => run(async () => { await axios.post(`${base}/everee-batches/${batchId}/retry`); await afterAction(); }, "The retry could not be completed. Check the results before trying again.");

  const { preview, batches } = state;
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} className="relative z-[70]">
      <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-2 sm:p-6">
        <DialogPanel className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-line p-4 sm:p-6">
            <div>
              <DialogTitle className="text-xl font-bold text-ink">Pay with Everee</DialogTitle>
              <p className="mt-1 text-sm text-ink-muted">{cityName}{preview ? ` · ${preview.run.period_start} – ${preview.run.period_end}` : ""}</p>
            </div>
            <button type="button" aria-label="Close Everee payment" disabled={busy} onClick={onClose} className="min-h-11 min-w-11 rounded-xl border border-line"><X className="mx-auto h-5 w-5" aria-hidden="true" /></button>
          </div>
          <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
            {state.status === "loading" && <p role="status" className="text-sm text-ink-muted">Loading the payment preview…</p>}
            {state.status === "error" && (
              <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                <p>{state.message}</p>
                <button type="button" onClick={() => { setState({ status: "loading", preview: null, batches: [], message: "" }); load(); }} className="mt-2 min-h-11 rounded-xl border border-line bg-white px-4 font-semibold">Try again</button>
              </div>
            )}
            {message && state.status === "ready" && batches.length > 0 && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{message}</p>}
            {state.status === "ready" && batches.map((b) => (
              <EvereeBatchResults key={b.batch.id} view={b} busy={busy} onCheck={() => check(b.batch.id)} onRetry={() => retry(b.batch.id)} />
            ))}
            {state.status === "ready" && preview && (preview.summary.eligible > 0 || batches.length === 0) && (
              <EvereePreview preview={preview} busy={busy} message={batches.length > 0 ? "" : message} onConfirm={confirm} />
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

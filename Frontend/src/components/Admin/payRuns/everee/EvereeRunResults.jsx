import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "../../../../redux/slice/axiosInstance";
import EvereeBatchResults from "./EvereeBatchResults.jsx";
import EvereeApprovalLink from "./EvereeApprovalLink.jsx";
import { mergeBatches, needsCheck, needsRetry } from "./mergeBatches.js";
import { readableError } from "./evereeLabels.js";

const base = "/admin/payroll";
export const REFRESH_MS = 60_000; // how often the open window re-reads the results while payments are still waiting

// The Everee payments already made for one run, in one list however many times the run was paid, driver by driver, with Check now and Retry what failed. It reads the server's results and, while
// payments wait for Everee, reads them again every minute (a read only: the server checks Everee every 15 minutes, or at once with Check now).
// Nothing here decides what is paid. `reloadKey` changes when a new batch has just been sent, so the list is read again.
export default function EvereeRunResults({ runId, onChanged, refreshMs = REFRESH_MS, reloadKey = 0, showApprovalLink = true }) {
  const [batches, setBatches] = useState([]);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const mounted = useRef(true);
  const paidCount = useRef(0);
  const returnedCount = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (signal) => {
    try {
      const { data } = await axios.get(`${base}/runs/${runId}/everee-batches`, { signal });
      if (signal?.aborted || !mounted.current) return;
      const list = data?.batches ?? [];
      const paid = list.reduce((n, b) => n + b.counts.paid, 0);
      const returned = list.reduce((n, b) => n + b.items.filter((i) => i.everee?.depositReturned).length, 0);
      if (paid > paidCount.current || returned !== returnedCount.current) onChanged?.();
      paidCount.current = paid;
      returnedCount.current = returned;
      setBatches(list);
    } catch {
      // keep showing the last results; a later read tries again
    }
  }, [runId, onChanged]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  const pending = batches.some((b) => b.counts.submitted + b.counts.unconfirmed > 0);
  const waiting = pending || batches.some((b) => b.items.some((i) => i.everee?.depositReturned));
  useEffect(() => {
    if (!waiting || busy) return undefined;
    const controller = new AbortController();
    const timer = setInterval(() => load(controller.signal), refreshMs);
    return () => { clearInterval(timer); controller.abort(); };
  }, [waiting, busy, load, refreshMs]);

  // Each batch is tried on its own: a refusal for one (the server's answer is kept as it is) never stops the others, and the results are read
  // again afterwards whatever happened, so the list shows what really went through. Nothing refused is tried again by itself.
  const act = async (targets, action, failure) => {
    if (busy) return;
    setBusy(true);
    setMessages([]);
    const refused = [];
    let done = 0;
    for (const target of targets) {
      try {
        await axios.post(`${base}/everee-batches/${target.batch.id}/${action}`);
        done += 1;
      } catch (error) {
        refused.push(`${target.items.slice(0, 3).map((i) => i.driverName).join(", ")}${target.items.length > 3 ? ` and ${target.items.length - 3} more` : ""}: ${readableError(error, failure)}`);
      }
    }
    await load();
    if (done > 0) onChanged?.();
    if (mounted.current) {
      setMessages(refused);
      setBusy(false);
    }
  };

  if (batches.length === 0) return null;
  return (
    <div className="space-y-3">
      {messages.length > 0 && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <p className="font-semibold">{messages.length === 1 ? "One payment could not be completed. The others were tried." : `${messages.length} payments could not be completed. The others were tried.`}</p>
          <ul className="mt-1 list-disc pl-5">{messages.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      <EvereeBatchResults view={mergeBatches(batches)} busy={busy}
        onCheck={() => act(batches.filter(needsCheck), "check", "Everee could not be checked. Try again in a moment.")}
        onRetry={() => act(batches.filter(needsRetry), "retry", "The retry could not be completed. Check the results before trying again.")} />
      {showApprovalLink && waiting && <EvereeApprovalLink label={pending ? "Open Everee to approve" : "Open Everee for deposit details"} />}
    </div>
  );
}

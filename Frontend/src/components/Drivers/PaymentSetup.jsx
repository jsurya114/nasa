import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import Header from "../../reuse/driver/Header";
import Nav from "../../reuse/driver/Nav";
import { SkeletonList } from "../../reuse/Skeleton.jsx";
import useTranslation from "../../hooks/useTranslation.js";
import { callNative, isNativeShell } from "../../native/bridge";
import { errorKeyOf, useEvereeSetup } from "../../hooks/useEvereeSetup.js";
import EvereeEmbed from "./everee/EvereeEmbed.jsx";
import PaymentSetupCard from "./everee/PaymentSetupCard.jsx";
import SetupDetailsForm from "./everee/SetupDetailsForm.jsx";
import { actionOf } from "./everee/setupLabels.js";

export const NATIVE_WINDOW_MS = 30 * 60 * 1000; // the person may take their time inside Everee's window
export const CHECK_ATTEMPTS = 3;
export const CHECK_WAIT_MS = 2500;
const PROBLEM_KEY = {
  native_unsupported: "psetProbUpdateApp",
  native_busy: "psetProbBusy", bad_session: "psetProbBad", expired: "psetProbExpired", no_connection: "psetProbConnection", screen_error: "psetProbScreen" };

// The driver's payment setup (issue #242): one place to start it, open Everee's own screens, resume after a closed window or a lost connection, and
// see the result. The result always comes from the server (which asks Everee); closing a window or a screen event never marks anything complete.
export default function PaymentSetup() {
  const { t } = useTranslation();
  const setup = useEvereeSetup();
  const { status, data } = setup;
  const [mode, setMode] = useState("idle"); // idle | form | embed
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState(null); // { tone, key }
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const fail = useCallback((error) => setMessage({ tone: "bad", key: errorKeyOf(error) }), []);

  // After a window closes: ask the server a few times (Everee can take a moment), then stop and say it is still being checked.
  const confirm = useCallback(async () => {
    setChecking(true);
    setMessage(null);
    let latest = null;
    for (let attempt = 0; attempt < CHECK_ATTEMPTS; attempt += 1) {
      latest = await setup.refresh();
      if (!mounted.current || latest?.state === "complete") break;
      if (attempt < CHECK_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, CHECK_WAIT_MS));
      if (!mounted.current) return;
    }
    if (!mounted.current) return;
    setChecking(false);
    if (latest?.state !== "complete") setMessage({ tone: "info", key: latest ? "psetStillChecking" : "psetErrUnavailable" });
  }, [setup]);

  const open = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const opened = await setup.openSession("ONBOARDING");
      if (isNativeShell()) {
        // In the phone app Everee opens in the shell's own separate window (a frame cannot be used there). The link goes to the shell once and is not kept.
        try {
          await callNative("everee.open", { url: opened.url }, { timeoutMs: NATIVE_WINDOW_MS });
        } catch (nativeError) {
          setMessage({ tone: "bad", key: nativeError?.code === "unsupported_action" ? PROBLEM_KEY.native_unsupported : nativeError?.code === "busy" ? PROBLEM_KEY.native_busy : PROBLEM_KEY.no_connection });
          return;
        }
        confirm();
        return;
      }
      setSession(opened);
      setMode("embed");
    } catch (error) {
      fail(error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, setup, fail, confirm]);

  const begin = useCallback(async (details) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = await setup.start(details);
      setMode("idle");
      if (body.state === "in-progress") { setBusy(false); await open(); return; }
      setMessage({ tone: body.state === "needs-review" ? "bad" : "info", key: body.state === "needs-review" ? "psetHintReview" : "psetHintCreating" });
    } catch (error) {
      if (error?.response?.data?.code === "missing_fields") setMessage({ tone: "bad", key: "psetErrMissing" });
      else fail(error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, setup, open, fail]);

  const closeEmbed = useCallback(() => {
    setSession(null); // the single-use link is dropped as soon as the window closes
    setMode("idle");
    confirm();
  }, [confirm]);

  const problem = useCallback((kind) => {
    setSession(null);
    setMode("idle");
    setMessage({ tone: "bad", key: PROBLEM_KEY[kind] ?? "psetErrGeneric" });
  }, []);

  if (status === "ready" && (!data || data.state === "not-required")) return <Navigate to="/driver/dashboard" replace />;

  const action = actionOf(data);
  const gaps = data?.needsFromDriver ?? [];
  const adminMustFix = ["name", "email", "phone"].filter((g) => gaps.includes(g));

  let body;
  if (status === "loading") body = <SkeletonList rows={2} label={t("loading")} />;
  else if (status === "error") {
    body = (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{t("psetLoadError")}</p>
        <button type="button" onClick={setup.reload} className="mt-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 font-semibold text-red-700">{t("tryAgain")}</button>
      </div>
    );
  } else {
    body = (
      <>
        <PaymentSetupCard />
        {data.blockedBy === "agreement" && <Link to="/driver/agreement" className="mb-4 inline-flex min-h-11 items-center rounded-xl bg-brand px-4 font-semibold text-white">{t("psetSignAgreement")}</Link>}
        {adminMustFix.length > 0 && action === "start" && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("psetAdminMustFix")}</p>}
        {mode === "form" && <SetupDetailsForm needsStartDate={gaps.includes("startDate")} busy={busy} onSubmit={begin} onCancel={() => setMode("idle")} />}
        {mode === "idle" && !checking && (
          <div className="flex flex-wrap gap-2">
            {action === "start" && adminMustFix.length === 0 && <button type="button" onClick={() => setMode("form")} disabled={busy} className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60">{data.state === "creating" ? t("psetTryAgain") : t("psetStart")}</button>}
            {action === "continue" && <button type="button" onClick={open} disabled={busy} className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60">{busy ? t("psetOpening") : t("psetContinue")}</button>}
            {action === "check" && <button type="button" onClick={confirm} className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white">{t("psetCheckAgain")}</button>}
            {data.state === "complete" && <Link to="/driver/dashboard" className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 font-semibold text-white">{t("psetBackToDashboard")}</Link>}
          </div>
        )}
        {checking && <p role="status" className="mt-3 text-sm text-ink-muted">{t("psetChecking")}</p>}
      </>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />
      <main className="mx-auto mt-4 mb-24 max-w-3xl px-4 pb-36 sm:mt-6 sm:px-6">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-gray-800">{t("psetTitle")}</h2>
          <p className="mt-1 text-sm text-gray-500">{t("psetPageHint")}</p>
        </div>
        <div aria-live="polite">
          {message && <p role={message.tone === "bad" ? "alert" : "status"} className={`mb-4 rounded-xl p-3 text-sm ${message.tone === "bad" ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>{t(message.key)}</p>}
        </div>
        {body}
      </main>
      {mode === "embed" && session && <EvereeEmbed session={session} onFinished={closeEmbed} onClose={closeEmbed} onProblem={problem} />}
      <Nav />
    </div>
  );
}

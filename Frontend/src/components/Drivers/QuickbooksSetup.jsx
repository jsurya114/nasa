import React, { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import Header from "../../reuse/driver/Header";
import Nav from "../../reuse/driver/Nav";
import { SkeletonList } from "../../reuse/Skeleton.jsx";
import useTranslation from "../../hooks/useTranslation.js";
import { qbErrorKeyOf, useQuickbooksSetup } from "../../hooks/useQuickbooksSetup.js";

const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base";
const EMPTY = { legalName: "", addressLine1: "", city: "", state: "", postalCode: "", taxId: "", certified: false };

// A new Desi driver's QuickBooks setup (the Desi counterpart of the payment setup). The driver gives their legal name, address and tax ID once; the server creates their
// QuickBooks vendor with the tax ID and the 1099 flag, and keeps no copy of the tax ID. The tax ID never goes in the address, storage or a log, and the form clears it as
// soon as it is sent.
export default function QuickbooksSetup() {
  const { t } = useTranslation();
  const setup = useQuickbooksSetup();
  const { status, data } = setup;
  const [form, setForm] = useState(EMPTY);
  const [showTax, setShowTax] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { tone, key }
  const [missing, setMissing] = useState([]);

  const set = (key) => (e) => { setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value })); setMissing((m) => m.filter((k) => k !== key)); };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setMissing([]);
    try {
      await setup.start(form);
      setForm(EMPTY); // the tax ID leaves this page as soon as it is sent
    } catch (error) {
      setMissing(error?.response?.data?.missing ?? []);
      setMessage({ tone: "bad", key: qbErrorKeyOf(error) });
    } finally {
      setBusy(false);
    }
  };

  if (status === "ready" && (!data || data.state === "not-required")) return <Navigate to="/driver/dashboard" replace />;

  const bad = (key) => missing.includes(key);
  const field = (key, label, props = {}) => (
    <label className="block text-sm font-medium text-gray-700">{label}
      <input value={form[key]} onChange={set(key)} disabled={busy} aria-invalid={bad(key) || undefined} className={`${inputClass} ${bad(key) ? "border-red-400" : ""}`} {...props} />
    </label>
  );

  let body;
  if (status === "loading") body = <SkeletonList rows={2} label={t("loading")} />;
  else if (status === "error") {
    body = (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{t("qbsetLoadError")}</p>
        <button type="button" onClick={setup.reload} className="mt-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 font-semibold text-red-700">{t("tryAgain")}</button>
      </div>
    );
  } else if (data.state === "complete") {
    body = (
      <div role="status" className="rounded-2xl bg-green-50 p-4 text-sm text-green-800">
        <p className="font-semibold">{t("qbsetDone")}</p>
        <Link to="/driver/dashboard" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-brand px-5 font-semibold text-white">{t("psetBackToDashboard")}</Link>
      </div>
    );
  } else if (data.blockedBy === "agreement") {
    body = <Link to="/driver/agreement" className="inline-flex min-h-11 items-center rounded-xl bg-brand px-4 font-semibold text-white">{t("psetSignAgreement")}</Link>;
  } else if (data.blockedBy === "email") {
    body = <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("qbsetErrEmail")}</p>;
  } else if (data.blockedBy === "contact_changed") {
    body = <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("profContactReview")}</p>;
  } else {
    body = (
      <form onSubmit={submit} noValidate autoComplete="off" className="space-y-3">
        {field("legalName", t("qbsetLegalName"), { autoComplete: "name", maxLength: 100 })}
        {field("addressLine1", t("qbsetAddress"), { autoComplete: "address-line1", maxLength: 100 })}
        <div className="grid grid-cols-2 gap-3">
          {field("city", t("qbsetCity"), { autoComplete: "address-level2", maxLength: 50 })}
          {field("state", t("qbsetState"), { autoComplete: "address-level1", maxLength: 2, placeholder: "TX" })}
        </div>
        {field("postalCode", t("qbsetZip"), { autoComplete: "postal-code", inputMode: "numeric", maxLength: 10 })}
        <label className="block text-sm font-medium text-gray-700">{t("qbsetTaxId")}
          <div className="flex gap-2">
            <input value={form.taxId} onChange={set("taxId")} disabled={busy} type={showTax ? "text" : "password"} inputMode="numeric" autoComplete="off" maxLength={11} aria-invalid={bad("taxId") || undefined}
              className={`${inputClass} ${bad("taxId") ? "border-red-400" : ""}`} />
            <button type="button" onClick={() => setShowTax((v) => !v)} className="mt-1 min-h-11 shrink-0 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-brand">{showTax ? t("qbsetHide") : t("qbsetShow")}</button>
          </div>
        </label>
        <p className="text-xs text-gray-500">{t("qbsetTaxHint")}</p>
        <label className={`flex min-h-11 items-start gap-3 rounded-xl border p-3 text-sm ${bad("certified") ? "border-red-400" : "border-line"}`}>
          <input type="checkbox" checked={form.certified} onChange={set("certified")} disabled={busy} className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{t("qbsetCertify")}</span>
        </label>
        <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60">{busy ? t("qbsetSending") : t("qbsetSubmit")}</button>
      </form>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />
      <main className="mx-auto mt-4 mb-24 max-w-3xl px-4 pb-36 sm:mt-6 sm:px-6">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-gray-800">{t("qbsetTitle")}</h2>
          <p className="mt-1 text-sm text-gray-500">{t("qbsetHint")}</p>
        </div>
        {setup.required && <p className="mb-4 rounded-xl bg-brand-50 p-3 text-sm text-brand-700">{t("qbsetEmailNote")}</p>}
        {setup.locked && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">{t("psetLockedNote")}</p>}
        <div aria-live="polite">
          {message && <p role={message.tone === "bad" ? "alert" : "status"} className={`mb-4 rounded-xl p-3 text-sm ${message.tone === "bad" ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>{t(message.key)}</p>}
        </div>
        {body}
      </main>
      {!setup.locked && <Nav />}
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Pencil, User } from "lucide-react";
import Header from "../../reuse/driver/Header";
import Nav from "../../reuse/driver/Nav";
import useTranslation from "../../hooks/useTranslation.js";
import { toast } from "../../utils/toast";
import { setDriver } from "../../redux/slice/driver/driverSlice.js";
import { clearSaveErrors, loadProfile, saveProfile } from "../../redux/slice/driver/profileSlice.js";

// Same limits as the server (drivers.name 100, email 150, phone 20): they only stop typing past the end, the server does the checking.
const FIELDS = [
  { key: "name", labelKey: "profFullName", type: "text", autoComplete: "name", maxLength: 100 },
  { key: "email", labelKey: "email", type: "email", autoComplete: "email", maxLength: 150, hintKey: "profEmailHint" },
  { key: "phoneNumber", labelKey: "phone", type: "tel", autoComplete: "tel", inputMode: "tel", maxLength: 20, hintKey: "profPhoneHint" },
];
const inputClass = (invalid) =>
  `bg-white text-ink placeholder:text-ink-muted/70 min-h-11 w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-4 transition-shadow ${
    invalid ? "border-red-500 focus:ring-red-500/20" : "border-line focus:ring-brand-500/20"
  }`;

function Profile() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { driver } = useSelector((state) => state.driver);
  const { profile, loadStatus, loadError, saveStatus, saveError, fieldErrors } = useSelector((state) => state.driverProfile);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phoneNumber: "" });
  const firstField = useRef(null);
  const saving = saveStatus === "saving";

  useEffect(() => {
    dispatch(loadProfile());
    return () => { dispatch(clearSaveErrors()); };
  }, [dispatch]);

  useEffect(() => {
    if (editing) firstField.current?.focus();
  }, [editing]);

  const startEditing = () => {
    dispatch(clearSaveErrors());
    setForm({ name: profile.name, email: profile.email, phoneNumber: profile.phoneNumber });
    setEditing(true);
  };
  const cancel = () => {
    dispatch(clearSaveErrors());
    setEditing(false);
  };
  const change = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name] || saveError) dispatch(clearSaveErrors());
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const result = await dispatch(saveProfile(form));
    if (!saveProfile.fulfilled.match(result)) return; // the page shows what was wrong, next to the field
    const saved = result.payload.profile;
    // The header shows the driver's name: bring it up to date without another request.
    dispatch(setDriver({ ...driver, name: saved.name, email: saved.email }));
    const emailChanged = saved.email !== profile.email;
    toast.success(emailChanged ? `${result.payload.message}. ${t("profEmailChanged")}` : result.payload.message);
    setEditing(false);
  };

  const changed = profile && FIELDS.some(({ key }) => form[key] !== profile[key]);

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />
      <main className="max-w-2xl mx-auto mt-6 mb-24 px-4 sm:px-6 pb-36">
        <div className="card-surface overflow-hidden">
          <div className="bg-brand px-4 sm:px-6 py-4 flex items-center gap-3">
            <User className="w-6 h-6 text-white" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-bold text-white">{t("profTitle")}</h1>
              <p className="text-purple-100 text-sm mt-1">{t("profSubtitle")}</p>
            </div>
          </div>

          {loadStatus === "loading" && !profile && <p role="status" className="p-6 text-ink-muted">{t("loading")}</p>}

          {loadStatus === "failed" && !profile && (
            <div className="p-6 space-y-3" role="alert">
              <p className="text-red-600">{t("profLoadFailed")}</p>
              {loadError && <p className="text-sm text-ink-muted">{loadError}</p>}
              <button type="button" onClick={() => dispatch(loadProfile())} className="min-h-11 px-4 rounded-xl bg-brand text-white font-semibold hover:bg-brand-700">
                {t("profTryAgain")}
              </button>
            </div>
          )}

          {profile && !editing && (
            <div className="p-4 sm:p-6 space-y-5">
              <dl className="space-y-4">
                {FIELDS.map(({ key, labelKey }) => (
                  <div key={key}>
                    <dt className="text-sm font-semibold text-gray-700">{t(labelKey)}</dt>
                    <dd className="mt-1 break-words text-ink">{profile[key] || <span className="text-ink-muted">{t("profNotSet")}</span>}</dd>
                  </div>
                ))}
              </dl>
              <button type="button" onClick={startEditing} className="inline-flex items-center gap-2 min-h-11 px-5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-500/30">
                <Pencil className="w-4 h-4" aria-hidden="true" />
                {t("edit")}
              </button>
            </div>
          )}

          {profile && editing && (
            <form onSubmit={submit} noValidate className="p-4 sm:p-6 space-y-6">
              {FIELDS.map(({ key, labelKey, hintKey, ...input }, index) => {
                const error = fieldErrors[key];
                const describedBy = [error && `${key}-error`, hintKey && `${key}-hint`].filter(Boolean).join(" ") || undefined;
                return (
                  <div key={key} className="space-y-2">
                    <label htmlFor={`profile-${key}`} className="block text-sm font-semibold text-gray-700">
                      {t(labelKey)} <span className="text-red-500" aria-hidden="true">*</span>
                    </label>
                    <input
                      id={`profile-${key}`}
                      name={key}
                      ref={index === 0 ? firstField : undefined}
                      value={form[key]}
                      onChange={change}
                      disabled={saving}
                      required
                      aria-invalid={error ? "true" : undefined}
                      aria-describedby={describedBy}
                      className={inputClass(Boolean(error))}
                      {...input}
                    />
                    {error && <p id={`${key}-error`} role="alert" className="text-red-600 text-sm">{error}</p>}
                    {hintKey && <p id={`${key}-hint`} className="text-xs text-gray-500">{t(hintKey)}</p>}
                    {key === "name" && <p className="text-xs text-amber-700">{t("profNameNotice")}</p>}
                  </div>
                );
              })}

              {saveError && Object.keys(fieldErrors).length === 0 && <p role="alert" className="text-red-600 text-sm">{saveError}</p>}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                <button type="button" onClick={cancel} disabled={saving} className="min-h-11 px-5 rounded-xl border border-line bg-white font-semibold hover:bg-gray-50 disabled:opacity-60">
                  {t("cancel")}
                </button>
                <button type="submit" disabled={saving || !changed} className="min-h-11 px-5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-700 disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-brand-500/30">
                  {saving ? t("saving") : t("save")}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
      <Nav />
    </div>
  );
}

export default Profile;

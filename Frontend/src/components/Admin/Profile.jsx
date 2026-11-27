import React from "react";
import { useSelector } from "react-redux";
import { User } from "lucide-react";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import useTranslation from "../../hooks/useTranslation.js";
import AccountSection from "../account/AccountSection.jsx";

// The signed-in admin's own page: who they are, and the account links (help, privacy, deletion requests for a super admin, Delete account).
// Read only: an admin's name and email are changed by a super admin, as before.
export default function AdminProfile() {
  const { t } = useTranslation();
  const { admin, isSuperAdmin } = useSelector((state) => state.admin);
  const details = [
    ["profFullName", admin?.name],
    ["email", admin?.email],
    ["adminProfRole", t(isSuperAdmin ? "adminProfSuperAdmin" : "adminProfCityAdmin")],
  ];

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-6 pb-36 sm:px-6">
        <section className="card-surface overflow-hidden" aria-labelledby="admin-profile-title">
          <div className="flex items-center gap-3 bg-brand px-4 py-4 sm:px-6">
            <User className="h-6 w-6 text-white" aria-hidden="true" />
            <h1 id="admin-profile-title" className="text-xl font-bold text-white">{t("adminProfTitle")}</h1>
          </div>
          <dl className="space-y-4 p-4 sm:p-6">
            {details.map(([labelKey, value]) => (
              <div key={labelKey}>
                <dt className="text-sm font-semibold text-gray-700">{t(labelKey)}</dt>
                <dd className="mt-1 break-words">{value || <span className="text-ink-muted">{t("profNotSet")}</span>}</dd>
              </div>
            ))}
          </dl>
        </section>
        <AccountSection area="admin" isSuperAdmin={isSuperAdmin} />
      </main>
      <Nav />
    </div>
  );
}

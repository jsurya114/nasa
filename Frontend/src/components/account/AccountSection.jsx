import { Link } from "react-router-dom";
import { ChevronRight, FileText, LifeBuoy, ListChecks, Trash2 } from "lucide-react";
import useTranslation from "../../hooks/useTranslation.js";

// The "Account" part of a profile page: help, privacy, the super admin's deletion requests and Delete account, in one place
// instead of in the header. A driver still locked behind the agreement or payment setup keeps the short links in the header
// (AccountLinks), because the profile page is not open to them yet.
const iconClass = "h-5 w-5 shrink-0";
const row = "flex min-h-12 items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500";

export default function AccountSection({ area, isSuperAdmin = false }) {
  const { t } = useTranslation();
  const items = [
    { key: "help", to: "/support", label: t("acctHelp"), icon: <LifeBuoy className={iconClass} aria-hidden="true" /> },
    { key: "privacy", href: "/privacy-policy", label: t("acctPrivacy"), icon: <FileText className={iconClass} aria-hidden="true" /> },
    ...(isSuperAdmin ? [{ key: "requests", to: "/admin/deletion-requests", label: t("acctDeletionRequests"), icon: <ListChecks className={iconClass} aria-hidden="true" /> }] : []),
    { key: "delete", to: `/${area}/delete-account`, label: t("acctDelete"), icon: <Trash2 className={iconClass} aria-hidden="true" />, danger: true },
  ];
  return (
    <section aria-labelledby="account-section-title" className="card-surface overflow-hidden">
      <h2 id="account-section-title" className="px-4 pt-4 pb-2 text-base font-semibold text-ink">{t("acctTitle")}</h2>
      <ul className="divide-y divide-line border-t border-line">
        {items.map(({ key, to, href, label, icon, danger }) => {
          const inner = (
            <>
              {icon}
              <span className="flex-1">{label}</span>
              <ChevronRight className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            </>
          );
          const className = `${row} ${danger ? "text-red-700" : "text-ink"}`;
          return (
            <li key={key}>
              {to ? <Link className={className} to={to}>{inner}</Link> : <a className={className} href={href}>{inner}</a>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

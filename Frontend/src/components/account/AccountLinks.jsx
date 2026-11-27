import { Link } from "react-router-dom";
import useTranslation from "../../hooks/useTranslation.js";

// Help, privacy and Delete account in the driver's header, only while the driver is locked behind the agreement or payment setup
// and so cannot open the profile page (where AccountSection holds them otherwise).
export default function AccountLinks({ area, isSuperAdmin = false, className = "", onNavigate }) {
  const { t } = useTranslation();
  const link = "block rounded-lg px-3 py-2 text-sm hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
  return (
    <div role="group" aria-label="Account" className={className}>
      <Link className={link} to="/support" onClick={onNavigate}>{t("acctHelp")}</Link>
      <a className={link} href="/privacy-policy">{t("acctPrivacy")}</a>
      {isSuperAdmin ? <Link className={link} to="/admin/deletion-requests" onClick={onNavigate}>{t("acctDeletionRequests")}</Link> : null}
      <Link className={`${link} text-red-700`} to={`/${area}/delete-account`} onClick={onNavigate}>{t("acctDelete")}</Link>
    </div>
  );
}

import { Link } from "react-router-dom";

// Help, privacy and account deletion, in every signed-in menu (also before onboarding is finished).
export default function AccountLinks({ area, isSuperAdmin = false, className = "", onNavigate }) {
  const link = "block rounded-lg px-3 py-2 text-sm hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
  return (
    <div role="group" aria-label="Account" className={className}>
      <Link className={link} to="/support" onClick={onNavigate}>Help and support</Link>
      <a className={link} href="/privacy-policy">Privacy policy</a>
      {isSuperAdmin ? <Link className={link} to="/admin/deletion-requests" onClick={onNavigate}>Deletion requests</Link> : null}
      <Link className={`${link} text-red-700`} to={`/${area}/delete-account`} onClick={onNavigate}>Delete account</Link>
    </div>
  );
}

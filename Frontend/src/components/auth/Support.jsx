import { Link } from "react-router-dom";
import LegalLinks from "./LegalLinks.jsx";

// The address already published in the privacy policy (privacy-policy.html).
const SUPPORT_EMAIL = "info@drivefornlc.com";

// Help for anyone, signed in or not: how accounts work, who to ask, and where privacy and account deletion are.
export default function Support() {
  return (
    <main className="min-h-dvh bg-white px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <div className="mx-auto max-w-xl text-ink">
        <h1 className="text-2xl font-semibold">Help and support</h1>
        <p className="mt-2 text-ink-muted">NASA Routes is the work app of NASA Logistics Carriers LLC for its drivers and administrators.</p>

        <h2 className="mt-6 text-lg font-semibold">Signing in</h2>
        <p className="mt-1 text-ink-muted">Accounts are created by a NASA administrator. Sign in with the email and password they gave you. If you forgot your password or cannot sign in, contact your city administrator or NASA support.</p>

        <h2 className="mt-6 text-lg font-semibold">Pay and onboarding</h2>
        <p className="mt-1 text-ink-muted">Pay statements are in the app under Pay. Bank and tax details are entered on Everee's or QuickBooks' own screens; NASA staff never ask for them by message or phone.</p>

        <h2 className="mt-6 text-lg font-semibold">Deleting your account</h2>
        <p className="mt-1 text-ink-muted">Signed-in users can request deletion from their profile or account menu ("Delete account"). Records NASA must keep for pay and accounting stay, without your sign-in.</p>

        <h2 className="mt-6 text-lg font-semibold">Contact</h2>
        <p className="mt-1">Email <a className="font-semibold text-brand-800 underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Do not send passwords, bank or tax details by email.</p>

        <LegalLinks className="mt-8 justify-start" />
        <p className="mt-6"><Link to="/" className="text-sm underline text-ink-muted">Back to NASA Routes</Link></p>
      </div>
    </main>
  );
}

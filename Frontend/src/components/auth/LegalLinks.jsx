// Privacy, terms and support, reachable from every screen a signed-out person can see.
// Plain links: in the app the shell opens anything outside the NASA site in the phone's browser.
export default function LegalLinks({ className = "" }) {
  const link = "underline underline-offset-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded";
  return (
    <nav aria-label="Legal and support" className={`flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-ink-muted ${className}`}>
      <a className={link} href="/privacy-policy">Privacy policy</a>
      <a className={link} href="/enduser-license/agreements">Terms of use</a>
      <a className={link} href="/support">Help and support</a>
    </nav>
  );
}

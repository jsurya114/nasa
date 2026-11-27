import { useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { AiOutlineEye, AiOutlineEyeInvisible } from "react-icons/ai";
import logo from "../../assets/logo.png";
import { signIn } from "../../redux/slice/signIn";
import SignOutNotice from "../../native/SignOutNotice.jsx";
import LegalLinks from "./LegalLinks.jsx";

const AREA_LABEL = { admin: "Administrator account", driver: "Driver account" };
const inputClass = (bad) =>
  `bg-white text-ink placeholder:text-ink-muted/70 w-full h-12 px-4 text-base border rounded-xl focus:outline-none focus:ring-4 transition-shadow ${
    bad ? "border-red-500 focus:ring-red-500/20" : "border-line focus:ring-brand-500/20 focus:border-brand-500"
  }`;

// The one sign-in page for drivers, city admins and the super admin. The person types only an email and a password;
// the server says which account that is and where to start. /login, /admin/login and /driver/login all show this page.
export default function SignIn() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [choices, setChoices] = useState(null);

  const submit = async (area) => {
    if (busy) return;
    if (!email.trim() || !password) {
      setProblem("Enter your email and password.");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      const { next } = await dispatch(signIn({ email: email.trim(), password, area })).unwrap();
      setPassword("");
      navigate(next, { replace: true });
    } catch (error) {
      if (error?.code === "choose_account" && Array.isArray(error.areas)) {
        setChoices(error.areas.filter((a) => AREA_LABEL[a]));
      } else {
        setChoices(null);
        setProblem(error?.message || "NASA could not sign you in right now. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="bg-aurora min-h-dvh flex items-center justify-center px-4 py-10 pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
      <div className="bg-white rounded-3xl shadow-[var(--shadow-float)] ring-1 ring-white/20 w-full max-w-md overflow-hidden">
        <div className="bg-[#462976] py-7 flex justify-center">
          <img src={logo} alt="NASA Logistic Carriers" className="w-44" />
        </div>
        <div className="px-6 sm:px-10 pt-7 pb-8">
          <SignOutNotice area="admin" />
          <SignOutNotice area="driver" />
          <h1 className="text-2xl font-semibold tracking-tight text-ink mb-1 text-center">Sign in</h1>
          <p className="text-sm text-ink-muted mb-6 text-center">For NASA drivers and administrators. Use the email your administrator registered.</p>

          <form noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label htmlFor="signin-email" className="block text-sm text-ink mb-1.5 font-medium">Email address</label>
            <input id="signin-email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false}
              value={email} onChange={(e) => { setEmail(e.target.value); setChoices(null); }} className={`${inputClass(Boolean(problem))} mb-4`}
              aria-invalid={Boolean(problem)} aria-describedby={problem ? "signin-problem" : undefined} />

            <label htmlFor="signin-password" className="block text-sm text-ink mb-1.5 font-medium">Password</label>
            <div className="relative mb-2">
              <input id="signin-password" type={showPassword ? "text" : "password"} autoComplete="current-password"
                value={password} onChange={(e) => { setPassword(e.target.value); setChoices(null); }} className={`${inputClass(Boolean(problem))} pr-12`}
                aria-invalid={Boolean(problem)} aria-describedby={problem ? "signin-problem" : undefined} />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-1.5 top-1 p-2.5 text-ink-muted hover:text-ink rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                {showPassword ? <AiOutlineEyeInvisible size={22} aria-hidden="true" /> : <AiOutlineEye size={22} aria-hidden="true" />}
              </button>
            </div>

            <p id="signin-problem" role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-700">{problem}</p>

            {choices ? (
              <fieldset className="mt-3 rounded-xl border border-line p-4">
                <legend className="px-1 text-sm font-semibold text-ink">Which account do you want to use?</legend>
                <p className="text-sm text-ink-muted mb-3">This email and password open more than one NASA account.</p>
                {choices.map((area) => (
                  <button key={area} type="button" disabled={busy} onClick={() => submit(area)}
                    className="mb-2 w-full min-h-12 rounded-xl border border-brand-500 text-brand-800 font-semibold disabled:opacity-50">
                    {AREA_LABEL[area]}
                  </button>
                ))}
              </fieldset>
            ) : (
              <button type="submit" disabled={busy} aria-busy={busy}
                className="w-full bg-brand hover:bg-brand-900 text-white font-semibold h-12 rounded-xl mt-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {busy ? "Signing in…" : "Sign in"}
              </button>
            )}
          </form>

          <p className="mt-5 text-center text-sm text-ink-muted">Forgot your password or need an account? Ask your NASA administrator.</p>
          <LegalLinks className="mt-4" />
        </div>
      </div>
    </main>
  );
}

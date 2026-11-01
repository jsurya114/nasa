import React, { useState, useEffect } from "react";
import { Globe } from "lucide-react";
import logo from "../../assets/logo.png";
import { useDispatch, useSelector } from "react-redux";
import { driverLogin } from "../../redux/slice/driver/driverSlice.js";
import { useNavigate } from "react-router-dom";
import { toast } from "../../utils/toast";
import useTranslation from "../../hooks/useTranslation.js";
import { AiOutlineEye, AiOutlineEyeInvisible } from "react-icons/ai";

const DriverLogin = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [detectedTimezone, setDetectedTimezone] = useState("");

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { loading } = useSelector((state) => state.driver);

  // DETECT TIMEZONE ON COMPONENT MOUNT
  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setDetectedTimezone(timezone);
  }, []);

  useEffect(() => {
    if (email && fieldErrors.email) {
      setFieldErrors((prev) => ({ ...prev, email: "" }));
    }
    // Clears the email error when the person types. It must not run again when the error itself is set, or an error from the server would vanish at once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  useEffect(() => {
    if (password && fieldErrors.password) {
      setFieldErrors((prev) => ({ ...prev, password: "" }));
    }
    // Same as the email effect above: only typing clears the password error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Required validation before submitting
    if (!email || !password) {
      setFieldErrors({
        email: !email ? "Email is required" : "",
        password: !password ? "Password is required" : "",
      });
      return;
    }

    try {
      await dispatch(driverLogin({ email, password })).unwrap();

      toast.success(`${t('loginSuccessful')} ${t('timezone')}: ${detectedTimezone}`, {
        position: "top-right",
        autoClose: 3000,
        pauseOnHover: true,
        draggable: true,
      });

      navigate("/driver/dashboard");

    } catch (err) {
      if (err?.errors) {
        setFieldErrors({
          email: err.errors.email || "",
          password: err.errors.password || "",
        });
      } else if (err?.message) {
        toast.error(err.message, {
          position: "top-right",
          autoClose: 3000,
          pauseOnHover: true,
          draggable: true,
        });
      }
    }
  };

  return (
    <div className="bg-aurora min-h-dvh flex items-center justify-center px-4 py-10 pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
      <div className="bg-white rounded-3xl shadow-[var(--shadow-float)] ring-1 ring-white/20 w-full max-w-md overflow-hidden">
        <div className="bg-[#462976] py-7 flex justify-center">
          <img src={logo} alt="Nasa Logistic Carriers Logo" className="w-44" />
        </div>

        <div className="px-6 sm:px-10 pt-7 pb-8 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink mb-6">Driver Login</h2>

          <form onSubmit={handleSubmit}>
            <div className="text-left mb-4">
              <label htmlFor="email" className="block text-sm text-ink mb-1.5 font-medium">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                name="email"
                autoComplete="email"
                placeholder="Enter your driver email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full h-12 px-4 text-base border rounded-xl focus:outline-none focus:ring-4 transition-shadow 
                  ${
                    fieldErrors.email
                      ? "border-red-500 focus:ring-red-500/20"
                      : "border-line focus:ring-brand-500/20 focus:border-brand-500"
                  }`}
              />
              {fieldErrors.email && (
                <p className="text-red-600 text-sm mt-1">{fieldErrors.email}</p>
              )}
            </div>

            <div className="text-left mb-4 relative">
              <label htmlFor="password" className="block text-sm text-ink mb-1.5 font-medium">
                Password
              </label>

              <input
                type={showPassword ? "text" : "password"}
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, password: "" }));
                }}
                placeholder="Enter your password"
                className={`w-full h-12 px-4 pr-12 text-base border rounded-xl focus:outline-none focus:ring-4 transition-shadow
                  ${
                    fieldErrors.password
                      ? "border-red-500 focus:ring-red-500/20"
                      : "border-line focus:ring-brand-500/20 focus:border-brand-500"
                  }`}
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-1.5 top-[1.85rem] p-2.5 cursor-pointer text-ink-muted hover:text-ink rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {showPassword ? <AiOutlineEyeInvisible size={22} /> : <AiOutlineEye size={22} />}
              </button>

              {fieldErrors.password && (
                <p className="text-red-600 text-sm mt-1">{fieldErrors.password}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand hover:bg-brand-900 text-white font-semibold h-12 rounded-xl shadow-[0_10px_24px_-12px_rgb(59_31_107/0.8)] mt-6 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Signing in...
                </>
              ) : (
                "Sign In to Driver Portal"
              )}
            </button>
          </form>

          {/* SHOW DETECTED TIMEZONE */}
          {detectedTimezone && (
            <div className="mt-5 p-3 bg-brand-50 border border-brand-100 rounded-xl">
              <p className="text-xs text-ink-muted">
                <Globe className="inline w-4 h-4 mr-1 -mt-0.5" aria-hidden="true" />
                Your timezone: <span className="font-semibold text-brand-800">
                  {detectedTimezone}
                </span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DriverLogin;
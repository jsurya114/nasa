import React, { useState, useEffect } from "react";
import { Globe } from "lucide-react";
import logo from "../../assets/logo.png";
import { useDispatch, useSelector } from "react-redux";
import { driverLogin } from "../../redux/slice/driver/driverSlice.js";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { AiOutlineEye, AiOutlineEyeInvisible } from "react-icons/ai";

const DriverLogin = () => {
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

      toast.success(`Login successful! Timezone: ${detectedTimezone}`, {
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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 font-poppins">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md">
        <div className="bg-brand rounded-t-2xl py-6 flex justify-center">
          <img src={logo} alt="Nasa Logistic Carriers Logo" className="w-44" />
        </div>

        <div className="px-10 py-6 text-center">
          <h2 className="text-2xl font-semibold text-blue-900 mb-2">Driver Login</h2>

          <form onSubmit={handleSubmit}>
            <div className="text-left mb-4">
              <label htmlFor="email" className="block text-gray-700 mb-1 font-medium">
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
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 
                  ${
                    fieldErrors.email
                      ? "border-red-500 focus:ring-red-500"
                      : "border-gray-300 focus:ring-purple-600"
                  }`}
              />
              {fieldErrors.email && (
                <p className="text-red-600 text-sm mt-1">{fieldErrors.email}</p>
              )}
            </div>

            <div className="text-left mb-4 relative">
              <label htmlFor="password" className="block text-gray-700 mb-1 font-medium">
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
                className={`w-full px-4 py-3 pr-12 border rounded-lg focus:outline-none focus:ring-2
                  ${
                    fieldErrors.password
                      ? "border-red-500 focus:ring-red-500"
                      : "border-gray-300 focus:ring-purple-600"
                  }`}
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2 top-9 p-2 cursor-pointer text-gray-600 hover:text-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600"
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
              className="w-full bg-brand hover:bg-brand-dark text-white font-semibold py-3 rounded-lg shadow-md mt-4 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
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
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-gray-600">
                <Globe className="inline w-4 h-4 mr-1 -mt-0.5" aria-hidden="true" />
                Your timezone: <span className="font-semibold text-blue-800">
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
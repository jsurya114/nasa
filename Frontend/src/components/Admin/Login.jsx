import React, { useState } from "react";
import logo from "../../assets/logo.png"; // adjust path according to your folder structure

import { useDispatch, useSelector } from 'react-redux'
import { adminLogin } from "../../redux/slice/admin/adminSlice.js";
import { useNavigate } from "react-router-dom";
import { toast } from "../../utils/toast";
import { AiOutlineEye, AiOutlineEyeInvisible } from "react-icons/ai";


const Login = () => {

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" })
  const [showPassword, setShowPassword] = useState(false);


  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { loading, error } = useSelector((state) => state.admin);
  const handleSubmit = async (e) => {
    e.preventDefault();

    // simple frontend validation
    let errors = {};

    if (!email.trim()) {
      errors.email = "Email is required";
    }

    if (!password.trim()) {
      errors.password = "Password is required";
    }

    // if errors exist, show toast and stop API call
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      Object.values(errors).forEach((msg) => {
        toast.error(msg, {
          position: "top-right",
          autoClose: 3000,
        });
      });
      return; // 🚫 stop API call
    }

    try {
      const result = await dispatch(adminLogin({ email, password })).unwrap();

      if (result.admin) {
        toast.success("Login successful!", {
          position: "top-right",
          autoClose: 3000,
        });

      // ✅ Fixed
navigate("/admin/dashboard");

      }
    } catch (err) {
      if (err.status === 403 || err.errors?.general) {
        toast.error(err.errors?.general || "Your account has been blocked. Please contact support.", {
          position: "top-right",
          autoClose: 5000,
        });
        return;
      }

      // backend validation or server error
      if (err.errors) {
        setFieldErrors({
          email: err.errors.email || "",
          password: err.errors.password || "",
        });
        Object.values(err.errors).forEach((msg) => {
          if (msg) {
            toast.error(msg, {
              position: "top-right",
              autoClose: 3000,
            });
          }
        });
      } else {
        toast.error(err.message || "Login failed. Please try again.", {
          position: "top-right",
          autoClose: 3000,
        });
      }
    }
  };

  // const handleSubmit = async (e) => {
  //     e.preventDefault();
  //     if(Object.keys(fieldErrors).length>0) console.log(fieldErrors)
  //     try {
  //       const result = await dispatch(adminLogin({ email, password })).unwrap();
  //       if (result.admin) {
  //         toast.success("Login successful!", {
  //           position: "top-right",
  //           autoClose: 3000,
  //           hideProgressBar: false,
  //           closeOnClick: false,
  //           pauseOnHover: true,
  //           draggable: false,
  //         });
  //         navigate("/admin/dashboard");
  //       }
  //     } catch (err) {
  //       if (err.errors) {
  //         setFieldErrors({
  //           email: err.errors.email || "",
  //           password: err.errors.password || "",
  //         });
  //       }
  //     }
  //   };
  return (
    <div className="bg-aurora min-h-dvh flex items-center justify-center px-4 py-10 pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
      <div className="bg-white rounded-3xl shadow-[var(--shadow-float)] ring-1 ring-white/20 w-full max-w-md overflow-hidden">
        <div className="bg-[#462976] py-7 flex justify-center">
          <img
            src={logo}
            alt="Nasa Logistic Carriers Logo"
            className="w-44"
          />
        </div>

        <div className="px-6 sm:px-10 pt-7 pb-8 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink mb-6">Login</h2>
          <form onSubmit={handleSubmit}>
            <div className="text-left mb-4">
              <label htmlFor="email" className="block text-sm text-ink mb-1.5 font-medium">Email Address</label>
              <input
                type="email"
                id="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, email: "" })); // clear email error
                }}

                className="w-full h-12 px-4 text-base border border-line rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 transition-shadow"
              />
              {fieldErrors.email && (
                <p className="text-red-600 text-sm mt-1">{fieldErrors.email}</p>
              )}
            </div>

           <div className="text-left mb-4 relative">
  <label htmlFor="password" className="block text-sm text-ink mb-1.5 font-medium">Password</label>

  <input
    type={showPassword ? "text" : "password"}
    id="password"
    autoComplete="current-password"
    value={password}
    onChange={(e) => {
      setPassword(e.target.value);
      setFieldErrors((prev) => ({ ...prev, password: "" }));
    }}
    className="w-full h-12 px-4 pr-12 text-base border border-line rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 transition-shadow"
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
              className="w-full bg-brand hover:bg-brand-900 text-white font-semibold h-12 rounded-xl shadow-[0_10px_24px_-12px_rgb(59_31_107/0.8)] mt-6"
            >
              {loading ? "Logging in..." : "Login"}
            </button>

            {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
          </form>

          <div className="mt-4 text-sm">
            {/* <a href="#" className="text-purple-700 hover:underline">
              Forgot Password?
            </a> */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;

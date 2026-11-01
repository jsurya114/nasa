import React, { useState } from "react";
import logo from "../assets/logo.png";
import { adminLogout } from "../redux/slice/admin/adminSlice";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Menu, X, User } from "lucide-react";

function Header() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { admin } = useSelector((state) => state.admin);
  const [menuOpen, setMenuOpen] = useState(false);

  // useEffect(() => {
  //   dispatch(accessAdminUser());
  //   console.log("Available user ", admin);
  // }, [dispatch]);

  const handleLogout = () => {
    dispatch(adminLogout());
    navigate("/admin/login");
  };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between h-16 bg-brand text-white px-4 border-b border-white/10">
      {/* Left Side (Hide on mobile) */}
      <div className="hidden md:block font-semibold text-sm md:text-lg">
        Dashboard Admin
      </div>

      {/* Center (Logo always centered) */}
      <div className="absolute left-1/2 transform -translate-x-1/2 md:static md:translate-x-0 md:left-auto">
        <img
          src={logo}
          alt="Logo"
          className="w-28 sm:w-40 md:w-56 object-contain"
        />
      </div>

      {/* Right Side - Desktop (≥768px) */}
      <div className="hidden md:flex items-center gap-3 text-sm md:text-base">
        <div className="flex flex-col items-center">
          <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-yellow-400 text-black font-bold grid place-items-center">
            <User className="w-4 h-4 md:w-5 md:h-5" aria-hidden="true" />
          </div>
          <div className="font-semibold truncate max-w-[120px] md:max-w-[150px]">
            {admin?.name}
          </div>
        </div>

        <button
          className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-md font-semibold"
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>

     {/* Hamburger Menu - Mobile (<768px) */}
<div className="md:hidden relative ml-auto">
  <button
    onClick={() => setMenuOpen(!menuOpen)}
    aria-label="Toggle menu"
    aria-expanded={menuOpen}
    className="p-2 -mr-2 rounded-md hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/60"
  >
    {menuOpen ? <X size={24} /> : <Menu size={24} />}
  </button>

  {/* Dropdown */}
  {menuOpen && (
    <div className="absolute right-0 top-12 bg-white text-black rounded-md shadow-md w-48 p-3 space-y-3 z-50">
      {/* Dashboard title inside menu for mobile */}
      <div className="font-semibold text-center text-brand">
        Dashboard Admin
      </div>

      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-yellow-400 text-black font-bold grid place-items-center">
          <User className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="font-semibold text-center">{admin?.name}</div>
      </div>

      <button
        className="w-full bg-red-600 hover:bg-red-700 text-white px-3 py-3 rounded-md font-semibold"
        onClick={handleLogout}
      >
        Logout
      </button>
    </div>
  )}
</div>

    </header>
  );
}

export default Header;

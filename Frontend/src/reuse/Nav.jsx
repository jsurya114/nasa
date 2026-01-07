import React from "react";
import { NavLink } from "react-router-dom";

function Nav() {
  const links = [
    { to: "/admin/dashboard", icon: "📊", label: "Dashboard" },
    { to: "/admin/create-users", icon: "👥", label: "Users" },
    { to: "/admin/routes", icon: "🧭", label: "Routes" },
    { to: "/admin/jobs", icon: "📦", label: "Cities" },
    { to: "/admin/double-stop", icon: "🔁", label: "Double Stop" },
    { to: "/admin/manage-access-codes", icon: "🔑", label: "Access Codes" },
    { to: "/admin/driver-availability", icon: "📅", label: "Availability" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#462976] border-t border-white/10 z-50">
      {/* Mobile: Horizontally Scrollable */}
      <div className="overflow-x-auto scrollbar-hide sm:overflow-x-visible">
        <div className="flex sm:grid sm:grid-cols-7 gap-1.5 xs:gap-2 sm:gap-3 md:gap-4 p-2 sm:p-3 min-w-max sm:min-w-0 px-2 sm:px-4 max-w-full sm:max-w-screen-xl mx-auto">
          {links.map((item, index) => (
            <NavLink
              key={index}
              to={item.to}
              className={({ isActive }) =>
                `bg-white text-gray-800 rounded-lg sm:rounded-xl shadow-md 
                px-2.5 xs:px-3 sm:px-3 md:px-4 py-2 
                flex flex-col items-center justify-center gap-1 sm:gap-1.5
                hover:scale-105 active:scale-95 transition-transform
                min-w-[70px] xs:min-w-[80px] sm:min-w-0
                ${isActive ? "ring-2 ring-blue-500 ring-offset-1" : ""}`
              }
            >
              <div className="w-7 h-7 xs:w-8 xs:h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 bg-gray-100 grid place-items-center rounded-md text-base xs:text-lg sm:text-xl md:text-2xl">
                {item.icon}
              </div>
              <small className="font-semibold text-[9px] xs:text-[10px] sm:text-[11px] md:text-[13px] leading-tight text-center whitespace-nowrap">
                {item.label}
              </small>
            </NavLink>
          ))}
        </div>
      </div>

      {/* Scroll Indicator for Mobile (optional) */}
      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </nav>
  );
}

export default Nav;
import React from "react";
import { NavLink } from "react-router-dom";

function Nav() {
  const links = [
    { to: "/driver/dashboard", icon: "📊", label: "Dashboard" },
    { to: "/driver/access-codes", icon: "🔑", label: "Access Codes" },
    { to: "/driver/delivery", icon: "🚛", label: "Deliveries" },
    // { to: "/driver/availability", icon: "📅", label: "Availability" },
  ];

  return (
    <>
      {/* Mobile & Desktop Navigation */}
      <nav className="fixed left-0 right-0 bottom-0 bg-[#462976] border-t border-white/10 z-50">
        <div className="flex justify-center gap-2 sm:gap-4 md:gap-6 px-3 sm:px-4 py-2.5 sm:py-3 max-w-screen-xl mx-auto">
          {links.map((item, index) => (
            <NavLink
              key={index}
              to={item.to}
              className={({ isActive }) =>
                `bg-white text-[#1f2633] rounded-lg sm:rounded-xl px-3 xs:px-4 sm:px-4 py-2 sm:py-2.5 
                flex flex-col items-center gap-1 sm:gap-2 shadow-md 
                flex-1 sm:flex-initial sm:min-w-[100px] md:min-w-[110px] 
                max-w-[90px] xs:max-w-[100px] sm:max-w-none
                hover:scale-105 active:scale-95 transition-transform ${
                  isActive ? "ring-2 ring-blue-500 ring-offset-1 ring-offset-[#462976]" : ""
                }`
              }
            >
              <div className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-md sm:rounded-lg bg-[#eef2f7] flex items-center justify-center text-lg sm:text-xl md:text-2xl">
                {item.icon}
              </div>
              <small className="text-[10px] xs:text-[11px] sm:text-[13px] font-semibold leading-tight text-center">
                {item.label}
              </small>
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}

export default Nav;
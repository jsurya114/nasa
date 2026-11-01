import React from "react";
import { NavLink } from "react-router-dom";

function Nav() {
  const links = [
    { to: "/admin/dashboard", icon: "📊", label: "Dashboard" },
    { to: "/admin/create-users", icon: "👥", label: "Users" },
    { to: "/admin/routes", icon: "🧭", label: "Routes" },
    { to: "/admin/jobs", icon: "📦", label: "Cities" },
    { to: "/admin/double-stop", icon: "🔁", label: "File Upload" },
    { to: "/admin/manage-access-codes", icon: "🔑", label: "Access Codes" },
    { to: "/admin/driver-availability", icon: "📅", label: "Availability" },
    { to: "/admin/agreements", icon: "📝", label: "Agreements" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-brand border-t border-white/10 z-50 pb-[env(safe-area-inset-bottom)]">
      {/* Mobile: Horizontally Scrollable */}
      <div className="overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:overflow-x-visible">
        <div className="flex sm:grid sm:grid-cols-8 gap-0.5 sm:gap-2 md:gap-3 p-1.5 sm:p-2 min-w-max sm:min-w-0 px-2 sm:px-4 max-w-full sm:max-w-screen-xl mx-auto">
          {links.map((item, index) => (
            <NavLink
              key={index}
              to={item.to}
              className={({ isActive }) =>
                `rounded-xl
                px-2.5 sm:px-3 md:px-4 py-1.5
                min-h-[52px]
                flex flex-col items-center justify-center gap-1
                active:scale-95 transition-colors duration-200
                min-w-[68px] sm:min-w-0
                focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70
                ${isActive ? "bg-white text-brand shadow-md" : "text-white/85 hover:bg-white/10"}`
              }
            >
              <span className="text-xl sm:text-2xl leading-none" aria-hidden="true">
                {item.icon}
              </span>
              <small className="font-semibold text-[10px] sm:text-[11px] md:text-[13px] leading-tight text-center whitespace-nowrap">
                {item.label}
              </small>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}

export default Nav;

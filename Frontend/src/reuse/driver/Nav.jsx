import React from "react";
import { NavLink } from "react-router-dom";
import useTranslation from "../../hooks/useTranslation.js";

function Nav() {
  const { t } = useTranslation();

  const links = [
    { to: "/driver/dashboard", icon: "📊", label: t('dashboard') },
    { to: "/driver/access-codes", icon: "🔑", label: t('Access codes') },
    { to: "/driver/delivery", icon: "🚛", label: t('deliveries') },
    { to: "/driver/availability", icon: "📅", label: t('Availability') },
    { to: "/driver/update-password", icon: "💤", label: t('password') },
  ];

  return (
    <>
      {/* Mobile & Desktop Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#462976] border-t border-white/10 z-50">
        <div className="max-w-screen-xl mx-auto px-2 sm:px-4">
          <div className="flex justify-between sm:justify-center gap-1 sm:gap-4 md:gap-6 py-2 sm:py-3">
            {links.map((item, index) => (
              <NavLink
                key={index}
                to={item.to}
                className={({ isActive }) =>
                  `
                  flex flex-col items-center justify-center
                  bg-white text-[#1f2633]
                  rounded-lg sm:rounded-xl
                  px-2 xs:px-3 sm:px-4
                  py-2 sm:py-2.5
                  shadow-md
                  transition-all duration-200
                  active:scale-95 hover:scale-105
                  flex-1 sm:flex-initial
                  min-w-[64px] xs:min-w-[72px] sm:min-w-[96px]
                  ${isActive
                    ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-[#462976]"
                    : ""
                  }
                `
                }
              >
                {/* Icon */}
                <div className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-md sm:rounded-lg bg-[#eef2f7] flex items-center justify-center text-lg sm:text-xl md:text-2xl">
                  {item.icon}
                </div>

                {/* Label */}
                <small className="mt-1 text-[10px] xs:text-[11px] sm:text-[13px] font-semibold leading-tight text-center whitespace-nowrap">
                  {item.label}
                </small>
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
    </>
  );
}

export default Nav;
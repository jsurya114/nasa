import React from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, KeyRound, Truck, CalendarDays, FileText, Lock } from "lucide-react";
import useTranslation from "../../hooks/useTranslation.js";

function Nav() {
  const { t } = useTranslation();

  const links = [
    { to: "/driver/dashboard", Icon: LayoutDashboard, label: t('dashboard') },
    { to: "/driver/access-codes", Icon: KeyRound, label: t('Access codes') },
    { to: "/driver/delivery", Icon: Truck, label: t('deliveries') },
    { to: "/driver/availability", Icon: CalendarDays, label: t('Availability') },
    { to: "/driver/view-agreement", Icon: FileText, label: "Agreement" },
    { to: "/driver/update-password", Icon: Lock, label: t('password') },
  ];

  return (
    <>
      {/* Mobile & Desktop Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-brand border-t border-white/10 z-50 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-screen-xl mx-auto px-1 sm:px-4">
          <div className="flex justify-between sm:justify-center gap-0.5 sm:gap-3 py-1.5 sm:py-2">
            {links.map((item, index) => (
              <NavLink
                key={index}
                to={item.to}
                className={({ isActive }) =>
                  `
                  flex flex-col items-center justify-center
                  rounded-xl
                  px-1 sm:px-4
                  py-1.5
                  min-h-[52px]
                  transition-colors duration-200
                  active:scale-95
                  flex-1 sm:flex-initial
                  min-w-[52px] sm:min-w-[96px]
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70
                  ${isActive
                    ? "bg-white text-brand shadow-md"
                    : "text-white/85 hover:bg-white/10"
                  }
                `
                }
              >
                {/* Icon */}
                <item.Icon className="w-6 h-6 sm:w-7 sm:h-7" strokeWidth={2} aria-hidden="true" />

                {/* Label */}
                <small className="mt-1 text-[10px] sm:text-[13px] font-semibold leading-tight text-center whitespace-nowrap">
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
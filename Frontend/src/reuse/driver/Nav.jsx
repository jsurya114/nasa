import React from "react";
import { LayoutDashboard, KeyRound, Truck, CalendarDays, FileText, Lock } from "lucide-react";
import useTranslation from "../../hooks/useTranslation.js";
import GlassTabBar from "../GlassTabBar.jsx";

function Nav() {
  const { t, currentLanguage } = useTranslation();

  const links = [
    { to: "/driver/dashboard", Icon: LayoutDashboard, label: t('dashboard') },
    { to: "/driver/access-codes", Icon: KeyRound, label: t('Access codes') },
    { to: "/driver/delivery", Icon: Truck, label: t('deliveries') },
    { to: "/driver/availability", Icon: CalendarDays, label: t('Availability') },
    { to: "/driver/view-agreement", Icon: FileText, label: t('agreementTab') },
    { to: "/driver/update-password", Icon: Lock, label: t('password') },
  ];

  return (
    <GlassTabBar
      items={links}
      primaryCount={4}
      moreLabel={t('more')}
      navLabel={t('mainNavigation')}
      lang={currentLanguage}
    />
  );
}

export default Nav;

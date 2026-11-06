import React from "react";
import { LayoutDashboard, KeyRound, Truck, CalendarDays, Wallet, FileText, Lock, CreditCard } from "lucide-react";
import { useEvereeSetup } from "../../hooks/useEvereeSetup.js";
import useTranslation from "../../hooks/useTranslation.js";
import GlassTabBar from "../GlassTabBar.jsx";

function Nav() {
  const { t, currentLanguage } = useTranslation();
  const { required } = useEvereeSetup();

  const links = [
    { to: "/driver/dashboard", Icon: LayoutDashboard, label: t('dashboard') },
    { to: "/driver/access-codes", Icon: KeyRound, label: t('Access codes') },
    { to: "/driver/delivery", Icon: Truck, label: t('deliveries') },
    { to: "/driver/availability", Icon: CalendarDays, label: t('Availability') },
    { to: "/driver/pay", Icon: Wallet, label: t('payTab') },
    { to: "/driver/view-agreement", Icon: FileText, label: t('agreementTab') },
    { to: "/driver/update-password", Icon: Lock, label: t('password') },
    // A permanent entry while the payment setup is unfinished, so it cannot be lost by closing a popup.
    ...(required ? [{ to: "/driver/payment-setup", Icon: CreditCard, label: t('psetTitle') }] : []),
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

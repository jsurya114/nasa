import React from "react";
import { useSelector } from "react-redux";
import {
  LayoutDashboard,
  Users,
  Compass,
  Building2,
  FileUp,
  KeyRound,
  CalendarDays,
  FileText,
  Wallet,
  Banknote,
  BarChart3,
  ReceiptText,
} from "lucide-react";
import GlassTabBar from "./GlassTabBar.jsx";

function Nav() {
  const isSuperAdmin = useSelector((state) => state.admin?.isSuperAdmin === true);
  const links = [
    { to: "/admin/dashboard", Icon: LayoutDashboard, label: "Dashboard" },
    { to: "/admin/create-users", Icon: Users, label: "Users" },
    { to: "/admin/routes", Icon: Compass, label: "Routes" },
    { to: "/admin/jobs", Icon: Building2, label: "Cities" },
    { to: "/admin/double-stop", Icon: FileUp, label: "File Upload" },
    { to: "/admin/manage-access-codes", Icon: KeyRound, label: "Access Codes" },
    { to: "/admin/driver-availability", Icon: CalendarDays, label: "Availability" },
    { to: "/admin/agreements", Icon: FileText, label: "Agreements" },
    // Payroll, pay runs, Insights and Invoices are for the super admin only.
    ...(isSuperAdmin ? [
      { to: "/admin/payroll", Icon: Wallet, label: "Payroll" },
      { to: "/admin/pay-runs", Icon: Banknote, label: "Pay runs" },
      { to: "/admin/insights", Icon: BarChart3, label: "Insights" },
      { to: "/admin/invoices", Icon: ReceiptText, label: "Invoices" },
    ] : []),
  ];

  return <GlassTabBar items={links} primaryCount={4} moreLabel="More" navLabel="Admin navigation" lang="en" />;
}

export default Nav;

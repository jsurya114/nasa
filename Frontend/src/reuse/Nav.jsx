import React from "react";
import {
  LayoutDashboard,
  Users,
  Compass,
  Building2,
  FileUp,
  KeyRound,
  CalendarDays,
  FileText,
} from "lucide-react";
import GlassTabBar from "./GlassTabBar.jsx";

function Nav() {
  const links = [
    { to: "/admin/dashboard", Icon: LayoutDashboard, label: "Dashboard" },
    { to: "/admin/create-users", Icon: Users, label: "Users" },
    { to: "/admin/routes", Icon: Compass, label: "Routes" },
    { to: "/admin/jobs", Icon: Building2, label: "Cities" },
    { to: "/admin/double-stop", Icon: FileUp, label: "File Upload" },
    { to: "/admin/manage-access-codes", Icon: KeyRound, label: "Access Codes" },
    { to: "/admin/driver-availability", Icon: CalendarDays, label: "Availability" },
    { to: "/admin/agreements", Icon: FileText, label: "Agreements" },
  ];

  return <GlassTabBar items={links} primaryCount={4} moreLabel="More" navLabel="Admin navigation" lang="en" />;
}

export default Nav;

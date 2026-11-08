import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import useTranslation from "../../../hooks/useTranslation.js";
import { SkeletonList } from "../../../reuse/Skeleton.jsx";
import { useEvereeSetup } from "../../../hooks/useEvereeSetup.js";

// The complete screen-level lock (issue #242). While a Local driver's Everee setup is unfinished and enforcement is on, every driver page except the
// payment setup page is replaced by a redirect to it. Nothing else renders, so no page or request behind it starts. The server still holds work and payments
// by itself: this is the screen that matches it. If the state cannot be read, the pages stay open (the server gate still refuses work); the first read shows
// a skeleton so a locked driver never sees a page flash.
export default function SetupLock({ children }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { status, data, locked } = useEvereeSetup();
  if (status === "loading" && !data) return <SkeletonList rows={2} label={t("loading")} />;
  if (locked && pathname !== "/driver/payment-setup") return <Navigate to="/driver/payment-setup" replace />;
  return children;
}

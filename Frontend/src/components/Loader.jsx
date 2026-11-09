import React from "react";
import { SkeletonPage } from "../reuse/Skeleton.jsx";

// Shown while a screen's code or first data loads: a page-shaped skeleton instead of a spinner.
export default function Loader() {
  return <SkeletonPage label="Loading, please wait..." />;
}

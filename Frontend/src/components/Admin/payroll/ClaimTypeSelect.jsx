import React from "react";
import { inputClass } from "./formParts.jsx";
import { CLAIM_TYPES } from "./claimTypes.js";

// A drop-down for the claim type of a hand-entered penalty. An entry saved earlier may hold another spelling (for example "fake pod" from
// the carrier's file); it stays selectable so opening an old entry never shows a blank or silently changes it.
export default function ClaimTypeSelect({ value, onChange, ...rest }) {
  const extra = value && !CLAIM_TYPES.includes(value) ? [value] : [];
  return (
    <select className={inputClass} value={value} onChange={onChange} {...rest}>
      <option value="">Choose a claim type</option>
      {[...CLAIM_TYPES, ...extra].map((type) => <option key={type} value={type}>{type}</option>)}
    </select>
  );
}

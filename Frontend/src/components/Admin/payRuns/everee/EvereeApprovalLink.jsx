import React from "react";
import { ExternalLink } from "lucide-react";
import { buttonClass } from "../../payroll/formParts.jsx";

// Sandbox and production use the same portal. No credentials or unverified return URL belong in this link.
export default function EvereeApprovalLink({ className = buttonClass, label = "Open Everee to approve" }) {
  return (
    <a href="https://app.everee.com" target="_blank" rel="noopener noreferrer"
      className={`${className} inline-flex items-center justify-center gap-2`}>
      {label}
      <ExternalLink className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

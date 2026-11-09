import { createContext, useContext } from "react";

// The signed-in Desi driver's QuickBooks setup: the shared context, the hook and the plain helpers. The provider that fills it is in QuickbooksSetupProvider.jsx.
// The server decides everything and reads the driver from the token; the screens only ask and show.
export const QuickbooksSetupContext = createContext(null);

// Without a provider (the sign-in page, other screens' tests) nothing is shown and nothing is requested.
const OFF = Object.freeze({ status: "ready", data: null, required: false, enforced: false, locked: false });

export const isQbRequired = (data) => Boolean(data?.required) && data.state !== "complete";
// Locked like a Local driver's setup: with enforcement on, nothing but the setup page, once the agreement is signed (the agreement has its own screen).
export const isQbLocked = (data) => isQbRequired(data) && Boolean(data?.enforced) && data.blockedBy !== "agreement";

export const useQuickbooksSetup = () => useContext(QuickbooksSetupContext) ?? OFF;

// What the server's refusal codes mean to the driver (translation keys). The provider's own wording is never shown.
export const QB_ERRORS = Object.freeze({
  agreement_required: "qbsetErrAgreement",
  email_required: "qbsetErrEmail",
  not_required: "qbsetErrNotRequired",
  already_complete: "qbsetErrAlreadyComplete",
  missing_fields: "qbsetErrMissing",
  needs_review: "qbsetErrReview",
  quickbooks_refused: "qbsetErrRefused",
  service_unavailable: "qbsetErrUnavailable",
  unexpected_answer: "qbsetErrReview",
});
export const qbErrorKeyOf = (error) => QB_ERRORS[error?.response?.data?.code] ?? "qbsetErrGeneric";

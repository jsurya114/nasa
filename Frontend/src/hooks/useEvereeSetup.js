import { createContext, useContext } from "react";

// The signed-in driver's Everee payment setup (issue #242): the shared context, the hook and the plain helpers. The provider that fills it is in
// EvereeSetupProvider.jsx. The server decides everything and reads the driver from the token; the screens only ask and show.
export const EvereeSetupContext = createContext(null);

// Without a provider (the sign-in page, other screens' tests) nothing is shown and nothing is requested.
const OFF = Object.freeze({ status: "ready", data: null, required: false, enforced: false, promptDismissed: true });

export const isSetupRequired = (data) => Boolean(data?.required) && data.state !== "complete";

export const useEvereeSetup = () => useContext(EvereeSetupContext) ?? OFF;

// What the server's refusal codes mean to the driver (translation keys).
export const SETUP_ERRORS = Object.freeze({
  agreement_required: "psetErrAgreement",
  classification_required: "psetErrClassification",
  not_local: "psetErrNotLocal",
  driver_disabled: "psetErrDisabled",
  onboarding_unavailable: "psetErrUnavailable",
  service_unavailable: "psetErrUnavailable",
  everee_refused: "psetErrRefused",
  too_many_sessions: "psetErrTooMany",
  missing_fields: "psetErrMissing",
  link_not_verified_for_tenant: "psetErrReview",
  not_started: "psetErrNotStarted",
  already_complete: "psetErrAlreadyComplete",
  not_complete: "psetErrNotComplete",
});
export const errorKeyOf = (error) => SETUP_ERRORS[error?.response?.data?.code] ?? "psetErrGeneric";

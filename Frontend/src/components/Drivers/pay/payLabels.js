// Translation keys for the values the pay statement API sends (#145).

const STATE_KEYS = {
  pending: "statePending",
  approved: "stateApproved",
  submitted: "stateSubmitted",
  paid: "statePaid",
  failed: "stateFailed",
  unconfirmed: "stateUnconfirmed",
  voided: "stateVoided",
};

const STATE_TONES = {
  paid: "bg-green-100 text-green-800 border-green-300",
  approved: "bg-blue-100 text-blue-800 border-blue-300",
  submitted: "bg-blue-100 text-blue-800 border-blue-300",
  pending: "bg-gray-100 text-gray-700 border-gray-300",
  unconfirmed: "bg-amber-100 text-amber-800 border-amber-300",
  failed: "bg-red-100 text-red-800 border-red-300",
  voided: "bg-gray-100 text-gray-600 border-gray-300 line-through",
};

const ENTRY_KEYS = {
  advance: "entryAdvance",
  advance_repayment: "entryAdvanceRepayment",
  expense: "entryExpense",
  reimbursement: "entryReimbursement",
  manual_claim: "entryManualClaim",
  correction: "entryCorrection",
};

export const stateKey = (state) => STATE_KEYS[state] ?? "statePending";
export const stateTone = (state) => STATE_TONES[state] ?? STATE_TONES.pending;
export const entryKey = (type) => ENTRY_KEYS[type] ?? "entryCorrection";

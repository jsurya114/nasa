// How each transfer status is shown (translation keys and colours). The five statuses come from the server and are never merged: a transfer is
// "completed" only when NASA verified Everee's payout as paid.
export const TRANSFER_VIEW = Object.freeze({
  pending: { label: "etrStatusPending", hint: "etrHintPending", tone: "bg-blue-100 text-blue-800 border-blue-300" },
  unconfirmed: { label: "etrStatusUnconfirmed", hint: "etrHintUnconfirmed", tone: "bg-amber-100 text-amber-800 border-amber-300" },
  failed: { label: "etrStatusFailed", hint: "etrHintFailed", tone: "bg-red-100 text-red-800 border-red-300" },
  returned: { label: "etrStatusReturned", hint: "etrHintReturned", tone: "bg-red-100 text-red-800 border-red-300" },
  completed: { label: "etrStatusCompleted", hint: "etrHintCompleted", tone: "bg-green-100 text-green-800 border-green-300" },
});

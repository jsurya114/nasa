// Drafts of forms a person is filling in, so a dropped connection or a reloaded page does not lose what they typed
// (docs/MOBILE_APP_DESIGN.md, section 6). They live in sessionStorage: private to this tab or WebView, gone when it
// closes, never shared. Each draft is keyed by area and person, so someone else signing in on the same phone never
// sees it, and all of an area's drafts are removed at sign-out.

const PREFIX = "nasa.draft.";
// A save whose result the page could not confirm (see hooks/useUncertainSave.js). It is remembered here, apart from the
// typed entries, so a reload cannot forget that the server may already hold the record. Same rules as a draft:
// private to this tab, keyed by area and person, and removed at sign-out.
const PENDING_PREFIX = "nasa.pending.";
const MAX_VALUE_LENGTH = 500;

const keyFor = (area, userId, form) => `${PREFIX}${area}.${userId}.${form}`;
const pendingKeyFor = (area, userId, form) => `${PENDING_PREFIX}${area}.${userId}.${form}`;

const storage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

// Only plain text values of a sensible size are kept, whatever was stored.
const cleanValues = (values) => {
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  const out = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === "string" && value.length <= MAX_VALUE_LENGTH) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
};

export const readDraft = (area, userId, form) => {
  try {
    const raw = storage()?.getItem(keyFor(area, userId, form));
    return raw ? cleanValues(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

// An empty form removes its draft instead of storing blanks.
export const writeDraft = (area, userId, form, values) => {
  try {
    const clean = cleanValues(Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => v !== "")));
    if (clean) storage()?.setItem(keyFor(area, userId, form), JSON.stringify(clean));
    else storage()?.removeItem(keyFor(area, userId, form));
  } catch {
    // Without storage the draft just lives in the form
  }
};

export const clearDraft = (area, userId, form) => {
  try {
    storage()?.removeItem(keyFor(area, userId, form));
  } catch {
    // Nothing to clear
  }
};

// `scope` says which submission is unconfirmed (for the journey form, its date), so a leftover from another day is
// never mistaken for today's.
export const markPending = (area, userId, form, scope) => {
  try {
    storage()?.setItem(pendingKeyFor(area, userId, form), String(scope));
  } catch {
    // Without storage this only lasts until the page is reloaded
  }
};

// The scope that was marked, or null.
export const readPending = (area, userId, form) => {
  try {
    return storage()?.getItem(pendingKeyFor(area, userId, form)) ?? null;
  } catch {
    return null;
  }
};

export const clearPending = (area, userId, form) => {
  try {
    storage()?.removeItem(pendingKeyFor(area, userId, form));
  } catch {
    // Nothing to clear
  }
};

// At sign-out: every draft and unconfirmed-save mark of this area, whoever it belonged to.
export const clearDrafts = (area) => {
  try {
    const store = storage();
    if (!store) return;
    const prefixes = [`${PREFIX}${area}.`, `${PENDING_PREFIX}${area}.`];
    Object.keys(store)
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => store.removeItem(key));
  } catch {
    // Nothing to clear
  }
};

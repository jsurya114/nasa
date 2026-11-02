// Drafts of forms a person is filling in, so a dropped connection or a reloaded page does not lose what they typed
// (docs/MOBILE_APP_DESIGN.md, section 6). They live in sessionStorage: private to this tab or WebView, gone when it
// closes, never shared. Each draft is keyed by area and person, so someone else signing in on the same phone never
// sees it, and all of an area's drafts are removed at sign-out.

const PREFIX = "nasa.draft.";
const MAX_VALUE_LENGTH = 500;

const keyFor = (area, userId, form) => `${PREFIX}${area}.${userId}.${form}`;

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

// At sign-out: every draft of this area, whoever it belonged to.
export const clearDrafts = (area) => {
  try {
    const store = storage();
    if (!store) return;
    const prefix = `${PREFIX}${area}.`;
    Object.keys(store)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => store.removeItem(key));
  } catch {
    // Nothing to clear
  }
};

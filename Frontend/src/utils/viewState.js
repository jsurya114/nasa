// What a person has set on a page (filters, search text, page number, chosen tab or city), kept so that leaving a page and coming back
// finds it as it was. Like the form drafts (utils/formDrafts.js), it lives in sessionStorage: private to this tab, gone when the tab
// closes, keyed by area and person so someone else signing in on the same device never sees it, and removed at sign-out.

const PREFIX = "nasa.view.";
const MAX_VALUE_LENGTH = 20000;

const keyFor = (area, userId, page, name) => `${PREFIX}${area}.${userId}.${page}.${name}`;

const storage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

// The saved value, or undefined when nothing usable is saved.
export const readView = (area, userId, page, name) => {
  try {
    const raw = storage()?.getItem(keyFor(area, userId, page, name));
    return raw === null || raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
};

// A value that is too large, or that cannot be written, is simply not kept: the page works without it.
export const writeView = (area, userId, page, name, value) => {
  try {
    const raw = JSON.stringify(value);
    if (raw === undefined || raw.length > MAX_VALUE_LENGTH) storage()?.removeItem(keyFor(area, userId, page, name));
    else storage()?.setItem(keyFor(area, userId, page, name), raw);
  } catch {
    // Without storage the value just lives in the page
  }
};

export const removeView = (area, userId, page, name) => {
  try {
    storage()?.removeItem(keyFor(area, userId, page, name));
  } catch {
    // Nothing to remove
  }
};

// At sign-out: everything kept for this area, whoever it belonged to.
export const clearViewState = (area) => {
  try {
    const store = storage();
    if (!store) return;
    const prefix = `${PREFIX}${area}.`;
    Object.keys(store).filter((key) => key.startsWith(prefix)).forEach((key) => store.removeItem(key));
  } catch {
    // Nothing to clear
  }
};

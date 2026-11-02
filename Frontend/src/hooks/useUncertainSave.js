import { useCallback, useEffect, useRef, useState } from "react";
import { clearPending, markPending, readPending } from "../utils/formDrafts";

// A save whose result is not known: the connection dropped after the request was sent, so the server may or may not
// have stored it. Instead of an error (which invites a second submit) the page asks the server what it has.
//
//   check()   asks the server whether the record exists: resolves true or false, rejects if it cannot be reached.
//   onSaved() runs when the record is found, so the page can show the usual success.
//   persist   { area, userId, form, scope } remembers an unconfirmed save in this tab, so a reload (which keeps the
//             typed entries) does not lose it: the form comes back with submit still off, and the server is asked again
//             by itself. `scope` says which submission it is (the journey date), and a mark for another scope is
//             dropped. Without it, or until `userId` is known, nothing is remembered.
//
// state: null, "checking", "unconfirmed" (could not reach the server: keep waiting), or "notSaved" (the server has
// nothing: it is safe to submit again). `blocked` is true while a second submit could duplicate the first.
export default function useUncertainSave({ check, onSaved, persist }) {
  const [state, setState] = useState(null);
  const latest = useRef({ check, onSaved });
  latest.current = { check, onSaved };

  const where = persist?.userId && persist.scope ? persist : null;
  const whereRef = useRef(where);
  whereRef.current = where;
  const scopeId = where ? String(where.scope) : null;

  // Read on every render, not copied into state, so the form is already blocked on the first render after a reload
  const marked = where ? readPending(where.area, where.userId, where.form) === scopeId : false;

  const run = useCallback(async () => {
    setState("checking");
    try {
      const saved = await latest.current.check();
      // Either answer settles it; only a check that could not reach the server leaves the mark in place
      const here = whereRef.current;
      if (here) clearPending(here.area, here.userId, here.form);
      if (saved) {
        setState(null);
        latest.current.onSaved();
      } else {
        setState("notSaved");
      }
    } catch {
      setState("unconfirmed");
    }
  }, []);

  const begin = useCallback(() => {
    const here = whereRef.current;
    if (here) markPending(here.area, here.userId, here.form, here.scope);
    return run();
  }, [run]);

  // After a reload: a mark for today's submission is checked again by itself; one for another day is forgotten
  const resumed = useRef(null);
  const area = where?.area;
  const userId = where?.userId;
  const form = where?.form;
  useEffect(() => {
    if (!area || !userId) return;
    const stored = readPending(area, userId, form);
    if (stored === null) return;
    if (stored !== scopeId) {
      clearPending(area, userId, form);
      return;
    }
    const identity = `${area}.${userId}.${form}.${scopeId}`;
    if (resumed.current === identity) return;
    resumed.current = identity;
    run();
  }, [area, userId, form, scopeId, run]);

  // When the connection comes back, look again by itself
  useEffect(() => {
    if (state !== "unconfirmed") return undefined;
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [state, run]);

  const dismiss = useCallback(() => {
    const here = whereRef.current;
    if (here) clearPending(here.area, here.userId, here.form);
    setState(null);
  }, []);

  const shown = state ?? (marked ? "checking" : null);
  return {
    state: shown,
    begin,
    checkAgain: run,
    dismiss,
    blocked: shown === "checking" || shown === "unconfirmed",
  };
}

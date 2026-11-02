import { useCallback, useEffect, useRef, useState } from "react";

// A save whose result is not known: the connection dropped after the request was sent, so the server may or may not
// have stored it. Instead of an error (which invites a second submit) the page asks the server what it has.
//
//   check()   asks the server whether the record exists: resolves true or false, rejects if it cannot be reached.
//   onSaved() runs when the record is found, so the page can show the usual success.
//
// state: null, "checking", "unconfirmed" (could not reach the server: keep waiting), or "notSaved" (the server has
// nothing: it is safe to submit again). `blocked` is true while a second submit could duplicate the first.
export default function useUncertainSave({ check, onSaved }) {
  const [state, setState] = useState(null);
  const latest = useRef({ check, onSaved });
  latest.current = { check, onSaved };

  const run = useCallback(async () => {
    setState("checking");
    try {
      const saved = await latest.current.check();
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

  // When the connection comes back, look again by itself
  useEffect(() => {
    if (state !== "unconfirmed") return undefined;
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [state, run]);

  return {
    state,
    begin: run,
    checkAgain: run,
    dismiss: useCallback(() => setState(null), []),
    blocked: state === "checking" || state === "unconfirmed",
  };
}

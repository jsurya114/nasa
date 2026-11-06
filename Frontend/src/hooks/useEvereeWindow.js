import { useCallback, useEffect, useRef, useState } from "react";
import { callNative, isNativeShell } from "../native/bridge";
import { errorKeyOf, useEvereeSetup } from "./useEvereeSetup.js";

export const NATIVE_WINDOW_MS = 30 * 60 * 1000; // the person may take their time inside Everee's window
const PROBLEM_KEY = { bad_session: "psetProbBad", expired: "psetProbExpired", no_connection: "psetProbConnection", screen_error: "psetProbScreen" };

// Opens one of Everee's own screens for the signed-in driver (payment history, bank details) the way the setup page does: an iframe with a private channel
// on the web, the shell's separate window in the phone app. A fresh single-use link is asked for only when a button is pressed; it is held in this state while
// the window is open and dropped when it closes. Returns the session to render with <EvereeEmbed/> (web only), and a message key when something went wrong.
export default function useEvereeWindow({ onClosed } = {}) {
  const setup = useEvereeSetup();
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [messageKey, setMessageKey] = useState(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const close = useCallback(() => {
    setSession(null); // the single-use link is dropped as soon as the window closes
    onClosed?.();
  }, [onClosed]);

  const problem = useCallback((kind) => {
    setSession(null);
    setMessageKey(PROBLEM_KEY[kind] ?? "psetErrGeneric");
  }, []);

  const open = useCallback(async (experience) => {
    if (busy) return;
    setBusy(true);
    setMessageKey(null);
    try {
      const opened = await setup.openSession(experience);
      if (isNativeShell()) {
        try {
          await callNative("everee.open", { url: opened.url }, { timeoutMs: NATIVE_WINDOW_MS });
        } catch (nativeError) {
          setMessageKey(nativeError?.code === "unsupported_action" ? "psetProbUpdateApp" : nativeError?.code === "busy" ? "psetProbBusy" : "psetProbConnection");
          return;
        }
        onClosed?.();
        return;
      }
      setSession(opened);
    } catch (error) {
      setMessageKey(errorKeyOf(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, setup, onClosed]);

  return { open, close, problem, session, busy, messageKey };
}

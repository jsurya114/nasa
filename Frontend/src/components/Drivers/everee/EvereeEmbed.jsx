import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import useTranslation from "../../../hooks/useTranslation.js";
import { checkSession, readEvent, REGISTER_TIMEOUT_MS } from "./embedRules.js";

// Everee's own screens (onboarding), opened inside NASA in an iframe, as Everee documents. The page talks to Everee only through a private
// MessageChannel that this component creates for each load; an event is accepted only from that port and only if it has the shape and the handler
// name of THIS session. An event never decides anything: it only tells the page to ask the server (which asks Everee) what is true now.
// The link is a bearer credential: it lives in this component's props only. It is never logged, stored, put in the URL or reused.

// onFinished(): the driver finished or closed the screen (the page then asks the server). onProblem(kind): 'bad_session' | 'expired' | 'no_connection' | 'screen_error'.
// `connectTimeoutMs` is how long to wait for the screen to register before giving up; only the tests change it.
export default function EvereeEmbed({ session, onFinished, onProblem, onClose, connectTimeoutMs = REGISTER_TIMEOUT_MS }) {
  const { t } = useTranslation();
  // Checked once per session, NOT once per render: the effect below depends on it, and a fresh object on every render (for example the one caused by
  // hiding the "Opening Everee…" line when the screen registers) would reset the handshake and close a healthy screen after the timeout.
  const checked = useMemo(() => checkSession(session), [session]);
  const portRef = useRef(null);
  const timersRef = useRef([]);
  // Registration belongs to the SESSION it happened for: once a session has registered, nothing (not an effect that runs late, not a re-run, not a
  // re-render) can make it look unregistered again or arm its timers.
  const registeredFor = useRef(null);
  const closeRef = useRef(null);
  const handlers = useRef({ onFinished, onProblem });
  handlers.current = { onFinished, onProblem };
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!checked) handlers.current.onProblem?.("bad_session");
  }, [checked]);

  // Until the screen has registered, the link may run out (it is single-use and short-lived) or the connection may never come. These timers belong to
  // this session only: they start once for it, and they are cancelled for good the moment the screen registers (nothing later can close a working screen).
  useEffect(() => {
    if (!checked || registeredFor.current === session) return undefined;
    const expiry = session.expiresAt ? Math.max(0, new Date(session.expiresAt).getTime() - Date.now()) : null;
    timersRef.current = [setTimeout(() => { if (registeredFor.current !== session) handlers.current.onProblem?.("no_connection"); }, connectTimeoutMs)];
    if (expiry !== null) timersRef.current.push(setTimeout(() => { if (registeredFor.current !== session) handlers.current.onProblem?.("expired"); }, expiry));
    return () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
  }, [checked, session, connectTimeoutMs]);

  useEffect(() => () => { portRef.current?.close(); portRef.current = null; }, []);
  useEffect(() => { closeRef.current?.focus(); }, []);

  const onLoad = useCallback((event) => {
    if (!checked) return;
    portRef.current?.close(); // a reloaded frame needs a new channel; a port can be transferred once
    const channel = new MessageChannel();
    portRef.current = channel.port1;
    channel.port1.onmessage = (message) => {
      const read = readEvent(message.data, session.eventHandlerName);
      if (!read) return;
      if (read.type === "MESSAGE_PORT_REGISTERED") {
        registeredFor.current = session;
        timersRef.current.forEach(clearTimeout); // connected: neither "no connection" nor "expired" can fire any more
        timersRef.current = [];
        setLoading(false);
        return;
      }
      if (read.error) { handlers.current.onProblem?.("screen_error"); return; }
      if (read.type === "WORKER_ONBOARDING_COMPLETE" || read.type === "DISMISS") handlers.current.onFinished?.();
    };
    // Sent only to the origin of the link, never "*".
    event.currentTarget.contentWindow?.postMessage("", checked.origin, [channel.port2]);
  }, [checked, session]);

  const onKeyDown = (e) => { if (e.key === "Escape") onClose?.(); };

  if (!checked) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("psetEmbedTitle")}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[70] flex flex-col bg-white sm:inset-6 sm:overflow-hidden sm:rounded-2xl sm:shadow-2xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line bg-brand-50/60 px-4 py-2">
        <h2 className="text-base font-bold text-ink">{t("psetEmbedTitle")}</h2>
        <button ref={closeRef} type="button" onClick={onClose} aria-label={t("close")} className="grid h-11 w-11 place-items-center rounded-lg text-ink-muted hover:bg-white/70">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {loading && <p role="status" className="absolute inset-x-0 top-6 text-center text-sm text-ink-muted">{t("psetEmbedLoading")}</p>}
        {/* No sandbox attribute is set: Everee's documentation names none, and its screens need scripts, forms and their own storage. The frame is given no
            device permissions, and a link that is not https on an Everee host is never rendered. */}
        <iframe
          title={t("psetEmbedTitle")}
          src={checked.src}
          onLoad={onLoad}
          allow=""
          referrerPolicy="no-referrer"
          className="h-full w-full border-0"
        />
      </div>
    </div>
  );
}

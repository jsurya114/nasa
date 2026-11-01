import { toast as baseToast } from "react-toastify";

/*
 * One notification helper for the whole app, built on react-toastify (no second library).
 * Same calls as before (toast.success, toast.error, ...), plus:
 * - the same message is never stacked twice while it is still on screen;
 * - errors and warnings stay longer (they may need action) and pause while hovered or focused;
 * - screen readers hear errors and warnings at once, other messages politely;
 * - position is decided by the app-wide container, so every message appears in the same place;
 * - toast.track() shows a loading message that turns into the real success or failure.
 */

const DURATION_MS = { default: 4000, success: 3500, info: 4500, warning: 6500, error: 8000 };
const ROLE = { default: "status", success: "status", info: "status", warning: "alert", error: "alert" };
const NEEDS_TIME = new Set(["warning", "error"]);

const autoCloseFor = (type, requested) => {
  if (requested === false) return false;
  const base = DURATION_MS[type];
  if (typeof requested !== "number") return base;
  return NEEDS_TIME.has(type) ? Math.max(requested, base) : requested;
};

const optionsFor = (type, content, options = {}) => {
  // eslint-disable-next-line no-unused-vars -- position is dropped on purpose: the container decides it.
  const { position, autoClose, ...rest } = options;
  const toastId = rest.toastId ?? (typeof content === "string" ? `${type}:${content}` : undefined);
  return { ...rest, toastId, role: rest.role ?? ROLE[type], autoClose: autoCloseFor(type, autoClose) };
};

const show = (type) => (content, options) => {
  const opts = optionsFor(type, content, options);
  if (opts.toastId !== undefined && baseToast.isActive(opts.toastId)) return opts.toastId;
  return type === "default" ? baseToast(content, opts) : baseToast[type](content, opts);
};

const resolveMessage = (message, value) => (typeof message === "function" ? message(value) : message);

const finish = (id, type, render) =>
  baseToast.update(id, {
    render,
    type,
    isLoading: false,
    role: ROLE[type],
    autoClose: DURATION_MS[type],
    closeButton: true,
    closeOnClick: false,
    draggable: true,
  });

/**
 * Shows `pending` while the promise runs, then the real result.
 * Success is only shown after the promise resolves. The error is shown and then re-thrown,
 * so the caller's own error handling still runs.
 */
async function track(promise, { pending, success, error }) {
  const id = baseToast.loading(pending, { role: "status" });
  try {
    const value = await promise;
    finish(id, "success", resolveMessage(success, value));
    return value;
  } catch (err) {
    finish(id, "error", resolveMessage(error, err));
    throw err;
  }
}

export const toast = Object.assign(show("default"), {
  success: show("success"),
  error: show("error"),
  info: show("info"),
  warning: show("warning"),
  warn: show("warning"),
  loading: (content, options) => baseToast.loading(content, { role: "status", ...options }),
  update: baseToast.update,
  dismiss: baseToast.dismiss,
  isActive: baseToast.isActive,
  track,
});

export default toast;

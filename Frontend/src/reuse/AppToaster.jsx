import { ToastContainer, Slide } from "react-toastify";
import { CircleCheck, CircleX, TriangleAlert, Info, LoaderCircle, Bell, X } from "lucide-react";
import useTranslation from "../hooks/useTranslation.js";

const ICONS = {
  success: CircleCheck,
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
  default: Bell,
};

function CloseButton({ closeToast }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="toast-close" onClick={closeToast} aria-label={t("dismissNotification")}>
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function ToastIcon({ type, isLoading }) {
  if (isLoading) return <LoaderCircle className="toast-icon animate-spin" aria-hidden="true" />;
  const Icon = ICONS[type] ?? ICONS.default;
  return <Icon className="toast-icon" aria-hidden="true" />;
}

/**
 * The single place notifications appear. Styling lives in index.css (".Toastify").
 * Top of the screen, below the header, so messages never cover the bottom navigation or
 * the main buttons. At most three at a time; newer ones wait their turn.
 */
function AppToaster() {
  const { t } = useTranslation();

  return (
    <ToastContainer
      position="top-right"
      limit={3}
      newestOnTop
      closeOnClick={false}
      pauseOnHover
      pauseOnFocusLoss
      draggable="touch"
      transition={Slide}
      icon={ToastIcon}
      closeButton={(props) => <CloseButton {...props} />}
      theme="light"
      aria-label={t("notifications")}
    />
  );
}

export default AppToaster;

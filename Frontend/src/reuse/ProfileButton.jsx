import { useNavigate } from "react-router-dom";
import { CircleUserRound } from "lucide-react";
import useTranslation from "../hooks/useTranslation.js";

// The way to the profile page (help, privacy, Delete account live there), shown with the person icon and the words "My profile" so nobody has to
// guess. "bar": the name and the label, on wide screens. "icon": the icon alone in the phone header, next to the menu.
export default function ProfileButton({ to, name, variant = "bar" }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const label = t("profTitle");
  if (variant === "icon") {
    return (
      <button type="button" onClick={() => navigate(to)} aria-label={`${label}: ${name ?? ""}`} title={label}
        className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
        <CircleUserRound className="h-7 w-7" aria-hidden="true" />
      </button>
    );
  }
  return (
    <button type="button" onClick={() => navigate(to)} aria-label={`${label}: ${name ?? ""}`}
      className="flex items-center gap-2 rounded-xl px-2 py-1 text-left hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
      <CircleUserRound className="h-8 w-8 shrink-0" aria-hidden="true" />
      <span className="flex flex-col leading-tight">
        <span className="max-w-[150px] truncate font-semibold">{name}</span>
        <span className="text-xs text-white/80">{label}</span>
      </span>
    </button>
  );
}

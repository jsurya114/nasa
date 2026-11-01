import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Ellipsis } from "lucide-react";

const isActivePath = (pathname, to) => pathname === to || pathname.startsWith(`${to}/`);

const tabClass = ({ isActive }) =>
  `group flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[1.35rem] px-1 py-1.5
   text-[11px] font-medium leading-tight transition-colors duration-200 ease-[var(--ease-out-soft)]
   md:min-w-[5.25rem] md:flex-none md:px-3 md:text-xs
   ${isActive ? "bg-white text-brand-800 shadow-md" : "text-white/80 hover:bg-white/10 hover:text-white"}`;

function TabLabel({ lang, children }) {
  return (
    <span lang={lang} className="line-clamp-2 block w-full text-center [hyphens:auto] [overflow-wrap:break-word]">
      {children}
    </span>
  );
}

/**
 * Floating liquid-glass navigation shared by the admin and driver areas.
 * Phones show the first `primaryCount` links and put the rest in a "More" menu, so labels fit
 * in English and Spanish. Very narrow phones (under 380px) move one more link into "More".
 * Tablets and desktops show every link. A spacer in the page flow keeps the bar from ever
 * covering the last content or buttons on the page.
 */
function GlassTabBar({ items, primaryCount = 4, moreLabel = "More", navLabel = "Main navigation", lang = "en" }) {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();

  // On narrow phones the last primary link also moves into "More".
  const lastPrimaryIndex = primaryCount - 1;
  const overflow = items.slice(lastPrimaryIndex);
  const overflowActive = items.slice(primaryCount).some((item) => isActivePath(pathname, item.to));
  const lastPrimaryActive = isActivePath(pathname, items[lastPrimaryIndex]?.to ?? "");

  useEffect(() => {
    if (!moreOpen) return undefined;

    const closeAndReturnFocus = () => {
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeAndReturnFocus();
    };
    const onPointerDown = (event) => {
      if (panelRef.current?.contains(event.target) || moreButtonRef.current?.contains(event.target)) return;
      setMoreOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    panelRef.current?.querySelector("a")?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [moreOpen]);

  return (
    <>
      {/* Keeps page content and actions clear of the floating bar. */}
      <div aria-hidden="true" className="h-[calc(6.5rem+env(safe-area-inset-bottom))]" />

      <nav
        aria-label={navLabel}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
      >
        <div className="relative w-full max-w-md md:w-auto md:max-w-none">
          {/* The menu sits outside the bar: a blurred element inside another one cannot blur the page. */}
          {moreOpen && (
            <div
              ref={panelRef}
              id={panelId}
              className="glass-light animate-sheet-in pointer-events-auto absolute bottom-full right-0 mb-3 w-64 max-w-full origin-bottom-right rounded-3xl p-2 md:hidden"
            >
              <ul className="space-y-1">
                {overflow.map((item, index) => (
                  <li key={item.to} className={index === 0 ? "min-[380px]:hidden" : undefined}>
                    <NavLink
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        `flex min-h-12 items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                          isActive ? "bg-brand-100 text-brand-800" : "text-ink hover:bg-brand-50"
                        }`
                      }
                    >
                      <item.Icon className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden="true" />
                      <span lang={lang}>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="glass-violet pointer-events-auto flex w-full items-stretch gap-1 rounded-[1.75rem] p-1.5">
            {items.map((item, index) => {
              const placement =
                index > lastPrimaryIndex ? "hidden md:flex" : index === lastPrimaryIndex ? "max-[379px]:hidden" : "";
              return (
                <NavLink key={item.to} to={item.to} className={(state) => `${tabClass(state)} ${placement}`}>
                  <item.Icon className="h-[22px] w-[22px] shrink-0" strokeWidth={2} aria-hidden="true" />
                  <TabLabel lang={lang}>{item.label}</TabLabel>
                </NavLink>
              );
            })}

            {items.length > primaryCount && (
              <button
                ref={moreButtonRef}
                type="button"
                aria-expanded={moreOpen}
                aria-controls={panelId}
                onClick={() => setMoreOpen((open) => !open)}
                className={`${tabClass({ isActive: overflowActive && !moreOpen })} md:hidden ${
                  moreOpen ? "bg-white/15 text-white" : ""
                } ${lastPrimaryActive && !moreOpen ? "max-[379px]:bg-white max-[379px]:text-brand-800 max-[379px]:shadow-md" : ""}`}
              >
                <Ellipsis className="h-[22px] w-[22px] shrink-0" strokeWidth={2} aria-hidden="true" />
                <TabLabel lang={lang}>{moreLabel}</TabLabel>
              </button>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}

export default GlassTabBar;

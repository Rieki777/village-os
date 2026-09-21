/**
 * MobileFab: floating action button, bottom right, mobile only.
 *
 * Tapping the Amora lotus opens a column of labeled shortcut rows that springs
 * upward from the trigger, nearest row first, behind a soft focus scrim. Each
 * row is one large tap target: a readable label plus a round icon button.
 *
 * Shortcuts come from config/mobileNav.ts (FAB_ACTIONS).
 *
 * Ported from regen-civics WizardRadialMenu. Four things are carried over from
 * that implementation on purpose, because each one is a fix for a real failure:
 *
 *  1. pointer-events-none on the positioning container. Closed rows stay mounted
 *     at opacity 0 so the transition can run, which leaves this fixed box
 *     hundreds of pixels tall while nothing is visible. Without this, the box
 *     itself swallows every tap in the bottom-right of the screen even when the
 *     menu is shut. Interactive children re-enable with pointer-events-auto.
 *  2. A hard floor under the bottom offset. Some iOS Safari cases (PWA mode,
 *     embedded web views, landscape) report env(safe-area-inset-bottom) as 0,
 *     and without a floor the FAB disappears behind the tab bar entirely.
 *     The offset rides the safe area so the overlap is the same on every
 *     device: the trigger's lower edge tucks about 1rem into the bar rather
 *     than floating a thumb's width above it.
 *  3. Layering: modal sheets z-[70], FAB z-[60], scrim z-[55], tab bar z-50.
 *     The scrim has to sit between the FAB and the bar, not over both — and a
 *     modal has to clear all three, or the tab bar sits on top of the sheet's
 *     own buttons (the village map's node card shipped that way at z-50).
 *  4. Plain tap rows rather than a gesture-driven radial. The gesture version
 *     did not survive iOS Safari.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { FAB_ACTIONS, FabTriggerIcon, type FabAction } from "@/config/mobileNav";
import { haptic } from "@/lib/haptics";
import { isBareRoute, normalisePath } from "./MobileTabBar";

/** Springy easing so rows feel like they pop up out of the lotus. */
const SPRING = "cubic-bezier(0.34, 1.4, 0.64, 1)";

type ResolvedAction = {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  href?: string;
  event?: string;
};

function resolve(actions: FabAction[], currentPath: string, isAuthenticated: boolean): ResolvedAction[] {
  const out: ResolvedAction[] = [];
  for (const a of actions) {
    if (a.requiresAuth === true && !isAuthenticated) continue;
    if (a.requiresAuth === false && isAuthenticated) continue;

    const onAnchor =
      !!a.anchorPath &&
      (currentPath === a.anchorPath || currentPath.startsWith(a.anchorPath + "/"));

    if (onAnchor && a.insteadOf) {
      out.push({ key: `${a.key}-alt`, label: a.insteadOf.label, Icon: a.insteadOf.Icon, href: a.insteadOf.href });
      continue;
    }
    // Already on this page and no useful alternative: drop the row rather than
    // offer a link back to where the person already is.
    if (onAnchor) continue;

    out.push({ key: a.key, label: a.label, Icon: a.Icon, href: a.href, event: a.event });
  }
  return out;
}

export default function MobileFab() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { user } = useAuth();
  const currentPath = normalisePath(location);
  const actions = resolve(FAB_ACTIONS, currentPath, !!user);

  const toggle = useCallback(() => {
    // "press" is 10ms, the number this line used to spell out. The util in
    // client/src/lib/haptics.ts holds the vocabulary now.
    haptic("press");
    setOpen((s) => !s);
  }, []);

  // Tap anywhere else to close.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // The screens that render no tab bar render no FAB either: the trigger is a
  // 56px circle in the bottom-right, and on /login it sat over the right end
  // of the full-width sign-in button. Same list, same reason (mobileNav.ts).
  if (isBareRoute(location)) return null;

  return (
    <>
      {/* Focus scrim, between the tab bar (z-50) and the FAB (z-[60]). */}
      <div
        aria-hidden="true"
        className={`fixed inset-0 z-[55] md:hidden bg-black/45 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ backdropFilter: open ? "blur(2px)" : undefined }}
      />

      <div
        // Rides up clear of the living map's circle peek while one shows (index.css).
        data-mobile-fab
        className="fixed right-4 z-[60] md:hidden flex flex-col items-end pointer-events-none"
        // Tab bar is h-16 (4rem) of content plus the safe-area pad. Offsetting
        // by that same pad + 3.5rem leaves the trigger's lower edge exactly
        // 0.5rem over the bar's top edge on EVERY device — the safe area
        // cancels, so a notched phone and a desktop viewport overlap
        // identically instead of drifting apart. Anchored in the corner it
        // belongs in, not hovering a thumb's width above it.
        style={{ bottom: "max(calc(env(safe-area-inset-bottom, 0px) + 3.5rem), 3.5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          role="menu"
          aria-label="Shortcuts"
          aria-hidden={!open}
          className={`flex flex-col items-end gap-2.5 mb-3 transition-all duration-200 ${
            open ? "pointer-events-auto" : "pointer-events-none"
          }`}
        >
          {actions.map((a, i) => {
            // Nearest the trigger reveals first, so the stack springs upward.
            const delay = open ? `${(actions.length - 1 - i) * 38}ms` : `${i * 18}ms`;
            const cls =
              "group/row flex items-center gap-2.5 outline-none transition-all duration-300 focus-visible:opacity-100 " +
              (open ? "opacity-100 translate-x-0 scale-100" : "opacity-0 translate-x-5 scale-90");
            const style: React.CSSProperties = { transitionDelay: delay, transitionTimingFunction: SPRING };

            const inner = (
              <>
                <span className="select-none whitespace-nowrap rounded-xl border border-white/15 bg-teal-band/95 px-3 py-1.5 text-[13px] font-semibold text-cream shadow-lg backdrop-blur-sm transition-colors group-hover/row:bg-teal-deep group-hover/row:text-white">
                  {a.label}
                </span>
                <span className="w-12 h-12 flex-shrink-0 rounded-full border border-teal/60 bg-teal-deep text-cream flex items-center justify-center shadow-lg transition-transform duration-200 group-hover/row:scale-105 group-hover/row:border-teal group-active/row:scale-95">
                  <a.Icon className="w-[18px] h-[18px]" />
                </span>
              </>
            );

            const closeThenRun = () => {
              // "tick" is 6ms, the number this line used to spell out.
              haptic("tick");
              setOpen(false);
              if (a.event) window.dispatchEvent(new CustomEvent(a.event));
            };

            if (a.href) {
              return (
                <Link
                  key={a.key}
                  href={a.href}
                  onClick={closeThenRun}
                  className={cls}
                  style={style}
                  role="menuitem"
                  aria-label={a.label}
                  tabIndex={open ? 0 : -1}
                >
                  {inner}
                </Link>
              );
            }
            return (
              <button
                key={a.key}
                type="button"
                onClick={closeThenRun}
                className={cls}
                style={style}
                role="menuitem"
                aria-label={a.label}
                tabIndex={open ? 0 : -1}
              >
                {inner}
              </button>
            );
          })}
        </div>

        {/* Trigger. The lotus rotates and the ring lights up when open, so the
            state is unmistakable without a label. */}
        <button
          type="button"
          onClick={toggle}
          className={`pointer-events-auto relative w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 ${
            open ? "scale-105" : ""
          }`}
          style={{
            background: "linear-gradient(to top, var(--tone-brand-band, #105e5d), var(--tone-brand, #157f7d))",
            boxShadow: open
              ? "0 0 0 4px rgba(236,177,99,0.45), 0 12px 32px rgba(0,0,0,0.4)"
              : "0 10px 24px rgba(0,0,0,0.35)",
          }}
          aria-label={open ? "Close shortcuts" : "Open shortcuts"}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          {/* No rotation between states: an X rotated is just a plus sign, which
              is what happened the first time. The glow ring, the lift, and the
              scrim already carry the open state. */}
          <span className="flex items-center justify-center">
            {open ? (
              <X className="w-7 h-7 text-cream" />
            ) : (
              <FabTriggerIcon className="w-7 h-7 text-cream drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
            )}
          </span>
        </button>
      </div>
    </>
  );
}

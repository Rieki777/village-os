/**
 * MobileFab: floating action button, bottom right, at EVERY width.
 *
 * The name is historical. It was phones only (`md:hidden`) until the Journal
 * shortcut gave desktop members a reason to want it too, so it now serves
 * every width: on a phone it sits above the tab bar as before, and from `md`
 * up, where there is no tab bar, it sits in the bottom-right corner itself.
 * Shortcut rows can carry a `module`, and a row whose module is off for this
 * viewer is never offered.
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
 *     Since the button shows at every width, the z-50 dialogs (shadcn's
 *     overlays, the hand-rolled aria-modal ones) would sit UNDER it on a desk,
 *     clickable through the backdrop. index.css hides the button while any
 *     modal is up, and a panel that owns this corner while open opts in with
 *     `data-hides-fab` (the launch guide on /journey-to-launch).
 *  4. Plain tap rows rather than a gesture-driven radial. The gesture version
 *     did not survive iOS Safari.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/modules/ModuleProvider";
import { FAB_ACTIONS, FabTriggerIcon, type FabAction } from "@/config/mobileNav";
import { isBrochurePath, useBrochurePages } from "@/lib/brochure";
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

function resolve(
  actions: FabAction[],
  currentPath: string,
  isAuthenticated: boolean,
  moduleOn: (id?: string) => boolean = () => true,
): ResolvedAction[] {
  const out: ResolvedAction[] = [];
  for (const a of actions) {
    if (a.requiresAuth === true && !isAuthenticated) continue;
    if (a.requiresAuth === false && isAuthenticated) continue;
    if (!moduleOn(a.module)) continue;

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
  // The header menu's test (Layout.tsx `moduleOn`): a module is on for this
  // viewer when the viewer's manifest carries it, and, as `moduleIsOn` reads
  // it, its lifecycle is not off. Read defensively, since a catalog still in
  // flight has no list yet and the row should wait for it.
  const { modules } = useModules();
  const moduleOn = (id?: string) =>
    !id || (Array.isArray(modules) && modules.some((m) => m.id === id && m.lifecycle !== "off"));
  const currentPath = normalisePath(location);
  // A shortcut into a brochure page goes with the pages (shared/brochure.ts).
  const brochureOn = useBrochurePages() === true;
  // BOTH sides of this line, which is what #404 asked for: keep #406's brochure
  // filter on the list, and take #404's `moduleOn` as the fourth argument. The
  // two are independent questions about the same shortcut row - whether a page
  // exists on this village at all, and whether the module behind it is on.
  const actions = resolve(
    FAB_ACTIONS.filter((a) => brochureOn || !a.href || !isBrochurePath(a.href)),
    currentPath,
    !!user,
    moduleOn,
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Set when the menu was opened from the keyboard, so focus can move into it.
  const focusOnOpen = useRef(false);

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const toggle = useCallback((e?: React.MouseEvent) => {
    // "press" is 10ms, the number this line used to spell out. The util in
    // client/src/lib/haptics.ts holds the vocabulary now.
    haptic("press");
    // A click with detail 0 came from Enter or Space, not a pointer.
    focusOnOpen.current = !!e && e.detail === 0;
    setOpen((s) => !s);
  }, []);

  // Tap anywhere else to close.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  // Escape to close. Focus goes back to the trigger when it was inside the
  // menu, because the rows leave the tab order as the menu shuts. The open
  // menu is the top layer, so the key it spent closing itself goes no
  // further: BreakGlass listens on `window` and read the same press as
  // "decline the override".
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      const inside = !!menuRef.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Opened from the keyboard: land on the row nearest the trigger, which is
  // the last one, the way a menu button hands focus to its menu.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const items = menuItems();
    items[items.length - 1]?.focus();
  }, [open]);

  // Arrow keys walk the rows; Home and End jump to either end. Only while the
  // menu is open: a shut menu's rows are invisible, and these keys belong to
  // the page again (they scroll it).
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    const items = menuItems();
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % items.length;
    else if (e.key === "ArrowUp") next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next]?.focus();
  };

  /*
   * IT STEPS ASIDE WHILE A MEMBER READS DOWN THE PAGE. The trigger is a 56px
   * circle over whatever a page puts in its bottom-right corner: the living
   * map's key, a paragraph on /roles (QA pass and sweep, 2026-09-21). Reading
   * down is when that corner holds the thing being read, so it tucks away; a
   * scroll back up, the top of the page, a new page, or a keyboard reaching
   * it brings it back. Never while its menu is open.
   */
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 64) {
        setTucked(false);
        last = y;
        return;
      }
      // Hysteresis, so a thumb resting on the glass does not flicker it.
      if (Math.abs(y - last) < 12) return;
      setTucked(y > last);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setTucked(false), [location]);
  const hidden = tucked && !open;

  // The screens that render no tab bar render no FAB either: the trigger is a
  // 56px circle in the bottom-right, and on /login it sat over the right end
  // of the full-width sign-in button. Same list, same reason (mobileNav.ts).
  if (isBareRoute(location)) return null;

  return (
    <>
      {/* Focus scrim, between the tab bar (z-50) and the FAB (z-[60]). */}
      <div
        aria-hidden="true"
        className={`fixed inset-0 z-[55] bg-black/45 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ backdropFilter: open ? "blur(2px)" : undefined }}
      />

      <div
        // Rides up clear of the living map's circle peek while one shows (index.css).
        data-mobile-fab
        className="fixed right-4 bottom-[var(--fab-bottom)] md:right-6 md:bottom-6 z-[60] flex flex-col items-end pointer-events-none"
        // Tab bar is h-16 (4rem) of content plus the safe-area pad. Offsetting
        // by that same pad + 3.5rem leaves the trigger's lower edge exactly
        // 0.5rem over the bar's top edge on EVERY phone: the safe area
        // cancels, so a notched phone and a plain one overlap identically
        // instead of drifting apart. Anchored in the corner it belongs in, not
        // hovering a thumb's width above it. Carried as a variable so `md:`
        // can take over from it: from `md` up there is no bar to clear, and
        // the button sits 1.5rem in from the corner itself.
        style={{ "--fab-bottom": "max(calc(env(safe-area-inset-bottom, 0px) + 3.5rem), 3.5rem)" } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={menuRef}
          role="menu"
          aria-label="Shortcuts"
          aria-hidden={!open}
          onKeyDown={onMenuKey}
          className={`flex flex-col items-end gap-2.5 mb-3 transition-all duration-200 ${
            open ? "pointer-events-auto" : "pointer-events-none"
          }`}
        >
          {actions.map((a, i) => {
            // Nearest the trigger reveals first, so the stack springs upward.
            const delay = open ? `${(actions.length - 1 - i) * 38}ms` : `${i * 18}ms`;
            const cls =
              "group/row flex items-center gap-2.5 outline-none transition-[transform,opacity] duration-300 focus-visible:opacity-100 " +
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
              // A row for the page already showing (Profile on /profile) keeps
              // this component mounted, and focus would stay on a row that is
              // now invisible and aria-hidden. Hand it back to the trigger
              // first, the way Escape does.
              if (menuRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
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
          ref={triggerRef}
          type="button"
          onClick={toggle}
          onFocus={() => setTucked(false)}
          data-fab-trigger
          // Named properties, never `all`: `all` also animates the visibility
          // this button inherits from the hide rule in index.css, which held
          // it on screen through a dialog's opening and late after it closed.
          className={`relative w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-[transform,opacity,box-shadow] duration-300 motion-reduce:transition-none hover:scale-105 active:scale-95 ${
            hidden ? "pointer-events-none scale-0 opacity-0" : "pointer-events-auto"
          } ${open ? "scale-105" : ""}`}
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

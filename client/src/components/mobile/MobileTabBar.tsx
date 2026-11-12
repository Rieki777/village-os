/**
 * MobileTabBar: five-slot bottom nav, mobile only.
 *
 * Slots come from config/mobileNav.ts. The last one dispatches
 * "open-mobile-menu", which Layout listens for and opens the existing header
 * drawer, so there is one nav menu in the app rather than two that drift apart.
 *
 * Ported from regen-civics. Two details from that implementation are carried
 * over deliberately because both were bug fixes, not decoration:
 *
 *  - It portals to <body>. A `position: fixed` element is positioned against
 *    the nearest ancestor that has a transform, filter, backdrop-filter or
 *    contain, not against the viewport. Any of those on a parent silently turns
 *    this bar into an absolutely-positioned strip floating mid-page.
 *  - It pads for env(safe-area-inset-bottom) so the bar clears the iOS home
 *    indicator.
 */
import { createPortal } from "react-dom";
import { Link, useLocation } from "wouter";
import { BARE_ROUTES, TAB_SLOTS } from "@/config/mobileNav";
import { useTokenName } from "@/hooks/useTokenNames";
import { useLingui } from "@lingui/react/macro";

/** The current route with query and trailing slash removed. */
export function normalisePath(location: string): string {
  return location.split("?")[0].replace(/\/$/, "") || "/";
}

/** True where the bottom bar and the FAB are suppressed (config/mobileNav.ts). */
export function isBareRoute(location: string): boolean {
  return BARE_ROUTES.includes(normalisePath(location));
}

export default function MobileTabBar() {
  const [location] = useLocation();
  const currentPath = normalisePath(location);
  // The token slot reads the village's word for its token; `path` never moves.
  const tokenName = useTokenName("Recognition");
  const { t } = useLingui();
  // The bar speaks the reader's language (go-live pass, M10). Keyed by the
  // slot's fixed path or event, so config/mobileNav.ts keeps its English as
  // the fallback for a slot this list does not know.
  const said: Record<string, string> = {
    "/": t({ message: "Home", context: "bottom tab bar" }),
    "/quests": t({ message: "Quests", context: "bottom tab bar" }),
    "/circles": t({ message: "Circles", context: "bottom tab bar" }),
    "open-mobile-menu": t({ message: "More", context: "bottom tab bar" }),
  };

  // Sign-in and the other focused, signed-out screens render no bar at all.
  // See BARE_ROUTES for why bottom padding could not close this.
  if (isBareRoute(location)) return null;

  const bar = (
    <nav
      data-mobile-tabbar=""
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gradient-to-t from-teal-band to-teal-deep backdrop-blur-xl border-t border-white/15 shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.45)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label={t({ message: "Bottom navigation", context: "bottom tab bar" })}
    >
      {/* Seafoam accent hairline along the top edge */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5 opacity-70"
        style={{ background: "linear-gradient(to right, transparent, var(--tone-brand-soft, #7fb8ac), transparent)" }}
      />
      <div className="grid grid-cols-[repeat(5,minmax(0,1fr))] h-16 items-stretch max-w-2xl mx-auto min-w-0">
        {TAB_SLOTS.map((s) => {
          const slot = s.token ? { ...s, label: tokenName } : { ...s, label: said[s.path ?? s.event ?? ""] ?? s.label };
          const active =
            !!slot.path &&
            (slot.path === "/"
              ? currentPath === "/"
              : currentPath === slot.path || currentPath.startsWith(slot.path + "/"));

          const inner = (
            <>
              <span
                className={`pointer-events-none absolute top-0 h-0.5 w-8 rounded-full bg-amber transition-opacity duration-300 ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              />
              <div
                className={`relative flex items-center justify-center rounded-2xl transition-all duration-300 ${
                  active ? "px-2.5 py-1 -translate-y-0.5 bg-white/15" : "px-1.5 py-1"
                }`}
              >
                <slot.Icon className="w-[22px] h-[22px]" />
              </div>
              {/* min-w-0 + truncate, because at a 320px viewport the five labels needed
                  325px of min-content and the bar itself became wider than the
                  screen. It is fixed, so it set the document width and every page
                  with it: /profile's entire 5px of overflow was this bar. */}
              {/* 12px, the one size under the 14px floor (M12): five labels share
                  a 320px bar, and at 14px "Gratitude" and its Spanish ran out. */}
              <span className={`text-xs leading-none min-w-0 truncate ${active ? "font-semibold" : "font-medium"}`}>
                {slot.label}
              </span>
            </>
          );

          // Both states are full-opacity text-white, on purpose: white is the
          // ONLY opacity level shared/brandTokens.ts actually guarantees here.
          // "brand" (teal-deep) is derived so white clears AA_BODY (4.5)
          // against it EXACTLY at the floor for the hardest seed (checked:
          // worst case 4.50:1 across all 54 CHARACTER_CARDS x seed
          // combinations), which means ANY dimming below full opacity can
          // drop under 4.5 for some village's colour - even white/90
          // measured as low as 3.80:1 on one. The old white/70 measured
          // 2.66:1 worst case (30 of 54 combinations failed outright), and
          // separately, on the platform's own former literal brand colour
          // (#157f7d, docs/AUDIT_2026-07-30_OPEN_QUESTIONS.md 1.1), white/70
          // measured 3.20:1 - a real, shipped failure, not a hypothetical
          // one. Active vs inactive is carried by the highlight pill
          // (bg-white/15), the translate-y lift and font-weight below
          // instead of by colour.
          const cls = "group relative flex flex-col items-center justify-center gap-1 transition-transform active:scale-95 text-white";

          if (slot.path) {
            return (
              <Link
                key={slot.label}
                href={slot.path}
                aria-label={slot.label}
                aria-current={active ? "page" : undefined}
                className={cls}
              >
                {inner}
              </Link>
            );
          }

          return (
            <button
              key={slot.label}
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(slot.event!))}
              aria-label={slot.label}
              className={cls}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </nav>
  );

  if (typeof document === "undefined") return bar;
  return createPortal(bar, document.body);
}

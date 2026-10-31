/**
 * THE PHONE'S FIVE TABS: Today, Quests, Roles, Treasury, Sheet (approved
 * design, 2026-10-30).
 *
 * On a phone the sheet is five short pages instead of one long one. Every
 * section stays in the document, in the desktop order, and a section that
 * belongs to another tab is hidden below the `sm` breakpoint only
 * (`phoneTab`), so a desktop reader sees the whole sheet and nothing moves.
 *
 * THE STRIP SITS AT THE TOP, NOT THE BOTTOM. The design drew it along the
 * bottom edge, and on this app the bottom edge already belongs to the site's
 * own tab bar and its floating button (Layout: MobileTabBar, MobileFab), which
 * every page carries. A second bar there would cover the first. It is sticky
 * under the site header instead, which keeps the same five doors one tap away
 * from anywhere on the page.
 */
import { useEffect, useId } from "react";

export const PROFILE_TABS = ["today", "quests", "roles", "treasury", "sheet"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

const LABEL: Record<ProfileTab, string> = {
  today: "Today",
  quests: "Quests",
  roles: "Roles",
  treasury: "Treasury",
  sheet: "Sheet",
};

/** The class a section takes so it shows on its own phone tab and always on a desktop. */
export const phoneTab = (active: ProfileTab, mine: ProfileTab | readonly ProfileTab[]): string =>
  (Array.isArray(mine) ? mine.includes(active) : mine === active) ? "" : "max-sm:hidden";

/** Which tab an anchor in the address lives on, so /profile#cash-owed opens Treasury on a phone. */
export const TAB_OF_ANCHOR: Record<string, ProfileTab> = {
  "my-tasks": "quests",
  companions: "quests",
  treasury: "treasury",
  "cash-owed": "treasury",
  wallet: "treasury",
  ledger: "treasury",
  redeem: "treasury",
  "send-tokens": "treasury",
  "your-agent": "sheet",
  "my-needs": "sheet",
  "sheet-paths": "sheet",
  about: "sheet",
  invite: "sheet",
  roles: "roles",
};

export default function ProfileTabs({ tab, onTab }: { tab: ProfileTab; onTab: (t: ProfileTab) => void }) {
  const id = useId();
  // A hash that names a section on another tab opens that tab first.
  useEffect(() => {
    const go = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const t = TAB_OF_ANCHOR[hash];
      if (t) onTab(t);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [onTab]);

  return (
    <nav
      aria-label="Profile sections"
      className="sticky top-24 z-30 -mx-4 mb-4 grid grid-cols-5 border-b border-dash-edge bg-card/95 backdrop-blur sm:hidden"
    >
      {PROFILE_TABS.map((t) => (
        <button
          key={t}
          id={`${id}-${t}`}
          type="button"
          aria-pressed={tab === t}
          onClick={() => {
            onTab(t);
            window.scrollTo({ top: 0 });
          }}
          className={`flex min-h-14 flex-col items-center justify-center gap-1 text-xs ${tab === t ? "font-semibold text-dash-gold-lit" : "font-medium text-muted-foreground"}`}
        >
          <span aria-hidden="true" className={`h-1 w-7 rounded-sm ${tab === t ? "bg-dash-gold" : "bg-transparent"}`} />
          <span>{LABEL[t]}</span>
        </button>
      ))}
    </nav>
  );
}

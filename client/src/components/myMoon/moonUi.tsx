/**
 * My moon's shared pieces: the class strings (tokens only, from the profile
 * dashboard's set, so the light sheet and the night sheet both hold), the
 * Room view switch's context, and the one component that prints an amount.
 *
 * ROOM VIEW IS ONE SWITCH READ IN ONE PLACE PER KIND. Every amount on My moon
 * goes through `<Amount>`, and the score and the moon load are wrapped in
 * `<MemberOnly>`, so turning Room view on cannot miss one: a new amount that
 * skipped `<Amount>` would print `formatMoney` by hand, which is the thing a
 * reviewer looks for.
 */
import { createContext, useContext, type ReactNode } from "react";
import { formatMoney } from "@shared/money";
import { MY_MOON_WORDS } from "@shared/moonRecap";

export { BTN_GOLD, BTN_LINE, CHIP, H2, KICKER, LINK, PANEL, RAISED } from "@/components/profileDash/dashUi";

export const H3 = "m-0 text-lg font-semibold text-foreground";
export const LABEL = "block text-xs font-medium text-muted-foreground";
export const INPUT =
  "mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const SMALL_BTN =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-transparent px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const SMALL_BTN_ON = "inline-flex min-h-9 items-center justify-center rounded-lg border border-transparent bg-teal-deep px-3 text-sm font-medium text-white hover:bg-teal-deep-dark";
export const MUTED = "text-sm text-muted-foreground";
export const ERROR = "text-sm text-destructive";

/** Room view: true hides every amount, the score and the moon load. */
export const RoomViewContext = createContext(false);
export const useRoomView = () => useContext(RoomViewContext);

/** An amount, or the hidden line while Room view is on. */
export function Amount({ minor, currency }: { minor: number | null; currency: string | null }) {
  const room = useRoomView();
  if (room) return <span data-hidden-amount="">{MY_MOON_WORDS.hiddenInRoom}</span>;
  if (minor === null || !currency) return <span>{MY_MOON_WORDS.none}</span>;
  return <span data-amount="">{formatMoney(minor, currency)}</span>;
}

/** Whatever only the member reads: the score and the moon load. Nothing renders in Room view. */
export function MemberOnly({ children }: { children: ReactNode }) {
  return useRoomView() ? null : <>{children}</>;
}

/** A section of My moon: a heading and its body, phone-first in one column. */
export function Section({ title, kicker, children, id }: { title: string; kicker?: string; children: ReactNode; id?: string }) {
  return (
    <section aria-label={title} id={id} className="flex scroll-mt-28 flex-col gap-3 rounded-[18px] border border-dash-edge bg-dash-raised p-4 sm:p-5">
      {kicker ? <p className="m-0 text-xs uppercase tracking-[0.17em] text-dash-gold-lit">{kicker}</p> : null}
      <h3 className={H3}>{title}</h3>
      {children}
    </section>
  );
}


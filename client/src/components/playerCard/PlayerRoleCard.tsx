/**
 * THE PLAYER ROLE CARD, live: one card per person, on their own profile and on
 * their public profile.
 *
 * Reference design: https://claude.ai/artifact/49Fh3tdkSoNYTmNDFv24D1
 * (version 15). The order is the design's: the header; one tile per role,
 * each linking down to its section; across all my roles; each role in full;
 * the moon timeline; how I hold my roles; my applications; and agreements in
 * a small closed <details> at the bottom.
 *
 * DRAWN ONLY FROM THE MODEL. The server sends a `PlayerCard`
 * (shared/playerCard.ts) at the reader's tier, and every section here draws
 * what arrived and decides nothing: an unread slot draws nothing, an empty one
 * draws its words. The one thing this file holds is the owner's "Edit my card"
 * switch.
 *
 * WHY NOT `SeatTradingCard` FOR EACH ROLE. That card takes a `SeatInput` and
 * runs its own model (`seatSheet`), which names the role's holders and
 * decides its own words. The player card names nobody but its owner and has
 * already decided every word, so each role is drawn here from `RoleOut`, in
 * the same tokens the profile uses.
 *
 * Phone first: one column with 16px gutters at 375px, every control at least
 * 44px, and no row wider than the screen.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { EDIT_WORDS } from "@shared/playerCardEdit";
import type { PlayerCardPayload } from "@shared/playerCardPayload";
import { CardEditContext, QUIET_BUTTON, SECTION } from "./cardParts";
import { CardHeader, RoleTiles } from "./CardHeader";
import { AcrossSection } from "./AcrossSection";
import { RoleInFull } from "./RoleInFull";
import { Agreements, HowIHold, MoonTimeline, MyApplications } from "./CardLower";
import { fetchApplicationCard, fetchCard } from "./playerCardApi";

export const CARD_LOAD_WORDS = {
  failed: "This card did not load.",
  retry: "Retry",
} as const;

/**
 * "live" is a person's card as it stands. "proposal" is the card a role
 * application asks for (PR 3): drawn the same way, never edited, and its live
 * sections already read "Starts once adopted" in the model.
 */
export type CardViewMode = "live" | "proposal";

/** The card itself, from a payload already read. Exported so tests draw it without a fetch. */
export function PlayerRoleCardView({
  data,
  reload = () => undefined,
  className = "",
  mode = "live",
}: {
  data: PlayerCardPayload;
  reload?: () => void;
  className?: string;
  mode?: CardViewMode;
}) {
  const [editing, setEditing] = useState(false);
  const { card, sheets, links, viewer, timeZone } = data;
  const mayEdit = viewer.isSelf && mode === "live";
  return (
    <CardEditContext.Provider value={{ editing: mayEdit && editing, reload, reviewHref: links.review ?? null }}>
      <div data-player-card data-card-mode={mode} className={`grid gap-4 sm:gap-6 ${className}`}>
        <div className={`${SECTION} grid gap-5`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardHeader header={card.header} walletHref={mode === "live" ? links.wallet : undefined} />
            {mayEdit ? (
              <button type="button" onClick={() => setEditing((e) => !e)} aria-pressed={editing} className={QUIET_BUTTON}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {editing ? EDIT_WORDS.doneEditing : EDIT_WORDS.editMyCard}
              </button>
            ) : null}
          </div>
          {card.tiles.items.kind === "shown" ? <RoleTiles tiles={card.tiles} /> : null}
        </div>

        <AcrossSection across={card.across} sheets={sheets} timeZone={timeZone} />

        {card.roles.length ? (
          <section aria-label={card.tiles.heading} className="grid gap-4">
            {card.roles.map((r) => (
              <RoleInFull key={r.id} role={r} sheets={sheets} timeZone={timeZone} />
            ))}
          </section>
        ) : null}

        <MoonTimeline timeline={card.timeline} />
        <HowIHold howIHold={card.howIHold} />
        <MyApplications applications={card.applications} />
        <Agreements agreements={card.agreements} newApplicationHref={links.newApplication} />
      </div>
    </CardEditContext.Provider>
  );
}

/**
 * Fetches a card and draws it: a person's by handle (`me` for your own), or,
 * with `applicationId`, the card that application asks for in proposal mode.
 * `fallback` draws instead of the failure line when the card cannot load, and
 * `footer` draws under the card once it has.
 */
export default function PlayerRoleCard({
  handle = "me",
  applicationId,
  mode = applicationId ? "proposal" : "live",
  className = "",
  fallback,
  footer,
}: {
  handle?: string;
  applicationId?: string;
  mode?: CardViewMode;
  className?: string;
  fallback?: ReactNode;
  footer?: ReactNode;
}) {
  const [data, setData] = useState<PlayerCardPayload | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setFailed(false);
    void (applicationId ? fetchApplicationCard(applicationId) : fetchCard(handle)).then((r) => {
      if (!alive) return;
      if (r.ok) setData(r.data);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [handle, applicationId]);
  useEffect(() => load(), [load]);

  // Arriving by a link to one role (`/profile/:handle#role-<id>`, from /roles):
  // the section exists only once the card has loaded, so scroll to it then.
  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id.startsWith("role-")) return;
    document.getElementById(id)?.scrollIntoView?.({ block: "start" });
  }, [data]);

  if (failed && fallback !== undefined) return <>{fallback}</>;
  if (failed) {
    return (
      <p role="status" className="text-foreground">
        {CARD_LOAD_WORDS.failed}{" "}
        <button type="button" onClick={load} className="min-h-11 font-medium text-notice underline underline-offset-2">
          {CARD_LOAD_WORDS.retry}
        </button>
      </p>
    );
  }
  if (!data) return null;
  return (
    <>
      <PlayerRoleCardView data={data} reload={load} className={className} mode={mode} />
      {footer}
    </>
  );
}

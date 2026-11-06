/**
 * THE PLAYER ROLE CARD, live: one card per person, on their own profile, on
 * their public profile, on a role application, on a shared role proposal and
 * in a proposal's Preview step.
 *
 * THE APPROVED DESIGN, SHIPPED AS IT WAS APPROVED: the CCOS version,
 * https://claude.ai/artifact/XGP6VP5WFU1T6ti7RD482P (Rye 2026-10-22), which
 * extends https://claude.ai/artifact/49Fh3tdkSoNYTmNDFv24D1. One night world:
 * the owner's character portrait in a gold ring with the moon pill under it;
 * one icon tile per role, each linking down to its section; across all my
 * roles; each role in full; the moon cycle; what I accomplished, by moon; how
 * I hold my roles; my applications; and agreements in a small closed
 * <details> at the bottom. The look is playerCard.css, the design's own rules
 * with a `pc-` prefix, and the card is a theme-frozen surface: it is drawn in
 * the design's night palette whatever the page's theme (that file says why
 * that is not a dark mode).
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
 * already decided every word, so each role is drawn here from `RoleOut`.
 *
 * Phone first, by the design's own media queries: one column at 375px, the
 * hero centred, the tiles two to a row, every control at least 44px, and no
 * row wider than the screen.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { CARD_WORDS as W } from "@shared/playerCard";
import { EDIT_WORDS } from "@shared/playerCardEdit";
import type { PlayerCardPayload } from "@shared/playerCardPayload";
import {
  CardEditContext,
  ChangedContext,
  Eyebrow,
  NightContext,
  type ChangedWords,
} from "./cardParts";
import { CardHero, RoleTiles } from "./CardHeader";
import { AcrossSection } from "./AcrossSection";
import { RoleInFull } from "./RoleInFull";
import {
  Agreements,
  HowIHold,
  MoonTimeline,
  MyApplications,
} from "./CardLower";
import { AccomplishedSection } from "./AccomplishedSection";
import { fetchApplicationCard, fetchCard } from "./playerCardApi";
import "./playerCard.css";

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
  changed,
}: {
  data: PlayerCardPayload;
  reload?: () => void;
  className?: string;
  mode?: CardViewMode;
  /** A role proposal's changed words by role id, drawn in gold (role proposals PR C). */
  changed?: Readonly<Record<string, ChangedWords>>;
}) {
  const [editing, setEditing] = useState(false);
  const { card, sheets, links, viewer, timeZone } = data;
  const mayEdit = viewer.isSelf && mode === "live";
  const walletHref = mode === "live" ? links.wallet : undefined;
  const health = new Map(
    card.tiles.items.kind === "shown"
      ? card.tiles.items.value.map(t => [t.roleId, t.health])
      : []
  );
  const actions =
    mayEdit || walletHref ? (
      <>
        {mayEdit ? (
          <button
            type="button"
            onClick={() => setEditing(e => !e)}
            aria-pressed={editing}
            className="pc-tab"
          >
            <Pencil aria-hidden="true" />
            {editing ? EDIT_WORDS.doneEditing : EDIT_WORDS.editMyCard}
          </button>
        ) : null}
        {walletHref ? (
          <a href={walletHref} className="pc-tab">
            {W.wallet}
          </a>
        ) : null}
      </>
    ) : null;
  return (
    <CardEditContext.Provider
      value={{ editing: mayEdit && editing, owner: mayEdit, reload }}
    >
      <NightContext.Provider value={true}>
        <div
          data-player-card
          data-card-mode={mode}
          className={`pc-night pc-card ${className}`}
        >
          <div className="pc-wrap">
            <CardHero header={card.header} actions={actions} />
            <RoleTiles tiles={card.tiles} />

            <AcrossSection
              across={card.across}
              sheets={sheets}
              timeZone={timeZone}
            />

            {card.roles.length ? (
              <section aria-labelledby="pc-roles-h" className="pc-roles">
                <div className="pc-headgroup">
                  <Eyebrow gold>{W.myNRoles(card.roles.length)}</Eyebrow>
                  <h3 id="pc-roles-h" className="pc-h2">
                    {W.eachInFull(card.roles.length)}
                  </h3>
                  {/* 0274: once, above the roles, what an underlined heading does. */}
                  {card.termsKey ? (
                    <p className="pc-dim pc-f13">{card.termsKey}</p>
                  ) : null}
                </div>
                {card.roles.map(r => (
                  <ChangedContext.Provider
                    key={r.id}
                    value={changed?.[r.id] ?? null}
                  >
                    <RoleInFull role={r} health={health.get(r.id) ?? null} />
                  </ChangedContext.Provider>
                ))}
              </section>
            ) : null}

            <MoonTimeline timeline={card.timeline} />
            <AccomplishedSection accomplished={card.accomplished} />
            <HowIHold howIHold={card.howIHold} />
            <MyApplications applications={card.applications} />
            <Agreements
              agreements={card.agreements}
              newApplicationHref={links.newApplication}
            />
          </div>
        </div>
      </NightContext.Provider>
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
    void (
      applicationId ? fetchApplicationCard(applicationId) : fetchCard(handle)
    ).then(r => {
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
        <button
          type="button"
          onClick={load}
          className="min-h-11 font-medium text-notice underline underline-offset-2"
        >
          {CARD_LOAD_WORDS.retry}
        </button>
      </p>
    );
  }
  if (!data) return null;
  return (
    <>
      <PlayerRoleCardView
        data={data}
        reload={load}
        className={className}
        mode={mode}
      />
      {footer}
    </>
  );
}

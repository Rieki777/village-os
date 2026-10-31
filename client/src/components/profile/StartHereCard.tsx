/**
 * START HERE, AT THE TOP OF YOUR OWN PROFILE.
 *
 * Rye asked for "a big and obvious card in the profile section" that walks a
 * person from joining to putting a quest or a role in front of the village.
 * This card shows ONE next step for where this person stands, in large type,
 * and the other doors open to them underneath it, smaller. Every door says in
 * one line what happens after it is pressed.
 *
 * ── WHO SEES IT ─────────────────────────────────────────────────────────────
 *
 * Only the owner of the profile, signed in. `ownerId` is whose profile is on
 * screen and `useAuth` is who is looking, and the card draws nothing unless
 * the two are the same account. `/profile` is always the viewer's own page
 * today, so the check is a guarantee about this component wherever it is
 * mounted next, and the tests hold it.
 *
 * ── EVERY STATE COMES OFF A PAYLOAD ─────────────────────────────────────────
 *
 *   member or guest   `/api/game/me`, the page's own read: `membership` is the
 *                     village's explicit grant and `stageIndex` against the
 *                     ladder covers a stage an admin granted by hand. Those are
 *                     the two admission records `server/lib/admission.ts`
 *                     reads, so this card and the server agree on who is in.
 *   already asked     `/api/game/progression`'s `signing`, the member's own
 *                     signed letter and the village's answer to it, which the
 *                     page already reads (`shared/membershipSigning.ts`).
 *   which door        `/api/game/config`: whether this village serves the
 *                     letter at all, and what it calls the thing a member signs.
 *   vouches           `/api/me/vouches`, the server's own sentence about this
 *                     person's standing. Asked only for somebody not yet in.
 *
 * Null means UNKNOWN, the contract the rest of the sheet keeps. The card waits
 * for the facts it needs and draws nothing while one is missing, and a line
 * whose fact could not be read is left out rather than guessed.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Compass } from "lucide-react";

import type { MembershipSigning } from "@shared/membershipSigning";
import { useAuth } from "@/contexts/AuthContext";
import { gameFetch, type GameMe, type ProgressionCapability, type PublicGameConfig } from "@/lib/gameApi";
import { pageVarsFrom } from "@shared/pageContent/vars";
import { articleFor } from "@shared/villageWord";
import { useModule } from "@/modules/ModuleProvider";
import { useMyGeneKeys } from "@/components/geneKeys/useMyGeneKeys";

/**
 * The rung whose rule is being admitted. The server names it `ADMISSION_RUNG`
 * in `server/lib/admission.ts`; a ladder without it has no door at all, and
 * there everybody counts as in, which is what `isAdmitted` answers too.
 */
const ADMISSION_RUNG = "member";

/** Whether the village has let this person in, read the way the server reads it. */
export function isAdmittedHere(me: Pick<GameMe, "membership" | "stageIndex" | "stages">): boolean {
  if (me.membership) return true;
  const door = (me.stages ?? []).findIndex((s) => s.id === ADMISSION_RUNG);
  return door < 0 || me.stageIndex >= door;
}

/**
 * Whether the person looking is the person this profile belongs to.
 *
 * A visitor never is, and that is its own line rather than a side effect of
 * the comparison: an owner that is not known yet (a page still loading whose
 * profile this is) reads as "" and so does a viewer nobody signed in as, and
 * two blanks must never count as a match.
 */
export function viewerOwns(viewerId: unknown, ownerId: unknown): boolean {
  const viewer = String(viewerId ?? "");
  if (!viewer) return false;
  return viewer === String(ownerId ?? "");
}

/** One way forward, and what happens once somebody takes it. */
interface Door {
  href: string;
  label: string;
  after: string;
}

/** The member's own standing at the membrane, as `/api/me/vouches` says it. */
interface OwnVouches {
  sentence: string;
  off: boolean;
  met: boolean;
}

/*
 * THE LINES THAT SAY WHAT HAPPENS NEXT. Each one is the pipeline behind its
 * door, in plain words, and each was checked against the code that runs it:
 *
 *   quest   POST /api/forms/submit lands the idea in the review queue, where a
 *           holder of `quest.approve` types what it pays and puts it on the
 *           board, or turns it down (server/lib/questProposals.ts).
 *   letter  Accepting a signed letter sets the member's grant, and moving it
 *           sends them a notice that links back to this page (server/index.ts,
 *           `PUT /api/admin/submissions/:id/status`).
 *   hand    A seat card's raised hand reaches whoever seats roles, and moving
 *           it sends the same notice. On the season-roles stack the same card
 *           opens an application a holder or the village adopts instead, and
 *           the line stays true of both.
 *
 * NO "PROPOSE A NEW ROLE" DOOR, ON PURPOSE. On this base a member has no way
 * to put a new seat to the village: the wizard has no seat-proposal kind, the
 * role declaration route has no screen and writes the permission plane, and
 * only an admin adds a seat to the org chart. A door here would lead nowhere,
 * so it waits for the kind that makes it real.
 */
const QUEST_AFTER = "A steward reads it, and if it goes on the board, they set what it pays.";
const LETTER_AFTER = "The people who look after joining read it and answer. You get a notice when they do.";
const HAND_AFTER = "The people who seat roles read your offer and answer. You get a notice when they do.";
const LINES_AFTER = "Your Gene Keys show how you work best, so the roles and teams we suggest fit you.";

/** A date the member reads, in their own locale, or nothing if the instant is unreadable. */
function dayOf(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

/**
 * What being let in would open for this person, from the progression read.
 *
 * The rows are this village's own: `opens` is already resolved against its
 * unlock variables, and a switched-off module's keys are absent. So the line
 * names powers that really open at the admission rung here, and an empty or
 * unread catalogue gives no line at all.
 */
export function opensAtMembership(catalogue: readonly ProgressionCapability[] | null | undefined): string {
  const rows = (catalogue ?? []).filter(
    (c) => !c.held && c.opens.via === "stage" && c.opens.stage === ADMISSION_RUNG && c.label.trim(),
  );
  if (!rows.length) return "";
  const named = rows.slice(0, 3).map((c) => c.label.trim().replace(/^./, (ch) => ch.toLowerCase()));
  const list = rows.length > 3 ? `${named.join(", ")}, and more` : named.join(", ");
  const count = rows.length === 1 ? "one power" : `${rows.length} powers`;
  return `Membership opens ${count} for you here: ${list}.`;
}

/** `/api/me/vouches`, asked once and only when `ask` is true. Null while unknown or unreadable. */
function useOwnVouches(ask: boolean): OwnVouches | null {
  const [vouches, setVouches] = useState<OwnVouches | null>(null);
  useEffect(() => {
    if (!ask) return;
    let live = true;
    gameFetch("/api/me/vouches")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d?.state || typeof d.sentence !== "string") return;
        setVouches({ sentence: d.sentence, off: d.state.off === true, met: d.state.met === true });
      })
      .catch(() => {
        /* Unknown draws no line. */
      });
    return () => {
      live = false;
    };
  }, [ask]);
  return vouches;
}

export interface StartHereCardProps {
  /** Whose profile this is. The card is for its owner and nobody else. */
  ownerId: string | null | undefined;
  /** `/api/game/me`, read once by the page. Null while unknown. */
  me: GameMe | null;
  /** `/api/game/progression`'s `signing`. Undefined while that read is unknown. */
  signing: MembershipSigning | null | undefined;
  /** `/api/game/config`. Null while unknown. */
  config: PublicGameConfig | null;
  /** `/api/game/progression`'s power map, for what membership would open. Optional. */
  catalogue?: readonly ProgressionCapability[] | null;
}

export default function StartHereCard({ ownerId, me, signing, config, catalogue }: StartHereCardProps) {
  const { user } = useAuth();
  // The seat card offers a hand only while the map module is on for this
  // reader, read exactly the way Roles.tsx reads it, so this door never leads
  // to a page with no hand to raise.
  const map = useModule("map");
  const handsOpen = !!map && map.lifecycle !== "off";
  const isOwner = viewerOwns(user?.id, ownerId);
  const admitted = me ? isAdmittedHere(me) : null;
  // Every hook above the returns below: the page's hook order is gated.
  const vouches = useOwnVouches(isOwner && admitted === false);
  // Gene Keys, when the village has them on and this member has not found theirs yet.
  const { on: linesOn, mine: myLines } = useMyGeneKeys();

  if (!isOwner || !me || admitted === null) return null;

  const questDoor: Door = { href: "/propose-quest", label: "Propose a quest", after: QUEST_AFTER };

  let step: string;
  let lines: string[] = [];
  let primary: Door | null;
  let others: Door[];

  if (admitted) {
    step = "Bring the village a quest";
    lines = ["Say what you want to do and what you would need, in a few lines."];
    primary = questDoor;
    others = handsOpen ? [{ href: "/roles", label: "Raise your hand for an open role", after: HAND_AFTER }] : [];
  } else {
    // Which door a guest has, and whether they already went through it, are
    // both facts the card waits for. Guessing either one is how a person who
    // has already signed is told to sign.
    if (signing === undefined || config === null) return null;
    const letterOn = config.brochurePages === true;
    const commitment = config.project?.commitmentName?.trim() ?? "";
    const letterDoor: Door = {
      href: "/love-letter",
      label: commitment ? `Sign the ${commitment}` : "Sign to join",
      after: LETTER_AFTER,
    };
    const handle = user?.handle?.trim() ?? "";
    const vouchDoor: Door | null =
      vouches && !vouches.off && !vouches.met && handle
        ? {
            href: `/profile/${encodeURIComponent(handle)}`,
            label: "Open your page",
            after: `${vouches.sentence} Members who know you can vouch for you there.`,
          }
        : null;

    // A signing still waiting is true whether or not the letter page is served
    // today: the village switching its pages off does not answer the request.
    if (signing && signing.answer !== "left") {
      const day = dayOf(signing.at);
      const what = commitment ? `the ${commitment}` : "to join";
      step = signing.answer === "welcomed" ? "The village said yes" : "Your request is with the village";
      lines = [
        day ? `You signed ${what} on ${day}.` : `You signed ${what}.`,
        signing.answer === "welcomed"
          ? "Your membership shows here the next time this page loads."
          : "The people who look after joining read it and answer. You get a notice when they do, and this card changes when you are in.",
      ];
      primary = null;
    } else {
      // The village's own word for a member (Admin, Make This Yours).
      const member = pageVarsFrom(config).member;
      step = `Become ${articleFor(member)} ${member}`;
      if (signing?.answer === "left") {
        lines.push("The village left your last request where it is for now. You are welcome to ask again.");
      }
      const opens = opensAtMembership(catalogue);
      if (opens) lines.push(opens);
      // No letter in this village: vouches are the door, or its stewards are.
      if (!letterOn && vouches?.off) lines.push(vouches.sentence);
      primary = letterOn ? letterDoor : vouchDoor;
    }
    others = [...(vouchDoor && primary !== vouchDoor ? [vouchDoor] : []), questDoor];
  }
  // Last among the other doors: a member may skip Gene Keys, so this door never stands above a step of the game.
  if (linesOn && myLines === null) others = [...others, { href: "/profile/gene-keys", label: "Find your lines", after: LINES_AFTER }];

  return (
    <section
      aria-labelledby="start-here-h"
      className="mb-8 rounded-2xl border-2 border-notice/60 bg-card p-5 shadow-sm sm:p-8"
    >
      <div className="flex items-center gap-2">
        <Compass className="h-5 w-5 shrink-0 text-notice" aria-hidden="true" />
        <h2 id="start-here-h" className="font-display text-sm font-semibold uppercase tracking-widest text-notice">
          Start here
        </h2>
      </div>
      <p className="mt-3 font-display text-2xl font-bold leading-snug text-card-foreground sm:text-3xl">{step}</p>
      {lines.map((line) => (
        <p key={line} className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
          {line}
        </p>
      ))}

      {primary ? (
        <div className="mt-5">
          <Link
            href={primary.href}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-notice px-6 py-3 text-lg font-semibold text-background hover:bg-notice/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:w-auto"
          >
            {primary.label}
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">{primary.after}</p>
        </div>
      ) : null}

      {others.length ? (
        <ul aria-label="Other ways forward" className="mt-6 space-y-3 border-t border-border pt-5">
          {others.map((door) => (
            <li key={door.href} className="max-w-xl">
              <Link
                href={door.href}
                className="group flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-2 font-medium text-foreground hover:border-notice focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{door.label}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-notice" aria-hidden="true" />
              </Link>
              <p className="mt-1 px-1 text-sm text-muted-foreground">{door.after}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

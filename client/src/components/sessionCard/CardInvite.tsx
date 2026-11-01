/**
 * THE INVITATION TO THE CARD (Rye, 2026-11-01: "have the opt in pop-up on
 * members screen when the admin pulls a card so everyone can easily
 * participate in the card reading if they want", and a way to find their lines
 * from it, "so that it can serve as a quick onboarding too").
 *
 * Anyone in the room may pull (Rye, 2026-10-30), so any pull opens it. Once a
 * card is in the room, a member the card does not read sees this, in whatever
 * stage the room is at. It is mounted once, beside the stages, and reads the
 * room's one card poll (./sharedCards), so it adds no request.
 *
 * CONSENT IS NEVER IMPLIED. Being read needs three things: lines shown, Maia
 * allowed to use them, and the member's own yes to cards
 * (`cardReadableGeneKeys`). The pop-up names each of those still off, in plain
 * words, above the one button that turns on exactly those and nothing else.
 * "Not today" (or closing it any way at all) means not again in this session.
 * A new session may ask once more.
 *
 * Saying yes reads them from the NEXT card: the card on the table was read from
 * the room as it was when it was pulled, and is not rewritten.
 *
 * Somebody with no lines yet is sent to find them (/profile/gene-keys) and
 * brought back to this room after (`?next=`). That page reads Gene Keys and,
 * from the same birth, the Human Design type, strategy and authority. It reads
 * no Western natal chart, so the invitation does not promise one.
 */
import { useState } from "react";
import { Link } from "wouter";
import type { SessionView } from "@shared/sessions";
import type { CardsAnswer } from "@shared/sessionCard";
import type { OwnGeneKeysView } from "@shared/geneKeys";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useModuleOn } from "@/modules/ModuleProvider";
import { changeMyGeneKeys, GeneKeysRefusal } from "@/lib/geneKeysApi";
import { setMyGeneKeys, useMyGeneKeys } from "@/components/geneKeys/useMyGeneKeys";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, HINT } from "@/components/sessions/roomUi";
import { useSharedCards } from "./sharedCards";

export const INVITE_WORDS = {
  title: "A card is on the table",
  lede: "The room pulled a card. It reads today's sky and the Gene Keys and Human Design lines of everyone who says yes. Would you like to be read too?",
  turnsOn: "Saying yes turns on:",
  consent: {
    show: "Your lines are shown on your profile, in your circle and on your role applications.",
    maia: "Maia may use your lines, to shape what she suggests and to weave the card.",
    cards: "Session cards read you. Your own line is private to you until you share it with the room.",
  },
  nextCard: "You are read from the next card. This one stays as it was pulled.",
  change: "You can change any of these in your Gene Keys controls.",
  yes: "Yes, read me",
  notToday: "Not today",
  done: "You are in. The next card reads you too.",
  noLines: "The room pulled a card. It reads today's sky and the Gene Keys and Human Design lines of everyone who says yes. Find yours in a few minutes, then come back to this room.",
  findLines: "Find my Gene Keys and Human Design",
  birth: "Your birth details never leave this device.",
} as const;

const seenKey = (sessionId: number) => `session-card-invite:${sessionId}`;

function answeredHere(sessionId: number): boolean {
  try {
    return localStorage.getItem(seenKey(sessionId)) === "1";
  } catch {
    return false;
  }
}

function markAnswered(sessionId: number): void {
  try {
    localStorage.setItem(seenKey(sessionId), "1");
  } catch {
    /* without storage it may ask again after a reload, never twice in one sitting */
  }
}

/** What being read still needs, as the patch that turns exactly those on. */
function stillOff(mine: OwnGeneKeysView): { patch: { visibility?: "show"; maia?: boolean; cards: boolean }; asks: (keyof typeof INVITE_WORDS.consent)[] } {
  const showIt = mine.visibility !== "show";
  const allowMaia = !mine.maia;
  return {
    patch: { ...(showIt ? { visibility: "show" as const } : {}), ...(allowMaia ? { maia: true } : {}), cards: true },
    asks: [...(showIt ? (["show"] as const) : []), ...(allowMaia ? (["maia"] as const) : []), "cards"],
  };
}

/** Whether this viewer should be asked, from the room's cards alone. */
function shouldAsk(answer: CardsAnswer | null): boolean {
  return !!answer && answer.cards.length > 0 && answer.notRead !== null;
}

export default function CardInvite({ view }: { view: SessionView }) {
  const on = useModuleOn("session-card");
  const live = on && view.me.joined && view.status === "open";
  const answer = useSharedCards(view.id, live);
  const { mine } = useMyGeneKeys();
  const [closed, setClosed] = useState(() => answeredHere(view.id));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!live || closed || !shouldAsk(answer)) return null;
  const noLines = answer!.notRead === "no-lines";
  // Lines exist but are still loading: wait rather than ask for the wrong things.
  if (!noLines && !mine) return null;

  const close = () => {
    markAnswered(view.id);
    setClosed(true);
  };

  const yes = async () => {
    if (!mine) return;
    setBusy(true);
    setProblem(null);
    try {
      const saved = await changeMyGeneKeys(stillOff(mine).patch);
      if (saved) setMyGeneKeys(saved);
      markAnswered(view.id);
      setDone(true);
    } catch (e) {
      setProblem(e instanceof GeneKeysRefusal ? e.message : "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const back = `/profile/gene-keys?next=${encodeURIComponent(`/sessions/${view.id}`)}`;
  const asks = mine ? stillOff(mine).asks : [];

  return (
    <Dialog open onOpenChange={(open) => (open ? null : close())}>
      <DialogContent className="sheet-night max-w-md rounded-2xl border-border bg-card p-6 text-card-foreground">
        <DialogTitle className="font-display text-2xl font-normal text-foreground">{INVITE_WORDS.title}</DialogTitle>
        {done ? (
          <>
            <DialogDescription className="text-base text-foreground" role="status">
              {INVITE_WORDS.done}
            </DialogDescription>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={BTN_PRIMARY} onClick={close}>
                Back to the room
              </button>
            </div>
          </>
        ) : noLines ? (
          <>
            <DialogDescription className="text-base text-foreground">{INVITE_WORDS.noLines}</DialogDescription>
            <p className={HINT}>{INVITE_WORDS.birth}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={back} className={BTN_PRIMARY}>
                {INVITE_WORDS.findLines}
              </Link>
              <button type="button" className={BTN_QUIET} onClick={close}>
                {INVITE_WORDS.notToday}
              </button>
            </div>
          </>
        ) : (
          <>
            <DialogDescription className="text-base text-foreground">{INVITE_WORDS.lede}</DialogDescription>
            <p className="text-sm font-semibold text-foreground">{INVITE_WORDS.turnsOn}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {asks.map((k) => (
                <li key={k}>{INVITE_WORDS.consent[k]}</li>
              ))}
            </ul>
            <p className={HINT}>
              {INVITE_WORDS.nextCard} {INVITE_WORDS.change}
            </p>
            {problem ? (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={yes}>
                {INVITE_WORDS.yes}
              </button>
              <button type="button" className={BTN_QUIET} disabled={busy} onClick={close}>
                {INVITE_WORDS.notToday}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

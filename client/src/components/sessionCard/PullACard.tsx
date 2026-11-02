/**
 * PULL A CARD, in the live room's drop in (Rye, 2026-10-30). Optional: the
 * card waits face down until somebody pulls it, and anyone in the room may,
 * as often as they like. Every screen in the room sees the new card within a
 * few seconds.
 *
 * WHAT A CARD SHOWS. The day's sky in two labelled panels, Human Design and
 * Gene Keys on one side and Western astrology on the other; the collective
 * reading, each paragraph marked with its system; the viewer's own line,
 * private to them until they share it; the lines others shared; who was
 * welcomed by name; and a few ways to hold the session today. For a tension
 * on the agenda, the facilitator can park an item for next time from here,
 * with the room's own item door, and nothing else changes on its own.
 *
 * A LENS, NEVER A FORECAST. The card says so under the button, and its words
 * invite rather than predict (shared/sessionCard.ts).
 *
 * Draws nothing while the module is off, for somebody not in the room, and
 * once the session has closed (its cards are deleted then).
 *
 * Every colour is a theme token, so on the room's night it reads in the
 * village's own gold and ink. With reduced motion asked for, the card appears
 * without turning over.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { SYSTEM_LABELS, SIGNS, andList, moonPhaseName, type CardView, type CardsAnswer, type CardSystem } from "@shared/sessionCard";
import type { SessionView } from "@shared/sessions";
import { useModuleOn } from "@/modules/ModuleProvider";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import MoonGlyph from "@/components/calendar/MoonGlyph";
import { CardRefusal, pullCard, readCards, shareMyLine } from "@/lib/sessionCardApi";
import { BTN_QUIET, BTN_SECONDARY, EYEBROW, H3, HINT, SOFT } from "@/components/sessions/roomUi";
import type { RoomActions } from "@/components/sessions/useSessionRoom";
import { useGuideName } from "@/hooks/useGuideName";
import { fillGuideName } from "@shared/guideName";

/** How often an open card reads the room's cards, so a card pulled on another phone arrives. */
export const CARD_POLL_MS = 5000;

export const CARD_WORDS = {
  title: "Pull a card",
  lede: "Optional. Today's sky and the people here, read together. A lens for being present: take what is useful.",
  pull: "Pull a card",
  again: "Pull another",
  pulling: "Reading the sky",
  forYou: "For you",
  shareMine: "Share mine with the room",
  keepMine: "Keep mine private",
  sharedMine: "Shared with the room.",
  privateMine: "Only you see this.",
  fromOthers: "Shared by",
  waysToHold: "Ways to hold today",
  park: "Park for next time",
  parked: "Parked for next time.",
  earlier: "Earlier card",
  newer: "Newer card",
  // {name} is the village's own guide (shared/guideName.ts), filled where the card is drawn.
  maia: "Woven by {name} from today's sky and the lines of the people here.",
  plain: "Read from today's sky and the lines of the people here.",
  notRead: {
    "no-lines": "Find your Gene Keys lines and the next card will read you too.",
    hidden: "Your lines are hidden, so the card welcomes you by name and reads nothing of yours.",
    "no-maia": "Let {name} use your lines and the next card will read you too.",
    "left-out": "You asked to be left out of cards, so the card welcomes you by name.",
    "not-asked": "Say yes to session cards in your Gene Keys controls and the next card will read you too.",
  },
} as const;

const SYSTEM_TAG = "font-body text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground";

function SystemTag({ system }: { system: CardSystem }) {
  return <span className={SYSTEM_TAG}>{SYSTEM_LABELS[system]}</span>;
}

/** Six bars read from the bottom up, the Sun's line lit in gold. */
function LineBars({ line }: { line: number }) {
  return (
    <svg viewBox="0 0 28 34" className="h-14 w-12 shrink-0" role="img" aria-label={`Line ${line} of 6`}>
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <rect
          key={n}
          x={2}
          y={2 + (6 - n) * 5.4}
          width={24}
          height={3.2}
          rx={1.2}
          className={n === line ? "fill-notice" : "fill-muted-foreground/35"}
        />
      ))}
    </svg>
  );
}

function timeWords(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", weekday: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function Sky({ card }: { card: CardView }) {
  const s = card.sky;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className={SOFT}>
        <SystemTag system="human-design" />
        <ul className="mt-1.5 space-y-0.5 text-sm text-foreground">
          <li>Sun in gate {s.gates.Sun.gate}, line {s.gates.Sun.line}</li>
          <li>Earth in gate {s.gates.Earth.gate}, line {s.gates.Earth.line}</li>
          <li>Moon in gate {s.gates.Moon.gate}</li>
        </ul>
      </div>
      <div className={SOFT}>
        <SystemTag system="western" />
        <ul className="mt-1.5 space-y-0.5 text-sm text-foreground">
          <li>Sun in {SIGNS[s.signs.Sun]}</li>
          <li>
            {moonPhaseName(s.moonPhase)} in {SIGNS[s.signs.Moon]}
          </li>
          {s.retro.length ? <li>Retrograde: {andList(s.retro)}</li> : null}
          {s.moonVoidUntil ? <li>Moon void of course until {timeWords(s.moonVoidUntil)}</li> : null}
        </ul>
      </div>
    </div>
  );
}

function ParkItems({ view, actions }: { view: SessionView; actions: RoomActions }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const waiting = view.items.filter((i) => i.status === "waiting" && !done.has(i.id));
  if (!waiting.length) return done.size ? <p className={HINT}>{CARD_WORDS.parked}</p> : null;
  return (
    <ul className="mt-2 space-y-1">
      {waiting.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-words text-sm text-foreground">{item.title}</span>
          <button
            type="button"
            className={BTN_QUIET}
            onClick={async () => {
              const r = await actions.patchItem(item.id, { status: "parked" });
              if (r.ok) setDone((d) => new Set(d).add(item.id));
            }}
          >
            {CARD_WORDS.park}
          </button>
        </li>
      ))}
    </ul>
  );
}

function CardFace({
  card,
  answer,
  view,
  actions,
  onShare,
  busy,
}: {
  card: CardView;
  answer: CardsAnswer;
  view: SessionView;
  actions?: RoomActions;
  onShare(shared: boolean): void;
  busy: boolean;
}) {
  const guide = useGuideName().name;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <LineBars line={card.sky.gates.Sun.line} />
        <div className="min-w-0">
          <p className={EYEBROW}>
            Card {card.n} · pulled by {card.pulledByName}
          </p>
          <p className="font-display text-3xl leading-tight lining-nums text-foreground">
            Gate {card.sky.gates.Sun.gate}.{card.sky.gates.Sun.line}
          </p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <MoonGlyph phase={card.sky.moonPhase} size={16} />
            {moonPhaseName(card.sky.moonPhase)} in {SIGNS[card.sky.signs.Moon]}
          </p>
        </div>
      </div>

      <Sky card={card} />

      <div className="space-y-3">
        {card.collective.map((c, i) => (
          <div key={i}>
            <SystemTag system={c.system} />
            <p className="mt-0.5 text-base leading-relaxed text-foreground">{c.text}</p>
          </div>
        ))}
        {card.welcomed.length ? <p className="text-base text-foreground">Welcome too, {andList(card.welcomed)}.</p> : null}
      </div>

      <section className={SOFT} aria-labelledby={`card-${card.id}-mine`}>
        <h4 id={`card-${card.id}-mine`} className={H3}>
          {CARD_WORDS.forYou}
        </h4>
        {card.mine ? (
          <>
            <p className="mt-1.5 text-base leading-relaxed text-foreground">{card.mine}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => onShare(!card.mineShared)}>
                {card.mineShared ? CARD_WORDS.keepMine : CARD_WORDS.shareMine}
              </button>
              <span className={HINT}>{card.mineShared ? CARD_WORDS.sharedMine : CARD_WORDS.privateMine}</span>
            </div>
          </>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">
            {fillGuideName(answer.notRead ? CARD_WORDS.notRead[answer.notRead] : CARD_WORDS.notRead["no-lines"], guide)}{" "}
            {answer.notRead && answer.notRead !== "left-out" ? (
              <Link href="/profile/gene-keys" className="text-notice underline underline-offset-2">
                Your Gene Keys
              </Link>
            ) : null}
          </p>
        )}
      </section>

      {card.shared.length ? (
        <ul className="space-y-2">
          {card.shared.map((s, i) => (
            <li key={i} className="text-base leading-relaxed text-foreground">
              <span className="font-semibold">{s.name}:</span> {s.line}
            </li>
          ))}
        </ul>
      ) : null}

      {card.suggestions.length ? (
        <section aria-labelledby={`card-${card.id}-ways`}>
          <h4 id={`card-${card.id}-ways`} className={H3}>
            {CARD_WORDS.waysToHold}
          </h4>
          <ul className="mt-2 space-y-2">
            {card.suggestions.map((s) => (
              <li key={s.kind} className={SOFT}>
                <SystemTag system={s.system} />
                <p className="mt-0.5 text-sm leading-relaxed text-foreground">{s.words}</p>
                {s.kind === "hold-conflict" && view.me.facilitates && actions ? <ParkItems view={view} actions={actions} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className={HINT}>{card.source === "maia" ? fillGuideName(CARD_WORDS.maia, guide) : CARD_WORDS.plain}</p>
    </div>
  );
}

export default function PullACard({ view, actions, className = "" }: { view: SessionView; actions?: RoomActions; className?: string }) {
  const on = useModuleOn("session-card");
  const reduced = useReducedMotion();
  const live = on && view.me.joined && view.status === "open";
  const [answer, setAnswer] = useState<CardsAnswer | null>(null);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const newest = useRef<number | null>(null);

  const take = useCallback((a: CardsAnswer) => {
    setAnswer(a);
    const top = a.cards[0]?.id ?? null;
    // A new card, from this phone or another, comes to the front.
    if (top !== newest.current) setAt(0);
    newest.current = top;
  }, []);

  useEffect(() => {
    if (!live) return;
    let stop = false;
    const read = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      readCards(view.id).then((a) => !stop && take(a), () => {});
    };
    read();
    const timer = setInterval(read, CARD_POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [live, view.id, take]);

  if (!live) return null;

  const act = async (fn: () => Promise<CardsAnswer>) => {
    setBusy(true);
    setProblem(null);
    try {
      take(await fn());
    } catch (e) {
      setProblem(e instanceof CardRefusal ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const cards = answer?.cards ?? [];
  const card = cards[at] ?? null;
  const mayPull = answer ? answer.mayPull : true;

  return (
    <section aria-labelledby="pull-a-card" aria-busy={busy} className={className}>
      <h3 id="pull-a-card" className={`${H3} mb-2`}>
        {CARD_WORDS.title}
      </h3>
      {card && answer ? (
        <motion.div
          key={card.id}
          initial={reduced ? false : { rotateY: 90, opacity: 0 }}
          animate={{ rotateY: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          style={{ transformPerspective: 900 }}
        >
          <CardFace card={card} answer={answer} view={view} actions={actions} busy={busy} onShare={(shared) => act(() => shareMyLine(view.id, card.id, shared))} />
        </motion.div>
      ) : (
        <p className={HINT}>{CARD_WORDS.lede}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {mayPull ? (
          <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => act(() => pullCard(view.id))}>
            {busy ? CARD_WORDS.pulling : card ? CARD_WORDS.again : CARD_WORDS.pull}
          </button>
        ) : null}
        {cards.length > 1 ? (
          <>
            <button type="button" className={BTN_QUIET} disabled={at >= cards.length - 1} onClick={() => setAt((i) => Math.min(cards.length - 1, i + 1))}>
              {CARD_WORDS.earlier}
            </button>
            <button type="button" className={BTN_QUIET} disabled={at === 0} onClick={() => setAt((i) => Math.max(0, i - 1))}>
              {CARD_WORDS.newer}
            </button>
          </>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

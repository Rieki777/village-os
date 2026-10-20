/**
 * YOUR TASK BOARD: every task you took on in a live session, across all of
 * them, and every task a seat you sit in holds.
 *
 * Rye asked for "a 'task board' section in profile that has all tasks that
 * have been assigned to each player during the sessions". It reads as three
 * groups, a grouped list and not a set of columns, because it is read on a
 * phone and answered with one tap:
 *
 *   Holding          held by you, by date, undated last
 *   Your seats hold  held by a seat you sit in now, so it follows the seat
 *   Finished         done or let go in the last three moons
 *   Earlier          finished before that, loaded only when opened
 *
 * The server groups and sorts (`TaskBoardPayload`); this draws what it sent
 * and never re-sorts it. `today` comes in the same payload, in the village's
 * zone, so a date gone by is measured where the circle lives.
 *
 * NO COUNTS. No group heading carries a number, and nothing here totals what
 * one person did or did not do. The Earlier disclosure knows there is
 * something to open and says only its name.
 *
 * AFTER AN ANSWER the card the server handed back takes its place at once,
 * and the board re-reads quietly, so a task marked done moves to Finished and
 * a task handed back leaves. If the card that had focus is gone, focus comes
 * back to the board's heading rather than falling to the top of the page.
 *
 * An email or the menu links here as /profile#my-tasks. A task notice links
 * one card as /profile#task-<entryId> (taskBoardLink). The board arrives after
 * the page does, so it brings itself into view once it has drawn, and again
 * whenever the hash names it while the member is already here (a notice
 * opened from the bell on this page changes the hash with no remount). A card
 * it lands on scrolls clear of the fixed header, wears a gold ring for a
 * moment (no fade when the reader asks for reduced motion), and takes focus
 * on its own words, so a screen reader starts at the task. A card that is not
 * on the board as drawn (an Earlier one, or one that moved on) lands on the
 * board itself.
 *
 * On a first visit the sections above the board are still drawing when it
 * lands, and each one pushes it down. So a landing holds its target in place
 * until the page settles (tasks/holdInView), letting go the moment the reader
 * scrolls, touches or types, and puts focus on the card again once it is
 * still, so the ring and the focus are never out of sight.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { gameFetch } from "@/lib/gameApi";
import { HINT, LABEL_CAPS, PANEL, BTN_SECONDARY, BTN_QUIET } from "@/components/sessions/roomUi";
import TaskCard from "@/components/tasks/TaskCard";
import { TASKS_CHANGED_EVENT, tasksChanged, tasksChangedFrom } from "@/components/tasks/useTaskCount";
import { dropBellAnswer } from "@/components/tasks/bellAnswers";
import { holdInView } from "@/components/tasks/holdInView";
import {
  TASK_BOARD_ANCHOR,
  TASK_COPY,
  TASKS_MINE_URL,
  taskCardAnchor,
  taskIdFromHash,
  type TaskBoardPayload,
  type TaskCard as TaskCardData,
} from "@shared/sessionTasks";

const isCards = (v: unknown): v is TaskCardData[] => Array.isArray(v);

function readBoard(v: unknown): TaskBoardPayload | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Partial<TaskBoardPayload>;
  if (!isCards(b.holding) || !isCards(b.seatsHold) || !isCards(b.finished) || typeof b.today !== "string") return null;
  return { holding: b.holding, seatsHold: b.seatsHold, finished: b.finished, earlierCount: Number(b.earlierCount) || 0, today: b.today };
}

const replaceIn = (list: TaskCardData[], t: TaskCardData): TaskCardData[] => list.map((c) => (c.entryId === t.entryId ? t : c));

type GroupKey = "holding" | "seatsHold" | "finished";

/** How long a card landed on keeps its gold ring. */
export const LANDED_RING_MS = 2400;

const reducedMotion = (): boolean => {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** The card's own words, which label its article: where focus lands. */
function focusCard(wrap: HTMLElement): void {
  const article = wrap.querySelector<HTMLElement>("article[aria-labelledby]");
  const words = article ? document.getElementById(article.getAttribute("aria-labelledby") ?? "") : null;
  const target = words ?? wrap;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

/** The li a card sits in: its anchor, and room above it for the fixed header. */
const cardShell = (entryId: number, ringed: number | null): string =>
  `scroll-mt-28 rounded-2xl motion-safe:transition-shadow motion-safe:duration-500 ${
    ringed === entryId ? "ring-2 ring-gold ring-offset-2 ring-offset-card" : ""
  }`;

export default function TaskBoard() {
  const [board, setBoard] = useState<TaskBoardPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [earlier, setEarlier] = useState<TaskCardData[] | null>(null);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const earlierAsked = useRef(false);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const refocus = useRef(false);
  const arrived = useRef(false);
  const live = useRef(true);
  const drawn = useRef(false);
  // The landing being held in view, let go by the next landing or on leaving.
  const holding = useRef<(() => void) | null>(null);
  const [ringed, setRinged] = useState<number | null>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      holding.current?.();
      holding.current = null;
    };
  }, []);

  const load = useCallback(async (quiet = false, afterAnswer = false) => {
    if (!quiet) setFailed(false);
    try {
      const res = await gameFetch(TASKS_MINE_URL, { cache: "no-store" });
      const next = res.ok ? readBoard(await res.json().catch(() => null)) : null;
      if (!live.current) return;
      // A quiet re-read that fails leaves the board as it stands: what is in
      // hand is still true, and the next answer re-reads again.
      if (next) {
        // The re-read is what moves an answered card to another group, so it
        // is the render after this one that may have taken focus with it.
        if (afterAnswer) refocus.current = true;
        setBoard(next);
      } else if (!quiet) setFailed(true);
    } catch {
      if (live.current && !quiet) setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Land where the hash points: one card, or the board as a whole. Answers
   * whether the hash named this board at all.
   */
  const land = useCallback((): boolean => {
    if (typeof window === "undefined") return false;
    const hash = window.location.hash;
    const id = taskIdFromHash(hash);
    if (id == null && hash !== `#${TASK_BOARD_ANCHOR}`) return false;
    const behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth";
    const card = id != null ? document.getElementById(taskCardAnchor(id)) : null;
    const target = card ?? document.getElementById(TASK_BOARD_ANCHOR);
    holding.current?.();
    holding.current = null;
    if (!target) return true;
    target.scrollIntoView?.({ block: "start", behavior });
    if (card) {
      setRinged(id);
      focusCard(card);
    }
    // Hold it there while the page above it finishes drawing.
    holding.current = holdInView(target, {
      onSettle: () => {
        holding.current = null;
        // Focus on the card again once it is still, unless the reader has moved it on.
        const active = document.activeElement;
        if (card && card.isConnected && (!active || active === document.body || card.contains(active))) focusCard(card);
      },
    });
    return true;
  }, []);

  // Landed here from an email, a notice or the menu: come into view once there is something to see.
  useEffect(() => {
    if (!board || arrived.current) return;
    arrived.current = true;
    drawn.current = true;
    land();
  }, [board, land]);

  // Already on the profile when a notice or the menu points here: the hash
  // changes with no remount. The router moves by pushState, which sends no
  // hashchange, so its own event is heard too.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const again = () => {
      if (drawn.current) land();
    };
    const events = ["hashchange", "popstate", "pushState"];
    for (const e of events) window.addEventListener(e, again);
    return () => {
      for (const e of events) window.removeEventListener(e, again);
    };
  }, [land]);

  // The ring is a moment, not a mark.
  useEffect(() => {
    if (ringed == null) return;
    const t = window.setTimeout(() => setRinged(null), LANDED_RING_MS);
    return () => window.clearTimeout(t);
  }, [ringed]);

  // The card that held focus left the board: bring focus home.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) heading.current?.focus();
  }, [board]);

  const answered = (t: TaskCardData) => {
    // The bell's own memory of "It's done" speaks for it no longer.
    dropBellAnswer(t.entryId);
    setBoard((b) => (b ? { ...b, holding: replaceIn(b.holding, t), seatsHold: replaceIn(b.seatsHold, t), finished: replaceIn(b.finished, t) } : b));
    setEarlier((e) => (e ? replaceIn(e, t) : e));
    void load(true, true);
    // The menu's count and the profile's waiting card read again.
    tasksChanged("board");
  };

  // A task answered from the bell while the board is open: read again quietly.
  useEffect(() => {
    const fromBell = (e: Event) => {
      if (tasksChangedFrom(e) === "bell") void load(true);
    };
    window.addEventListener(TASKS_CHANGED_EVENT, fromBell);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, fromBell);
  }, [load]);

  const openEarlier = async () => {
    if (earlierAsked.current) return;
    earlierAsked.current = true;
    setEarlierFailed(false);
    try {
      const res = await gameFetch(`${TASKS_MINE_URL}?earlier=1`, { cache: "no-store" });
      const next = res.ok ? readBoard(await res.json().catch(() => null)) : null;
      if (!live.current) return;
      if (!next) {
        earlierAsked.current = false;
        setEarlierFailed(true);
        return;
      }
      // The reply's Finished holds the older tasks too. Only the ones not
      // already shown above belong here.
      const shown = new Set((board?.finished ?? []).map((c) => c.entryId));
      setEarlier(next.finished.filter((c) => !shown.has(c.entryId)));
    } catch {
      earlierAsked.current = false;
      if (live.current) setEarlierFailed(true);
    }
  };

  const group = (key: GroupKey, cards: TaskCardData[], today: string) => {
    if (cards.length === 0) return null;
    const id = `task-board-${key}`;
    return (
      <section aria-labelledby={id} className="space-y-3">
        <h3 id={id} className={LABEL_CAPS}>
          {TASK_COPY.groups[key]}
        </h3>
        <ul className="space-y-3">
          {cards.map((c) => (
            <li key={c.entryId} id={taskCardAnchor(c.entryId)} className={cardShell(c.entryId, ringed)}>
              <TaskCard task={c} today={today} onAnswered={answered} />
            </li>
          ))}
        </ul>
      </section>
    );
  };

  const nothingHeld = !!board && board.holding.length === 0 && board.seatsHold.length === 0;
  // A task opened again from Earlier moves up on the next read; it is shown once, where it now stands.
  const onBoard = new Set(board ? [...board.holding, ...board.seatsHold, ...board.finished].map((c) => c.entryId) : []);
  const earlierShown = (earlier ?? []).filter((c) => !onBoard.has(c.entryId));

  return (
    <section aria-labelledby="task-board-h" aria-busy={!board && !failed} className={`${PANEL} sm:p-8`}>
      <h2 id="task-board-h" ref={heading} tabIndex={-1} className="font-display text-2xl font-bold text-card-foreground outline-none">
        {TASK_COPY.heading}
      </h2>
      <p className={`${HINT} mt-1`}>{TASK_COPY.lede}</p>

      {!board && !failed && (
        <div className="mt-6 space-y-3" aria-hidden="true" data-loading>
          <div className="h-28 animate-pulse rounded-2xl bg-muted" />
          <div className="h-28 animate-pulse rounded-2xl bg-muted" />
        </div>
      )}

      {!board && failed && (
        <div className="mt-6 flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-foreground">{TASK_COPY.loadFailed}</p>
          <button type="button" className={BTN_SECONDARY} onClick={() => void load()}>
            {TASK_COPY.retry}
          </button>
        </div>
      )}

      {board && (
        <div className="mt-6 space-y-8">
          {nothingHeld && <p className="text-base text-muted-foreground">{TASK_COPY.empty}</p>}
          {group("holding", board.holding, board.today)}
          {group("seatsHold", board.seatsHold, board.today)}
          {group("finished", board.finished, board.today)}

          {board.earlierCount > 0 && (
            <details
              className="group"
              onToggle={(e) => {
                if ((e.currentTarget as HTMLDetailsElement).open) void openEarlier();
              }}
            >
              <summary className={`${BTN_QUIET} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                <span className={LABEL_CAPS}>{TASK_COPY.groups.earlier}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-3" aria-live="polite">
                {earlier === null && !earlierFailed && (
                  <div className="h-20 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
                )}
                {earlierFailed && (
                  <div className="flex flex-wrap items-center gap-3" role="alert">
                    <p className="text-sm text-foreground">{TASK_COPY.loadFailed}</p>
                    <button type="button" className={BTN_SECONDARY} onClick={() => void openEarlier()}>
                      {TASK_COPY.retry}
                    </button>
                  </div>
                )}
                {earlierShown.length > 0 && (
                  <ul className="space-y-3">
                    {earlierShown.map((c) => (
                      <li key={c.entryId} id={taskCardAnchor(c.entryId)} className={cardShell(c.entryId, ringed)}>
                        <TaskCard task={c} today={board.today} onAnswered={answered} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

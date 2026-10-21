/**
 * FROM LAST TIME: what this circle's earlier sessions left behind.
 *
 * THE ACTION CHECK reads the circle's tasks (`view.circleTasks`): every task
 * from its earlier sessions that is still open, and every one answered since
 * the circle last met, each with its latest answer. They are grouped in the
 * order the room reads them (`groupForCheck`, shared/sessionTasks.ts): what got
 * done first, then what is back with the circle and needs someone, then the
 * new dates, what was let go, and what is still being held. Each card is the
 * task board's own card, so the person holding a task, the facilitator and an
 * admin answer it here the way they would on their board, and a task back
 * with the circle offers "I'll take it" to whoever may take it. An answer
 * bumps the room's version on the server, so the room's normal poll brings
 * the new state; until it does, the card shows the answer it was given.
 *
 * A circle whose tasks have nothing to say yet (a server from before the task
 * layer) still reads its open actions from the last record, as it always did.
 * An action nobody held when the call closed is a task too, back with the
 * circle, so it is read here with the rest.
 *
 * Then the last session's backlog and the items it parked. Anything there can
 * come onto today's agenda with one tap, carrying where it came from, and once
 * it is there it is no longer offered. Those cards belong to the earlier
 * session, which is closed and keeps its record as it was, so they are drawn
 * as the room draws every card (glyph and all) with no pencil and no remove.
 */
import { useState } from "react";
import {
  AIM_DEFS,
  ROOM_COPY,
  ROOM_ITEM_MINUTES_DEFAULT,
  SESSION_COPY,
  SESSION_LIMITS,
  cleanLine,
  type ItemAim,
} from "@shared/sessions";
import { TASK_COPY, groupForCheck, type TaskCard } from "@shared/sessionTasks";
import TaskCardView from "@/components/tasks/TaskCard";
import EntryCard from "./EntryCard";
import { BTN_QUIET, BTN_SECONDARY, CARD, CHIP, H3, HINT, LABEL_CAPS, heldLine, keepsNotes, type StageProps } from "./roomUi";

/** The room's own day, YYYY-MM-DD, read off the room's clock in this device's zone. */
export function roomDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * When the circle last met, as near as the cards can tell, for a view that
 * does not say (`circleLastMetAt`, from a server before it was sent). A task
 * nobody has answered carries its session's close as its latest moment, so
 * the newest of those is the latest close the cards show. When the last
 * session left no unanswered task this reads an earlier close, and a date
 * moved before the last meeting is read once more as new.
 */
export function lastMetFrom(cards: readonly TaskCard[]): string | null {
  let best: string | null = null;
  for (const c of cards) {
    if (c.latest?.kind !== "closed") continue;
    if (best == null || Date.parse(c.latest.at) > Date.parse(best)) best = c.latest.at;
  }
  return best;
}

/** The newest session the tasks came from: the one an action check brought in today points back to. */
function newestSource(cards: readonly TaskCard[]): number | null {
  let best: TaskCard | null = null;
  for (const c of cards) {
    if (!best || c.saidOn > best.saidOn || (c.saidOn === best.saidOn && c.sessionId > best.sessionId)) best = c;
  }
  return best?.sessionId ?? null;
}

export default function FromLastTime({ view, actions }: Omit<StageProps, "now">) {
  const carried = view.carried;
  const [busy, setBusy] = useState<string | null>(null);
  // A card answered here, until the room's poll brings the same answer or a later one.
  const [answered, setAnswered] = useState<Record<number, TaskCard>>({});
  const tasks = (view.circleTasks ?? []).map((t) => {
    const mine = answered[t.entryId];
    return mine && mine.version > t.version ? mine : t;
  });
  const carriedActions = carried?.actions ?? [];
  const backlog = carried?.backlog ?? [];
  const parkedItems = carried?.parkedItems ?? [];
  const useTasks = tasks.length > 0;
  if (!useTasks && !carriedActions.length && !backlog.length && !parkedItems.length) return null;

  const canAdd = view.me.joined && view.status === "open";
  const today = roomDay(view.serverNow);
  const source = carried?.sessionId ?? newestSource(tasks);
  // The action check is a title of the room's own, so the room asks its agenda whether it is there yet.
  // Any earlier session counts: a member with standing and no `carried` reads another source, and one check is enough.
  const checkTitle = ROOM_COPY.actionCheckTitle.toLowerCase();
  const checkAdded = view.items.some((i) => i.fromSessionId != null && i.title.toLowerCase() === checkTitle);
  // The server knows when the circle last met; the cards' own guess is the fallback.
  const groups = useTasks ? groupForCheck(tasks, view.circleLastMetAt ?? lastMetFrom(tasks)) : [];

  const bring = async (key: string, title: string, aim: ItemAim, minutes: number) => {
    const clean = cleanLine(title, SESSION_LIMITS.agendaTitle);
    if (!clean || source == null) return;
    setBusy(key);
    try {
      await actions.addItem({ title: clean, aim, minutes, fromSessionId: source });
    } finally {
      setBusy(null);
    }
  };

  const onAnswered = (t: TaskCard) => setAnswered((prev) => ({ ...prev, [t.entryId]: t }));

  return (
    <section className={CARD} aria-labelledby="carried-title">
      <h3 id="carried-title" className={H3}>
        {SESSION_COPY.carriedTitle}
      </h3>
      {carried && <p className={HINT}>{carried.title}</p>}

      {(useTasks || carriedActions.length > 0) && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className={LABEL_CAPS}>{SESSION_COPY.carriedActions}</h4>
            {canAdd && source != null && !checkAdded && (
              <button
                type="button"
                className={BTN_QUIET}
                disabled={busy != null}
                onClick={() => void bring("check", ROOM_COPY.actionCheckTitle, "report", 5)}
              >
                {ROOM_COPY.addActionCheck}
              </button>
            )}
          </div>

          {useTasks ? (
            <>
              {keepsNotes(view) && <p className={`${HINT} mt-1`}>{TASK_COPY.checkCue}</p>}
              <div className="mt-3 space-y-4">
                {groups.map((g) => (
                  <section key={g.key} aria-labelledby={`check-${g.key}`} data-check-group={g.key}>
                    <h5 id={`check-${g.key}`} className="text-sm font-semibold text-foreground">
                      {TASK_COPY.checkGroups[g.key]}
                    </h5>
                    {/* A count for the whole circle, never for one person. */}
                    {g.key === "doneSince" && <p className={HINT}>{TASK_COPY.doneSince(g.cards.length)}</p>}
                    <ul className="mt-2 space-y-2">
                      {g.cards.map((t) => (
                        <li key={t.entryId}>
                          <TaskCardView compact task={t} today={today} onAnswered={onAnswered} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <ul className="mt-2 space-y-2">
              {carriedActions.map((a) => (
                <li key={a.id}>
                  <EntryCard
                    view={view}
                    actions={actions}
                    entry={a}
                    readOnly
                    extra={
                      <p className="mt-1 text-sm text-muted-foreground">
                        {heldLine(a)}
                        {a.dueOn ? ` · ${ROOM_COPY.dueLabel} ${a.dueOn}` : ""}
                      </p>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(backlog.length > 0 || parkedItems.length > 0) && (
        <div className="mt-4">
          <h4 className={LABEL_CAPS}>{SESSION_COPY.carriedBacklog}</h4>
          <ul className="mt-2 space-y-2">
            {parkedItems.map((p, i) => (
              <li key={`p${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted px-3.5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="text-foreground">{p.title}</span>{" "}
                  <span className={CHIP}>
                    {AIM_DEFS[p.aim].label} · {p.minutes} {ROOM_COPY.minutesShort}
                  </span>
                </span>
                {canAdd && (
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    disabled={busy != null}
                    onClick={() => void bring(`p${i}`, p.title, p.aim, p.minutes)}
                  >
                    {ROOM_COPY.addToAgenda}
                  </button>
                )}
              </li>
            ))}
            {backlog.map((e) => (
              <li key={e.id}>
                <EntryCard
                  view={view}
                  actions={actions}
                  entry={e}
                  readOnly
                  extra={
                    canAdd ? (
                      <div className="mt-2">
                        <button
                          type="button"
                          className={BTN_SECONDARY}
                          disabled={busy != null}
                          onClick={() => void bring(`e${e.id}`, e.text, "explore", ROOM_ITEM_MINUTES_DEFAULT)}
                        >
                          {ROOM_COPY.addToAgenda}
                        </button>
                      </div>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

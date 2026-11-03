/**
 * YOUR LIST: the member's own tasks on their profile, under the task board
 * ("Your list", PR 2).
 *
 * Draws nothing until a steward has turned the member's list on (the server
 * answers `{ on: false }`), so it changes nothing for anybody else. Today,
 * This week and Later are the VILLAGE's days, decided on the server
 * (shared/memberTasks.ts); inside each, tasks are grouped by tier. Pinned
 * tasks and tasks due within two days always show; the rest past the caps sit
 * behind "Show hidden".
 *
 * Every change waits for the server's answer before the card moves. A removed
 * task can be brought back with Undo, here and for 30 days in "Removed".
 */
import { useCallback, useEffect, useState } from "react";
import { HORIZONS, TIERS, type Horizon, type ReasonCode, type Tier } from "@shared/memberTasks";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, HINT, LABEL_CAPS, PANEL } from "@/components/sessions/roomUi";
import { addTask, markDone, readList, removeTask, undoTask, type ListPayload, type ListTask, type RankedTask } from "./yourListApi";

export const HORIZON_WORDS: Record<Horizon, string> = { today: "Today", week: "This week", later: "Later" };
export const TIER_WORDS: Record<Tier, string> = { high: "High", priority: "Priority", not_yet: "Not yet" };
export const REASON_WORDS: Record<ReasonCode, string> = {
  tier_high: "You marked it high.",
  due_soon: "It is due within two days.",
  overdue: "Its date has passed.",
  pinned: "A steward pinned it.",
  from_session: "It came from a session.",
  from_journal: "You made it from your journal.",
  from_library: "It came from the knowledge library.",
  added_by_you: "You added it.",
  chosen_today: "You chose today for it.",
};

type Live = Extract<ListPayload, { on: true }>;

function TaskRow({ task, busy, onDone, onRemove }: { task: RankedTask; busy: boolean; onDone: () => void; onRemove: () => void }) {
  const [why, setWhy] = useState(false);
  return (
    <li className="rounded-xl border border-border bg-muted px-3.5 py-3 text-foreground">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 break-words text-base">{task.title}</span>
        {task.dueOn && <span className={HINT}>Due {task.dueOn}</span>}
      </div>
      {task.privateDetail && (
        <p className={`${HINT} mt-1 whitespace-pre-line`}>
          <span className="font-semibold">Only you see this: </span>
          {task.privateDetail}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={onDone}>It's done</button>
        <button type="button" className={BTN_QUIET} disabled={busy} onClick={onRemove}>Remove</button>
        <button type="button" className={BTN_QUIET} aria-expanded={why} onClick={() => setWhy((w) => !w)}>Why this is here</button>
      </div>
      {why && (
        <ul className={`${HINT} mt-1 list-disc pl-5`}>
          {task.reasons.map((r) => <li key={r}>{REASON_WORDS[r]}</li>)}
        </ul>
      )}
    </li>
  );
}

export default function YourListCard() {
  const [list, setList] = useState<ListPayload | null>(null);
  const [title, setTitle] = useState("");
  const [tier, setTier] = useState<Tier>("priority");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [undo, setUndo] = useState<ListTask | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);

  const load = useCallback(async () => setList(await readList()), []);
  useEffect(() => { void load(); }, [load]);

  if (!list || !list.on) return null;
  const live = list as Live;

  const act = async (fn: () => Promise<{ ok: boolean; error?: string; task?: ListTask | null }>, after?: (t: ListTask | null) => void) => {
    setBusy(true);
    setProblem(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setProblem((r as { error: string }).error === "conflict" ? "That task changed somewhere else. Here is the latest." : (r as { error: string }).error);
    else after?.(r.task ?? null);
    await load();
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await act(() => addTask(title.trim(), tier), () => setTitle(""));
  };

  const shown = (h: Horizon) => live.open.filter((t) => t.horizonNow === h && (showHidden || t.shown));

  return (
    <section className={PANEL} aria-labelledby="your-list-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="your-list-h" className="font-display text-2xl text-foreground">Your list</h2>
        <p className={HINT}>
          {live.counts.today} today, {live.counts.week} this week, {live.counts.later} later
          {live.counts.hidden > 0 ? `, ${live.counts.hidden} hidden` : ""}
        </p>
      </div>

      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={add}>
        <label className="min-w-0 flex-1">
          <span className={LABEL_CAPS}>Add a task</span>
          <input
            className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-foreground"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
          />
        </label>
        <label>
          <span className={LABEL_CAPS}>Tier</span>
          <select className="mt-1 block min-h-11 rounded-xl border border-border bg-background px-3 text-foreground" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
            {TIERS.map((t) => <option key={t} value={t}>{TIER_WORDS[t]}</option>)}
          </select>
        </label>
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !title.trim()}>Add</button>
      </form>

      {problem && <p role="alert" className="mt-2 text-sm text-foreground">{problem}</p>}
      {undo && (
        <p className="mt-2 flex items-center gap-2 text-sm text-foreground" role="status">
          Removed "{undo.title}".
          <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => act(() => undoTask(undo), () => setUndo(null))}>Undo</button>
        </p>
      )}

      {HORIZONS.map((h) => {
        const tasks = shown(h);
        return (
          <div key={h} className="mt-5">
            <h3 className={LABEL_CAPS}>{HORIZON_WORDS[h]}</h3>
            {tasks.length === 0 ? (
              <p className={`${HINT} mt-1`}>Nothing here.</p>
            ) : (
              TIERS.map((tr) => {
                const inTier = tasks.filter((t) => t.tier === tr);
                if (!inTier.length) return null;
                return (
                  <div key={tr} className="mt-2">
                    <p className={HINT}>{TIER_WORDS[tr]}</p>
                    <ul className="mt-1 space-y-2">
                      {inTier.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          busy={busy}
                          onDone={() => act(() => markDone(t))}
                          onRemove={() => act(() => removeTask(t, "other"), (gone) => setUndo(gone))}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
        );
      })}

      <div className="mt-5 flex flex-wrap gap-2">
        {live.counts.hidden > 0 && (
          <button type="button" className={BTN_QUIET} aria-pressed={showHidden} onClick={() => setShowHidden((s) => !s)}>
            {showHidden ? "Hide the extra tasks" : `Show hidden (${live.counts.hidden})`}
          </button>
        )}
        {live.removed.length > 0 && (
          <button type="button" className={BTN_QUIET} aria-expanded={showRemoved} onClick={() => setShowRemoved((s) => !s)}>
            Removed ({live.removed.length})
          </button>
        )}
      </div>
      {showRemoved && (
        <ul className="mt-2 space-y-2">
          {live.removed.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="min-w-0 flex-1">{t.title}</span>
              <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => act(() => undoTask(t))}>Bring it back</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

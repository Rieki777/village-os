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
import { daysBetween } from "@shared/memberTasks";
import type { FeedbackContext } from "@shared/memberTaskFeedback";
import ReasonSheet, { type ReasonPick } from "./ReasonSheet";
import { holdUndo } from "@/components/admin/adminUndo";
import {
  addTask, changeTier, markDone, newFeedbackId, pinTask, readFeedbackSwitch, readList, redirectTask, removeTask, saveFeedbackSwitch, undoTask,
  type ListPayload, type ListTask, type RankedTask,
} from "./yourListApi";

export const HORIZON_WORDS: Record<Horizon, string> = { today: "Today", week: "This week", later: "Later" };
export const TIER_WORDS: Record<Tier, string> = { high: "High", priority: "Priority", not_yet: "Not yet" };
export const REASON_WORDS: Record<ReasonCode, string> = {
  tier_high: "You marked it high.",
  due_soon: "It is due within two days.",
  overdue: "Its date has passed.",
  pinned: "A steward pinned it.",
  pinned_by_you: "You pinned it to the top.",
  handed_to_you: "Someone handed it to you.",
  from_session: "It came from a session.",
  from_journal: "You made it from your journal.",
  from_library: "It came from Organisational Memory.",
  added_by_you: "You added it.",
  chosen_today: "You chose today for it.",
};

type Live = Extract<ListPayload, { on: true }>;

function TaskRow({ task, busy, onDone, onPick, onPin, onTier, others, selected, onToggle }: {
  task: RankedTask;
  others: { id: string; title: string }[];
  busy: boolean;
  selected: boolean;
  onToggle: () => void;
  onDone: () => void;
  onPick: (mode: "remove" | "redirect", p: ReasonPick) => void;
  onPin: () => void;
  onTier: (t: Tier) => void;
}) {
  const [why, setWhy] = useState(false);
  const [sheet, setSheet] = useState<"remove" | "redirect" | null>(null);
  return (
    <li className="rounded-xl border border-border bg-muted px-3.5 py-3 text-foreground">
      <div className="flex flex-wrap items-start gap-2">
        <input type="checkbox" aria-label={`Select ${task.title}`} className="mt-1 h-11 w-11 shrink-0" checked={selected} onChange={onToggle} />
        <span className="min-w-0 flex-1 break-words text-base">
          {task.memberPinned ? <span className="mr-1 font-semibold">Pinned:</span> : null}
          {task.title}
        </span>
        {task.dueOn && <span className={HINT}>Due {task.dueOn}</span>}
      </div>
      {task.requestedBy && <p className={`${HINT} mt-1`}>Asked by {task.requestedBy}</p>}
      {task.waitingForRole && <p className={`${HINT} mt-1`}>This one belongs to a role nobody holds yet. A steward will see it.</p>}
      {task.privateDetail && (
        <p className={`${HINT} mt-1 whitespace-pre-line`}>
          <span className="font-semibold">Only you see this: </span>
          {task.privateDetail}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={onDone}>It's done</button>
        <button type="button" className={BTN_QUIET} disabled={busy} aria-expanded={sheet === "remove"} onClick={() => setSheet(sheet === "remove" ? null : "remove")}>Remove</button>
        <button type="button" className={BTN_QUIET} disabled={busy} aria-expanded={sheet === "redirect"} onClick={() => setSheet(sheet === "redirect" ? null : "redirect")}>Hand it on</button>
        <button type="button" className={BTN_QUIET} disabled={busy} aria-pressed={!!task.memberPinned} onClick={onPin}>{task.memberPinned ? "Unpin" : "Pin to top"}</button>
        <label className="inline-flex items-center gap-1 text-sm text-foreground">
          <span className="sr-only">Tier</span>
          <select className="min-h-11 rounded-lg border border-border bg-background px-2 text-foreground" value={task.tier} disabled={busy} onChange={(e) => onTier(e.target.value as Tier)}>
            {TIERS.map((t) => <option key={t} value={t}>{TIER_WORDS[t]}</option>)}
          </select>
        </label>
        <button type="button" className={BTN_QUIET} aria-expanded={why} onClick={() => setWhy((w) => !w)}>Why this is here</button>
      </div>
      {why && (
        <ul className={`${HINT} mt-1 list-disc pl-5`}>
          {task.reasons.map((r) => <li key={r}>{REASON_WORDS[r]}</li>)}
        </ul>
      )}
      {sheet && (
        <ReasonSheet
          mode={sheet}
          busy={busy}
          others={others}
          onCancel={() => setSheet(null)}
          onPick={(p) => {
            setSheet(null);
            onPick(sheet, p);
          }}
        />
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
  const [sharing, setSharing] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<"remove" | "redirect" | null>(null);

  const load = useCallback(async () => setList(await readList()), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void readFeedbackSwitch().then(setSharing); }, []);

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

  const contextOf = (t: RankedTask): FeedbackContext => ({
    shownIn: t.shown ? t.horizonNow : "hidden",
    rankScore: t.score,
    daysOnList: Math.max(0, daysBetween(t.createdOn, live.today)),
    surface: "profile",
  });
  const pressed = (t: RankedTask, mode: "remove" | "redirect", p: ReasonPick) => {
    const press = { feedbackId: newFeedbackId(), reason: p.reason, note: p.note, context: contextOf(t), ...(p.mergedIntoTaskId ? { mergedIntoTaskId: p.mergedIntoTaskId } : {}) };
    return mode === "remove"
      ? act(() => removeTask(t, press), (gone) => setUndo(gone))
      : act(() => redirectTask(t, press, { toUserId: p.toUserId, toRoleId: p.toRoleId }), (gone) => setUndo(gone));
  };
  const flipSharing = async () => {
    if (sharing === null) return;
    const next = await saveFeedbackSwitch(!sharing);
    if (next === null) setProblem("That did not save. Try again.");
    else setSharing(next);
  };

  const shown = (h: Horizon) => live.open.filter((t) => t.horizonNow === h && (showHidden || t.shown));
  const chosen = live.open.filter((t) => selected.includes(t.id));
  const applyBulk = async (mode: "remove" | "redirect" | "done", p?: ReasonPick) => {
    setBusy(true);
    setProblem(null);
    for (const t of chosen) {
      const press = p ? { feedbackId: newFeedbackId(), reason: p.reason, note: p.note, context: contextOf(t), ...(p.mergedIntoTaskId ? { mergedIntoTaskId: p.mergedIntoTaskId } : {}) } : null;
      const result = mode === "done"
        ? await markDone(t)
        : mode === "remove" && press
          ? await removeTask(t, press)
          : press
            ? await redirectTask(t, press, { toUserId: p?.toUserId, toRoleId: p?.toRoleId })
            : { ok: false as const, error: "Pick a reason." };
      if (!result.ok) {
        setProblem(result.error);
        setBusy(false);
        await load();
        return;
      }
    }
    setSelected([]);
    setBulk(null);
    setBusy(false);
    await load();
  };

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
          Moved "{undo.title}" off your list.
          <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => act(() => undoTask(undo), () => setUndo(null))}>Undo</button>
        </p>
      )}

      {chosen.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-background p-3">
          <p className="text-sm text-foreground">{chosen.length} selected. The reason you pick applies to every task you selected.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => holdUndo(`Applying this to ${chosen.length} tasks.`, () => { void applyBulk("done"); })}>Done</button>
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setBulk(bulk === "remove" ? null : "remove")}>Remove</button>
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setBulk(bulk === "redirect" ? null : "redirect")}>Redirect</button>
          </div>
          {bulk && (
            <ReasonSheet
              mode={bulk}
              busy={busy}
              others={chosen.map((t) => ({ id: t.id, title: t.title }))}
              onCancel={() => setBulk(null)}
              onPick={(p) => holdUndo(`Applying this to ${chosen.length} tasks.`, () => { void applyBulk(bulk, p); })}
            />
          )}
        </div>
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
                          others={tasks.filter((o) => o.id !== t.id).map((o) => ({ id: o.id, title: o.title }))}
                          busy={busy}
                          selected={selected.includes(t.id)}
                          onToggle={() => setSelected((cur) => cur.includes(t.id) ? cur.filter((id) => id !== t.id) : [...cur, t.id])}
                          onDone={() => holdUndo("Marking this done.", () => { void act(() => markDone(t)); })}
                          onPick={(mode, p) => holdUndo(mode === "remove" ? "Removing this task." : "Handing this task on.", () => { void pressed(t, mode, p); })}
                          onPin={() => act(() => pinTask(t, !t.memberPinned))}
                          onTier={(tr2) => act(() => changeTier(t, tr2, contextOf(t)))}
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
      {sharing !== null && (
        <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 text-sm text-foreground">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={sharing} onChange={flipSharing} />
          <span>
            Help Organisational Memory learn from my choices. When this is on, the reason you pick for a task it sent you goes back to it.
            Your journal words never do.
          </span>
        </label>
      )}
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

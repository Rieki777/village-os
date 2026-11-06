/**
 * The Command Centre plan editor's moves, as pure functions over a draft.
 *
 * Every move returns a new plan and leaves the one it was given alone, so the
 * editor can hold a draft, show it, and throw it away on Cancel. Nothing here
 * deletes: removing an item marks it hidden (see shared/commandCentrePlan.ts
 * for why), and a hidden item is skipped when moving its neighbours.
 */
import {
  newPlanId,
  type CommandCentrePlan,
  type PlanDecision,
  type PlanTask,
  type PlanWeek,
} from "@shared/commandCentrePlan";

export type Plan = CommandCentrePlan;
export type Direction = -1 | 1;

/** Index of the nearest visible item from `from` in `dir`, or -1. */
function nextVisible<T extends { hidden?: boolean }>(
  items: T[],
  from: number,
  dir: Direction
): number {
  for (let i = from + dir; i >= 0 && i < items.length; i += dir)
    if (!items[i].hidden) return i;
  return -1;
}

function swap<T>(items: T[], a: number, b: number): T[] {
  const out = items.slice();
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

export function updateIntro(plan: Plan, intro: string): Plan {
  return { ...plan, intro };
}

export function updatePartner(plan: Plan, partnerName: string): Plan {
  return { ...plan, partnerName };
}

// ── Weeks ───────────────────────────────────────────────────────────────────

export function addWeek(
  plan: Plan,
  taken: Iterable<string>
): { plan: Plan; id: string } {
  const id = newPlanId("week", taken);
  return {
    plan: {
      ...plan,
      weeks: [...plan.weeks, { id, label: "", goal: "", tasks: [] }],
    },
    id,
  };
}

export function updateWeek(
  plan: Plan,
  weekId: string,
  patch: Partial<Pick<PlanWeek, "label" | "goal">>
): Plan {
  return {
    ...plan,
    weeks: plan.weeks.map(w => (w.id === weekId ? { ...w, ...patch } : w)),
  };
}

export function moveWeek(plan: Plan, weekId: string, dir: Direction): Plan {
  const at = plan.weeks.findIndex(w => w.id === weekId);
  const to = at < 0 ? -1 : nextVisible(plan.weeks, at, dir);
  return to < 0 ? plan : { ...plan, weeks: swap(plan.weeks, at, to) };
}

export function setWeekHidden(
  plan: Plan,
  weekId: string,
  hidden: boolean
): Plan {
  return {
    ...plan,
    weeks: plan.weeks.map(w => (w.id === weekId ? withHidden(w, hidden) : w)),
  };
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export function addTask(
  plan: Plan,
  weekId: string,
  taken: Iterable<string>
): { plan: Plan; id: string } {
  const id = newPlanId("task", taken);
  const task: PlanTask = { id, text: "", status: "pending" };
  return {
    plan: {
      ...plan,
      weeks: plan.weeks.map(w =>
        w.id === weekId ? { ...w, tasks: [...w.tasks, task] } : w
      ),
    },
    id,
  };
}

export function updateTask(plan: Plan, taskId: string, text: string): Plan {
  return {
    ...plan,
    weeks: plan.weeks.map(w =>
      w.tasks.some(t => t.id === taskId)
        ? {
            ...w,
            tasks: w.tasks.map(t => (t.id === taskId ? { ...t, text } : t)),
          }
        : w
    ),
  };
}

export function setTaskHidden(
  plan: Plan,
  taskId: string,
  hidden: boolean
): Plan {
  return {
    ...plan,
    weeks: plan.weeks.map(w =>
      w.tasks.some(t => t.id === taskId)
        ? {
            ...w,
            tasks: w.tasks.map(t =>
              t.id === taskId ? withHidden(t, hidden) : t
            ),
          }
        : w
    ),
  };
}

/**
 * Up or down one place among the visible tasks. At the edge of its week a
 * task crosses into the next visible week (to the end going up, the start
 * going down), so two buttons are enough to put any task anywhere.
 */
export function moveTask(plan: Plan, taskId: string, dir: Direction): Plan {
  const wi = plan.weeks.findIndex(w => w.tasks.some(t => t.id === taskId));
  if (wi < 0) return plan;
  const week = plan.weeks[wi];
  const ti = week.tasks.findIndex(t => t.id === taskId);
  const to = nextVisible(week.tasks, ti, dir);
  if (to >= 0) {
    const weeks = plan.weeks.slice();
    weeks[wi] = { ...week, tasks: swap(week.tasks, ti, to) };
    return { ...plan, weeks };
  }
  const wj = nextVisible(plan.weeks, wi, dir);
  if (wj < 0) return plan;
  const task = week.tasks[ti];
  const weeks = plan.weeks.slice();
  weeks[wi] = { ...week, tasks: week.tasks.filter(t => t.id !== taskId) };
  const target = weeks[wj];
  weeks[wj] = {
    ...target,
    tasks: dir < 0 ? [...target.tasks, task] : [task, ...target.tasks],
  };
  return { ...plan, weeks };
}

// ── Decisions ───────────────────────────────────────────────────────────────

export function addDecision(
  plan: Plan,
  taken: Iterable<string>
): { plan: Plan; id: string } {
  const id = newPlanId("dec", taken);
  return {
    plan: {
      ...plan,
      decisions: [
        ...plan.decisions,
        { id, title: "", description: "", options: [] },
      ],
    },
    id,
  };
}

export function updateDecision(
  plan: Plan,
  id: string,
  patch: Partial<
    Pick<PlanDecision, "title" | "description" | "options" | "linkedItem">
  >
): Plan {
  return {
    ...plan,
    decisions: plan.decisions.map(d => {
      if (d.id !== id) return d;
      const next = { ...d, ...patch };
      if (!next.linkedItem) delete next.linkedItem;
      return next;
    }),
  };
}

export function moveDecision(plan: Plan, id: string, dir: Direction): Plan {
  const at = plan.decisions.findIndex(d => d.id === id);
  const to = at < 0 ? -1 : nextVisible(plan.decisions, at, dir);
  return to < 0 ? plan : { ...plan, decisions: swap(plan.decisions, at, to) };
}

export function setDecisionHidden(
  plan: Plan,
  id: string,
  hidden: boolean
): Plan {
  return {
    ...plan,
    decisions: plan.decisions.map(d =>
      d.id === id ? withHidden(d, hidden) : d
    ),
  };
}

function withHidden<T extends { hidden?: boolean }>(
  item: T,
  hidden: boolean
): T {
  const next = { ...item };
  if (hidden) next.hidden = true;
  else delete next.hidden;
  return next;
}

// ── Saving ──────────────────────────────────────────────────────────────────

/**
 * The draft as it should be sent: an item ADDED in this edit and left blank
 * is dropped, because nobody meant to create it. A blank item the server
 * already holds stays, and the check then says it needs words, because
 * dropping that one would lose its stored state.
 */
export function withoutUntouchedNew(draft: Plan, saved: Plan): Plan {
  const known = new Set<string>();
  for (const w of saved.weeks) {
    known.add(w.id);
    for (const t of w.tasks) known.add(t.id);
  }
  for (const d of saved.decisions) known.add(d.id);
  const blank = (s: string) => s.trim() === "";
  const weeks = draft.weeks
    .map(w => ({
      ...w,
      tasks: w.tasks.filter(t => known.has(t.id) || !blank(t.text)),
    }))
    .filter(w => known.has(w.id) || !blank(w.label) || w.tasks.length > 0);
  const kept = new Set(weeks.flatMap(w => w.tasks.map(t => t.id)));
  const decisions = draft.decisions
    .filter(d => known.has(d.id) || !blank(d.title))
    .map(d => {
      // A link to a task that was itself dropped above would be refused.
      if (!d.linkedItem || kept.has(d.linkedItem)) return d;
      const next = { ...d };
      delete next.linkedItem;
      return next;
    });
  return { ...draft, weeks, decisions };
}

/** What a reader no longer sees, for the editor's Restore list. */
export function hiddenItems(
  plan: Plan
): Array<{ kind: "week" | "task" | "decision"; id: string; text: string }> {
  const out: Array<{
    kind: "week" | "task" | "decision";
    id: string;
    text: string;
  }> = [];
  for (const w of plan.weeks) {
    if (w.hidden) out.push({ kind: "week", id: w.id, text: w.label });
    else
      for (const t of w.tasks)
        if (t.hidden) out.push({ kind: "task", id: t.id, text: t.text });
  }
  for (const d of plan.decisions)
    if (d.hidden) out.push({ kind: "decision", id: d.id, text: d.title });
  return out;
}

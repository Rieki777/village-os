/**
 * THE COMMAND CENTRE'S BUILD PLAN, AS DATA (Rye, 2026-10-22: "editable").
 *
 * The plan used to be compiled into client/src/pages/ProjectHistory.tsx: six
 * dated weeks, their tasks, ten decisions, the build partner's name and the
 * intro line. Nothing about it could change without a deploy, and every task
 * id was a key the server already stored ticks, kanban cards, notes and
 * decision answers against, so the list could not change shape either.
 *
 * Now it is a field of the `journey-state` document, edited in place by an
 * admin. Three rules carry the stored state across:
 *
 *   1. THE DEFAULT IS TODAY'S PLAN WITH TODAY'S IDS. It lives on the server
 *      (server/lib/commandCentrePlanDefault.ts) and reaches the page only
 *      through the admin-gated read, so it no longer ships in a chunk any
 *      visitor can download.
 *   2. A NEW ITEM GETS A NEW ID (`newPlanId`), checked against every id the
 *      plan has ever held and every key the state already stores, so a new
 *      task can never inherit an old one's tick.
 *   3. REMOVING AN ITEM HIDES IT. `planProblems` refuses a plan that drops an
 *      id the current plan holds, so the route enforces it and not only the
 *      editor. The hidden item's stored state stays where it was, and
 *      restoring it brings its ticks and notes back.
 *
 * Both sides run the same check: the editor before it saves, the route before
 * it writes. One function, so the editor never accepts what the route refuses.
 */
import { charCount } from "./pageContent/resolve";

/**
 * THE VILLAGE-SIDE OWNER ID IS A PERSISTED VALUE AND KEEPS ITS SPELLING.
 * Every owner change writes it into `journey-state`, so renaming it would
 * silently reclassify every saved row. What a founder reads is their own
 * village's name, resolved at render.
 */
export const VILLAGE_OWNED = "amora" as const; // brand-ok: a persisted status id stored by every owner change, never shown

/** pending and done belong to the build partner; collab is both sides. */
export type DeliveryStatus =
  "pending" | "done" | typeof VILLAGE_OWNED | "collab";
export const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  "pending",
  "done",
  VILLAGE_OWNED,
  "collab",
];

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (
    typeof value === "string" &&
    (DELIVERY_STATUSES as readonly string[]).includes(value)
  );
}

export interface PlanTask {
  id: string;
  text: string;
  /** Who owns it until somebody picks another owner on the row. */
  status: DeliveryStatus;
  hidden?: boolean;
}

export interface PlanWeek {
  id: string;
  label: string;
  goal: string;
  tasks: PlanTask[];
  hidden?: boolean;
}

export interface PlanDecision {
  id: string;
  title: string;
  description: string;
  options: string[];
  /** A task id. Deciding moves that task to "In progress". */
  linkedItem?: string;
  hidden?: boolean;
}

export interface CommandCentrePlan {
  /** Bumped by every save, so a stale tab cannot overwrite a newer plan. */
  revision: number;
  intro: string;
  /** The build side's name on the owner pill, the legend and the dropdown. */
  partnerName: string;
  weeks: PlanWeek[];
  decisions: PlanDecision[];
}

/**
 * Every limit is at least the longest text today's plan carries, so the
 * default always fits. Proven by the route test against the real default.
 */
export const PLAN_LIMITS = {
  intro: 300,
  partnerName: 24,
  weekLabel: 40,
  weekGoal: 300,
  taskText: 240,
  decisionTitle: 100,
  decisionDescription: 600,
  option: 40,
  optionsPerDecision: 12,
  weeks: 30,
  tasksPerWeek: 80,
  tasks: 400,
  decisions: 60,
} as const;

/** Letters, digits and hyphens: every id today's plan carries has this shape. */
export const PLAN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

type Doc = Record<string, unknown>;
const isObject = (v: unknown): v is Doc =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Every id the plan holds, hidden ones included. */
export function planIds(
  plan: Pick<CommandCentrePlan, "weeks" | "decisions">
): Set<string> {
  const ids = new Set<string>();
  for (const week of plan.weeks) {
    ids.add(week.id);
    for (const task of week.tasks) ids.add(task.id);
  }
  for (const decision of plan.decisions) ids.add(decision.id);
  return ids;
}

/**
 * The stored plan over the default, field by field. A document written
 * before this field existed has no `plan`, so it reads as today's plan and
 * its stored ticks keep matching.
 */
export function resolvePlan(
  stored: unknown,
  fallback: CommandCentrePlan
): CommandCentrePlan {
  const own = isObject(stored) ? stored : {};
  const weeks = Array.isArray(own.weeks)
    ? own.weeks.filter(isObject).map(w => ({
        ...(w as unknown as PlanWeek),
        tasks: Array.isArray(w.tasks)
          ? (w.tasks.filter(isObject) as unknown as PlanTask[])
          : [],
      }))
    : fallback.weeks;
  const decisions = Array.isArray(own.decisions)
    ? own.decisions.filter(isObject).map(d => ({
        ...(d as unknown as PlanDecision),
        options: Array.isArray(d.options)
          ? d.options.filter((o): o is string => typeof o === "string")
          : [],
      }))
    : fallback.decisions;
  return {
    revision:
      typeof own.revision === "number" && Number.isFinite(own.revision)
        ? own.revision
        : 0,
    intro: typeof own.intro === "string" ? own.intro : fallback.intro,
    partnerName:
      typeof own.partnerName === "string" && own.partnerName.trim()
        ? own.partnerName
        : fallback.partnerName,
    weeks,
    decisions,
  };
}

/** Weeks and tasks a reader sees, in order. */
export function visibleWeeks(
  plan: Pick<CommandCentrePlan, "weeks">
): PlanWeek[] {
  return plan.weeks
    .filter(w => !w.hidden)
    .map(w => ({ ...w, tasks: w.tasks.filter(t => !t.hidden) }));
}

export interface PlacedTask extends PlanTask {
  weekId: string;
  weekLabel: string;
  weekGoal: string;
}

/** Every task a reader sees, flattened, carrying the week it sits in. */
export function visibleTasks(
  plan: Pick<CommandCentrePlan, "weeks">
): PlacedTask[] {
  return visibleWeeks(plan).flatMap(w =>
    w.tasks.map(t => ({
      ...t,
      weekId: w.id,
      weekLabel: w.label,
      weekGoal: w.goal,
    }))
  );
}

/**
 * A fresh id no item and no stored key has ever used. `taken` should hold the
 * plan's ids AND the state's keys: a task whose id matched an old checkbox
 * key would arrive already ticked.
 *
 * It always ends. A random draw that keeps colliding (a poor source, or a
 * test's fixed one) gets a counter appended until the id is free, rather
 * than looping on the same draw forever.
 */
export function newPlanId(
  prefix: string,
  taken: Iterable<string>,
  random: () => number = Math.random
): string {
  const used = new Set(taken);
  const draw = () =>
    `${prefix}-${Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, "0")}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = draw();
    if (!used.has(id)) return id;
  }
  const stem = draw();
  for (let n = 2; ; n += 1) {
    const id = `${stem}-${n}`;
    if (!used.has(id)) return id;
  }
}

function textProblem(
  value: unknown,
  max: number,
  where: string,
  required: boolean
): string | null {
  if (typeof value !== "string") return `${where} must be text.`;
  if (required && value.trim() === "") return `${where} needs some words.`;
  const n = charCount(value.trim());
  if (n > max)
    return `${where} is ${n} characters; the most it holds is ${max}.`;
  return null;
}

/**
 * What is wrong with a plan, in sentences a founder can act on. Empty means
 * it may be saved. With `current`, it also refuses a plan that drops an item
 * the current one holds: removing an item hides it.
 */
export function planProblems(
  next: unknown,
  current?: Pick<CommandCentrePlan, "weeks" | "decisions">
): string[] {
  if (!isObject(next)) return ["Send the plan as one object."];
  const problems: string[] = [];
  const push = (p: string | null) => {
    if (p) problems.push(p);
  };
  push(textProblem(next.intro, PLAN_LIMITS.intro, "The intro line", false));
  push(
    textProblem(
      next.partnerName,
      PLAN_LIMITS.partnerName,
      "The build partner's name",
      true
    )
  );

  const seen = new Set<string>();
  const taskIds = new Set<string>();
  const claim = (id: unknown, where: string): boolean => {
    if (typeof id !== "string" || !PLAN_ID.test(id)) {
      problems.push(`${where} has no usable id.`);
      return false;
    }
    if (seen.has(id)) {
      problems.push(`${where} repeats the id ${id}.`);
      return false;
    }
    seen.add(id);
    return true;
  };
  const hiddenOk = (v: unknown, where: string) => {
    if (v !== undefined && typeof v !== "boolean")
      problems.push(`${where} has a hidden mark that is not true or false.`);
  };

  if (!Array.isArray(next.weeks)) {
    problems.push("The weeks must be a list.");
  } else {
    if (next.weeks.length > PLAN_LIMITS.weeks)
      problems.push(
        `The plan has ${next.weeks.length} weeks; the most it holds is ${PLAN_LIMITS.weeks}.`
      );
    let total = 0;
    next.weeks.forEach((week, wi) => {
      const where = `Week ${wi + 1}`;
      if (!isObject(week)) {
        problems.push(`${where} must be a week.`);
        return;
      }
      claim(week.id, where);
      push(
        textProblem(week.label, PLAN_LIMITS.weekLabel, `${where}'s label`, true)
      );
      push(
        textProblem(week.goal, PLAN_LIMITS.weekGoal, `${where}'s goal`, false)
      );
      hiddenOk(week.hidden, where);
      if (!Array.isArray(week.tasks)) {
        problems.push(`${where}'s tasks must be a list.`);
        return;
      }
      if (week.tasks.length > PLAN_LIMITS.tasksPerWeek) {
        problems.push(
          `${where} has ${week.tasks.length} tasks; the most a week holds is ${PLAN_LIMITS.tasksPerWeek}.`
        );
      }
      total += week.tasks.length;
      week.tasks.forEach((task, ti) => {
        const at = `${where}, task ${ti + 1}`;
        if (!isObject(task)) {
          problems.push(`${at} must be a task.`);
          return;
        }
        if (claim(task.id, at)) taskIds.add(task.id as string);
        push(textProblem(task.text, PLAN_LIMITS.taskText, at, true));
        if (!isDeliveryStatus(task.status))
          problems.push(`${at} has an owner this page does not know.`);
        hiddenOk(task.hidden, at);
      });
    });
    if (total > PLAN_LIMITS.tasks)
      problems.push(
        `The plan has ${total} tasks; the most it holds is ${PLAN_LIMITS.tasks}.`
      );
  }

  if (!Array.isArray(next.decisions)) {
    problems.push("The decisions must be a list.");
  } else {
    if (next.decisions.length > PLAN_LIMITS.decisions) {
      problems.push(
        `The plan has ${next.decisions.length} decisions; the most it holds is ${PLAN_LIMITS.decisions}.`
      );
    }
    next.decisions.forEach((decision, di) => {
      const where = `Decision ${di + 1}`;
      if (!isObject(decision)) {
        problems.push(`${where} must be a decision.`);
        return;
      }
      claim(decision.id, where);
      push(
        textProblem(
          decision.title,
          PLAN_LIMITS.decisionTitle,
          `${where}'s title`,
          true
        )
      );
      push(
        textProblem(
          decision.description,
          PLAN_LIMITS.decisionDescription,
          `${where}'s description`,
          false
        )
      );
      hiddenOk(decision.hidden, where);
      if (!Array.isArray(decision.options)) {
        problems.push(`${where}'s options must be a list.`);
      } else {
        if (decision.options.length > PLAN_LIMITS.optionsPerDecision) {
          problems.push(
            `${where} has ${decision.options.length} options; the most it holds is ${PLAN_LIMITS.optionsPerDecision}.`
          );
        }
        decision.options.forEach((o, oi) =>
          push(
            textProblem(
              o,
              PLAN_LIMITS.option,
              `${where}, option ${oi + 1}`,
              true
            )
          )
        );
      }
      if (decision.linkedItem !== undefined && decision.linkedItem !== "") {
        if (typeof decision.linkedItem !== "string")
          problems.push(`${where} links to something that is not a task.`);
      }
    });
    // Checked after every task is known, so a decision may link to a task in
    // any week.
    next.decisions.forEach((decision, di) => {
      if (
        isObject(decision) &&
        typeof decision.linkedItem === "string" &&
        decision.linkedItem !== "" &&
        !taskIds.has(decision.linkedItem)
      ) {
        problems.push(
          `Decision ${di + 1} links to a task the plan does not hold.`
        );
      }
    });
  }

  if (current && problems.length === 0) {
    planIds(current).forEach(id => {
      if (!seen.has(id)) {
        problems.push(
          `The item ${id} is missing. Removing an item hides it, so its ticks and notes stay; send it back marked hidden.`
        );
      }
    });
  }
  return problems;
}

/**
 * Exactly the fields this page reads, trimmed, so a write can never park an
 * unknown key in the document. Run only on a plan `planProblems` accepted.
 */
export function cleanPlan(
  plan: Omit<CommandCentrePlan, "revision">
): Omit<CommandCentrePlan, "revision"> {
  const hidden = (h: unknown) => (h === true ? { hidden: true } : {});
  return {
    intro: plan.intro.trim(),
    partnerName: plan.partnerName.trim(),
    weeks: plan.weeks.map(w => ({
      id: w.id,
      label: w.label.trim(),
      goal: w.goal.trim(),
      tasks: w.tasks.map(t => ({
        id: t.id,
        text: t.text.trim(),
        status: t.status,
        ...hidden(t.hidden),
      })),
      ...hidden(w.hidden),
    })),
    decisions: plan.decisions.map(d => ({
      id: d.id,
      title: d.title.trim(),
      description: d.description.trim(),
      options: d.options.map(o => o.trim()),
      ...(d.linkedItem ? { linkedItem: d.linkedItem } : {}),
      ...hidden(d.hidden),
    })),
  };
}

/** What is wrong with a map of owner choices, keyed by task id. */
export function ownersProblems(owners: unknown): string[] {
  if (!isObject(owners))
    return ["Send the owners as one object, task id to owner."];
  const entries = Object.entries(owners);
  if (entries.length > PLAN_LIMITS.tasks)
    return [
      `That is ${entries.length} owners; the plan holds at most ${PLAN_LIMITS.tasks} tasks.`,
    ];
  const problems: string[] = [];
  for (const [id, status] of entries) {
    if (!PLAN_ID.test(id))
      problems.push(`${id.slice(0, 64)} is not a task id.`);
    else if (!isDeliveryStatus(status))
      problems.push(`${id} has an owner this page does not know.`);
  }
  return problems;
}

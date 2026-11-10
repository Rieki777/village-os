/**
 * THE GOALS A CANDIDATE LISTS IN A ROLE PROPOSAL (joining lane, PR 1; the
 * lead, 10 Nov 2026).
 *
 * In a proposal the candidate lists GOALS for their first moon. Tasks are a
 * different thing: they are issued on the holder's profile each moon once they
 * are seated, and both are tracked for the holder's compensation. A goal has a
 * title and a "done when" so anyone can check it without asking, the role goal
 * it moves, optionally the season goal it serves, and optionally a day in this
 * moon. Three to five is the aim; fewer or more earns a gentle prompt and
 * never a refusal; eight is the cap; one is the least.
 *
 * Nothing here counts a share, a percentage or an amount. The goals together
 * are the value of the moon's contract, and that is all the candidate is told.
 *
 * ONE SHAPE, TWO DOORS. The open form keeps its goals on each role card
 * (`firstMoon`, shared/openProposalCard.ts); the member door keeps them in the
 * application's `answers.goals` (shared/seatApplications.ts, no migration: the
 * answers are JSON). Both read this file, so a goal is judged the same way
 * whichever door it came through.
 */

export const GOAL_LIMITS = { min: 1, aimMin: 3, aimMax: 5, max: 8, title: 160, doneWhen: 200, text: 300 } as const;

/** The days ahead of today a goal's date may fall: one moon, with a little room. */
export const GOAL_DATE_DAYS = { before: 1, after: 31 } as const;

export interface ProposalGoal {
  title: string;
  doneWhen: string;
  /** The role goal this one moves, in the role's own words. Empty when the role has set none. */
  moves: string;
  /** The season goal it serves: an id on the open form, its words on the member door. Empty when none. */
  serves: string;
  /** A day in this moon, YYYY-MM-DD, or empty. */
  date: string;
  /** Which role it belongs to, when one proposal names several. Empty for a single role. */
  roleId: string;
}

export const BLANK_GOAL: ProposalGoal = { title: "", doneWhen: "", moves: "", serves: "", date: "", roleId: "" };

export const GOAL_WORDS = {
  notAList: "Send your goals as a list.",
  needOne: "Add at least one goal for your first moon.",
  tooMany: `Up to ${GOAL_LIMITS.max} goals for a role.`,
  badGoal: "One of your goals could not be read.",
  needTitle: (n: number) => `Name goal ${n}.`,
  needDoneWhen: (n: number) => `Say when goal ${n} is done.`,
  tooLong: (what: string, n: number) => `${what} is too long. Keep it under ${n} characters.`,
  notTheRole: (n: number) => `Goal ${n} moves a goal this role does not have. Pick one from the role's own goals.`,
  notASeasonGoal: (n: number) => `Goal ${n} names a season goal this season does not have.`,
  badDate: (n: number) => `Write the date for goal ${n} as a day, like 2026-11-16.`,
  dateOutside: (n: number) => `The date for goal ${n} falls outside this moon.`,
  notThisProposal: (n: number) => `Goal ${n} names a role that is not in this proposal.`,
} as const;

const CIVIL_DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The first and last day a goal may be dated, from today's civil day. */
export function goalDateWindow(today: string): { min: string; max: string } {
  return { min: addDays(today, -GOAL_DATE_DAYS.before), max: addDays(today, GOAL_DATE_DAYS.after) };
}

/** A real calendar day written YYYY-MM-DD. */
export function isCivilDay(v: string): boolean {
  return CIVIL_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && addDays(v, 0) === v;
}

export interface GoalContext {
  /** The role goals a role holds, in its words. A role that has set none keeps `moves` empty. Absent: `moves` is not checked (the caller cannot see the roles). */
  roleGoalsOf?: (roleId: string) => readonly string[];
  /** The roles this proposal names. When given, a goal's `roleId` must be one of them. */
  roleIds?: ReadonlySet<string>;
  /** The season goals a goal may serve. Absent: not checked (the member door sends their words). */
  seasonKeys?: ReadonlySet<string> | null;
  /** Today's civil day; when given, a goal's date must fall within a moon of it. */
  today?: string;
  /** At least this many goals. One by default. */
  min?: number;
}

export type GoalsParsed = { ok: true; goals: ProposalGoal[] } | { ok: false; error: string };

/** Goals as a form sent them, checked. The first problem is answered; a wholly blank row is dropped. */
export function parseGoals(raw: unknown, ctx: GoalContext = {}): GoalsParsed {
  if (!Array.isArray(raw)) return { ok: false, error: GOAL_WORDS.notAList };
  const L = GOAL_LIMITS;
  const goals: ProposalGoal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: GOAL_WORDS.badGoal };
    const o = item as Record<string, unknown>;
    const g: ProposalGoal = {
      title: text(o.title),
      doneWhen: text(o.doneWhen),
      moves: text(o.moves),
      serves: text(o.serves),
      date: text(o.date),
      roleId: text(o.roleId),
    };
    if (!g.title && !g.doneWhen && !g.moves && !g.serves && !g.date) continue;
    const n = goals.length + 1;
    if (!g.title) return { ok: false, error: GOAL_WORDS.needTitle(n) };
    if (g.title.length > L.title) return { ok: false, error: GOAL_WORDS.tooLong("A goal", L.title) };
    if (!g.doneWhen) return { ok: false, error: GOAL_WORDS.needDoneWhen(n) };
    if (g.doneWhen.length > L.doneWhen) return { ok: false, error: GOAL_WORDS.tooLong("Done when", L.doneWhen) };
    if (g.moves.length > L.text || g.serves.length > L.text) return { ok: false, error: GOAL_WORDS.badGoal };
    if (ctx.roleIds && ctx.roleIds.size > 0 && g.roleId && !ctx.roleIds.has(g.roleId)) return { ok: false, error: GOAL_WORDS.notThisProposal(n) };
    if (g.moves && ctx.roleGoalsOf) {
      const own = (ctx.roleGoalsOf(g.roleId) ?? []).map((x) => x.trim());
      if (!own.includes(g.moves)) return { ok: false, error: GOAL_WORDS.notTheRole(n) };
    }
    if (g.serves && ctx.seasonKeys && !ctx.seasonKeys.has(g.serves)) return { ok: false, error: GOAL_WORDS.notASeasonGoal(n) };
    if (g.date) {
      if (!isCivilDay(g.date)) return { ok: false, error: GOAL_WORDS.badDate(n) };
      if (ctx.today) {
        const w = goalDateWindow(ctx.today);
        if (g.date < w.min || g.date > w.max) return { ok: false, error: GOAL_WORDS.dateOutside(n) };
      }
    }
    goals.push(g);
    // The cap is for each role: one proposal for several roles lists up to the cap under each.
    if (goals.filter((x) => x.roleId === g.roleId).length > L.max) return { ok: false, error: GOAL_WORDS.tooMany };
  }
  if (goals.length < (ctx.min ?? L.min)) return { ok: false, error: GOAL_WORDS.needOne };
  return { ok: true, goals };
}

/** Whether a count sits outside three to five: a gentle prompt, never a refusal. Null inside it and for none. */
export function goalsNudge(count: number, roles = 1): "few" | "many" | null {
  if (count <= 0) return null;
  if (count < GOAL_LIMITS.aimMin * roles) return "few";
  if (count > GOAL_LIMITS.aimMax * roles) return "many";
  return null;
}

/** An older proposal's single block of words, read as one goal. Empty text is no goal. */
export function legacyGoals(words: unknown): ProposalGoal[] {
  const s = text(words);
  return s ? [{ ...BLANK_GOAL, title: s }] : [];
}

/** The goals as plain lines, for the field older readers still show (`deliverables`), within `max` characters. */
export function goalsAsText(goals: readonly ProposalGoal[], max = 2000): string {
  const out = goals.map((g) => `- ${g.title}${g.doneWhen ? `, done when ${g.doneWhen}` : ""}`).join("\n");
  return out.length > max ? `${out.slice(0, max - 3)}...` : out;
}

/** A stored list read back safely: anything malformed is dropped, nothing throws. */
export function goalsOf(raw: unknown): ProposalGoal[] {
  if (!Array.isArray(raw)) return [];
  const cut = (v: unknown, n: number) => text(v).slice(0, n);
  return raw
    .filter((g) => g && typeof g === "object")
    .slice(0, GOAL_LIMITS.max * 3)
    .map((g: any) => ({
      title: cut(g.title, GOAL_LIMITS.title),
      doneWhen: cut(g.doneWhen, GOAL_LIMITS.doneWhen),
      moves: cut(g.moves, GOAL_LIMITS.text),
      serves: cut(g.serves, GOAL_LIMITS.text),
      date: isCivilDay(text(g.date)) ? text(g.date) : "",
      roleId: cut(g.roleId, 128),
    }))
    .filter((g) => g.title);
}

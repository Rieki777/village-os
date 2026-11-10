/**
 * THE APPLICANT'S OWN ROLE CARD, the bridge between two cards (Rye, 9 Nov
 * 2026): "The finance card is the organisation's lens on what it needs from a
 * person. My role application card shows what it looks like when someone has
 * applied ... walk them through the difference between my role proposal card
 * and the open role card. See the delta, and understand what this process is
 * doing."
 *
 * For each section of the open role card the applicant answers with the
 * matching section of their own, in the shape of a member's season card:
 *
 *   the role's outcomes (accountabilities)  ->  what I'll move, with a target
 *   the first 90 days                       ->  my first moon's goals, each
 *                                               with a "Done when" test
 *   the season's goals for the village      ->  which my work serves, and how
 *   the hours                               ->  what I can give
 *   the agreements                          ->  the NDA once approved. The
 *                                               Love Letter is no tick here: the
 *                                               applicant ALIGNS with it on the form
 *                                               (the proposal's own `membership`,
 *                                               Rye's answer 8, 9 Nov 2026)
 *
 * It rides in the open proposal's own JSON body (no table of its own), is
 * shown to whoever decides beside the open card with the gaps marked
 * (client/src/pages/OpenProposal.tsx), and on adoption becomes the role
 * application's own words (`cardSummary`, server/lib/openProposalDecide.ts).
 */

import { GOAL_LIMITS, goalsOf, parseGoals } from "./proposalGoals";

export const CARD_LIMITS = {
  movesPerRole: 3,
  moveText: 200,
  target: 120,
  questsPerRole: GOAL_LIMITS.max,
  quest: GOAL_LIMITS.title,
  doneWhen: GOAL_LIMITS.doneWhen,
  serves: 3,
  how: 200,
  hours: 80,
  timeZone: 64,
  termsNote: 600,
} as const;

/**
 * The usual windows a person can meet in, by part of the week and day (brief
 * v2, 5.4). Fixed keys, so the reviewer's view and any later booking read one
 * vocabulary; the words are the form's.
 */
export const CARD_WINDOWS = ["weekday-mornings", "weekday-afternoons", "weekday-evenings", "weekend-mornings", "weekend-afternoons", "weekend-evenings"] as const;
export type CardWindow = (typeof CARD_WINDOWS)[number];

/** The terms on offer: accepted as they stand, or a wish to talk about them (flagged to every reviewer). */
export interface CardTerms {
  choice: "accept" | "talk";
  note: string;
}

const CIVIL_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether the runtime knows this IANA time zone. */
export function isTimeZone(tz: string): boolean {
  if (!tz || tz.length > CARD_LIMITS.timeZone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * One goal for the first moon (joining lane PR 1). Stored under `firstMoon`,
 * with `quest` as its title, so a card sent before goals grew fields reads as it
 * always did. `moves` is the role goal it moves, `serves` the season goal's id,
 * `date` a day in this moon; each absent when the candidate left it.
 */
export interface FirstMoonGoal {
  quest: string;
  doneWhen: string;
  moves?: string;
  serves?: string;
  date?: string;
}

export interface OpenProposalCard {
  roles: Array<{ roleId: string; moves: Array<{ text: string; target: string }>; firstMoon: FirstMoonGoal[] }>;
  /**
   * `goal` is the goal's words when the proposal was sent, written by the server, never the form.
   * `roleId`: the role card the pick was made on (guide v2). Absent on a card sent before that, which named goals once for all its roles.
   */
  serves: Array<{ goalId: string; how: string; goal?: string; roleId?: string }>;
  hours: string;
  /**
   * `loveLetter` is kept as stored on a card sent before the alignment replaced
   * the tick, and read by nothing that decides: the proposal's `membership` is
   * the record now.
   */
  agreed: { loveLetter: boolean; nda: boolean };
  /** Form v2 (brief v2, 5.4). Optional on a card sent before them. */
  timeZone?: string;
  windows?: CardWindow[];
  earliestStart?: string;
  terms?: CardTerms;
}

export interface CardContext {
  /** The roles this proposal names. */
  roleIds: ReadonlySet<string>;
  /** A role's own outcomes, as the chart writes them; empty when it lists none. */
  accountabilitiesOf: (roleId: string) => readonly string[];
  /** The season's goals for the village, by id. */
  goalIds: ReadonlySet<string>;
  /** Today's civil day, so a goal's date can be held to this moon. Absent: the date is only read as a day. */
  today?: string;
}

export const CARD_WORDS = {
  agreed: "Tick that you will align with the village's confidentiality agreement once you are approved.",
  notTheRole: "Pick what you will move from the role's own goals.",
  notThisProposal: "A season goal was picked for a role that is not in this proposal.",
  notAGoal: "Pick goals from this season's goals for the village.",
  tooMany: (what: string, n: number) => `Up to ${n} ${what}.`,
  tooLong: (what: string, n: number) => `${what} is too long. Keep it under ${n} characters.`,
  unknownRole: "Your card names a role that is not in this proposal.",
  needGoal: "Pick at least one of the village's goals for the season that your work serves.",
  badTimeZone: "Pick your time zone from the list.",
  badWindow: "Pick your usual times from the list.",
  badDate: "Write the earliest start as a date, like 2026-11-16.",
  needTerms: "Say whether you accept the terms on offer, or would like to talk about them.",
  needTermsNote: "Say what you would like to talk about in the terms.",
} as const;

type Parsed = { ok: true; card: OpenProposalCard } | { ok: false; field: string; error: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A card as the form sent it, checked against the proposal's roles and the season. The first problem is answered. */
export function parseCard(raw: unknown, ctx: CardContext): Parsed {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const L = CARD_LIMITS;
  const roles: OpenProposalCard["roles"] = [];
  for (const r of list(o.roles) as any[]) {
    const roleId = str(r?.roleId);
    if (!ctx.roleIds.has(roleId)) return { ok: false, field: "card", error: CARD_WORDS.unknownRole };
    const own = ctx.accountabilitiesOf(roleId).map((a) => a.trim());
    const moves: OpenProposalCard["roles"][number]["moves"] = [];
    for (const m of list(r?.moves) as any[]) {
      const text = str(m?.text);
      const target = str(m?.target);
      if (!text) continue;
      if (text.length > L.moveText) return { ok: false, field: "card", error: CARD_WORDS.tooLong("What you will move", L.moveText) };
      if (target.length > L.target) return { ok: false, field: "card", error: CARD_WORDS.tooLong("A target", L.target) };
      if (own.length && !own.includes(text)) return { ok: false, field: "card", error: CARD_WORDS.notTheRole };
      if (!moves.some((x) => x.text === text)) moves.push({ text, target });
    }
    if (moves.length > L.movesPerRole) return { ok: false, field: "card", error: CARD_WORDS.tooMany("outcomes a role", L.movesPerRole) };
    // Joining lane PR 1: the first moon's goals, one to eight, each judged by the shared goal rules.
    const asked = list(r?.firstMoon).map((q: any) => ({ title: q?.quest, doneWhen: q?.doneWhen, moves: q?.moves, serves: q?.serves, date: q?.date, roleId }));
    const parsedGoals = parseGoals(asked, { roleGoalsOf: () => own, seasonKeys: ctx.goalIds, today: ctx.today });
    if (!parsedGoals.ok) return { ok: false, field: "card", error: parsedGoals.error };
    const firstMoon: FirstMoonGoal[] = parsedGoals.goals.map((g) => ({
      quest: g.title,
      doneWhen: g.doneWhen,
      ...(g.moves ? { moves: g.moves } : {}),
      ...(g.serves ? { serves: g.serves } : {}),
      ...(g.date ? { date: g.date } : {}),
    }));
    if (!roles.some((x) => x.roleId === roleId)) roles.push({ roleId, moves, firstMoon });
  }
  const serves: OpenProposalCard["serves"] = [];
  for (const s of list(o.serves) as any[]) {
    const goalId = str(s?.goalId);
    const how = str(s?.how);
    // Guide v2: a pick made on a role card names its role, which must be one of this card's.
    const roleId = str(s?.roleId);
    if (!goalId) continue;
    if (!ctx.goalIds.has(goalId)) return { ok: false, field: "card", error: CARD_WORDS.notAGoal };
    if (roleId && !roles.some((r) => r.roleId === roleId)) return { ok: false, field: "card", error: CARD_WORDS.notThisProposal };
    if (how.length > L.how) return { ok: false, field: "card", error: CARD_WORDS.tooLong("How it serves", L.how) };
    if (!serves.some((x) => x.goalId === goalId && (x.roleId ?? "") === roleId)) serves.push({ goalId, how, ...(roleId ? { roleId } : {}) });
  }
  // Up to the limit for each role card, and for the one list a card sent before goals went on each role.
  const perRole = new Map<string, number>();
  for (const x of serves) perRole.set(x.roleId ?? "", (perRole.get(x.roleId ?? "") ?? 0) + 1);
  if (Array.from(perRole.values()).some((n) => n > L.serves)) return { ok: false, field: "card", error: CARD_WORDS.tooMany("goals", L.serves) };
  // Form v2: at least one of the season's goals, when the season has any (brief v2, 5.4; Rye's D9).
  if (ctx.goalIds.size > 0 && serves.length === 0) return { ok: false, field: "serves", error: CARD_WORDS.needGoal };
  const timeZone = str(o.timeZone);
  if (timeZone && !isTimeZone(timeZone)) return { ok: false, field: "timeZone", error: CARD_WORDS.badTimeZone };
  const windows: CardWindow[] = [];
  for (const w of list(o.windows)) {
    if (typeof w !== "string" || !(CARD_WINDOWS as readonly string[]).includes(w)) return { ok: false, field: "windows", error: CARD_WORDS.badWindow };
    if (!windows.includes(w as CardWindow)) windows.push(w as CardWindow);
  }
  const earliestStart = str(o.earliestStart);
  if (earliestStart && !CIVIL_DAY.test(earliestStart)) return { ok: false, field: "earliestStart", error: CARD_WORDS.badDate };
  const t = o.terms && typeof o.terms === "object" ? (o.terms as Record<string, unknown>) : null;
  const choice = t?.choice === "accept" || t?.choice === "talk" ? t.choice : null;
  const note = str(t?.note);
  if (!choice) return { ok: false, field: "terms", error: CARD_WORDS.needTerms };
  if (choice === "talk" && !note) return { ok: false, field: "terms", error: CARD_WORDS.needTermsNote };
  if (note.length > L.termsNote) return { ok: false, field: "terms", error: CARD_WORDS.tooLong("Your note on the terms", L.termsNote) };
  const hours = str(o.hours);
  if (hours.length > L.hours) return { ok: false, field: "card", error: CARD_WORDS.tooLong("Your hours", L.hours) };
  const agreed = o.agreed && typeof o.agreed === "object" ? (o.agreed as Record<string, unknown>) : {};
  // Only the NDA is ticked here. A Love Letter tick from a form sent before the alignment replaced it is kept, never asked.
  if (agreed.nda !== true) return { ok: false, field: "agreed", error: CARD_WORDS.agreed };
  return {
    ok: true,
    card: {
      roles,
      serves,
      hours,
      agreed: { loveLetter: agreed.loveLetter === true, nda: true },
      ...(timeZone ? { timeZone } : {}),
      ...(windows.length ? { windows } : {}),
      ...(earliestStart ? { earliestStart } : {}),
      terms: { choice, note },
    },
  };
}

/** A stored card, read back safely; anything that is not one is no card. Never throws. */
export function cardOf(raw: unknown): OpenProposalCard | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.roles)) return undefined;
  const cut = (v: unknown, n: number) => str(v).slice(0, n);
  const L = CARD_LIMITS;
  return {
    roles: (o.roles as any[])
      .filter((r) => r && typeof r.roleId === "string")
      .map((r) => ({
        roleId: String(r.roleId),
        moves: list(r.moves).slice(0, L.movesPerRole).map((m: any) => ({ text: cut(m?.text, L.moveText), target: cut(m?.target, L.target) })).filter((m) => m.text),
        firstMoon: goalsOf(list(r.firstMoon).map((q: any) => ({ title: q?.quest, doneWhen: q?.doneWhen, moves: q?.moves, serves: q?.serves, date: q?.date }))).map((g) => ({
          quest: g.title,
          doneWhen: g.doneWhen,
          ...(g.moves ? { moves: g.moves } : {}),
          ...(g.serves ? { serves: g.serves } : {}),
          ...(g.date ? { date: g.date } : {}),
        })),
      })),
    serves: list(o.serves)
      .slice(0, L.serves * 3) // three role cards at most (D3)
      .map((s: any) => ({
        goalId: cut(s?.goalId, 64),
        how: cut(s?.how, L.how),
        ...(str(s?.goal) ? { goal: cut(s?.goal, 300) } : {}),
        ...(str(s?.roleId) ? { roleId: cut(s?.roleId, 128) } : {}),
      }))
      .filter((s) => s.goalId),
    hours: cut(o.hours, L.hours),
    agreed: { loveLetter: (o.agreed as any)?.loveLetter === true, nda: (o.agreed as any)?.nda === true },
    ...(isTimeZone(str(o.timeZone)) ? { timeZone: str(o.timeZone) } : {}),
    ...(list(o.windows).some((w) => (CARD_WINDOWS as readonly unknown[]).includes(w))
      ? { windows: list(o.windows).filter((w): w is CardWindow => (CARD_WINDOWS as readonly unknown[]).includes(w)) }
      : {}),
    ...(CIVIL_DAY.test(str(o.earliestStart)) ? { earliestStart: str(o.earliestStart) } : {}),
    ...((o.terms as any)?.choice === "accept" || (o.terms as any)?.choice === "talk"
      ? { terms: { choice: (o.terms as any).choice as CardTerms["choice"], note: cut((o.terms as any).note, L.termsNote) } }
      : {}),
  };
}

/** The card as the role application's own words, within its 2000 characters. */
export function cardSummary(card: OpenProposalCard, roleName: (id: string) => string, goalText: (id: string) => string): string {
  const lines: string[] = [];
  for (const r of card.roles) {
    lines.push(roleName(r.roleId));
    for (const m of r.moves) lines.push(`- I'll move: ${m.text}${m.target ? ` (${m.target})` : ""}`);
    for (const q of r.firstMoon) lines.push(`- Goal: ${q.quest}${q.doneWhen ? `: done when ${q.doneWhen}` : ""}${q.moves ? `. Moves: ${q.moves}` : ""}${q.date ? `. By ${q.date}` : ""}`);
    // Guide v2: the season goals this role's work serves, under the role.
    for (const s of card.serves.filter((x) => x.roleId === r.roleId)) lines.push(`- Serves the season goal: ${goalText(s.goalId)}${s.how ? `: ${s.how}` : ""}`);
  }
  const once = card.serves.filter((x) => !x.roleId);
  if (once.length) {
    lines.push("Serves the season's goals:");
    for (const s of once) lines.push(`- ${goalText(s.goalId)}${s.how ? `: ${s.how}` : ""}`);
  }
  if (card.hours) lines.push(`Time I can give: ${card.hours}`);
  if (card.timeZone) lines.push(`Time zone: ${card.timeZone}`);
  if (card.windows?.length) lines.push(`Usual times: ${card.windows.join(", ")}`);
  if (card.earliestStart) lines.push(`Earliest start: ${card.earliestStart}`);
  if (card.terms?.choice === "talk") lines.push(`Wants to talk about the terms: ${card.terms.note}`);
  else if (card.terms?.choice === "accept") lines.push("Accepts the terms on offer.");
  const text = lines.join("\n");
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}

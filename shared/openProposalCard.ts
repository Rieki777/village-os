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
 *   the first 90 days                       ->  my first moon's quests, each
 *                                               with a "Done when" test
 *   the season's goals for the village      ->  which my work serves, and how
 *   the hours                               ->  what I can give
 *   the agreements                          ->  the Love Letter before seating,
 *                                               the NDA once approved
 *
 * It rides in the open proposal's own JSON body (no table of its own), is
 * shown to whoever decides beside the open card with the gaps marked
 * (client/src/pages/OpenProposal.tsx), and on adoption becomes the role
 * application's own words (`cardSummary`, server/lib/openProposalDecide.ts).
 */

export const CARD_LIMITS = {
  movesPerRole: 3,
  moveText: 200,
  target: 120,
  questsPerRole: 3,
  quest: 160,
  doneWhen: 200,
  serves: 3,
  how: 200,
  hours: 80,
} as const;

export interface OpenProposalCard {
  roles: Array<{ roleId: string; moves: Array<{ text: string; target: string }>; firstMoon: Array<{ quest: string; doneWhen: string }> }>;
  /** `goal` is the goal's words when the proposal was sent, written by the server, never the form. */
  serves: Array<{ goalId: string; how: string; goal?: string }>;
  hours: string;
  agreed: { loveLetter: boolean; nda: boolean };
}

export interface CardContext {
  /** The roles this proposal names. */
  roleIds: ReadonlySet<string>;
  /** A role's own outcomes, as the chart writes them; empty when it lists none. */
  accountabilitiesOf: (roleId: string) => readonly string[];
  /** The season's goals for the village, by id. */
  goalIds: ReadonlySet<string>;
}

export const CARD_WORDS = {
  agreed: "Tick that you will sign the Love Letter before you are seated, and the NDA once you are approved.",
  notTheRole: "Pick what you will move from the role's own outcomes.",
  notAGoal: "Pick goals from this season's goals for the village.",
  tooMany: (what: string, n: number) => `Up to ${n} ${what}.`,
  tooLong: (what: string, n: number) => `${what} is too long. Keep it under ${n} characters.`,
  unknownRole: "Your card names a role that is not in this proposal.",
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
    const firstMoon: OpenProposalCard["roles"][number]["firstMoon"] = [];
    for (const q of list(r?.firstMoon) as any[]) {
      const quest = str(q?.quest);
      const doneWhen = str(q?.doneWhen);
      if (!quest) continue;
      if (quest.length > L.quest) return { ok: false, field: "card", error: CARD_WORDS.tooLong("A quest", L.quest) };
      if (doneWhen.length > L.doneWhen) return { ok: false, field: "card", error: CARD_WORDS.tooLong("Done when", L.doneWhen) };
      firstMoon.push({ quest, doneWhen });
    }
    if (firstMoon.length > L.questsPerRole) return { ok: false, field: "card", error: CARD_WORDS.tooMany("quests a role", L.questsPerRole) };
    if (!roles.some((x) => x.roleId === roleId)) roles.push({ roleId, moves, firstMoon });
  }
  const serves: OpenProposalCard["serves"] = [];
  for (const s of list(o.serves) as any[]) {
    const goalId = str(s?.goalId);
    const how = str(s?.how);
    if (!goalId) continue;
    if (!ctx.goalIds.has(goalId)) return { ok: false, field: "card", error: CARD_WORDS.notAGoal };
    if (how.length > L.how) return { ok: false, field: "card", error: CARD_WORDS.tooLong("How it serves", L.how) };
    if (!serves.some((x) => x.goalId === goalId)) serves.push({ goalId, how });
  }
  if (serves.length > L.serves) return { ok: false, field: "card", error: CARD_WORDS.tooMany("goals", L.serves) };
  const hours = str(o.hours);
  if (hours.length > L.hours) return { ok: false, field: "card", error: CARD_WORDS.tooLong("Your hours", L.hours) };
  const agreed = o.agreed && typeof o.agreed === "object" ? (o.agreed as Record<string, unknown>) : {};
  if (agreed.loveLetter !== true || agreed.nda !== true) return { ok: false, field: "agreed", error: CARD_WORDS.agreed };
  return { ok: true, card: { roles, serves, hours, agreed: { loveLetter: true, nda: true } } };
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
        firstMoon: list(r.firstMoon).slice(0, L.questsPerRole).map((q: any) => ({ quest: cut(q?.quest, L.quest), doneWhen: cut(q?.doneWhen, L.doneWhen) })).filter((q) => q.quest),
      })),
    serves: list(o.serves)
      .slice(0, L.serves)
      .map((s: any) => ({ goalId: cut(s?.goalId, 64), how: cut(s?.how, L.how), ...(str(s?.goal) ? { goal: cut(s?.goal, 300) } : {}) }))
      .filter((s) => s.goalId),
    hours: cut(o.hours, L.hours),
    agreed: { loveLetter: (o.agreed as any)?.loveLetter === true, nda: (o.agreed as any)?.nda === true },
  };
}

/** The card as the role application's own words, within its 2000 characters. */
export function cardSummary(card: OpenProposalCard, roleName: (id: string) => string, goalText: (id: string) => string): string {
  const lines: string[] = [];
  for (const r of card.roles) {
    lines.push(roleName(r.roleId));
    for (const m of r.moves) lines.push(`- I'll move: ${m.text}${m.target ? ` (${m.target})` : ""}`);
    for (const q of r.firstMoon) lines.push(`- First moon: ${q.quest}${q.doneWhen ? `: done when ${q.doneWhen}` : ""}`);
  }
  if (card.serves.length) {
    lines.push("Serves the season's goals:");
    for (const s of card.serves) lines.push(`- ${goalText(s.goalId)}${s.how ? `: ${s.how}` : ""}`);
  }
  if (card.hours) lines.push(`Time I can give: ${card.hours}`);
  const text = lines.join("\n");
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}

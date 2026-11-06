/**
 * Sera's quest feed (list_quest_proposals): the mapping onto this village's
 * quest proposal shape, and the counts a steward sees. Pure, so it is tested
 * without a service.
 *
 * Difficulty: Sera says Easy | Moderate | Involved; this village's quests use
 * Beginner | Intermediate | Advanced (Admin > Quests). Mapped one to one; any
 * other value is kept as written so a steward sees it.
 *
 * Archetypes: a quest proposal has no archetype column, so Sera's archetypes
 * travel in the steward-facing rationale. Only the five known keys are kept.
 */
export const DIFFICULTY_OF: Record<string, string> = { Easy: "Beginner", Moderate: "Intermediate", Involved: "Advanced" };
export const ARCHETYPE_KEYS_SERA = ["building", "researching", "facilitating", "catalyzing", "storytelling"] as const;

export interface QuestFeedCounts {
  read: number;
  queued: number;
  alreadySeen: number;
  droppedForEmail: number;
  /** Refused here (an email we caught, no title, an id too long). */
  refusedHere: number;
}

export interface QuestFeedAnswer extends QuestFeedCounts {
  dryRun: boolean;
  status: "ok" | "not-connected" | "no-tool" | "error";
  detail?: string;
  at: string;
}

export interface MappedQuest {
  seraId: string;
  prose: {
    title: string; subtitle: string | null; description: string | null; impact: string | null; story: string | null;
    firstStep: string | null; steps: string[]; deliverable: string | null; tips: string[]; tags: string[];
    duration: string | null; difficulty: string | null; icon: string | null; roleRequired: string | null;
  };
  rationale: string | null;
  quote: string | null;
  sourceRef: string | null;
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const l = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => s(x)).filter((x): x is string => !!x) : []);

export function mapSeraQuest(raw: unknown): MappedQuest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const seraId = s(r.id);
  const title = s(r.title);
  if (!seraId || !title) return null;
  const diff = s(r.difficulty);
  const arche = l(r.archetypes).map((a) => a.toLowerCase()).filter((a) => (ARCHETYPE_KEYS_SERA as readonly string[]).includes(a));
  const why = [s(r.rationale), arche.length ? `Archetypes: ${arche.join(", ")}.` : null].filter(Boolean).join("\n\n");
  return {
    seraId,
    prose: {
      title, subtitle: s(r.subtitle), description: s(r.description), impact: s(r.impact), story: s(r.story),
      firstStep: s(r.first_step), steps: l(r.steps), deliverable: s(r.deliverable), tips: l(r.tips), tags: l(r.tags),
      duration: s(r.duration), difficulty: diff ? DIFFICULTY_OF[diff] ?? diff : null, icon: s(r.icon), roleRequired: s(r.role_required),
    },
    rationale: why || null,
    quote: s(r.quote),
    sourceRef: s(r.source_ref) ?? s(r.url),
  };
}

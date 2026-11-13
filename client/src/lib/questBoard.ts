/**
 * Pure helpers for the quest board and quest detail pages. No fetching, no
 * DOM: everything here is testable with plain values, the same rule
 * firstWalk.ts and swatch.ts follow.
 *
 * The shapes mirror what GET /api/quests and GET /api/quests/field return.
 * The story fields (0068) are all optional: a quest written before the
 * story layer existed renders from description and impact alone.
 */

import { hashString, sceneStopsFor, type SceneStop } from "@shared/questScenes";
import type { StageRule } from "@shared/gameConfig";
import type { WorkPay } from "@shared/workValue";
import type { QuestPlace } from "@shared/questThreads";
import { questFit } from "@shared/commitment";

export interface BoardQuest {
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  impact?: string | null;
  story?: string | null;
  firstStep?: string | null;
  steps?: string[];
  deliverable?: string | null;
  tips?: string[];
  imageUrl?: string | null;
  /** The retired Gratitude label (0004). Read by nothing that pays since 2026-10-21. */
  gratitude: string;
  /**
   * What the quest is worth and pays (0265), worked out by the server from the
   * function the consent pays from. Absent from an older server.
   */
  pay?: WorkPay | null;
  /** The quest's own terms (0265, 0285), compared with what an open claim kept (0342). */
  valueMinor?: number | null;
  valueCurrency?: string | null;
  valueTokens?: { token: string; amount: number }[] | null;
  cashMinor?: number | null;
  cashCurrency?: string | null;
  /** The roots this quest grows from, one to three archetype keys (the five archetypes as roots). Absent from an older server. */
  archetypes?: string[];
  duration?: string | null;
  /** How much of a person it asks, 1 to 100 (0383). Absent or null: not sized. */
  commitmentPct?: number | null;
  difficulty?: string | null;
  circle?: string | null;
  status: string;
  icon?: string | null;
  roleRequired?: string | null;
  minStage?: string | null;
  requiresRole?: string | null;
  tags?: string[];
  order?: number;
  isExample?: boolean;
  /** The season goal this quest grows, by id (shared/questThreads.ts). Absent from an older server. */
  goalId?: string | null;
  /** Where the work happens. Absent from an older server. */
  place?: QuestPlace | null;
}

/** One quest's life signs. `moon` (consents since this moon began) is absent from an older server. */
export interface QuestSigns {
  active: number;
  done: number;
  moon?: number;
}

export interface FieldSigns {
  perQuest: Record<string, QuestSigns>;
  recent: { questId: string; questTitle: string; name: string; when: string | null }[];
}

/**
 * The scene a quest paints when no poster image is set: a gradient drawn
 * from the brand tone layer, chosen deterministically from the quest's
 * circle so every quest in a circle shares a palette and a fork that
 * re-themes in Admin re-paints every scene at once. The hex fallbacks keep
 * the board colored before theme.css arrives.
 */
export interface QuestScene {
  from: string;
  to: string;
}

/** The var() form, so a village re-theming in Admin repaints every card. */
const cssStop = (s: SceneStop) => `var(${s.token}, ${s.hex})`;

export { hashString };

export function questScene(circle: string | null | undefined): QuestScene {
  const [from, to] = sceneStopsFor(circle);
  return { from: cssStop(from), to: cssStop(to) };
}

export function sceneGradient(scene: QuestScene): string {
  return `linear-gradient(150deg, ${scene.from} 0%, ${scene.to} 100%)`;
}

/**
 * The three rings a board arranges itself into.
 *
 * Ported from the sibling game's page spec, mapped onto THIS platform's spine.
 * That game rings its board around four declared paths and a citizenship
 * ladder; a village has neither. What it has is a Path of Growth and a set of
 * roles, and quests already say which ones they ask for. So the ring is
 * derived, never stored:
 *
 *   welcome  an ungated gentle quest. Open to anyone with an account.
 *   village  the main body of the board, the work a member picks up.
 *   further  a quest a stage or a role opens. It stays in full colour and says
 *            what opens it, the one thing the spec bans greying out.
 *
 * Deriving beats a column here. A fork that renames its circles, retunes its
 * difficulties or gates a quest gets a board that reorganises itself, with no
 * migration and no admin field to forget.
 */
export type Ring = "welcome" | "village" | "further";

export const RING_ORDER: Ring[] = ["welcome", "village", "further"];

export function ringFor(
  q: Pick<BoardQuest, "difficulty" | "minStage" | "requiresRole">,
): Ring {
  if (q.minStage || q.requiresRole) return "further";
  return q.difficulty === "Beginner" ? "welcome" : "village";
}

/**
 * A personal opening view of a large ring, dormant until a board needs it.
 *
 * The spec reveals two quests at a time so an eighty-quest pool cannot
 * paralyse anyone, seeded per player so two members do not walk an identical
 * script. Ported straight, that mechanic HIDES quests, which collides with the
 * rule this board is built on: a quest a member cannot take yet stays in full
 * colour and says what opens it. Locking by another name is still locking.
 *
 * So the seeded order stays and the lock goes. A big ring opens on a personal
 * subset and carries a "show all", which is the calm the reveal was after
 * without taking anything away. Below the threshold the whole ring renders,
 * because hiding four of six quests makes a young board look emptier than it
 * is, the failure that sank the seasonal cascade in the spec this came from.
 */
export const REVEAL_THRESHOLD = 8;
export const REVEAL_STEP = 2;

export function revealedFrom<T extends { id: string }>(
  pool: T[],
  userId: string | null | undefined,
  completedCount: number,
): T[] {
  if (pool.length <= REVEAL_THRESHOLD) return pool;
  // Seeded per player, stable across renders: the same member always walks the
  // same order, and two members walk different ones.
  const seed = hashString(String(userId ?? "anon"));
  // Mix the seed INTO the key rather than concatenating it on the end: djb2
  // over "q-1" + a seed differs from djb2 over "q-2" + the same seed by very
  // little, so two members kept drawing the same first pair.
  const rank = (id: string) => hashString(`${seed}:${id}:${seed}`);
  const shuffled = [...pool].sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : 1));
  const open = REVEAL_STEP + Math.max(0, completedCount) * REVEAL_STEP;
  return shuffled.slice(0, Math.min(open, shuffled.length));
}

export type ClaimLike = { questId: string; status: string };

/**
 * Quest status compared the same way everywhere. The board stores display
 * casing ("Open", "Seasonal") and two call sites had drifted apart: one
 * lowercased before comparing and one matched exact case, so an admin typing
 * "seasonal" would silently lose the badge while the suggestion logic kept
 * working. One helper, one convention.
 */
export function statusIs(
  q: Pick<BoardQuest, "status">,
  want: string,
): boolean {
  return String(q.status ?? "").trim().toLowerCase() === want.toLowerCase();
}

/** Active beats resolved; a later claim beats an earlier one at the same rank. */
const CLAIM_RANK: Record<string, number> = {
  claimed: 3,
  submitted: 3,
  consented: 2,
  declined: 1,
};

const claimWhen = (c: { claimedAt?: string | null }): number => {
  const t = new Date(String(c.claimedAt ?? "")).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * The one claim per quest a member should see. Claims arrive oldest-first, and
 * taking the first non-declined one meant a repeatable quest completed last
 * season kept showing "Completed" over the claim the member is holding right
 * now. Live work outranks finished work, and within one rank the later claim
 * wins.
 */
export function currentClaims<
  T extends { questId: string; status: string; claimedAt?: string | null },
>(claims: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const c of claims ?? []) {
    const prev = out[c.questId];
    if (!prev) {
      out[c.questId] = c;
      continue;
    }
    const rank = CLAIM_RANK[c.status] ?? 0;
    const prevRank = CLAIM_RANK[prev.status] ?? 0;
    if (rank > prevRank || (rank === prevRank && claimWhen(c) >= claimWhen(prev))) {
      out[c.questId] = c;
    }
  }
  return out;
}

export interface QuestSuggestion {
  quest: BoardQuest;
  reason: "continue" | "begin";
  /**
   * The quest carries at least one of the member's own roots. Only a tagged
   * quest can fit: an untagged one is open to every hand and says nothing
   * about whether it suits anyone, so it never claims to.
   */
  fits: boolean;
  /** The quest grows a season goal that is not done yet: this season's need. */
  needed: boolean;
}

/** Whether a quest is tagged with at least one of these roots. */
export function fitsRoots(
  q: Pick<BoardQuest, "archetypes">,
  mine: readonly string[] | null | undefined,
): boolean {
  const roots = q.archetypes ?? [];
  return !!mine?.length && roots.some((k) => mine.includes(k));
}

/**
 * The one "fits you" quest the open work board leads with (Phase C,
 * decision 5). Among the open, ungated quests the member has not touched,
 * with any quest that asks more than the member can give now (`memberPct`,
 * 0383) put last:
 *   1. one that carries one of their roots;
 *   2. then one that grows a season goal not yet done (this season's need,
 *      `openGoalIds`);
 *   3. then the gentlest: Beginner before Intermediate before Advanced;
 *   4. then board order.
 * Roots only ever reorder what is already open to everyone: a root is a lens
 * and never a gate (shared/archetypeRoots.ts). Examples never lead, and a
 * fully played board leads with nothing.
 */
export function leadQuestFor(
  quests: BoardQuest[],
  claims: ClaimLike[],
  mine: readonly string[] = [],
  openGoalIds: readonly string[] = [],
  memberPct: number | null = null,
): QuestSuggestion | null {
  const touched = new Set(
    claims.filter((c) => c.status !== "declined").map((c) => c.questId),
  );
  const rank: Record<string, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };
  const open = quests
    .filter((q) => !q.isExample)
    .filter((q) => statusIs(q, "open"))
    .filter((q) => !q.minStage && !q.requiresRole)
    .filter((q) => !touched.has(q.id))
    .map((q) => ({ q, fits: fitsRoots(q, mine), needed: !!q.goalId && openGoalIds.includes(q.goalId), beyond: questFit(q.commitmentPct, memberPct) === "harder" }))
    .sort(
      (a, b) =>
        // 0383: a quest that asks more than the member can give now never leads.
        Number(a.beyond) - Number(b.beyond) ||
        Number(b.fits) - Number(a.fits) ||
        Number(b.needed) - Number(a.needed) ||
        (rank[a.q.difficulty ?? ""] ?? 1) - (rank[b.q.difficulty ?? ""] ?? 1) ||
        (a.q.order ?? 0) - (b.q.order ?? 0),
    );
  return open[0] ? { quest: open[0].q, reason: "begin", fits: open[0].fits, needed: open[0].needed } : null;
}

/**
 * The one suggestion the board makes. Priorities, in order:
 *   1. a quest the member already holds (claimed or submitted) — finishing
 *      beats starting, always;
 *   2. the "fits you" quest the board leads with (`leadQuestFor`).
 * Examples never suggest themselves, and a fully played board suggests
 * nothing: null means the caller renders no card, never an empty one.
 */
export function nextQuestFor(
  quests: BoardQuest[],
  claims: ClaimLike[],
  mine: readonly string[] = [],
  openGoalIds: readonly string[] = [],
): QuestSuggestion | null {
  const byId = new Map(quests.map((q) => [q.id, q]));
  for (const c of claims) {
    if (c.status !== "claimed" && c.status !== "submitted") continue;
    const q = byId.get(c.questId);
    if (q) return { quest: q, reason: "continue", fits: fitsRoots(q, mine), needed: !!q.goalId && openGoalIds.includes(q.goalId) };
  }
  return leadQuestFor(quests, claims, mine, openGoalIds);
}

/**
 * The gate, said plainly on the card. The sibling game's quest specs ban the
 * greyed-out lock outright: a gated quest stays in full color and simply says
 * what opens it. minStage resolves to the stage's display name; a role gate
 * leans on the quest's own display prose when the village wrote some.
 */
export function gateLabel(
  q: Pick<BoardQuest, "minStage" | "requiresRole" | "roleRequired">,
  stages: { id: string; name: string }[] | null | undefined,
): string | null {
  if (q.minStage) {
    const s = (stages ?? []).find((x) => x.id === q.minStage);
    return `Opens at ${s?.name ?? q.minStage}`;
  }
  if (q.requiresRole) {
    return q.roleRequired ? `Held for: ${q.roleRequired}` : "Held for a village role";
  }
  if (q.roleRequired) return `Asks for: ${q.roleRequired}`;
  return null;
}

/**
 * R47: a lock names its fix. The one step that reaches a quest's stage, for
 * the rules a member can act on, or null when there is no step to name: a
 * stage the village grants, a rule this client does not know, or a quest
 * with no stage floor at all.
 */
export function gateFix(
  q: Pick<BoardQuest, "minStage">,
  stages: { id: string; rule?: StageRule }[] | null | undefined,
  commitment: string = "membership agreement",
): string | null {
  if (!q.minStage) return null;
  const rule = (stages ?? []).find((x) => x.id === q.minStage)?.rule;
  switch (rule?.type) {
    case "account":
      return "Create your account to get there.";
    case "training-complete":
      return "Finish community training to get there.";
    case "membership":
      return `Sign the ${commitment} to get there.`;
    case "quests":
      return `Complete ${rule.min} ${rule.min === 1 ? "Quest" : "Quests"} to get there.`;
    case "role":
      return "Take on a role on the org chart to get there.";
    case "granted":
      return "The village grants this stage.";
    default:
      return null;
  }
}

/** Textarea lines → list: trimmed, blanks dropped. The admin editor's parser. */
export function linesToList(text: string): string[] {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** List → textarea lines, the exact inverse for non-blank input. */
export function listToLines(list: string[] | null | undefined): string {
  return (list ?? []).join("\n");
}

/**
 * "today" / "yesterday" / "N days ago", with `now` injected so the function
 * stays pure. Anything unparseable renders as nothing, never as NaN.
 */
export function relativeWhen(iso: string | null | undefined, now: Date): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** The board's filters (decision 5). "All" means the filter is off. */
export interface BoardFilters {
  circle: string;
  difficulty: string;
  /** A season goal id, or "All". */
  goal: string;
  /** "land", "remote", or "All". A quest that happens in both places matches either. */
  place: string;
}

export const NO_FILTERS: BoardFilters = { circle: "All", difficulty: "All", goal: "All", place: "All" };

/** Narrow the board by its chips. Keeps the board's order: a filter narrows, it never re-ranks. */
export function filterBoard<T extends Pick<BoardQuest, "circle" | "difficulty" | "goalId" | "place">>(
  quests: readonly T[],
  f: BoardFilters,
): T[] {
  return quests.filter(
    (q) =>
      (f.circle === "All" || q.circle === f.circle) &&
      (f.difficulty === "All" || q.difficulty === f.difficulty) &&
      (f.goal === "All" || q.goalId === f.goal) &&
      (f.place === "All" || q.place === f.place || q.place === "both"),
  );
}

export interface CircleGroup<T> {
  /** The circle's own name, or null for quests that name none. */
  circle: string | null;
  quests: T[];
}

/**
 * The open work list, grouped by circle: circles in the order the board first
 * meets them, quests in board order inside each, and quests with no circle
 * together at the end. Nothing is ranked by who carried what.
 */
export function groupByCircle<T extends Pick<BoardQuest, "circle">>(quests: readonly T[]): CircleGroup<T>[] {
  const groups = new Map<string, CircleGroup<T>>();
  const loose: T[] = [];
  for (const q of quests) {
    const c = String(q.circle ?? "").trim();
    if (!c) {
      loose.push(q);
      continue;
    }
    const g = groups.get(c) ?? { circle: c, quests: [] };
    g.quests.push(q);
    groups.set(c, g);
  }
  const out = Array.from(groups.values());
  if (loose.length) out.push({ circle: null, quests: loose });
  return out;
}

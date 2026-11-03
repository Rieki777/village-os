/**
 * A member's own task list: the contract every side reads (PR 1 of the
 * "Your list" plan).
 *
 * WHAT A TASK IS HERE. One row a member holds for themselves: typed by hand,
 * made from a journal entry, or brought in from the knowledge library's voice
 * tasks (source `sera`). It is the member's, so it is member-pii: shown to
 * them, in their export, and deleted with them on erasure.
 *
 * THE THREE TIERS are how much it matters (high, priority, not_yet). The
 * HORIZON is when (today, this week, later), read in the VILLAGE's zone, never
 * the server's. The ranking is a pure function of the task, the weights the
 * member set on the sliders, and the village day, so the server and the
 * browser draw the same list.
 *
 * REMOVED IS A TOMBSTONE. A removed task keeps its source and external id
 * forever (unique on user, source, external id), so a task the library sends
 * again is ignored instead of coming back. Its words can be restored for
 * RESTORE_DAYS and are cleared after that.
 *
 * PRIVATE DETAIL. A task may carry `privateDetail` (the journal text it came
 * from). Only the member ever reads it: never a steward view, never an export
 * to anyone else, never anything sent outward.
 */

export const TIERS = ["high", "priority", "not_yet"] as const;
export type Tier = (typeof TIERS)[number];

export const HORIZONS = ["today", "week", "later"] as const;
export type Horizon = (typeof HORIZONS)[number];

export const STATUSES = ["open", "done", "removed"] as const;
export type TaskStatus = (typeof STATUSES)[number];

export const SOURCES = ["self", "journal", "session", "sera", "assistant", "redirect"] as const;
export type TaskSource = (typeof SOURCES)[number];

/** Why a task is on the list, in codes the UI turns into words ("Why this is here"). */
export const REASONS = [
  "tier_high",
  "due_soon",
  "overdue",
  "pinned",
  "pinned_by_you",
  "handed_to_you",
  "from_session",
  "from_journal",
  "from_library",
  "added_by_you",
  "chosen_today",
] as const;
export type ReasonCode = (typeof REASONS)[number];

/** Why a member removed one. Only these codes ever leave the village, never words. */
export const REMOVE_REASONS = ["not_mine", "done_elsewhere", "not_relevant", "duplicate", "too_vague", "other"] as const;
export type RemoveReason = (typeof REMOVE_REASONS)[number];

export const TITLE_MAX = 200;
export const PRIVATE_DETAIL_MAX = 4000;
/** A removed task can be restored for this many days; then its words are cleared. */
export const RESTORE_DAYS = 30;
/** Due within this many days always shows, whatever the sliders say. */
export const ALWAYS_SHOW_DUE_DAYS = 2;
export const DEFAULT_MINUTES = 30;

// ── The sliders ──────────────────────────────────────────────────────────

export const WEIGHT_KEYS = ["tier", "due", "goal", "role", "age", "feedback", "session", "confidence"] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export type Weights = Record<WeightKey, number> & { todayCap: number; weekCap: number | null };

export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 10;
export const CAP_MAX = 100;

export const PRESETS = {
  founder: { tier: 10, due: 10, goal: 8, role: 3, age: 2, feedback: 5, session: 2, confidence: 3, todayCap: 12, weekCap: 25 },
  balanced: { tier: 6, due: 6, goal: 6, role: 6, age: 3, feedback: 5, session: 3, confidence: 3, todayCap: 12, weekCap: 25 },
  everything: { tier: 3, due: 3, goal: 3, role: 3, age: 0, feedback: 0, session: 3, confidence: 0, todayCap: 12, weekCap: null },
} as const satisfies Record<string, Weights>;
export type PresetName = keyof typeof PRESETS;
export const DEFAULT_PRESET: PresetName = "balanced";

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

/** Any input to a full, in-range set of weights. Unknown keys are dropped. */
export function clampWeights(input: unknown, base: Weights = PRESETS[DEFAULT_PRESET]): Weights {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = { ...base } as Weights;
  for (const k of WEIGHT_KEYS) out[k] = clampInt(o[k], WEIGHT_MIN, WEIGHT_MAX, base[k]);
  out.todayCap = clampInt(o.todayCap, 1, CAP_MAX, base.todayCap);
  out.weekCap = o.weekCap === null ? null : o.weekCap === undefined ? base.weekCap : clampInt(o.weekCap, 1, CAP_MAX, base.weekCap ?? 25);
  return out;
}

// ── The library's priorities ─────────────────────────────────────────────

/** High, Medium and Low to our tiers. Anything else is `priority`, flagged. */
export function tierFromLibrary(priority: unknown): { tier: Tier; flagged: boolean } {
  const p = String(priority ?? "").trim().toLowerCase();
  if (p === "high") return { tier: "high", flagged: false };
  if (p === "medium") return { tier: "priority", flagged: false };
  if (p === "low") return { tier: "not_yet", flagged: false };
  return { tier: "priority", flagged: true };
}

// ── Days in the village's zone ───────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDayKey = (v: unknown): v is string => typeof v === "string" && DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Whole days from `from` to `to`, both YYYY-MM-DD village days. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface TaskForRank {
  id: string;
  tier: Tier;
  status: TaskStatus;
  source: TaskSource;
  dueOn: string | null;
  /** The horizon the member chose, or null to let the due date decide. */
  horizon: Horizon | null;
  pinned: boolean;
  /** The member pinned it to the top of its tier (PR E). Not an always-show. */
  memberPinned?: boolean;
  /** Village day the task was made. */
  createdOn: string;
  /** 0 to 1 when the library sent one. */
  confidence?: number | null;
  goalAligned?: boolean;
  roleMatch?: boolean;
  /** How many times the member said "not now" to it. */
  notNowCount?: number;
}

/** Today, this week or later. A chosen horizon wins unless the due date is sooner. */
export function horizonOf(t: Pick<TaskForRank, "dueOn" | "horizon">, today: string): Horizon {
  let byDue: Horizon | null = null;
  if (t.dueOn && isDayKey(t.dueOn)) {
    const d = daysBetween(today, t.dueOn);
    byDue = d <= 0 ? "today" : d <= 6 ? "week" : "later";
  }
  const order: Record<Horizon, number> = { today: 0, week: 1, later: 2 };
  if (t.horizon && byDue) return order[t.horizon] <= order[byDue] ? t.horizon : byDue;
  return t.horizon ?? byDue ?? "later";
}

/** Must show whatever the sliders say: pinned, or due within two days (overdue included). */
export function alwaysShows(t: Pick<TaskForRank, "pinned" | "dueOn">, today: string): boolean {
  if (t.pinned) return true;
  return !!t.dueOn && isDayKey(t.dueOn) && daysBetween(today, t.dueOn) <= ALWAYS_SHOW_DUE_DAYS;
}

const TIER_SCORE: Record<Tier, number> = { high: 1, priority: 0.5, not_yet: 0 };

export interface Ranked<T extends TaskForRank = TaskForRank> {
  task: T;
  score: number;
  horizon: Horizon;
  reasons: ReasonCode[];
  always: boolean;
  /** False when the caps put it under "Show hidden". */
  shown: boolean;
}

export function reasonsFor(t: TaskForRank, today: string): ReasonCode[] {
  const r: ReasonCode[] = [];
  if (t.pinned) r.push("pinned");
  if (t.memberPinned) r.push("pinned_by_you");
  if (t.dueOn && isDayKey(t.dueOn)) {
    const d = daysBetween(today, t.dueOn);
    if (d < 0) r.push("overdue");
    else if (d <= ALWAYS_SHOW_DUE_DAYS) r.push("due_soon");
  }
  if (t.tier === "high") r.push("tier_high");
  if (t.horizon === "today") r.push("chosen_today");
  r.push(
    t.source === "session" ? "from_session" : t.source === "journal" ? "from_journal" : t.source === "sera" ? "from_library" : t.source === "redirect" ? "handed_to_you" : "added_by_you",
  );
  return r;
}

/** One number per task. Higher is earlier. Pure, so it is the same everywhere. */
export function scoreTask(t: TaskForRank, w: Weights, today: string): number {
  let s = TIER_SCORE[t.tier] * w.tier;
  if (t.dueOn && isDayKey(t.dueOn)) {
    const d = daysBetween(today, t.dueOn);
    s += w.due * (d <= 0 ? 1 : d >= 14 ? 0 : (14 - d) / 14);
  }
  if (t.goalAligned) s += w.goal;
  if (t.roleMatch) s += w.role * 0.5;
  if (t.source === "session") s += w.session * 0.5;
  if (t.confidence != null && Number.isFinite(t.confidence)) s += w.confidence * Math.min(1, Math.max(0, t.confidence)) * 0.5;
  const age = isDayKey(t.createdOn) ? Math.max(0, daysBetween(t.createdOn, today)) : 0;
  s -= w.age * Math.min(1, age / 60);
  s -= w.feedback * Math.min(1, (t.notNowCount ?? 0) / 3) * 0.5;
  return Math.round(s * 1000) / 1000;
}

/**
 * The open tasks, ranked within their horizon, with the caps applied. Always-show
 * tasks are never hidden by a cap. Ties break by due date, then id, so the order
 * is stable.
 */
export function rankTasks<T extends TaskForRank>(tasks: readonly T[], weights: Weights, today: string): Ranked<T>[] {
  const w = clampWeights(weights);
  const open = tasks.filter((t) => t.status === "open");
  const ranked = open.map((task) => ({
    task,
    score: scoreTask(task, w, today),
    horizon: horizonOf(task, today),
    reasons: reasonsFor(task, today),
    always: alwaysShows(task, today),
    shown: true,
  }));
  const hOrder: Record<Horizon, number> = { today: 0, week: 1, later: 2 };
  ranked.sort(
    (a, b) =>
      hOrder[a.horizon] - hOrder[b.horizon] ||
      Number(b.always) - Number(a.always) ||
      Number(!!b.task.memberPinned) - Number(!!a.task.memberPinned) ||
      b.score - a.score ||
      (a.task.dueOn ?? "9999").localeCompare(b.task.dueOn ?? "9999") ||
      a.task.id.localeCompare(b.task.id),
  );
  const caps: Record<Horizon, number | null> = { today: w.todayCap, week: w.weekCap, later: null };
  const used: Record<Horizon, number> = { today: 0, week: 0, later: 0 };
  for (const r of ranked) {
    const cap = caps[r.horizon];
    // Always-show tasks are outside the cap: they never use up a place.
    if (r.always) r.shown = true;
    else if (cap == null || used[r.horizon] < cap) {
      used[r.horizon] += 1;
      r.shown = true;
    } else r.shown = false;
  }
  return ranked;
}

/** Counts for the card header and the steward view. */
export function countsOf(ranked: readonly Ranked[]): Record<Horizon, number> & { hidden: number } {
  const c = { today: 0, week: 0, later: 0, hidden: 0 };
  for (const r of ranked) {
    if (r.shown) c[r.horizon] += 1;
    else c.hidden += 1;
  }
  return c;
}

// ── What a write may carry ───────────────────────────────────────────────

export interface TaskInput {
  title: string;
  tier: Tier;
  dueOn: string | null;
  horizon: Horizon | null;
  minutes: number | null;
  privateDetail: string | null;
}

const plain = (v: unknown, max: number): string =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);

/** A new task from a body. Title is required; everything else is optional. */
export function parseTaskInput(body: unknown): { ok: true; value: TaskInput } | { ok: false; problem: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = plain(b.title, TITLE_MAX).replace(/\s+/g, " ");
  if (!title) return { ok: false, problem: "A task needs a few words." };
  const patch = parseTaskPatch(b);
  if (!patch.ok) return patch;
  return {
    ok: true,
    value: {
      title,
      tier: patch.value.tier ?? "priority",
      dueOn: patch.value.dueOn ?? null,
      horizon: patch.value.horizon ?? null,
      minutes: patch.value.minutes ?? null,
      privateDetail: patch.value.privateDetail ?? null,
    },
  };
}

/** A change to a task: only the fields present are touched. */
export function parseTaskPatch(body: unknown): { ok: true; value: Partial<TaskInput> } | { ok: false; problem: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: Partial<TaskInput> = {};
  if ("title" in b) {
    const t = plain(b.title, TITLE_MAX).replace(/\s+/g, " ");
    if (!t) return { ok: false, problem: "A task needs a few words." };
    out.title = t;
  }
  if ("tier" in b) {
    if (!TIERS.includes(b.tier as Tier)) return { ok: false, problem: "That is not one of the tiers." };
    out.tier = b.tier as Tier;
  }
  if ("dueOn" in b) {
    if (b.dueOn === null || b.dueOn === "") out.dueOn = null;
    else if (isDayKey(b.dueOn)) out.dueOn = b.dueOn;
    else return { ok: false, problem: "A due date is a day, like 2026-11-30." };
  }
  if ("horizon" in b) {
    if (b.horizon === null) out.horizon = null;
    else if (HORIZONS.includes(b.horizon as Horizon)) out.horizon = b.horizon as Horizon;
    else return { ok: false, problem: "That is not today, this week or later." };
  }
  if ("minutes" in b) out.minutes = b.minutes === null ? null : clampInt(b.minutes, 1, 600, DEFAULT_MINUTES);
  if ("privateDetail" in b) {
    const d = b.privateDetail === null ? "" : plain(b.privateDetail, PRIVATE_DETAIL_MAX);
    out.privateDetail = d || null;
  }
  return { ok: true, value: out };
}

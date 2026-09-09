/**
 * A reorganisation you can read before it is true (0056).
 *
 * A village's org chart is edited live, one field at a time, by whoever has
 * the admin page open. There is no moment where the whole shape of a proposed
 * change is visible, and no way to say "this is what we would become" without
 * becoming it first. A draft is that moment.
 *
 * ── WHAT IS DRAFTABLE, AND WHY THE LINE IS THERE ─────────────────────────
 *
 * Seats, their circle assignment, and their holders. NOT circles themselves.
 *
 * That is a real constraint, not an oversight. `circles` is written through a
 * dbCollection whose `replaceAll` opens its OWN transaction on its OWN
 * connection and swaps the in-memory cache after committing. So a circle write
 * cannot join this transaction and cannot be undone once it has returned; a
 * draft that claimed to apply both planes atomically would be lying about the
 * half it cannot roll back. `org_roles` and `org_role_assignments` are raw SQL
 * with no cache, so they genuinely commit together.
 *
 * Moving a seat BETWEEN circles is `org_roles.circle_id` and is fully covered.
 * What is not is creating or deleting the circles themselves.
 *
 * ── APPLY IS ALL OR NOTHING ──────────────────────────────────────────────
 *
 * One connection, one transaction, every change or none. A half-applied
 * reorganisation is worse than none at all: the village would be left in a
 * shape nobody chose and nobody can describe.
 *
 * ── REVERT READS `before_json`, CAPTURED AT APPLY TIME ───────────────────
 *
 * Not at draft time. Two weeks can pass between writing a draft and consenting
 * to it, and undoing to what somebody saw a fortnight ago would silently throw
 * away everything that happened in between. The change journal cannot serve
 * this purpose either: `recordEvent` swallows its own errors by design, so it
 * is lossy, and an archive may not be.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { draftStatus, withdrawDraftRow } from "../repos/orgDrafts";
import { stageIndex } from "../../shared/gameConfig";
import { documentedKey, listOrgAssignments, listOrgRoles, peopleOnly, seatHolder, seatState, type LapseContext, type OrgAssignment } from "./orgChart";

export type DraftOp = "create_seat" | "update_seat" | "rest_seat" | "seat_holder" | "end_holding";
export type DraftStatus = "open" | "published" | "reverted" | "withdrawn";

export interface DraftChange {
  id: string;
  draftId: string;
  op: DraftOp;
  orgRoleId: string;
  payload: any;
  beforeJson: any;
  order: number;
}

export interface Draft {
  id: string;
  title: string;
  rationale: string | null;
  status: DraftStatus;
  threadId: string | null;
  createdBy: string | null;
  publishedAt: string | null;
  revertedAt: string | null;
  changes: DraftChange[];
  /** The vision block (0083, P1, N2), or null for a draft without one. */
  vision: VisionBlock | null;
  /**
   * WHO OR WHAT WROTE THIS (0143).
   *
   * `created_by` is a member id and nothing else, so before this column a
   * draft an outside service proposed was indistinguishable from one a
   * founder typed. The whole confirm-then-own architecture rests on being
   * able to tell those apart, and one of the guards below refuses on it.
   *
   * 'human' for everything that existed before this column, which is the true
   * answer: nothing except the admin panel has ever been able to write here.
   */
  sourceKind: string;
  /** Which integration, when it was one. The grain revocation works on. */
  sourceModuleId: string | null;
  /** The row in `external_proposals` this was built from, when there was one. */
  sourceProposalId: string | null;
  /** The evidence, as `assistant_drafts.cites` already carries it. */
  cites: string[];
}

// ── The vision block (0083, P1, N2) ─────────────────────────────────────────
//
// A draft is already "a reorganisation you can read before it is true". The
// vision block adds WHEN: objectives with a metric and a target, and a
// trigger. When every objective is done the platform PROMPTS "Vision
// conditions met: apply this structure?" and a human presses the existing
// publish button. Nothing in this file or anywhere else applies a draft on
// its own; `publishDraft` has exactly one caller and it is that button.

export interface VisionObjective {
  /** The objective in the village's own words. */
  text: string;
  /** A measured metric id, or null for one a human ticks. */
  metric: string | null;
  /** The number the metric must reach. Null for declared objectives. */
  target: number | null;
  /** Last known value. Stored for the record; re-measured on read. */
  current: number | null;
  /** `measured` = the platform counts it; `declared` = a human ticks it. */
  source: "measured" | "declared";
  /** The tick, authoritative for declared objectives; derived for measured. */
  done: boolean;
}

export interface VisionBlock {
  objectives: VisionObjective[];
  trigger: {
    all_objectives_done: boolean;
    /** An optional date the village hopes to be there by. Words, not a gate. */
    by?: string | null;
  };
}

/**
 * The measured metrics v1 knows how to count. A metric id outside this list
 * is refused at write time, so a typo fails as a sentence instead of as an
 * objective that never moves.
 */
export const VISION_METRICS = ["seats_filled", "seasons_completed"] as const;
export const VISION_METRIC_PREFIXES = ["seats_filled_in:", "members_at_stage:"] as const;

export function visionMetricKnown(metric: string): boolean {
  if ((VISION_METRICS as readonly string[]).includes(metric)) return true;
  return VISION_METRIC_PREFIXES.some((p) => metric.startsWith(p) && metric.length > p.length);
}

/**
 * Take a departed member out of every draft that names them.
 *
 * WHY THIS IS ITS OWN FUNCTION AND NOT A LINE IN `erasure.ts`. Every other
 * trace in that sweep is a COLUMN, so it is one UPDATE. A draft restates a
 * person inside JSON: `seat_holder` carries `{ userId, displayName }` in
 * `payload`, and `end_holding` carries a whole assignment row in
 * `before_json`, `display_name`, `user_id`, `focus` and `note` included. The
 * shape of those two blobs is decided in this file, so the code that empties
 * them belongs beside the code that fills them, or it goes stale the first
 * time a payload gains a key.
 *
 * WHAT IT WAS BEFORE. Nothing swept these at all. A member exercised deletion,
 * every column-shaped trace went, and their name sat in an open draft forever
 * while `/api/org/vision` published it to anyone the map admits.
 *
 * DE-ATTRIBUTION IS NOT ERASURE, the rule this file inherits: the id is nulled
 * AND the name goes, because a sentence naming somebody identifies them with
 * no id at all.
 *
 * `before_json` is the revert data, so emptying it costs a published draft its
 * undo for THAT holding. That is the right trade and it is deliberate: the
 * alternative is keeping a departed member's name to preserve the ability to
 * seat them again, which is the thing they asked the village to stop doing.
 * Every other field of the row is left alone, so reverting the structure still
 * works and only the person is gone.
 */
export async function forgetMemberInDrafts(pool: Pool, userId: string, anon: string): Promise<number> {
  const [rows]: any = await pool.query(
    "SELECT id, op, payload, before_json FROM org_draft_changes WHERE op IN ('seat_holder', 'end_holding')",
  );
  const parse = (v: unknown) => {
    if (v == null) return null;
    if (typeof v !== "string") return v as any;
    try { return JSON.parse(v); } catch { return null; }
  };
  let touched = 0;
  for (const r of rows as any[]) {
    const payload = parse(r.payload);
    const before = parse(r.before_json);
    let changed = false;
    if (payload && String(payload.userId ?? "") === userId) {
      payload.userId = null;
      payload.displayName = anon;
      if (payload.focus) payload.focus = null;
      changed = true;
    }
    if (before && String(before.user_id ?? "") === userId) {
      before.user_id = null;
      before.display_name = anon;
      before.focus = null;
      before.note = null;
      // The generated active-holder key is derived from this, so it goes too
      // or the row still points at them by id.
      if (before.holder_key) before.holder_key = `doc:forgotten-${String(r.id)}`;
      changed = true;
    }
    if (!changed) continue;
    await pool.query(
      "UPDATE org_draft_changes SET payload = ?, before_json = ? WHERE id = ?",
      [payload === null ? null : JSON.stringify(payload), before === null ? null : JSON.stringify(before), r.id],
    );
    touched += 1;
  }
  return touched;
}

/*
 * ── THE FREE TEXT ON A DRAFT, AND WHO MAY READ IT ────────────────────────
 *
 * `/api/org/vision` answers ANONYMOUS callers whenever `map.public_structure`
 * is on, and it was returning three fields a member types in their own words:
 * the draft's `title`, its `rationale`, and every objective's `text`. It
 * tiered `holder` correctly and then published the sentence next to it.
 *
 * Survivable only while nothing but an admin could draft. The org editor
 * opens drafting to any member, and the first time somebody writes "Move
 * Sarah out of Finance, she keeps missing meetings" that is a signed-out
 * stranger's to read, cache and index.
 *
 * So the three go behind `map.viewPeople`, the same key the holder name sits
 * behind. That key stands at the `guest` rung, which every signed-in account
 * reaches, so this costs a member nothing and closes the door on the street.
 *
 * Below the tier the ghost is still DRAWABLE and still COUNTS: the shape, the
 * seat names, the numbers and the progress all stay, because those are
 * structure and structure is what that tier is for. Only the sentences go.
 */

/** A neutral line for an objective, from platform vocabulary, never a village's. */
export function neutralObjectiveText(metric: string | null): string {
  if (!metric) return "An objective the village has set";
  if (metric === "seats_filled") return "Seats filled";
  if (metric === "seasons_completed") return "Seasons completed";
  if (metric.startsWith("seats_filled_in:")) return "Seats filled in a circle";
  if (metric.startsWith("members_at_stage:")) return "Members at a stage";
  return "An objective the village is measuring";
}

/**
 * The words of a draft as this viewer may have them.
 *
 * Lives here rather than in the route so the tier and the vocabulary it falls
 * back to sit beside each other, and so a test can ask what an anonymous
 * reader gets without booting a server.
 */
export function tierDraftWords<T extends { text: string; metric: string | null }>(
  maySeePeople: boolean,
  d: { title: string; rationale?: string | null },
  objectives: T[],
): { title: string; rationale: string | null; objectives: T[] } {
  if (maySeePeople) return { title: d.title, rationale: d.rationale ?? null, objectives };
  return {
    title: "A change being drafted",
    rationale: null,
    objectives: objectives.map((o) => ({ ...o, text: neutralObjectiveText(o.metric) })),
  };
}

/** What is wrong with a proposed vision block, in the words somebody would use. */
export function visionProblem(v: unknown): string | null {
  if (v === null || v === undefined) return null; // clearing the block is allowed
  if (typeof v !== "object" || Array.isArray(v)) return "A vision is an object with objectives and a trigger";
  const b = v as Record<string, unknown>;
  if (!Array.isArray(b.objectives)) return "A vision needs a list of objectives";
  if (b.objectives.length === 0) return "A vision with no objectives can never be met. Add at least one";
  if (b.objectives.length > 20) return "Twenty objectives is the most a vision can hold";
  for (const raw of b.objectives) {
    if (!raw || typeof raw !== "object") return "Each objective needs its own text";
    const o = raw as Record<string, unknown>;
    const text = String(o.text ?? "").trim();
    if (!text) return "Each objective needs its own text";
    if (text.length > 300) return "An objective is a line, and 300 characters is the room it has";
    const source = o.source;
    if (source !== "measured" && source !== "declared") {
      return `An objective's source is measured or declared`;
    }
    if (source === "measured") {
      const metric = String(o.metric ?? "");
      if (!visionMetricKnown(metric)) {
        return `"${metric}" is not a metric the platform counts. Measured ones are: ${VISION_METRICS.join(", ")}, ${VISION_METRIC_PREFIXES.map((p) => `${p}…`).join(", ")}`;
      }
      const target = Number(o.target);
      if (!Number.isFinite(target) || target <= 0) {
        return "A measured objective needs a target above zero";
      }
    }
  }
  const t = b.trigger;
  if (!t || typeof t !== "object" || Array.isArray(t)) return "A vision needs a trigger";
  if ((t as Record<string, unknown>).all_objectives_done !== true) {
    return "The one trigger v1 knows is all_objectives_done: true";
  }
  return null;
}

/**
 * Where a vision stands, given a way to measure. PURE: the measure function
 * is passed in, so this file keeps its no-pool discipline and the same
 * arithmetic runs identically in tests, on the server and in a preview.
 *
 * Declared objectives keep their human tick. Measured ones are re-derived
 * from the measurement every time, so a vision can UN-meet if seats empty
 * out: the prompt says what is true today, never what was true once.
 */
export function visionProgress(
  vision: VisionBlock,
  measure: (metric: string) => number | null,
): { objectives: VisionObjective[]; done: number; total: number; allDone: boolean } {
  const objectives = vision.objectives.map((o) => {
    if (o.source !== "measured" || !o.metric) return { ...o };
    const current = measure(o.metric);
    return {
      ...o,
      current: current ?? o.current ?? null,
      done: current !== null && o.target !== null && current >= o.target,
    };
  });
  const done = objectives.filter((o) => o.done).length;
  return {
    objectives,
    done,
    total: objectives.length,
    allDone: objectives.length > 0 && done === objectives.length,
  };
}

/**
 * Write a draft's vision block. Only an OPEN draft: a published draft is a
 * record of what happened, and a vision edited onto one afterwards would
 * claim conditions that never gated it.
 */
export async function setDraftVision(
  pool: Pool,
  draftId: string,
  vision: VisionBlock | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const problem = visionProblem(vision);
  if (problem) return { ok: false, error: problem };
  const [[d]] = await pool.query<any[]>("SELECT status FROM org_drafts WHERE id = ?", [draftId]);
  if (!d) return { ok: false, error: "No such draft" };
  if (d.status !== "open") return { ok: false, error: `This draft is ${d.status} and can no longer be edited` };
  await pool.query("UPDATE org_drafts SET vision = ? WHERE id = ?", [
    vision === null ? null : JSON.stringify(vision),
    draftId,
  ]);
  return { ok: true };
}

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

function asJson(v: unknown): any {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

function rowToChange(r: any): DraftChange {
  return {
    id: r.id, draftId: r.draft_id, op: r.op, orgRoleId: r.org_role_id,
    payload: asJson(r.payload), beforeJson: asJson(r.before_json),
    order: Number(r.sort_order ?? 0),
  };
}

/**
 * What each measured metric stands at right now.
 *
 * MOVED HERE FROM server/index.ts, where it sat inline inside the
 * `/api/org/vision` handler. The vocabulary (`VISION_METRICS`,
 * `VISION_METRIC_PREFIXES`, `visionMetricKnown`) has always lived in this
 * file, and the code that counts them lived 19,000 lines away in the one big
 * file, so adding a metric meant editing two places and only one of them was
 * findable from the other.
 *
 * Measured LAZILY: only the metric families the open visions actually name
 * are counted, so a village with no visions pays nothing. Absent from the
 * returned map means "not measured", which `visionProgress` reads as unknown
 * rather than as zero.
 *
 * ── AGENTS DO NOT COUNT TOWARD `seats_filled` (0142) ─────────────────────
 *
 * The most consequential of the per-site decisions in that audit, because
 * this metric is a TRIGGER and not a display. A vision whose objective is
 * "twelve seats filled" prompts a human to publish a whole reorganisation
 * when it is met. Counting agent-held seats would let a village reach the
 * number without reaching the thing the number was standing for, and the
 * prompt it fires is the one that changes the org chart.
 *
 * `seatState` itself is deliberately NOT changed. It answers "is this seat
 * held", the map and the public export both ask it, and a seat an agent holds
 * IS held. The filter belongs here, where the question is "is this seat
 * carried by somebody".
 */
export async function measureVisionMetrics(
  pool: Pool,
  wanted: ReadonlySet<string>,
  deps: {
    lapseContext(): LapseContext;
    allMembers(): Promise<any[]>;
    consentedCounts(): Promise<Map<string, number>>;
    isExampleUser(u: any): boolean;
    computeStage(u: any, consented: number, trainingDone: readonly string[]): string;
    trainingCompletions(userIds: readonly string[]): Promise<Map<string, string[]>>;
    seasonsCompleted(): number;
  },
): Promise<Map<string, number>> {
  const measured = new Map<string, number>();
  const asked = Array.from(wanted);

  if (asked.some((m) => m === "seats_filled" || m.startsWith("seats_filled_in:"))) {
    const [roles, assignments] = await Promise.all([
      listOrgRoles(pool),
      listOrgAssignments(pool, deps.lapseContext()),
    ]);
    const bySeat = new Map<string, OrgAssignment[]>();
    // See the header. `peopleOnly` is the one filter every coverage read uses.
    for (const a of peopleOnly(assignments)) {
      if (a.isExample) continue;
      bySeat.set(a.orgRoleId, [...(bySeat.get(a.orgRoleId) ?? []), a]);
    }
    const live = roles.filter((r) => r.active && !r.isExample);
    const filled = live.filter((r) => seatState(r, bySeat.get(r.id) ?? []) === "filled");
    measured.set("seats_filled", filled.length);
    for (const m of asked) {
      if (!m.startsWith("seats_filled_in:")) continue;
      const circleId = m.slice("seats_filled_in:".length);
      measured.set(m, filled.filter((r) => r.circleId === circleId).length);
    }
  }

  if (asked.some((m) => m.startsWith("members_at_stage:"))) {
    const [allMembers, consented] = await Promise.all([deps.allMembers(), deps.consentedCounts()]);
    const real = allMembers.filter((u) => !deps.isExampleUser(u));
    // One query for the roll, beside the grouped count above it. The stage
    // ladder now reads the server's training record rather than a member field.
    const trained = await deps.trainingCompletions(real.map((u: any) => String(u.id)));
    for (const m of asked) {
      if (!m.startsWith("members_at_stage:")) continue;
      const floor = stageIndex(m.slice("members_at_stage:".length));
      if (floor < 0) continue;
      measured.set(
        m,
        real.filter((u) => stageIndex(deps.computeStage(u, Number(consented.get(u.id) ?? 0), trained.get(String(u.id)) ?? [])) >= floor)
          .length,
      );
    }
  }

  if (wanted.has("seasons_completed")) measured.set("seasons_completed", deps.seasonsCompleted());

  return measured;
}

/**
 * Every draft with its changes. Takes a CONNECTION as happily as a pool,
 * so `publishDraft` can read the draft inside its own transaction and act
 * on the same snapshot it wrote against.
 */
export async function listDrafts(pool: Pool | PoolConnection): Promise<Draft[]> {
  const [drafts]: any = await pool.query("SELECT * FROM org_drafts ORDER BY created_at DESC");
  const [changes]: any = await pool.query("SELECT * FROM org_draft_changes ORDER BY sort_order, id");
  const byDraft = new Map<string, DraftChange[]>();
  for (const c of changes as any[]) {
    byDraft.set(c.draft_id, [...(byDraft.get(c.draft_id) ?? []), rowToChange(c)]);
  }
  return (drafts as any[]).map((d) => ({
    id: d.id, title: d.title, rationale: d.rationale ?? null,
    status: d.status, threadId: d.thread_id ?? null, createdBy: d.created_by ?? null,
    publishedAt: d.published_at ? new Date(d.published_at).toISOString() : null,
    revertedAt: d.reverted_at ? new Date(d.reverted_at).toISOString() : null,
    changes: byDraft.get(d.id) ?? [],
    vision: (asJson(d.vision) as VisionBlock | null) ?? null,
    sourceKind: String(d.source_kind ?? "human"),
    sourceModuleId: d.source_module_id ? String(d.source_module_id) : null,
    sourceProposalId: d.source_proposal_id ? String(d.source_proposal_id) : null,
    cites: Array.isArray(d.cites)
      ? (d.cites as unknown[]).map((c) => String(c))
      : (() => {
          try {
            const parsed = JSON.parse(String(d.cites ?? "[]"));
            return Array.isArray(parsed) ? parsed.map((c: unknown) => String(c)) : [];
          } catch {
            return [];
          }
        })(),
  }));
}

/**
 * How many changes one draft may carry, and how many open drafts may stand.
 *
 * Same shape and same reasoning as `roleBatchCap` in drafts.ts, whose comment
 * names seeding aspirational structure as the harm on the platform's
 * never-build list. A meeting extractor emitting role updates per meeting is
 * that machine, running weekly. Twenty-four seats over eight people is a chart
 * nobody maintains, and forty open drafts is a review queue nobody opens.
 *
 * The floor of 3 exists so a village of one founder can still be given
 * somewhere to start. A HUMAN IS NOT CAPPED: a founder reorganising their own
 * village is doing the thing this table was built for, and the cap answers a
 * machine proposing structure faster than a village can read it.
 */
export function draftChangeCap(activeMembers: number): number {
  return Math.max(3, activeMembers * 3);
}

export function openDraftCap(activeMembers: number): number {
  return Math.max(3, activeMembers);
}

export async function createDraft(
  pool: Pool,
  body: {
    title: string;
    rationale?: string | null;
    threadId?: string | null;
    createdBy?: string | null;
    /** 'human' unless a machine proposed it. See the Draft interface. */
    sourceKind?: string | null;
    sourceModuleId?: string | null;
    sourceProposalId?: string | null;
    cites?: string[] | null;
    /**
     * How many open drafts a machine-sourced draft may stand beside. Omitted
     * means no cap, which is the right answer for a human and the wrong one
     * for anything else, so the caller has to decide out loud.
     */
    openCap?: number | null;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sourceKind = String(body.sourceKind ?? "human");
  if (sourceKind !== "human" && body.openCap !== null && body.openCap !== undefined) {
    const [[open]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM org_drafts WHERE status = 'open' AND source_kind <> 'human'",
    );
    if (Number(open?.n ?? 0) >= body.openCap) {
      return {
        ok: false,
        error: `There are already ${body.openCap} proposed reorganisations waiting. Decide on some before more arrive.`,
      };
    }
  }
  const id = newId("draft");
  await pool.query(
    "INSERT INTO org_drafts (id, title, rationale, thread_id, created_by, source_kind, source_module_id, " +
      "source_proposal_id, cites) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, String(body.title || "Untitled reorganisation").slice(0, 200), body.rationale ?? null,
      body.threadId ?? null, body.createdBy ?? null, sourceKind, body.sourceModuleId ?? null,
      body.sourceProposalId ?? null, JSON.stringify(body.cites ?? [])],
  );
  return { ok: true, id };
}

export async function addChange(
  pool: Pool,
  draftId: string,
  body: { op: DraftOp; orgRoleId: string; payload?: any },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const [[d]] = await pool.query<any[]>("SELECT status FROM org_drafts WHERE id = ?", [draftId]);
  if (!d) return { ok: false, error: "No such draft" };
  // A published draft is a record of what happened. Editing it would make the
  // revert data describe a change nobody made.
  if (d.status !== "open") return { ok: false, error: `This draft is ${d.status} and can no longer be edited` };
  const [[n]] = await pool.query<any[]>(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM org_draft_changes WHERE draft_id = ?", [draftId],
  );
  const id = newId("dch");
  await pool.query(
    "INSERT INTO org_draft_changes (id, draft_id, op, org_role_id, payload, sort_order) VALUES (?,?,?,?,?,?)",
    [id, draftId, body.op, body.orgRoleId, JSON.stringify(body.payload ?? {}), Number(n?.next ?? 1)],
  );
  return { ok: true, id };
}

export interface PreviewLine {
  changeId: string;
  op: DraftOp;
  orgRoleId: string;
  /** What this does, in the words somebody would use about it. */
  reads: string;
  /** Why it cannot be applied, or null. */
  blocked: string | null;
}

/**
 * What this draft would do, and what refuses.
 *
 * Same shape as the season roll's dry run, which is the existing template for
 * "bulk structural apply" in this codebase: preview everything, refuse the
 * WHOLE thing if any single change is blocked, and never half-apply.
 */
export async function previewDraft(
  /**
   * A pool, or the connection of a transaction in progress. `publishDraft`
   * passes its own connection so the state the preview VALIDATES is the
   * state the writes then change, with no window in between for another
   * request to move a seat out from under a check that already passed.
   */
  pool: Pool | PoolConnection,
  draftId: string,
  /**
   * The volume cap, from `draftChangeCap`. Applied only to a machine-sourced
   * draft; omitted means no cap, which is the right answer for a human.
   */
  changeCap?: number | null,
): Promise<{ lines: PreviewLine[]; blocked: number }> {
  const drafts = await listDrafts(pool);
  const draft = drafts.find((d) => d.id === draftId);
  if (!draft) return { lines: [], blocked: 0 };

  const [roles]: any = await pool.query("SELECT id, name, is_example, active FROM org_roles");
  const byId = new Map((roles as any[]).map((r) => [String(r.id), r]));
  const [circles]: any = await pool.query("SELECT id FROM circles WHERE is_example = 0");
  const circleIds = new Set((circles as any[]).map((c) => String(c.id)));
  // Live seat names, lowercased, for the duplicate-structure check below.
  const liveNames = new Map<string, string>();
  for (const r of roles as any[]) {
    if (r.is_example || !r.active) continue;
    liveNames.set(String(r.name ?? "").trim().toLowerCase(), String(r.id));
  }
  // A machine-sourced draft is held to more than a human one, and the extra
  // rules are all below. `machine` is the switch.
  const machine = draft.sourceKind !== "human";
  const cap = changeCap ?? Infinity;
  // Seats this draft creates count as existing for the changes after them, so
  // a draft can create a seat and then put somebody in it.
  const willExist = new Set(draft.changes.filter((c) => c.op === "create_seat").map((c) => c.orgRoleId));

  const lines: PreviewLine[] = [];
  let index = 0;
  for (const c of draft.changes) {
    const existing = byId.get(c.orgRoleId);
    const name = existing?.name ?? c.payload?.name ?? c.orgRoleId;
    let blocked: string | null = null;
    let reads = "";
    index += 1;

    /*
     * ── THE MACHINE RULES (0143) ──────────────────────────────────────────
     *
     * Four blocks that apply to every op, and only to a draft a machine wrote.
     * A founder typing in the admin panel meets none of them, because a
     * founder reorganising their own village is the thing this table is for.
     *
     * A HOLDER IS THE ONE A MISTAKE CANNOT BE UNDONE FROM. Structure yes,
     * occupancy no: filling a seat is a human act performed by a human in the
     * game, and a proposal naming a holder would write a person's name into
     * the org chart on a machine's say-so. `SEAT_FIELDS` already keeps
     * `represents_circle` out by construction; this keeps the WHOLE op out.
     *
     * THE VOLUME CAP is the other one worth reading twice. Seeding
     * aspirational structure is on the platform's never-build list and a
     * weekly meeting extractor is that machine. The cap is on the DRAFT rather
     * than on the table, so a village can still accept many drafts over time
     * and cannot be handed one carrying forty seats at once.
     */
    if (machine && (c.op === "seat_holder" || c.op === "end_holding")) {
      blocked = "A proposal never names who holds a seat. Structure can be proposed; occupancy is a human act";
    } else if (machine && index > cap) {
      blocked = `This proposal is past this village's limit of ${cap} changes in one reorganisation`;
    } else if (machine && c.op === "rest_seat") {
      blocked = "A proposal never rests an existing seat. Removing a seat from the chart is a human decision";
    }

    if (blocked) {
      lines.push({ changeId: c.id, op: c.op, orgRoleId: c.orgRoleId, reads: `${c.op} on ${name}`, blocked });
      continue;
    }

    if (c.op === "create_seat") {
      reads = `Create the seat "${c.payload?.name ?? c.orgRoleId}"`;
      if (existing) blocked = "A seat with that id already exists";
      if (c.payload?.circleId && !circleIds.has(String(c.payload.circleId))) {
        blocked = "That circle does not exist. A draft cannot create circles";
      }
      /*
       * ── THE SHAPE RULES, which the old block list did not have ──────────
       *
       * Every one of these was reachable before. The list checked id
       * collision, unknown circle, seat existence and example rows, which is
       * the right list for a human who typed the form and the wrong one for a
       * model's output: a nameless seat, a seat named the same as a live one,
       * and a seat asking for four hundred holders all previewed as fine and
       * applied.
       *
       * A NAME COLLISION IS BLOCKED AND AN ID COLLISION IS TOO, and they are
       * different failures. Two seats can legally carry the same name in this
       * schema, and two seats carrying the same name is how a village ends up
       * with an org chart nobody can navigate. It is blocked rather than
       * renamed, because renaming somebody's proposal to make it fit is the
       * one thing a preview must never do quietly.
       */
      const proposed = String(c.payload?.name ?? "").trim();
      if (!blocked && proposed === "") blocked = "A seat needs a name";
      if (!blocked && proposed.length > 120) blocked = "That seat name is longer than a seat name can be";
      if (!blocked && liveNames.has(proposed.toLowerCase())) {
        blocked = `This village already has a live seat called "${proposed}"`;
      }
      const seats = c.payload?.seats;
      if (!blocked && seats !== undefined && seats !== null) {
        const n = Number(seats);
        if (!Number.isInteger(n) || n < 1 || n > 50) blocked = "A seat holds between 1 and 50 people";
      }
      const crit = c.payload?.criticality;
      if (!blocked && crit !== undefined && crit !== null && !["normal", "high"].includes(String(crit))) {
        blocked = "Criticality is normal or high";
      }
    } else {
      if (!existing && !willExist.has(c.orgRoleId)) blocked = "That seat no longer exists";
      // Standing examples are inert everywhere else and must be here too, or a
      // draft becomes the one door that edits demo data into the real chart.
      else if (existing?.is_example) blocked = "That is a standing example seat";

      if (c.op === "update_seat") {
        reads = `Edit ${name}`;
        // A change naming nothing this village can apply is not a change. It
        // previewed as "Edit <seat>", applied as an UPDATE with an empty SET
        // list, and left a reader believing something happened.
        const touched = Object.keys(c.payload ?? {}).filter((k) => k in SEAT_FIELDS);
        if (!blocked && touched.length === 0) {
          blocked = "This names no field this village can change on a seat";
        }
        const n2 = c.payload?.seats;
        if (!blocked && n2 !== undefined && n2 !== null) {
          const v = Number(n2);
          if (!Number.isInteger(v) || v < 1 || v > 50) blocked = "A seat holds between 1 and 50 people";
        }
        if (!blocked && c.payload?.circleId && !circleIds.has(String(c.payload.circleId))) {
          blocked = "That circle does not exist. A draft cannot create circles";
        }
      }
      if (c.op === "rest_seat") reads = `Rest ${name}, so it stops appearing on the chart`;
      if (c.op === "seat_holder") reads = `Put ${c.payload?.displayName ?? "a member"} in ${name}`;
      if (c.op === "end_holding") reads = `End a holding on ${name}`;
    }
    lines.push({ changeId: c.id, op: c.op, orgRoleId: c.orgRoleId, reads, blocked });
  }
  return { lines, blocked: lines.filter((l) => l.blocked).length };
}

/**
 * Apply every change, or none.
 *
 * One connection, one transaction. `before_json` is captured HERE, inside it,
 * so what a revert undoes is what was actually there at the moment of publish.
 */
export async function publishDraft(
  pool: Pool,
  draftId: string,
  publishedBy: string | null,
  /**
   * The volume cap, from `draftChangeCap`, passed through to the preview.
   *
   * THIS PARAMETER IS THE DIFFERENCE BETWEEN A GATE AND A SUGGESTION. Publish
   * refuses a draft with any blocked line, and the machine rules that produce
   * those lines are derived from the draft's own `source_kind` inside
   * `previewDraft`, so the one that matters most (a proposal never names who
   * holds a seat) already holds here whether or not a caller passes this. The
   * numeric cap is the one thing the preview cannot work out on its own,
   * because it depends on how many people the village has. Omitted means no
   * cap, which is the right answer for a draft a founder typed.
   */
  changeCap?: number | null,
): Promise<{ ok: true; applied: number; seated: DraftSeating[] } | { ok: false; error: string }> {
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // READ INSIDE THE TRANSACTION. These used to run on the pool before
    // `beginTransaction`, so the seats the preview approved and the draft
    // status it trusted were both read from a snapshot the writes below
    // never saw. Two publishes of one draft could each pass the status
    // check out here and then both apply.
    const preview = await previewDraft(conn, draftId, changeCap);
    if (!preview.lines.length) { await conn.rollback(); return { ok: false, error: "This draft has no changes in it" }; }
    if (preview.blocked > 0) {
      const first = preview.lines.find((l) => l.blocked);
      await conn.rollback();
      return { ok: false, error: `${preview.blocked} change(s) cannot be applied. First: ${first?.blocked}` };
    }
    const draft = (await listDrafts(conn)).find((d) => d.id === draftId);
    if (!draft) { await conn.rollback(); return { ok: false, error: "No such draft" }; }
    if (draft.status !== "open") { await conn.rollback(); return { ok: false, error: `This draft is already ${draft.status}` }; }

    /*
     * SEATINGS ARE COLLECTED, NEVER NOTIFIED FROM IN HERE.
     *
     * `notify` writes rows of its own, and a rollback after one had been
     * sent would leave a member told they hold a seat that no publish ever
     * applied. So the transaction only records WHO, and the caller tells
     * them once the commit has actually happened.
     *
     * The seat name and aim are read in here on purpose: read afterwards,
     * a later edit would put different words in the message than the ones
     * this publish wrote.
     */
    const seated: DraftSeating[] = [];
    for (const c of draft.changes) {
      const before = await captureBefore(conn, c);
      await conn.query("UPDATE org_draft_changes SET before_json = ? WHERE id = ?", [JSON.stringify(before), c.id]);
      const s = await applyChange(conn, c);
      if (s) seated.push(s);
    }
    // THE WHOLE POINT OF THE `status = 'open'` CLAUSE IS THIS COUNT.
    //
    // The guard was here and its result was thrown away, so a second
    // publish of the same draft matched zero rows, committed anyway and
    // answered 200. That is not merely a duplicate: `before_json` is
    // rewritten above with whatever is there NOW, so the second pass
    // overwrote every revert value with the ALREADY-PUBLISHED state and
    // the draft became unrevertable behind a success.
    const [done]: any = await conn.query(
      "UPDATE org_drafts SET status = 'published', published_by = ?, published_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'",
      [publishedBy, draftId],
    );
    if (!done?.affectedRows) {
      await conn.rollback();
      return { ok: false, error: "This draft was published by someone else while this was being applied" };
    }
    await conn.commit();
    return { ok: true, applied: draft.changes.length, seated };
  } catch (e: any) {
    await conn.rollback();
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    conn.release();
  }
}

async function captureBefore(conn: PoolConnection, c: DraftChange): Promise<any> {
  if (c.op === "create_seat") return null;
  if (c.op === "seat_holder") return null;
  if (c.op === "end_holding") {
    const [[row]] = await conn.query<any[]>(
      "SELECT id, org_role_id, holder_kind, user_id, display_name, holder_key, focus, note, season_id, term_ends_at FROM org_role_assignments WHERE id = ?",
      [String(c.payload?.assignmentId ?? "")],
    );
    return row ?? null;
  }
  const [[row]] = await conn.query<any[]>(
    "SELECT id, circle_id, name, aim, domain, accountabilities, why_it_matters, seats, criticality, active, recruiting FROM org_roles WHERE id = ?",
    [c.orgRoleId],
  );
  return row ?? null;
}

/** Column names are a fixed map, never interpolated from a payload key. */
const SEAT_FIELDS: Record<string, string> = {
  name: "name", circleId: "circle_id", aim: "aim", domain: "domain",
  whyItMatters: "why_it_matters", seats: "seats", criticality: "criticality",
  recruiting: "recruiting",
};

/** The seating a change made, for the caller to tell the person about. */
export interface DraftSeating {
  userId: string;
  orgRoleId: string;
  assignmentId: string;
  /** Read here, inside the transaction, so the words match what was applied. */
  seatName: string;
  seatAim: string | null;
}

async function applyChange(conn: PoolConnection, c: DraftChange): Promise<DraftSeating | null> {
  const p = c.payload ?? {};
  if (c.op === "create_seat") {
    await conn.query(
      "INSERT INTO org_roles (id, name, circle_id, aim, domain, accountabilities, seats) VALUES (?,?,?,?,?,?,?)",
      [c.orgRoleId, String(p.name ?? c.orgRoleId), p.circleId ?? null, p.aim ?? null, p.domain ?? null,
        JSON.stringify(Array.isArray(p.accountabilities) ? p.accountabilities : []), Number(p.seats ?? 1)],
    );
    return null;
  }
  if (c.op === "rest_seat") {
    await conn.query("UPDATE org_roles SET active = 0 WHERE id = ?", [c.orgRoleId]);
    return null;
  }
  if (c.op === "seat_holder") {
    /*
     * THROUGH `seatHolder`, NOT A SECOND INSERT BESIDE IT.
     *
     * This branch built its own holder key with an inline slug that was
     * MISSING the trailing-dash trim `documentedKey` does, so "Alex "
     * became `doc:alex` through the seating route and `doc:alex-` through a
     * draft. The unique index on the active holder key therefore could not
     * see that those were one person, and the same human could be seated
     * twice in the same seat.
     *
     * Going through the real function also buys the refusals: a documented
     * holder with no name is caught here, and a duplicate answers "They
     * already hold this seat" instead of surfacing a raw MySQL ER_DUP_ENTRY
     * string to whoever pressed Publish.
     */
    const seated = await seatHolder(conn, c.orgRoleId, {
      userId: p.userId ? String(p.userId) : null,
      displayName: p.displayName ?? null,
      focus: p.focus ?? null,
      seasonId: p.seasonId ?? null,
    });
    if (!seated.ok) throw new Error(seated.reason ?? "That seating could not be applied");
    // Only a MEMBER can be told. A documented holder has no account to
    // reach, which is the same rule the direct seating route follows.
    if (!p.userId || !seated.assignmentId) return null;
    const [[seat]] = await conn.query<any[]>("SELECT name, aim FROM org_roles WHERE id = ?", [c.orgRoleId]);
    return {
      userId: String(p.userId),
      orgRoleId: c.orgRoleId,
      assignmentId: seated.assignmentId,
      seatName: String(seat?.name ?? c.orgRoleId),
      seatAim: seat?.aim ? String(seat.aim) : null,
    };
    return null;
  }
  if (c.op === "end_holding") {
    await conn.query(
      "UPDATE org_role_assignments SET ended_at = CURRENT_TIMESTAMP, ended_reason = ? WHERE id = ? AND ended_at IS NULL",
      [String(p.reason ?? "reorganisation").slice(0, 200), String(p.assignmentId ?? "")],
    );
    return null;
  }
  // update_seat: only the fields the draft names, mapped through a fixed
  // table. A payload key is never used as a column name.
  const sets: string[] = [];
  const args: any[] = [];
  for (const [key, col] of Object.entries(SEAT_FIELDS)) {
    if (p[key] === undefined) continue;
    sets.push(`\`${col}\` = ?`);
    args.push(p[key]);
  }
  if (Array.isArray(p.accountabilities)) {
    sets.push("`accountabilities` = ?");
    args.push(JSON.stringify(p.accountabilities));
  }
  if (!sets.length) return null;
  args.push(c.orgRoleId);
  await conn.query(`UPDATE org_roles SET ${sets.join(", ")} WHERE id = ?`, args);
  return null;
}

/**
 * Put back what was there, from `before_json`.
 *
 * In REVERSE order, because the changes were applied forwards and a draft that
 * creates a seat and then seats somebody in it has to be undone the other way
 * round or the seat is gone before its holder is.
 *
 * A revert is honest about what it cannot do: a seat created by the draft is
 * RESTED rather than deleted, because deleting it would take its journal and
 * any holding history with it, and history is the thing this whole model is
 * for.
 */
export async function revertDraft(
  pool: Pool,
  draftId: string,
): Promise<{ ok: true; reverted: number } | { ok: false; error: string }> {
  const drafts = await listDrafts(pool);
  const draft = drafts.find((d) => d.id === draftId);
  if (!draft) return { ok: false, error: "No such draft" };
  if (draft.status !== "published") return { ok: false, error: "Only a published draft can be reverted" };

  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const c of [...draft.changes].reverse()) {
      if (c.op === "create_seat") {
        await conn.query("UPDATE org_roles SET active = 0 WHERE id = ?", [c.orgRoleId]);
      } else if (c.op === "seat_holder") {
        await conn.query(
          "UPDATE org_role_assignments SET ended_at = CURRENT_TIMESTAMP, ended_reason = 'draft reverted' WHERE org_role_id = ? AND ended_at IS NULL AND holder_key = ?",
          // The same key `applyChange` seated under, from the same function.
          // Built by hand here it did not match, so reverting a seating of
          // anyone whose name ended in a space or punctuation ended nothing
          // and reported success.
          [c.orgRoleId, c.payload?.userId ? String(c.payload.userId)
            : documentedKey(String(c.payload?.displayName ?? "unnamed"))],
        );
      } else if (c.op === "end_holding" && c.beforeJson) {
        const b = c.beforeJson;
        // A NEW row, not a resurrection of the old id. `active_holder_key` is
        // a generated column under a unique index, and the ended row still
        // holds the seat's history; clearing its ended_at would rewrite the
        // past to look as though the person never left.
        await conn.query(
          `INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, display_name, holder_key, focus, note, season_id, term_ends_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [newId("orgasg"), b.org_role_id, b.holder_kind, b.user_id, b.display_name, b.holder_key,
            b.focus, b.note ?? null, b.season_id, b.term_ends_at],
        );
      } else if (c.beforeJson) {
        const b = c.beforeJson;
        await conn.query(
          `UPDATE org_roles SET circle_id = ?, name = ?, aim = ?, domain = ?, accountabilities = ?,
             why_it_matters = ?, seats = ?, criticality = ?, active = ?, recruiting = ? WHERE id = ?`,
          [b.circle_id, b.name, b.aim, b.domain,
            typeof b.accountabilities === "string" ? b.accountabilities : JSON.stringify(b.accountabilities ?? []),
            b.why_it_matters, b.seats, b.criticality, b.active, b.recruiting, c.orgRoleId],
        );
      }
    }
    // Same count, same reason as publish: without it a second revert put
    // every `before_json` value back a second time and reported success.
    const [done]: any = await conn.query(
      "UPDATE org_drafts SET status = 'reverted', reverted_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'published'",
      [draftId],
    );
    if (!done?.affectedRows) {
      await conn.rollback();
      return { ok: false, error: "This draft was reverted by someone else while this was being undone" };
    }
    await conn.commit();
    return { ok: true, reverted: draft.changes.length };
  } catch (e: any) {
    await conn.rollback();
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    conn.release();
  }
}

/**
 * Withdraw an open draft, which is the way OUT of one that cannot publish.
 *
 * WHY THIS HAD TO EXIST. Before it, the only status writes in this file were
 * open to published and published to reverted. A draft carrying any blocked
 * line cannot publish (`publishDraft` refuses on `preview.blocked > 0`), no
 * change can be removed from an open draft, and nothing could close one. So a
 * blocked draft was unpublishable AND unclosable, and it held one of the
 * `openDraftCap` slots forever. Three of them jam org drafts permanently.
 *
 * That is not hypothetical. A vendor's first import is one large org batch:
 * `addChange` applies no cap, so all of it is written, and then `previewDraft`
 * blocks everything past `draftChangeCap`, or blocks a seat naming a circle
 * that does not exist yet, which is the ordinary case for a first import.
 *
 * The status already allowed this. `org_drafts.status` has been
 * enum('open','published','reverted','withdrawn') since 0056; the schema
 * anticipated a withdraw and the code never wrote one. No migration.
 *
 * A withdrawn draft is kept rather than deleted, because it is the record of a
 * reorganisation somebody proposed and abandoned, and its changes explain why.
 */
export async function withdrawDraft(
  pool: Pool,
  draftId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await withdrawDraftRow(pool, draftId)) return { ok: true };
  // Say which of the two reasons it was, because "that did not work" on a
  // draft a steward is trying to unjam is the least useful sentence available.
  const status = await draftStatus(pool, draftId);
  if (status === null) return { ok: false, error: "No such draft" };
  return { ok: false, error: `This draft is ${status}, and only an open draft can be withdrawn` };
}

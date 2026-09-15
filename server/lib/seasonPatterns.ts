/**
 * Season patterns (0050): the working setup of a season, saved and picked up
 * again next year.
 *
 * A pattern is a MEMBERSHIP LIST over rows that already exist. Nothing is
 * copied, so one seat can belong to the festival pattern and the building
 * pattern at once, and editing it edits it everywhere with its history
 * unbroken. Nothing is deleted either: leaving a pattern removes a membership
 * row, and the seat stays in the village's catalogue for any future season.
 *
 * THE RESOLUTION RULE, and the reason this is safe to ship:
 *
 *   A row with NO pattern memberships at all is permanent and always live.
 *
 * So a village that never touches patterns sees no change whatsoever. You opt
 * in by adding a membership, never by remembering not to.
 *
 * HOW A SEASON TURN ACTUALLY TAKES EFFECT. The roll writes the lifecycle
 * columns that every existing query already respects (`circles.status`,
 * `quests.status`, `org_roles.active`) instead of adding a second dimension
 * to roughly forty hand-written reads. The one place that would have been a
 * filter is badges, and that resolves through a single seam instead: see
 * activeBadgeIds below.
 *
 * The roll is a HUMAN act with a dry run, never a scheduled job. That is the
 * platform's rule for cycle close and season roll both (ARCHITECTURE.md
 * invariant 14), and it is what makes the preview meaningful.
 */
import type { Pool } from "mysql2/promise";
import { applyCircleStatusChanges, type CircleStatusOutcome } from "./circleTreasury";
import { listBudgets } from "./resources";

export type PatternKind = "circle" | "org_role" | "badge" | "quest";

export interface SeasonPattern {
  id: string;
  name: string;
  description: string | null;
  recurrence: "once" | "recurring";
}

export interface PatternMember {
  patternId: string;
  kind: PatternKind;
  entityId: string;
}

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export async function listPatterns(pool: Pool): Promise<SeasonPattern[]> {
  const [rows]: any = await pool.query(
    "SELECT id, name, description, recurrence FROM season_patterns ORDER BY name",
  );
  return rows as SeasonPattern[];
}

export async function createPattern(pool: Pool, body: any): Promise<string> {
  const id =
    String(body?.id ?? body?.name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || `pattern-${Date.now().toString(36)}`;
  await pool.query(
    "INSERT INTO season_patterns (id, name, description, recurrence) VALUES (?,?,?,?)",
    [id, String(body?.name ?? "New season"), body?.description ?? null,
     body?.recurrence === "once" ? "once" : "recurring"],
  );
  return id;
}

export async function listMembers(pool: Pool, patternId?: string): Promise<PatternMember[]> {
  const [rows]: any = patternId
    ? await pool.query(
        "SELECT pattern_id, kind, entity_id FROM season_pattern_members WHERE pattern_id = ?",
        [patternId],
      )
    : await pool.query("SELECT pattern_id, kind, entity_id FROM season_pattern_members");
  return (rows as any[]).map((r) => ({ patternId: r.pattern_id, kind: r.kind, entityId: r.entity_id }));
}

export async function addMember(pool: Pool, patternId: string, kind: PatternKind, entityId: string): Promise<void> {
  await pool.query(
    "INSERT IGNORE INTO season_pattern_members (id, pattern_id, kind, entity_id) VALUES (?,?,?,?)",
    [newId("spm"), patternId, kind, entityId],
  );
}

/** Leaving a pattern is a membership removal. The row itself is untouched. */
export async function removeMember(pool: Pool, patternId: string, kind: PatternKind, entityId: string): Promise<void> {
  await pool.query(
    "DELETE FROM season_pattern_members WHERE pattern_id = ? AND kind = ? AND entity_id = ?",
    [patternId, kind, entityId],
  );
}

/**
 * Which entities of a kind should be live for a given pattern.
 *
 * Returns null when patterns are not in use for that kind at all, which the
 * callers read as "everything stays as it is". That distinction matters: an
 * empty set means "this pattern includes none of them", and null means
 * "nobody has expressed an opinion", and those must not do the same thing.
 */
export function resolveLive(
  members: PatternMember[],
  kind: PatternKind,
  patternId: string | null,
): { governed: Set<string>; live: Set<string> } | null {
  const ofKind = members.filter((m) => m.kind === kind);
  if (!ofKind.length) return null;
  // A row named by ANY pattern is governed by patterns; one named by none is
  // permanent and never touched by a roll.
  const governed = new Set(ofKind.map((m) => m.entityId));
  const live = new Set(
    patternId ? ofKind.filter((m) => m.patternId === patternId).map((m) => m.entityId) : [],
  );
  return { governed, live };
}

// ── Badges: the one seam ────────────────────────────────────────────────────

/**
 * The badges whose POWERS are live for the current season.
 *
 * Badge-granted capabilities flow through exactly one query (badgeGrantsFor in
 * server/lib/badges.ts, called only from capabilityCtx), so seasonal scope
 * costs one clause in one place rather than an audit of every read.
 *
 * A `permanent` badge is always here. A `seasonal` badge is here only while a
 * season running a pattern that includes it is current. Either way the AWARD
 * survives untouched: the badge stays on the profile with its history, and
 * only the power sleeps.
 */
export async function seasonallyDormantBadgeIds(
  pool: Pool,
  currentPatternId: string | null,
): Promise<string[]> {
  const [rows]: any = await pool.query(
    "SELECT id FROM badges WHERE season_scope = 'seasonal'",
  );
  const seasonal = (rows as any[]).map((r) => r.id as string);
  if (!seasonal.length) return [];
  if (!currentPatternId) return seasonal;
  const members = await listMembers(pool, currentPatternId);
  const live = new Set(members.filter((m) => m.kind === "badge").map((m) => m.entityId));
  return seasonal.filter((id) => !live.has(id));
}

/**
 * A member's live reward multiplier, from every badge they hold whose powers
 * are awake. Multipliers compound, because two distinct standings both being
 * honoured is the behaviour a village expects.
 */
/** No stack of badges may multiply a reward past this. Caps fail closed. */
export const MAX_REWARD_MULTIPLIER = 3;

export async function rewardMultiplierFor(
  pool: Pool,
  userId: string,
  dormant: string[],
): Promise<number> {
  const [rows]: any = await pool.query(
    `SELECT b.id, b.multiplier FROM badge_awards a
       JOIN badges b ON b.id = a.badge_id
      WHERE a.user_id = ? AND b.active = 1 AND b.multiplier IS NOT NULL
        AND a.is_example = 0 AND b.is_example = 0
        -- A self badge is a member's own declaration and a hypha badge is an
        -- external mirror. Both gate nothing by design, and a reward
        -- multiplier is a power, so neither may carry one: self-claiming is
        -- an open route, and it must never reach the faucet.
        AND b.kind NOT IN ('self','hypha')
        AND (a.expires_at IS NULL OR a.expires_at > NOW())`,
    [userId],
  );
  const skip = new Set(dormant);
  let m = 1;
  for (const r of rows as any[]) {
    if (skip.has(r.id)) continue;
    const v = Number(r.multiplier);
    if (Number.isFinite(v) && v > 0) m *= v;
  }
  // Multipliers compound, so a handful of generous badges could otherwise
  // mint an unbounded amount from a faucet that cannot refuse it. The consent
  // cap governs the quest; this governs the person.
  return Math.min(m, MAX_REWARD_MULTIPLIER);
}

// ── The roll ────────────────────────────────────────────────────────────────

export interface RollChange {
  kind: PatternKind;
  entityId: string;
  name: string;
  from: string;
  to: string;
}

export interface RollBlock {
  kind: PatternKind;
  entityId: string;
  name: string;
  reason: string;
}

export interface RollPlan {
  patternId: string | null;
  patternName: string | null;
  changes: RollChange[];
  blocked: RollBlock[];
  /**
   * Seats whose holdings lapse at this turn, given the village's cadence.
   *
   * A PREVIEW of derived state, and applyRoll deliberately does not touch
   * these. Lapsing is computed on every read from the seating's season and
   * term (orgChart.isLapsed), so a turn writes nothing and the state cannot
   * drift from the calendar. Nothing is revoked either: the holder keeps
   * acting and the seat reads `expired`, meaning held and openly waiting to
   * be reassigned.
   *
   * If you came here expecting applyRoll to end these, read isLapsed first.
   */
  lapsing: Array<{ orgRoleId: string; name: string; holders: number }>;
}

/**
 * Work out what a roll WOULD do. No writes.
 *
 * Blocking is the settle-first rule the platform already applies when a quest
 * is deleted with claims in flight and when a module is disabled with value
 * outstanding: value that is owed gets settled before the shape changes
 * underneath it.
 */
export async function planRoll(
  pool: Pool,
  opts: { patternId: string | null; cadence: string },
): Promise<RollPlan> {
  const members = await listMembers(pool);
  const changes: RollChange[] = [];
  const blocked: RollBlock[] = [];

  const [patRow]: any = opts.patternId
    ? await pool.query("SELECT name FROM season_patterns WHERE id = ?", [opts.patternId])
    : [[]];
  const patternName = (patRow as any[])[0]?.name ?? null;

  // ── Circles: active or dormant ────────────────────────────────────────────
  const circleRes = resolveLive(members, "circle", opts.patternId);
  if (circleRes) {
    const [rows]: any = await pool.query("SELECT id, name, status FROM circles");
    for (const c of rows as any[]) {
      if (!circleRes.governed.has(c.id)) continue;
      const want = circleRes.live.has(c.id) ? "active" : "dormant";
      if (c.status !== want) {
        changes.push({ kind: "circle", entityId: c.id, name: c.name, from: c.status, to: want });
      }
    }
  }

  // ── Seats: active or not ─────────────────────────────────────────────────
  const seatRes = resolveLive(members, "org_role", opts.patternId);
  if (seatRes) {
    const [rows]: any = await pool.query("SELECT id, name, active FROM org_roles");
    for (const r of rows as any[]) {
      if (!seatRes.governed.has(r.id)) continue;
      const want = seatRes.live.has(r.id) ? 1 : 0;
      if (Number(r.active) !== want) {
        changes.push({
          kind: "org_role", entityId: r.id, name: r.name,
          from: Number(r.active) ? "active" : "resting",
          to: want ? "active" : "resting",
        });
      }
    }
  }

  // ── Quests: on the board, or seasonal ────────────────────────────────────
  const questRes = resolveLive(members, "quest", opts.patternId);
  if (questRes) {
    const [rows]: any = await pool.query("SELECT id, title, status FROM quests");
    const [claims]: any = await pool.query(
      "SELECT quest_id, COUNT(*) n FROM quest_claims WHERE status IN ('claimed','submitted') GROUP BY quest_id",
    );
    const inFlight = new Map((claims as any[]).map((c) => [c.quest_id, Number(c.n)]));
    for (const q of rows as any[]) {
      if (!questRes.governed.has(q.id)) continue;
      const live = questRes.live.has(q.id);
      const isOpen = String(q.status).toLowerCase() === "open";
      if (live && !isOpen) {
        changes.push({ kind: "quest", entityId: q.id, name: q.title, from: q.status, to: "Open" });
      } else if (!live && isOpen) {
        const n = inFlight.get(q.id) ?? 0;
        if (n > 0) {
          // Taking a quest off the board while somebody is part-way through
          // it strands work that was promised a reward.
          blocked.push({
            kind: "quest", entityId: q.id, name: q.title,
            reason: `${n} claim${n === 1 ? "" : "s"} still in flight, consent or decline first`,
          });
        } else {
          changes.push({ kind: "quest", entityId: q.id, name: q.title, from: q.status, to: "Seasonal" });
        }
      }
    }
  }

  // ── Badges: nothing is written ───────────────────────────────────────────
  // A seasonal badge's powers resolve at read through activeBadgeIds, so a
  // roll changes no badge row at all. `badges.active` in particular is never
  // touched: it means retired-by-an-admin, and flipping it here would strip
  // powers from everyone already holding the badge.

  // ── Seats whose holdings lapse ───────────────────────────────────────────
  const lapsing: RollPlan["lapsing"] = [];
  if (opts.cadence !== "never") {
    // AGENTS COUNT HERE (0142), and this one is worth the sentence because it
    // reads like a coverage number and is not. The roll plan says which seats
    // have holdings that lapse when the season turns, so a founder can see
    // what is about to need re-deciding. An agent's seating lapses like any
    // other, and hiding it would leave a founder rolling a season with a seat
    // they did not know a machine was sitting in.
    const [rows]: any = await pool.query(
      `SELECT r.id, r.name, COUNT(a.id) n
         FROM org_roles r
         JOIN org_role_assignments a ON a.org_role_id = r.id AND a.ended_at IS NULL
        WHERE COALESCE(r.expires_each_season, 1) = 1
        GROUP BY r.id, r.name`,
    );
    for (const r of rows as any[]) {
      lapsing.push({ orgRoleId: r.id, name: r.name, holders: Number(r.n) });
    }
  }

  return { patternId: opts.patternId, patternName, changes, blocked, lapsing };
}

/**
 * Apply a plan. Refuses outright when anything is blocked, so a roll is all
 * or nothing and never leaves the village half-turned.
 */
export async function applyRoll(
  pool: Pool,
  plan: RollPlan,
  ctx: { seasonId: string | null; byUserId: string | null },
): Promise<{ applied: number; treasury: RollTreasuryOutcome[] }> {
  if (plan.blocked.length) throw new Error("This roll is blocked; settle what is outstanding first");
  let applied = 0;
  const circleMoves: RollChange[] = [];
  for (const ch of plan.changes) {
    if (ch.kind === "circle") {
      await pool.query("UPDATE circles SET status = ? WHERE id = ?", [ch.to, ch.entityId]);
      circleMoves.push(ch);
    } else if (ch.kind === "org_role") {
      await pool.query("UPDATE org_roles SET active = ? WHERE id = ?", [ch.to === "active" ? 1 : 0, ch.entityId]);
    } else if (ch.kind === "quest") {
      await pool.query("UPDATE quests SET status = ? WHERE id = ?", [ch.to, ch.entityId]);
    } else {
      continue;
    }
    await pool.query(
      `INSERT INTO season_roll_log (id, season_id, pattern_id, kind, entity_id, from_value, to_value, by_user_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [newId("roll"), ctx.seasonId, plan.patternId, ch.kind, ch.entityId, ch.from, ch.to, ctx.byUserId],
    );
    applied += 1;
  }

  /*
   * EVERY CIRCLE THE ROLL MOVED GOES THROUGH THE TREASURY HOOK.
   *
   * `onCircleStatusChange` (server/lib/circleTreasury.ts) is Rye's dormancy
   * ruling: a circle going dormant has its treasury swept and the sweep
   * recorded, and a circle coming back is told what it held. It used to be
   * called from the admin circle PUT alone. The UPDATE above is a second
   * writer of the same column, so a circle this roll made dormant kept its
   * treasury, no dormant record was written, and `GET /api/resources/treasuries`
   * was left to report it as a defect after the fact. The call lives HERE, in
   * the one function that writes the roll's statuses, so no caller of
   * `applyRoll` can apply a status change without it.
   *
   * THE SAME PREVIOUS-STATUS SEMANTICS AS THE PUT. The PUT reads the status
   * before its merge overwrites it; the plan's `from` is that same reading,
   * taken from `circles.status` by `planRoll`, and `to` is what was written.
   *
   * AFTER EVERY STATUS WRITE, NEVER INTERLEAVED, and each circle's outcome is
   * caught on its own. The status write is what makes a sweep lawful (the
   * hook's own header says to call it after the row is committed), and a
   * ledger failure on one circle must not leave the rest of the village
   * half-turned, which is the one thing this function promises. A failure is
   * returned by name on the roll's response, and the dormant circle still
   * holding tokens is listed by the treasuries read until somebody returns them.
   */
  const treasury = await applyCircleStatusChanges(
    pool,
    circleMoves.map((ch) => ({ id: ch.entityId, name: ch.name, from: String(ch.from ?? "active"), to: ch.to })),
    ctx.byUserId,
    listBudgets,
  );
  return { applied, treasury };
}

/** What the treasury hook did for one circle a roll moved. The backfill reports the same shape. */
export type RollTreasuryOutcome = CircleStatusOutcome;

/**
 * Anything created while a season runs joins that season's pattern by
 * default, so a village never has to sit down and author one.
 */
export async function captureIntoCurrentPattern(
  pool: Pool,
  patternId: string | null,
  kind: PatternKind,
  entityId: string,
): Promise<void> {
  if (!patternId) return;
  await addMember(pool, patternId, kind, entityId);
}

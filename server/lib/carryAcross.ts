/**
 * Carry people across: the server half of the step after a structure change
 * is published. The rules are in shared/carryAcross.ts, so the page and this
 * file read the same list the same way; what lives here is reading the inputs
 * and writing the two acts.
 *
 * ── MOVING ONE PERSON IS ONE TRANSACTION ─────────────────────────────────
 *
 * Lock the old seating, seat the person in the new seat through `seatHolder`
 * (the function the seating door calls) with the season's term, end the old
 * seating, commit. Either both land or neither does, so nobody is ever left
 * with no seat and nobody holds both because a request died half way.
 *
 * Asked twice, the second answer is the first one's result: a seating already
 * ended whose holder now sits in the new seat is "already carried", and a
 * person already in the new seat is not seated twice.
 *
 * ── RETIRING WHAT IS LEFT IS A DRAFT ─────────────────────────────────────
 *
 * The empty old seats and circles go into ONE org draft of `rest_seat` and
 * `rest_circle` lines, each stamped with the steward who chose it (so the
 * preview's held-seat check applies) and with the draft it follows. It
 * publishes through the same preview and publish every draft does, and that
 * preview refuses a seat somebody holds, so a seating made after the draft
 * was written still keeps its seat. Asked again while one is open, the open
 * one is the answer.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { planCarry, retireChanges, type CarryPlan } from "../../shared/carryAcross";
import { resolveSeatTerm, type SeatCalendar } from "../../shared/seatTerms";
import { endSeating, listOrgAssignments, listOrgRoles, seatHolder, type OrgAssignment } from "./orgChart";
import {
  addChange,
  blockedLinesOf,
  createDraft,
  getDraft,
  listDrafts,
  loadPreviewContext,
  previewDraft,
  previewLoadedDraft,
  type BlockedLine,
  type Draft,
} from "./orgDrafts";
import { proposalsInBatch } from "./externalProposals";
import { liveSeatingIn, lockSeating } from "../repos/carryAcross";
import type { RepoCircle } from "./structureReview";

const truthy = (v: unknown): boolean => v === true || v === 1 || v === "1";

/** The retire draft that follows a published structure change. */
export interface RetireDraft {
  id: string;
  status: "open" | "published";
  /** Every line, as the preview reads it. */
  reads: string[];
  blocked: number;
  blockedLines: BlockedLine[];
}

export interface CarryRead extends CarryPlan {
  /** The published structure change this list follows. */
  draftId: string;
  retireDraft: RetireDraft | null;
}

/** Names a seating's holder by first name, the way the page shows people. */
export type PersonOf = (a: OrgAssignment) => string;

function circlesOf(circles: readonly RepoCircle[]) {
  return circles
    .filter((c) => c && c.id !== undefined && c.id !== null)
    .map((c) => ({
      id: String(c.id),
      name: String(c.name ?? c.id),
      parentCircleId: c.parentCircleId ? String(c.parentCircleId) : null,
      status: c.status ? String(c.status) : "active",
      isExample: truthy(c.isExample),
    }));
}

const followsDraft = (d: Draft, draftId: string) =>
  d.changes.length > 0 && d.changes.every((c) => (c.op === "rest_seat" || c.op === "rest_circle") && c.payload?.carriedAfter === draftId);

/** The open retire draft for this change, else the one published last. */
async function retireDraftFor(pool: Pool, draftId: string): Promise<Draft | null> {
  const all = (await listDrafts(pool)).filter((d) => followsDraft(d, draftId));
  const open = all.find((d) => d.status === "open");
  if (open) return open;
  return (
    all
      .filter((d) => d.status === "published")
      .sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")))[0] ?? null
  );
}

async function planFor(
  pool: Pool,
  circles: readonly RepoCircle[],
  draft: Draft,
  personOf: PersonOf,
): Promise<CarryPlan> {
  const [roles, seatings] = await Promise.all([listOrgRoles(pool), listOrgAssignments(pool)]);
  return planCarry({
    changes: draft.changes.map((c) => ({ op: c.op, orgRoleId: c.orgRoleId, payload: c.payload })),
    seats: roles.map((r) => ({ id: r.id, name: r.name, circleId: r.circleId, active: r.active, isExample: r.isExample })),
    circles: circlesOf(circles),
    seatings: seatings.map((a) => ({ id: a.id, orgRoleId: a.orgRoleId, person: personOf(a), isExample: a.isExample })),
  });
}

/**
 * The structure change a batch published, found through its accepted
 * proposals the way the review finds its draft. The one published last.
 */
export async function publishedDraftFor(pool: Pool, batchId: string): Promise<string | null> {
  const refs = Array.from(
    new Set((await proposalsInBatch(pool, batchId)).filter((r) => r.status === "accepted" && r.createdRef).map((r) => String(r.createdRef))),
  );
  const drafts = (await Promise.all(refs.map((id) => getDraft(pool, id)))).filter((d): d is Draft => !!d && d.status === "published");
  drafts.sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")));
  return drafts[0]?.id ?? null;
}

/** The carry list for a published structure change, or null when that draft is not published. */
export async function readCarry(
  pool: Pool,
  circles: readonly RepoCircle[],
  draftId: string,
  personOf: PersonOf,
): Promise<CarryRead | null> {
  const draft = await getDraft(pool, draftId);
  if (!draft || draft.status !== "published") return null;
  const plan = await planFor(pool, circles, draft, personOf);
  const retire = await retireDraftFor(pool, draftId);
  let retireDraft: RetireDraft | null = null;
  if (retire && (retire.status === "open" || retire.status === "published")) {
    const p = retire.status === "open" ? await previewDraft(pool, retire.id) : null;
    retireDraft = {
      id: retire.id,
      status: retire.status,
      reads: p ? p.lines.map((l) => l.reads) : [],
      blocked: p?.blocked ?? 0,
      blockedLines: p ? blockedLinesOf(p.lines) : [],
    };
  }
  return { draftId, ...plan, retireDraft };
}

export type MoveOutcome =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      /** True when an earlier request already did it. */
      already: boolean;
      /** The new seating, for the notice. Null when the person already sat there. */
      assignmentId: string | null;
      userId: string | null;
      seatName: string;
      seatAim: string | null;
    };

/**
 * Seat one person from the old chart in a seat of the new one, and end the
 * old seating, in one transaction. `isAgent` on the answer's refusal path is
 * the caller's business: it asks the agent power before calling this.
 */
export async function carryOne(
  pool: Pool,
  input: {
    circles: readonly RepoCircle[];
    draftId: string;
    seatingId: string;
    toSeatId: string;
    actor: string | null;
    calendar: SeatCalendar;
    now: Date;
    personOf: PersonOf;
  },
): Promise<MoveOutcome> {
  const draft = await getDraft(pool, input.draftId);
  if (!draft || draft.status !== "published") {
    return { ok: false, status: 409, error: "This structure is not live yet. Publish it first." };
  }
  const plan = await planFor(pool, input.circles, draft, input.personOf);
  const target = plan.newSeats.find((s) => s.id === input.toSeatId);
  if (!target) return { ok: false, status: 409, error: "That seat is not part of the new chart." };
  const roles = await listOrgRoles(pool);
  const seat = roles.find((r) => r.id === input.toSeatId)!;

  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const row = await lockSeating(conn, input.seatingId);
    if (!row || row.isExample) {
      await conn.rollback();
      return { ok: false, status: 404, error: "That seating is not on the chart." };
    }
    if (row.ended) {
      // Asked again after it worked: the person already sits in the new seat.
      const there = await liveSeatingIn(conn, input.toSeatId, row.holderKey);
      await conn.rollback();
      if (there) return { ok: true, already: true, assignmentId: null, userId: row.userId, seatName: seat.name, seatAim: seat.aim };
      return { ok: false, status: 409, error: "That seating has already ended." };
    }
    if (!plan.rows.some((r) => r.seatingId === row.id)) {
      await conn.rollback();
      return { ok: false, status: 409, error: "This person already sits on the new chart." };
    }
    // The season's term, the same rule the seating door uses when no date is asked.
    const term = resolveSeatTerm({ requestedEndsOn: null, calendar: input.calendar, capAtSeasonEnd: false, now: input.now });
    if (!term.ok) {
      await conn.rollback();
      return { ok: false, status: 409, error: term.error };
    }
    let assignmentId: string | null = null;
    if (!(await liveSeatingIn(conn, input.toSeatId, row.holderKey))) {
      const seated = await seatHolder(conn, input.toSeatId, {
        userId: row.isAgent ? null : row.userId,
        displayName: row.displayName,
        focus: row.focus,
        seasonId: term.seasonId,
        termEndsAt: term.endsAt,
        termFollowsSeason: term.followsSeason,
        grantedBy: input.actor,
        isAgent: row.isAgent,
        agentSlug: row.isAgent ? row.holderKey.replace(/^agent:/, "") : null,
      });
      if (!seated.ok) {
        await conn.rollback();
        return { ok: false, status: 409, error: seated.reason ?? "They could not be seated." };
      }
      assignmentId = seated.assignmentId ?? null;
    }
    if (!(await endSeating(conn, row.id, "Carried across to the new chart"))) {
      await conn.rollback();
      return { ok: false, status: 409, error: "That seating changed while this was being saved. Read the list again." };
    }
    await conn.commit();
    return { ok: true, already: false, assignmentId, userId: row.isAgent ? null : row.userId, seatName: seat.name, seatAim: seat.aim };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export type RetireOutcome =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      dryRun: boolean;
      /** The draft written, or the open one already there. Null on a dry run. */
      draftId: string | null;
      existing: boolean;
      reads: string[];
      blocked: number;
      blockedLines: BlockedLine[];
    };

/**
 * One draft that retires every empty old seat and every old circle left with
 * nothing in it, or a preview of it. Seats still held are never in it.
 */
export async function retireEmptyOldChart(
  pool: Pool,
  input: { circles: readonly RepoCircle[]; draftId: string; actor: string; dryRun: boolean; personOf: PersonOf },
): Promise<RetireOutcome> {
  const draft = await getDraft(pool, input.draftId);
  if (!draft || draft.status !== "published") {
    return { ok: false, status: 409, error: "This structure is not live yet. Publish it first." };
  }
  const open = await retireDraftFor(pool, input.draftId);
  if (open && open.status === "open") {
    const p = await previewDraft(pool, open.id);
    return {
      ok: true,
      dryRun: false,
      draftId: open.id,
      existing: true,
      reads: p.lines.map((l) => l.reads),
      blocked: p.blocked,
      blockedLines: blockedLinesOf(p.lines),
    };
  }
  const plan = await planFor(pool, input.circles, draft, input.personOf);
  const changes = retireChanges(plan.retire, input.actor, input.draftId);
  if (!changes.length) return { ok: false, status: 409, error: "Nothing on the old chart is empty yet." };
  const title = "Retire the empty old chart";

  if (input.dryRun) {
    const dry: Draft = {
      id: "dry-run",
      title,
      rationale: null,
      status: "open",
      threadId: null,
      createdBy: input.actor,
      publishedAt: null,
      revertedAt: null,
      vision: null,
      sourceKind: "human",
      sourceModuleId: null,
      sourceProposalId: null,
      cites: [],
      changes: changes.map((c, i) => ({
        id: `dry-${i + 1}`,
        draftId: "dry-run",
        op: c.op,
        orgRoleId: c.orgRoleId,
        payload: c.payload,
        beforeJson: null,
        order: i + 1,
      })),
    };
    const p = previewLoadedDraft(dry, await loadPreviewContext(pool));
    return {
      ok: true,
      dryRun: true,
      draftId: null,
      existing: false,
      reads: p.lines.map((l) => l.reads),
      blocked: p.blocked,
      blockedLines: blockedLinesOf(p.lines),
    };
  }

  const made = await createDraft(pool, {
    title,
    rationale: "What the old chart leaves empty once its people sit in the new one.",
    createdBy: input.actor,
    sourceKind: "human",
  });
  if (!made.ok) return { ok: false, status: 409, error: made.error };
  for (const c of changes) {
    const r = await addChange(pool, made.id, c);
    if (!r.ok) return { ok: false, status: 409, error: r.error };
  }
  const p = await previewDraft(pool, made.id);
  return {
    ok: true,
    dryRun: false,
    draftId: made.id,
    existing: false,
    reads: p.lines.map((l) => l.reads),
    blocked: p.blocked,
    blockedLines: blockedLinesOf(p.lines),
  };
}

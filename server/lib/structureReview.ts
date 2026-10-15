/**
 * The structure change review's server half: read one arrival against the live
 * chart, and accept it with a steward's decisions into ONE org draft.
 *
 * The rules themselves are in shared/structurePlan.ts, so the page and this
 * file count the same change the same way. What lives here is reading the
 * inputs and writing the result.
 *
 * ── WHAT ACCEPTING WRITES, AND WHAT IT NEVER DOES ────────────────────────
 *
 * One draft, built from existing draft ops (plus `rest_circle`, 0243, when the
 * steward retires the old chart). Nothing here publishes: the draft goes
 * through the same preview and publish path every draft does. The proposals a
 * steward kept are marked accepted against that draft; the ones left out stay
 * in the queue untouched; a structure split in two leaves its other half in
 * the queue as a record of its own. Withdrawing the draft puts the kept half
 * back, so the queue then holds the whole structure again.
 *
 * ── THE SAME LIMIT `acceptInto` STATES ───────────────────────────────────
 *
 * Not one transaction: `createDraft`, `addChange` and `markProposalDecided`
 * each take a pool. So the order is chosen for the failure it leaves: every
 * change first, then each remainder, then each decision. A process that dies
 * part way leaves an open draft (inert, withdrawable) and proposals still
 * waiting, and a remainder is written BEFORE its original is cut down, so the
 * worst case is a seat queued twice and never a seat lost.
 */
import { createHash, randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import {
  decideStructure,
  planStructure,
  type ConflictChoice,
  type DecidedStructure,
  type PlanLiveCircle,
  type PlanLiveSeat,
  type StructureDecisions,
  type StructurePlan,
} from "../../shared/structurePlan";
import { recordEvent } from "./events";
import { markProposalDecided, proposalsInBatch, type ExternalProposalRow } from "./externalProposals";
import { listOrgAssignments, listOrgRoles } from "./orgChart";
import {
  addChange,
  blockedLinesOf,
  createDraft,
  draftChangeCap,
  loadPreviewContext,
  openDraftCap,
  previewDraft,
  previewLoadedDraft,
  type BlockedLine,
  type Draft,
  type PreviewLine,
} from "./orgDrafts";
import { insertProposalCopy } from "../repos/externalProposals";

/** A circle as `circlesRepo.all()` holds it. Only these fields are read. */
export interface RepoCircle {
  id?: unknown;
  name?: unknown;
  aliases?: unknown;
  parentCircleId?: unknown;
  status?: unknown;
  isExample?: unknown;
}

export interface StructureRead {
  plan: StructurePlan;
  rows: ExternalProposalRow[];
  header: {
    batchId: string;
    moduleId: string | null;
    receivedAt: string | null;
    title: string | null;
  };
}

const truthy = (v: unknown): boolean => v === true || v === 1 || v === "1";

/** The live chart in the plan's shape. Holder counts are this village's own seatings. */
export async function liveChart(
  pool: Pool,
  circles: readonly RepoCircle[],
): Promise<{ circles: PlanLiveCircle[]; seats: PlanLiveSeat[] }> {
  const [roles, seatings] = await Promise.all([listOrgRoles(pool), listOrgAssignments(pool)]);
  const held = new Map<string, number>();
  for (const a of seatings) {
    if (a.isExample) continue;
    held.set(a.orgRoleId, (held.get(a.orgRoleId) ?? 0) + 1);
  }
  return {
    circles: circles
      .filter((c) => c && c.id !== undefined && c.id !== null)
      .map((c) => ({
        id: String(c.id),
        name: String(c.name ?? c.id),
        aliases: c.aliases,
        parentCircleId: c.parentCircleId ? String(c.parentCircleId) : null,
        status: c.status ? String(c.status) : "active",
        isExample: truthy(c.isExample),
      })),
    seats: roles.map((r) => ({
      id: r.id,
      name: r.name,
      circleId: r.circleId,
      active: r.active,
      isExample: r.isExample,
      holders: held.get(r.id) ?? 0,
    })),
  };
}

/**
 * The waiting proposals of one arrival, read against the live chart. `ids`
 * narrows it to a selection. Null when nothing in the batch is waiting.
 */
export async function readStructure(
  pool: Pool,
  circles: readonly RepoCircle[],
  batchId: string,
  ids?: readonly string[] | null,
): Promise<StructureRead | null> {
  const wanted = ids && ids.length ? new Set(ids) : null;
  const rows = (await proposalsInBatch(pool, batchId)).filter(
    (p) => p.status === "proposed" && (!wanted || wanted.has(p.id)),
  );
  if (!rows.length) return null;
  const live = await liveChart(pool, circles);
  const plan = planStructure(
    rows.map((r) => ({ id: r.id, kind: r.kind, payload: r.payload })),
    live.circles,
    live.seats,
  );
  const structure = rows.find((r) => r.kind === "org.proposed");
  const title = structure && typeof structure.payload.title === "string" ? structure.payload.title.slice(0, 200) : null;
  return {
    plan,
    rows,
    header: { batchId, moduleId: rows[0]?.moduleId ?? null, receivedAt: rows[0]?.receivedAt || null, title },
  };
}

/** The decisions as a request body carries them, read without trusting a single key. */
export function readDecisions(body: unknown): StructureDecisions {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const exclude = Array.isArray(b.exclude) ? b.exclude.filter((k): k is string => typeof k === "string").slice(0, 2000) : [];
  const conflicts: Record<string, ConflictChoice> = {};
  const raw = b.conflicts && typeof b.conflicts === "object" && !Array.isArray(b.conflicts) ? (b.conflicts as Record<string, unknown>) : {};
  for (const [key, v] of Object.entries(raw)) {
    const c = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    if (c.choice === "update" || c.choice === "leave") conflicts[key] = { choice: c.choice };
    else if (c.choice === "rename") conflicts[key] = { choice: "rename", name: typeof c.name === "string" ? c.name : "" };
  }
  return { exclude, conflicts, retireOldChart: b.retireOldChart === true };
}

/** A structure payload cut down to the given seats, with any name the steward typed. */
function seatsPayload(
  row: ExternalProposalRow,
  indexes: readonly number[],
  renamed: ReadonlyMap<number, string>,
): Record<string, unknown> {
  const list = Array.isArray(row.payload.seats)
    ? (row.payload.seats as unknown[]).filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
    : null;
  if (!list) {
    const typed = renamed.get(0);
    return typed !== undefined ? { ...row.payload, name: typed } : row.payload;
  }
  return {
    ...row.payload,
    seats: indexes.map((i) => (renamed.has(i) ? { ...list[i], name: renamed.get(i) } : list[i])),
  };
}

export type AcceptOutcome =
  | { ok: false; status: number; error: string; problems?: string[] }
  | { ok: true; dryRun: true; lines: PreviewLine[]; blocked: number; blockedLines: BlockedLine[]; decided: DecidedStructure }
  | {
      ok: true;
      dryRun: false;
      draftId: string;
      blocked: number;
      blockedLines: BlockedLine[];
      decided: DecidedStructure;
      remainders: Array<{ from: string; id: string }>;
    };

/**
 * Accept a batch with decisions, or preview the draft it would make.
 *
 * Refuses with every problem `decideStructure` names, so an unsettled match, a
 * name that collides or a seat whose circle is left out never reaches a draft.
 */
export async function acceptStructure(
  pool: Pool,
  input: {
    circles: readonly RepoCircle[];
    batchId: string;
    ids?: readonly string[] | null;
    decisions: StructureDecisions;
    actor: string;
    dryRun: boolean;
    roster: number;
  },
): Promise<AcceptOutcome> {
  const read = await readStructure(pool, input.circles, input.batchId, input.ids);
  if (!read) return { ok: false, status: 404, error: "Nothing in that batch is waiting for a decision" };
  const decided = decideStructure(read.plan, input.decisions, input.actor);
  if (decided.problems.length) {
    return { ok: false, status: 409, error: decided.problems[0], problems: decided.problems };
  }
  const byId = new Map(read.rows.map((r) => [r.id, r]));
  const sourceProposal = decided.accepted[0] ?? decided.split[0]?.proposalId ?? read.rows[0].id;
  const moduleId = read.header.moduleId ?? "integration";
  const title = read.header.title ?? `Structure suggested by ${moduleId}`;

  if (input.dryRun) {
    // The draft it WOULD make, previewed against the live chart and written nowhere.
    const draft: Draft = {
      id: "dry-run",
      title,
      rationale: null,
      status: "open",
      threadId: null,
      createdBy: input.actor,
      publishedAt: null,
      revertedAt: null,
      vision: null,
      sourceKind: "agent",
      sourceModuleId: moduleId,
      sourceProposalId: sourceProposal,
      cites: [],
      changes: decided.changes.map((c, i) => ({
        id: `dry-${i + 1}`,
        draftId: "dry-run",
        op: c.op,
        orgRoleId: c.orgRoleId,
        payload: c.payload,
        beforeJson: null,
        order: i + 1,
      })),
    };
    const preview = previewLoadedDraft(draft, await loadPreviewContext(pool), draftChangeCap());
    return { ok: true, dryRun: true, lines: preview.lines, blocked: preview.blocked, blockedLines: blockedLinesOf(preview.lines), decided };
  }

  const kept = [...decided.accepted, ...decided.split.map((s) => s.proposalId)].map((id) => byId.get(id)!).filter(Boolean);
  const made = await createDraft(pool, {
    title,
    rationale: null,
    createdBy: input.actor,
    sourceKind: "agent",
    sourceModuleId: moduleId,
    sourceProposalId: sourceProposal,
    cites: Array.from(new Set(kept.flatMap((p) => [p.sourceRef, p.quote]).filter((v): v is string => !!v))),
    openCap: openDraftCap(input.roster),
  });
  if (!made.ok) return { ok: false, status: 409, error: made.error };

  for (const c of decided.changes) {
    const r = await addChange(pool, made.id, { op: c.op, orgRoleId: c.orgRoleId, payload: c.payload });
    if (!r.ok) return { ok: false, status: 409, error: r.error };
  }

  // The names a steward typed, per proposal and seat index, so the stored payload says what the draft says.
  const renamedIn = new Map<string, Map<number, string>>();
  for (const k of decided.keptSeats) {
    if (k.via !== "rename") continue;
    const seat = read.plan.seats.find((s) => s.key === k.key);
    if (!seat) continue;
    const m = renamedIn.get(seat.proposalId) ?? new Map<number, string>();
    m.set(seat.index, k.name);
    renamedIn.set(seat.proposalId, m);
  }

  const remainders: Array<{ from: string; id: string }> = [];
  for (const s of decided.split) {
    const row = byId.get(s.proposalId)!;
    const id = `xprop-${randomUUID().slice(0, 12)}`;
    const dedupeKey = createHash("sha256").update(`${row.dedupeKey}\u0000split\u0000${id}`, "utf8").digest("hex");
    const ok = await insertProposalCopy(pool, row.id, { id, payload: seatsPayload(row, s.left, new Map()), dedupeKey });
    if (ok) remainders.push({ from: row.id, id });
  }
  for (const s of decided.split) {
    const row = byId.get(s.proposalId)!;
    await markProposalDecided(pool, {
      id: row.id,
      status: "accepted",
      decidedBy: input.actor,
      createdRef: made.id,
      editedPayload: seatsPayload(row, s.kept, renamedIn.get(row.id) ?? new Map()),
    });
  }
  for (const id of decided.accepted) {
    const row = byId.get(id)!;
    const renamed = renamedIn.get(id);
    const all = Array.isArray(row.payload.seats) ? (row.payload.seats as unknown[]).map((_, i) => i) : [0];
    await markProposalDecided(pool, {
      id,
      status: "accepted",
      decidedBy: input.actor,
      createdRef: made.id,
      editedPayload: renamed ? seatsPayload(row, all, renamed) : null,
    });
  }

  const preview = await previewDraft(pool, made.id, draftChangeCap());
  const n = decided.counts;
  void recordEvent(pool, {
    kind: "org",
    text:
      `a structure change was accepted into draft ${made.id}: ${n.newCircles} new circle(s), ${n.newSeats} new seat(s), ` +
      `${n.updates} live seat(s) updated` +
      (n.retiringCircles || n.retiringSeats ? `, ${n.retiringCircles} circle(s) and ${n.retiringSeats} seat(s) retiring` : "") +
      (remainders.length ? `, ${remainders.length} structure(s) split with the rest left in the queue` : "") +
      (preview.blocked ? `, ${preview.blocked} blocked` : ""),
    actorUserId: input.actor,
    actorKind: "human",
    originModuleId: moduleId,
    entityType: "draft",
    entityRef: made.id,
    audience: "admin",
  });
  return {
    ok: true,
    dryRun: false,
    draftId: made.id,
    blocked: preview.blocked,
    blockedLines: blockedLinesOf(preview.lines),
    decided,
    remainders,
  };
}

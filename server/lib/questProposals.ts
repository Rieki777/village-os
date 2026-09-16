/**
 * A proposed quest, and the one line a machine may never cross (0141).
 *
 * ── THE LINE ─────────────────────────────────────────────────────────────
 *
 * A vendor, or the village's own assistant, may write the whole prose layer of
 * a quest: what it is called, what it asks for, why it matters, the steps, the
 * tips, the tags. A HUMAN TYPES THE REWARD AND THE GATES. Under the default
 * cap mode the advertised label IS the payout contract, so writing
 * `quests.gratitude` sets what the faucet will pay; `stay_credit_reward`
 * releases the other currency; and `min_stage` and `requires_role` are the two
 * gates the claim route actually enforces.
 *
 * The enforcement is structural rather than procedural. Those five columns are
 * NOT on `quest_proposals` at all, so there is no vendor write to refuse and
 * no future route that can forget to refuse it. `acceptProposal` takes them
 * from its own argument, which is a form a person filled in, and refuses
 * without a reward that parses.
 *
 * ── WHY A TABLE AND NOT A STATUS ON `quests` ─────────────────────────────
 *
 * `GET /api/quests` is `res.json(await questsRepo.all())`: public, unfiltered.
 * The board renderer never reads status, and neither does
 * `POST /api/game/quests/:id/claim`. So a row inserted as a draft would sit
 * publicly on the board and be claimable, and consenting to that claim mints
 * from the faucet. 0141's header carries the same three facts.
 *
 * ── ACCEPT CALLS `questsRepo.add` ────────────────────────────────────────
 *
 * The same function `POST /api/admin/quests` calls. Not a second insert. The
 * reward-range parse, the calendar write for a quest with a window, and every
 * other invariant that path carries are inherited. This is the rule the
 * assistant draft queue already follows, and it is what keeps both queues from
 * becoming a second write path into the domain.
 */
import { createHash, randomUUID } from "crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { parseRewardRange } from "../../shared/questRewards";
import type { QuestRecord, QuestsRepo } from "../repos/quests";
import { recordEvent } from "./events";
import { containsEmail } from "./externalProposals";

export type QuestProposalStatus = "proposed" | "accepted" | "rejected" | "superseded";

/**
 * The prose layer, which is everything a machine may write.
 *
 * Every field here is words on a page. None of them gates anything and none of
 * them moves value. If a field ever stops being true of that sentence, it
 * belongs in `HumanReward` below instead.
 */
export interface QuestProse {
  title: string;
  subtitle?: string | null;
  description?: string | null;
  impact?: string | null;
  story?: string | null;
  firstStep?: string | null;
  steps?: string[];
  deliverable?: string | null;
  tips?: string[];
  tags?: string[];
  duration?: string | null;
  difficulty?: string | null;
  circle?: string | null;
  icon?: string | null;
  /**
   * The free-text display prose ("Requires: green thumb"), enforced by
   * nothing. Its structured sibling `requiresRole` IS enforced and lives in
   * `HumanReward`. The names are close enough in `quests` that keeping them
   * apart here is worth the comment.
   */
  roleRequired?: string | null;
}

/**
 * What a person types, and the only route by which any of it reaches a quest.
 *
 * `gratitudeMin` and `gratitudeMax` are deliberately absent from this
 * interface as well as from the table: they are DERIVED from the label by
 * shared/questRewards.ts inside the repository's save path, and are authored
 * by nobody, admin included.
 */
export interface HumanReward {
  /** The advertised label, verbatim: "50-100", "75". A contract. */
  gratitude: string;
  stayCreditReward?: number | null;
  minStage?: string | null;
  requiresRole?: string | null;
}

export interface QuestProposalRow {
  id: string;
  villageId: string;
  moduleId: string;
  batchId: string;
  correlationId: string | null;
  sourceProposalId: string | null;
  prose: QuestProse;
  rationale: string | null;
  quote: string | null;
  sourceRef: string | null;
  dedupeKey: string;
  status: QuestProposalStatus;
  proposedBy: string | null;
  proposedByKind: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedNote: string | null;
  createdRef: string | null;
  receivedAt: string;
}

/**
 * A cap on how many quests one batch may propose.
 *
 * Same shape and same reasoning as `roleBatchCap` in drafts.ts, whose comment
 * names seeding aspirational structure as the harm. A meeting extractor
 * emitting a handful of quests per meeting is that machine, and a board of
 * forty proposed quests nobody wrote is a board a village stops reading. The
 * floor of 3 exists so a village of one founder still gets somewhere to start.
 */
export function questBatchCap(activeMembers: number): number {
  return Math.max(3, activeMembers);
}

const ABSENT = "none";

function part(v: unknown): string {
  if (v === null || v === undefined) return ABSENT;
  const s = String(v).trim();
  return s === "" ? ABSENT : s;
}

/**
 * The dedupe key, on the same discipline as 0140: NOT NULL, unique, and
 * computed from the proposal's own content. Never a vendor timestamp, because
 * a re-extraction of the same meeting emits the same quest under a new one.
 */
export function questDedupeKey(input: { moduleId: string; sourceRef?: string | null; title: string }): string {
  return createHash("sha256")
    .update(
      [part(input.moduleId), "quest.proposed", part(input.sourceRef), part(input.title).toLowerCase()].join(" "),
      "utf8",
    )
    .digest("hex");
}

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((s) => String(s)).filter((s) => s.trim() !== "") : [];

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * Content, clipped to the column it lands in.
 *
 * MySQL is strict by default and an over-long string is ER_DATA_TOO_LONG, so
 * an unclipped vendor field is not a truncated field, it is a lost proposal
 * and a 500. server/lib/externalProposals.ts carries the full argument and the
 * measurement, including why identifiers are refused instead of clipped.
 */
const clip = (v: unknown, n: number): string | null => {
  const s = str(v);
  return s === null ? null : s.slice(0, n);
};

const idTooLong = (v: unknown): boolean =>
  v !== null && v !== undefined && String(v).trim().length > 64;

/**
 * The narrower of the two columns each field passes through.
 *
 * READ OFF `quests`, NOT OFF `quest_proposals`, and that is the whole reason
 * this constant exists rather than a number at each call site. A proposal is
 * on its way to the board: `quest_proposals.circle` is varchar(120) and
 * `quests.circle` is varchar(64), so clipping to the table in front of you
 * lands the proposal and then throws at accept, which is the worst possible
 * place for it. A test caught exactly that and this is the fix.
 *
 * Every number here is read from a migration: 0001 for the originals, 0004 for
 * `gratitude` becoming varchar(64), 0012 for the two gates, 0068 for the story
 * layer. `description`, `impact`, `story` and `rationale` are TEXT on both
 * sides, and TEXT is 65,535 BYTES rather than characters, so their ceiling is
 * set well under it.
 */
const W = {
  title: 200,
  subtitle: 160,
  firstStep: 400,
  deliverable: 400,
  duration: 64,
  difficulty: 32,
  circle: 64,
  icon: 64,
  roleRequired: 64,
  minStage: 64,
  requiresRole: 64,
  gratitude: 64,
  sourceRef: 400,
  prose: 8000,
  step: 500,
  tag: 80,
} as const;

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export interface ProposeQuestInput {
  villageId: string;
  moduleId?: string;
  batchId: string;
  correlationId?: string | null;
  sourceProposalId?: string | null;
  prose: QuestProse;
  rationale?: string | null;
  quote?: string | null;
  sourceRef?: string | null;
  proposedBy?: string | null;
  proposedByKind?: "human" | "agent";
  /** How many proposals this batch already holds, against `questBatchCap`. */
  batchCap: number;
}

export type ProposeQuestResult =
  | { ok: true; id: string; outcome: "stored" | "duplicate" }
  | { ok: false; error: string };

// A connection as well as a pool, so the public form can count its allowance and insert on the one
// connection holding its lock (`withIdeaLock` in server/repos/questProposals.ts).
export async function proposeQuest(pool: Pool | PoolConnection, input: ProposeQuestInput): Promise<ProposeQuestResult> {
  const title = str(input.prose?.title);
  if (!title) return { ok: false, error: "A proposed quest needs a title." };
  if (containsEmail(input.prose) || containsEmail(input.rationale ?? null) || containsEmail(input.quote ?? null)) {
    return { ok: false, error: "This proposal carried an email address, so none of it was stored." };
  }

  // Identity is refused rather than clipped: a shortened batch id merges two
  // reviews and a shortened module id attributes one integration's work to
  // another.
  if (
    idTooLong(input.villageId) ||
    idTooLong(input.moduleId) ||
    idTooLong(input.batchId) ||
    idTooLong(input.correlationId) ||
    idTooLong(input.sourceProposalId) ||
    idTooLong(input.proposedBy)
  ) {
    return { ok: false, error: "An identifier on this proposal is longer than 64 characters, so nothing was stored." };
  }
  const moduleId = str(input.moduleId) ?? "local";
  const [[open]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM quest_proposals WHERE batch_id = ? AND status = 'proposed'",
    [input.batchId],
  );
  if (Number(open?.n ?? 0) >= input.batchCap) {
    return {
      ok: false,
      error: `This batch is at its cap of ${input.batchCap} proposed quests. Decide on some before adding more.`,
    };
  }

  const dedupeKey = questDedupeKey({ moduleId, sourceRef: input.sourceRef, title });
  const id = `qprop-${randomUUID().slice(0, 12)}`;
  try {
    await pool.query( // module-review-ok: quest_proposals has no repo cache above it, and this file is the table's one enumerable home (the ballots.ts pattern); the QUEST itself is written through questsRepo.add and never here
      "INSERT INTO quest_proposals (id, village_id, module_id, batch_id, correlation_id, source_proposal_id, " +
        "title, subtitle, description, impact, story, first_step, steps, deliverable, tips, tags, duration, " +
        "difficulty, circle, icon, role_required, rationale, quote, source_ref, dedupe_key, proposed_by, " +
        "proposed_by_kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        input.villageId,
        moduleId,
        input.batchId,
        str(input.correlationId),
        str(input.sourceProposalId),
        title.slice(0, W.title),
        clip(input.prose.subtitle, W.subtitle),
        clip(input.prose.description, W.prose),
        clip(input.prose.impact, W.prose),
        clip(input.prose.story, W.prose),
        clip(input.prose.firstStep, W.firstStep),
        JSON.stringify(list(input.prose.steps).map((v) => v.slice(0, W.step))),
        clip(input.prose.deliverable, W.deliverable),
        JSON.stringify(list(input.prose.tips).map((v) => v.slice(0, W.step))),
        JSON.stringify(list(input.prose.tags).map((v) => v.slice(0, W.tag))),
        clip(input.prose.duration, W.duration),
        clip(input.prose.difficulty, W.difficulty),
        clip(input.prose.circle, W.circle),
        clip(input.prose.icon, W.icon),
        clip(input.prose.roleRequired, W.roleRequired),
        clip(input.rationale, W.prose),
        clip(input.quote, W.prose),
        clip(input.sourceRef, W.sourceRef),
        dedupeKey,
        str(input.proposedBy),
        input.proposedByKind ?? "agent",
      ],
    );
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") {
      const [[existing]] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM quest_proposals WHERE dedupe_key = ?",
        [dedupeKey],
      );
      return { ok: true, id: String(existing?.id ?? ""), outcome: "duplicate" };
    }
    throw err;
  }
  return { ok: true, id, outcome: "stored" };
}

const COLS =
  "id, village_id, module_id, batch_id, correlation_id, source_proposal_id, title, subtitle, description, " +
  "impact, story, first_step, steps, deliverable, tips, tags, duration, difficulty, circle, icon, " +
  "role_required, rationale, quote, source_ref, dedupe_key, status, proposed_by, proposed_by_kind, " +
  "decided_by, decided_at, decided_note, created_ref, received_at";

function jsonList(v: unknown): string[] {
  if (Array.isArray(v)) return list(v);
  if (typeof v === "string") {
    try {
      return list(JSON.parse(v));
    } catch {
      return [];
    }
  }
  return [];
}

function toRow(r: RowDataPacket): QuestProposalRow {
  return {
    id: String(r.id),
    villageId: String(r.village_id),
    moduleId: String(r.module_id),
    batchId: String(r.batch_id),
    correlationId: r.correlation_id ? String(r.correlation_id) : null,
    sourceProposalId: r.source_proposal_id ? String(r.source_proposal_id) : null,
    prose: {
      title: String(r.title ?? ""),
      subtitle: r.subtitle ?? null,
      description: r.description ?? null,
      impact: r.impact ?? null,
      story: r.story ?? null,
      firstStep: r.first_step ?? null,
      steps: jsonList(r.steps),
      deliverable: r.deliverable ?? null,
      tips: jsonList(r.tips),
      tags: jsonList(r.tags),
      duration: r.duration ?? null,
      difficulty: r.difficulty ?? null,
      circle: r.circle ?? null,
      icon: r.icon ?? null,
      roleRequired: r.role_required ?? null,
    },
    rationale: r.rationale ?? null,
    quote: r.quote ?? null,
    sourceRef: r.source_ref ?? null,
    dedupeKey: String(r.dedupe_key),
    status: String(r.status) as QuestProposalStatus,
    proposedBy: r.proposed_by ? String(r.proposed_by) : null,
    proposedByKind: String(r.proposed_by_kind ?? "agent"),
    decidedBy: r.decided_by ? String(r.decided_by) : null,
    decidedAt: iso(r.decided_at),
    decidedNote: r.decided_note ? String(r.decided_note) : null,
    createdRef: r.created_ref ? String(r.created_ref) : null,
    receivedAt: iso(r.received_at) ?? "",
  };
}

export async function questProposalQueue(
  pool: Pool,
  status: QuestProposalStatus = "proposed",
): Promise<QuestProposalRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLS} FROM quest_proposals WHERE status = ? ORDER BY received_at ASC, id ASC LIMIT 500`,
    [status],
  );
  return rows.map(toRow);
}

export async function questProposalById(pool: Pool, id: string): Promise<QuestProposalRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${COLS} FROM quest_proposals WHERE id = ?`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** What is wrong with a typed reward, in the words somebody would use. */
export function rewardProblem(reward: HumanReward | null | undefined): string | null {
  const label = str(reward?.gratitude);
  if (!label) {
    return "Type what this quest pays before it goes on the board. Nobody else can set that.";
  }
  /*
   * THE DIGIT TEST THAT USED TO BE HERE IS GONE, and the note survives it.
   *
   * `parseRewardRange` documented itself as returning valid:false for anything
   * unparseable and did the opposite for one whole class: a label with NO
   * DIGITS stripped to the empty string, `Number("")` is 0, `Number.isFinite`
   * is true, and it came back `{min: 0, max: 0, valid: true}`. "some hearts"
   * was a valid reward of nothing, and under the default cap mode the
   * advertised label IS the payout contract.
   *
   * This gate carried its own digit check for that. The parser now makes the
   * same judgement itself, so the check is redundant and one place decides
   * again instead of two. The test in this file's suite that pinned the old
   * behaviour has been flipped to assert the new one.
   */
  const range = parseRewardRange(label);
  if (!range.valid) {
    return `This village could not read "${label}" as an amount. Write a number, or a range like 50-100.`;
  }
  const credit = reward?.stayCreditReward;
  if (credit !== null && credit !== undefined && (!Number.isFinite(Number(credit)) || Number(credit) < 0)) {
    return "Stay credits are a whole number of nights, or nothing at all.";
  }
  return null;
}

export type AcceptQuestResult = { ok: true; questId: string } | { ok: false; status: number; error: string };

/**
 * Turn a proposal into a quest, with a human's reward on it.
 *
 * REFUSES WITHOUT ONE. This is acceptance criterion 4 and it is the only
 * guard in this file that answers a person: everything else about the split
 * is structural, and this is the one place a human could have left the box
 * empty.
 *
 * `edits` is the whole prose block as the steward wants it, which may be
 * nothing like what arrived. Editing before accepting is the only path by
 * which a proposal naming a person can be redacted before it lands, so the
 * edited version is what gets written and what gets stored back on the row.
 */
export async function acceptQuestProposal(
  pool: Pool,
  questsRepo: QuestsRepo,
  input: {
    id: string;
    decidedBy: string;
    reward: HumanReward;
    edits?: Partial<QuestProse> | null;
    note?: string | null;
  },
): Promise<AcceptQuestResult> {
  const row = await questProposalById(pool, input.id);
  if (!row) return { ok: false, status: 404, error: "No such quest proposal" };
  if (row.status !== "proposed") {
    return { ok: false, status: 409, error: `That proposal was already ${row.status}` };
  }
  const problem = rewardProblem(input.reward);
  if (problem) return { ok: false, status: 400, error: problem };

  const prose: QuestProse = { ...row.prose, ...(input.edits ?? {}) };
  const title = str(prose.title);
  if (!title) return { ok: false, status: 400, error: "A quest needs a title." };
  if (containsEmail(prose)) {
    return {
      ok: false,
      status: 400,
      error: "This still carries an email address. Take it out before the quest goes on the board.",
    };
  }

  const count = (await questsRepo.all()).length;
  const quest: QuestRecord = {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: title.slice(0, W.title),
    // Clipped again here, and not only at propose time. A steward's edit
    // arrives through the accept route and never passes through `proposeQuest`,
    // so a paste into the textarea is a second way an over-long string reaches
    // a sized column. `quests` has its own widths and this is the last place
    // anything can be done about it.
    subtitle: clip(prose.subtitle, W.subtitle),
    description: clip(prose.description, W.prose),
    impact: clip(prose.impact, W.prose),
    story: clip(prose.story, W.prose),
    firstStep: clip(prose.firstStep, W.firstStep),
    steps: list(prose.steps).map((v) => v.slice(0, W.step)),
    deliverable: clip(prose.deliverable, W.deliverable),
    tips: list(prose.tips).map((v) => v.slice(0, W.step)),
    tags: list(prose.tags).map((v) => v.slice(0, W.tag)),
    duration: clip(prose.duration, W.duration),
    difficulty: clip(prose.difficulty, W.difficulty) ?? "Beginner",
    circle: clip(prose.circle, W.circle),
    icon: clip(prose.icon, W.icon) ?? "Star",
    roleRequired: clip(prose.roleRequired, W.roleRequired),
    // The five a human typed. Nothing on the proposal row could have set them.
    // A human typed these, and a human can paste. Same ceilings.
    gratitude: String(input.reward.gratitude).trim().slice(0, W.gratitude),
    stayCreditReward:
      input.reward.stayCreditReward === null || input.reward.stayCreditReward === undefined
        ? null
        : Math.trunc(Number(input.reward.stayCreditReward)),
    minStage: clip(input.reward.minStage, W.minStage),
    requiresRole: clip(input.reward.requiresRole, W.requiresRole),
    status: "Open",
    order: count + 1,
    isExample: false,
  };

  // The same function POST /api/admin/quests calls. Every invariant that path
  // carries comes with it, including the reward-range parse.
  await questsRepo.add(quest);

  await pool.query( // module-review-ok: quest_proposals has no repo cache above it, and this file is the table's one enumerable home (the ballots.ts pattern); the QUEST itself is written through questsRepo.add and never here
    "UPDATE quest_proposals SET status = 'accepted', decided_by = ?, decided_at = CURRENT_TIMESTAMP, " +
      "decided_note = ?, created_ref = ?, title = ?, subtitle = ?, description = ?, impact = ?, story = ?, " +
      "first_step = ?, steps = ?, deliverable = ?, tips = ?, tags = ?, duration = ?, difficulty = ?, " +
      "circle = ?, icon = ?, role_required = ? WHERE id = ?",
    [
      input.decidedBy,
      str(input.note),
      quest.id,
      quest.title,
      quest.subtitle,
      quest.description,
      quest.impact,
      quest.story,
      quest.firstStep,
      JSON.stringify(quest.steps ?? []),
      quest.deliverable,
      JSON.stringify(quest.tips ?? []),
      JSON.stringify(quest.tags ?? []),
      quest.duration,
      quest.difficulty,
      quest.circle,
      quest.icon,
      quest.roleRequired,
      row.id,
    ],
  );

  void recordEvent(pool, {
    kind: "audit",
    // The ACCEPT is a human act even when a machine wrote the proposal, and
    // the row records both: proposed_by_kind on the proposal, this actor here.
    text: `quest proposal accepted: ${quest.title} pays ${quest.gratitude}`,
    actorUserId: input.decidedBy,
    actorKind: "human",
    originModuleId: row.moduleId === "local" ? null : row.moduleId,
    entityType: "quest",
    entityRef: quest.id,
    audience: "admin",
  });

  return { ok: true, questId: quest.id };
}

export async function rejectQuestProposal(
  pool: Pool,
  input: { id: string; decidedBy: string; note?: string | null },
): Promise<boolean> {
  const [res]: any = await pool.query( // module-review-ok: quest_proposals has no repo cache above it, and this file is the table's one enumerable home (the ballots.ts pattern); the QUEST itself is written through questsRepo.add and never here
    "UPDATE quest_proposals SET status = 'rejected', decided_by = ?, decided_at = CURRENT_TIMESTAMP, " +
      "decided_note = ? WHERE id = ? AND status = 'proposed'",
    [input.decidedBy, str(input.note), input.id],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

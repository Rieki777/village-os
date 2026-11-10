/**
 * Every statement against the Funding rounds tables (drizzle/0338) and the
 * interaction record it introduced.
 *
 * Raw SQL, one place: the lib and the routes never query these tables
 * themselves. S3 adds the grow fields, the ticks, the earmarks and the
 * round's outcome, all on 0338's tables. Every INSERT names every column it writes, so no DEFAULT is
 * relied on for a value the caller meant to set.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { IdeaInput, IdeaStatus, PotClock, ShownAs } from "../../shared/fundingRounds";

export type Queryable = Pool | PoolConnection;

export interface PotRow {
  id: string;
  name: string;
  purpose: string | null;
  kind: "season" | "rolling";
  unitKind: "currency" | "token";
  unitCode: string;
  holderRoleId: string | null;
  circleId: string | null;
  structureKey: string | null;
  clock: PotClock;
  decider: "power" | "people";
  weightCapPct: number;
  countedVoice: "work_only" | "all";
  status: "open" | "paused" | "closed";
  createdBy: string;
  createdAt: string | null;
}

export interface RoundRow {
  id: string;
  potId: string;
  title: string;
  seedAt: Date;
  growAt: Date | null;
  chooseAt: Date | null;
  harvestAt: Date | null;
  offeredMinor: number | null;
  quorumPct: number;
  ideasPerMember: number;
  anonymousAllowed: boolean;
  closedAt: Date | null;
  /** Frozen at harvest; null before. */
  decider: "power" | "people" | null;
  /** Both counts and the disagreement, written once at harvest (see `claimOutcome`). */
  outcome: unknown | null;
  createdBy: string;
  createdAt: string | null;
}

export interface IdeaRow {
  id: string;
  roundId: string;
  authorId: string;
  shownAs: ShownAs;
  title: string;
  what: string;
  whoHelps: string | null;
  roughCostMinor: number | null;
  whoMight: string | null;
  structureKey: string | null;
  circleId: string | null;
  locale: string | null;
  status: IdeaStatus;
  deliverable: string | null;
  askMinor: number | null;
  sharedImpact: boolean;
  threadId: string | null;
  questId: string | null;
  createdAt: string | null;
}

const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const date = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function toPot(r: RowDataPacket): PotRow {
  return {
    id: String(r.id),
    name: String(r.name),
    purpose: str(r.purpose),
    kind: r.kind === "rolling" ? "rolling" : "season",
    unitKind: r.unit_kind === "token" ? "token" : "currency",
    unitCode: String(r.unit_code),
    holderRoleId: str(r.holder_role_id),
    circleId: str(r.circle_id),
    structureKey: str(r.structure_key),
    clock: (["lunar", "seasonal", "fixed"].includes(String(r.clock)) ? r.clock : "seasonal") as PotClock,
    decider: r.decider === "power" ? "power" : "people",
    weightCapPct: Number(r.weight_cap_pct),
    countedVoice: r.counted_voice === "all" ? "all" : "work_only",
    status: (["open", "paused", "closed"].includes(String(r.status)) ? r.status : "open") as PotRow["status"],
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
  };
}

function toRound(r: RowDataPacket): RoundRow {
  return {
    id: String(r.id),
    potId: String(r.pot_id),
    title: String(r.title),
    seedAt: date(r.seed_at) as Date,
    growAt: date(r.grow_at),
    chooseAt: date(r.choose_at),
    harvestAt: date(r.harvest_at),
    offeredMinor: num(r.offered_minor),
    quorumPct: Number(r.quorum_pct),
    ideasPerMember: Number(r.ideas_per_member),
    anonymousAllowed: Number(r.anonymous_allowed) === 1,
    closedAt: date(r.closed_at),
    decider: r.decider === "power" || r.decider === "people" ? r.decider : null,
    outcome: r.outcome == null ? null : typeof r.outcome === "string" ? JSON.parse(r.outcome) : r.outcome,
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
  };
}

function toIdea(r: RowDataPacket): IdeaRow {
  return {
    id: String(r.id),
    roundId: String(r.round_id),
    authorId: String(r.author_id),
    shownAs: r.shown_as === "anonymous" ? "anonymous" : "named",
    title: String(r.title),
    what: String(r.what),
    whoHelps: str(r.who_helps),
    roughCostMinor: num(r.rough_cost_minor),
    whoMight: str(r.who_might),
    structureKey: str(r.structure_key),
    circleId: str(r.circle_id),
    locale: str(r.locale),
    status: String(r.status) as IdeaStatus,
    deliverable: str(r.deliverable),
    askMinor: num(r.ask_minor),
    sharedImpact: Number(r.shared_impact) === 1,
    threadId: str(r.thread_id),
    questId: str(r.quest_id),
    createdAt: iso(r.created_at),
  };
}

// ── pots ────────────────────────────────────────────────────────────────────

export interface NewPot {
  id: string;
  name: string;
  purpose: string | null;
  unitKind: "currency" | "token";
  unitCode: string;
  holderRoleId: string | null;
  circleId: string | null;
  structureKey: string | null;
  clock: PotClock;
  createdBy: string;
}

export async function insertPot(db: Queryable, p: NewPot): Promise<void> {
  await db.query(
    "INSERT INTO `funding_pots` (`id`, `name`, `purpose`, `kind`, `unit_kind`, `unit_code`, `holder_role_id`, `circle_id`, `structure_key`, `clock`, `decider`, `weight_cap_pct`, `counted_voice`, `status`, `created_by`) VALUES (?, ?, ?, 'season', ?, ?, ?, ?, ?, ?, 'power', 25, 'work_only', 'open', ?)",
    [p.id, p.name, p.purpose, p.unitKind, p.unitCode, p.holderRoleId, p.circleId, p.structureKey, p.clock, p.createdBy],
  );
}

export async function potById(db: Queryable, id: string): Promise<PotRow | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `funding_pots` WHERE `id` = ?", [id]);
  return rows[0] ? toPot(rows[0]) : null;
}

export async function listPots(db: Queryable): Promise<PotRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `funding_pots` ORDER BY `created_at`, `id`");
  return rows.map(toPot);
}

/** Money a pot has received, in its minor unit. */
export async function receivedOf(db: Queryable, potId: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT COALESCE(SUM(`amount_minor`), 0) AS total FROM `funding_pot_receipts` WHERE `pot_id` = ?", [potId]);
  return Number(rows[0]?.total ?? 0);
}

// ── rounds ──────────────────────────────────────────────────────────────────

export interface NewRound {
  id: string;
  potId: string;
  title: string;
  seedAt: Date;
  growAt: Date | null;
  chooseAt: Date | null;
  harvestAt: Date | null;
  offeredMinor: number | null;
  quorumPct: number;
  ideasPerMember: number;
  anonymousAllowed: boolean;
  createdBy: string;
}

export async function insertRound(db: Queryable, r: NewRound): Promise<void> {
  await db.query(
    "INSERT INTO `funding_rounds` (`id`, `pot_id`, `title`, `seed_at`, `grow_at`, `choose_at`, `harvest_at`, `offered_minor`, `rubric`, `quorum_pct`, `ideas_per_member`, `anonymous_allowed`, `created_by`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
    [r.id, r.potId, r.title, r.seedAt, r.growAt, r.chooseAt, r.harvestAt, r.offeredMinor, r.quorumPct, r.ideasPerMember, r.anonymousAllowed ? 1 : 0, r.createdBy],
  );
}

export async function roundById(db: Queryable, id: string): Promise<RoundRow | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `funding_rounds` WHERE `id` = ?", [id]);
  return rows[0] ? toRound(rows[0]) : null;
}

export async function listRounds(db: Queryable, potId?: string): Promise<RoundRow[]> {
  const [rows] = potId
    ? await db.query<RowDataPacket[]>("SELECT * FROM `funding_rounds` WHERE `pot_id` = ? ORDER BY `seed_at` DESC, `id`", [potId])
    : await db.query<RowDataPacket[]>("SELECT * FROM `funding_rounds` ORDER BY `seed_at` DESC, `id`");
  return rows.map(toRound);
}

export async function updateRoundDates(
  db: Queryable,
  id: string,
  d: { growAt: Date | null; chooseAt: Date | null; harvestAt: Date | null },
): Promise<void> {
  await db.query("UPDATE `funding_rounds` SET `grow_at` = ?, `choose_at` = ?, `harvest_at` = ? WHERE `id` = ?", [d.growAt, d.chooseAt, d.harvestAt, id]);
}

// ── ideas ───────────────────────────────────────────────────────────────────

export async function insertIdea(db: Queryable, id: string, roundId: string, authorId: string, idea: IdeaInput): Promise<void> {
  await db.query(
    "INSERT INTO `funding_round_ideas` (`id`, `round_id`, `author_id`, `shown_as`, `title`, `what`, `who_helps`, `rough_cost_minor`, `who_might`, `structure_key`, `circle_id`, `locale`, `status`, `shared_impact`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed', 0)",
    [id, roundId, authorId, idea.shownAs, idea.title, idea.what, idea.whoHelps, idea.roughCostMinor, idea.whoMight, idea.structureKey, idea.circleId, idea.locale],
  );
}

export async function ideaById(db: Queryable, id: string): Promise<IdeaRow | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `funding_round_ideas` WHERE `id` = ?", [id]);
  return rows[0] ? toIdea(rows[0]) : null;
}

export async function ideasOfRound(db: Queryable, roundId: string): Promise<IdeaRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `funding_round_ideas` WHERE `round_id` = ? ORDER BY `created_at`, `id`", [roundId]);
  return rows.map(toIdea);
}

/** A member's ideas in a round that still count against their allowance. */
export async function liveIdeasOf(db: Queryable, roundId: string, authorId: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `funding_round_ideas` WHERE `round_id` = ? AND `author_id` = ? AND `status` <> 'withdrawn'",
    [roundId, authorId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function setIdeaStatus(db: Queryable, id: string, status: IdeaStatus): Promise<void> {
  await db.query("UPDATE `funding_round_ideas` SET `status` = ? WHERE `id` = ?", [status, id]);
}

/** The grow fields and the status they imply, in one write. */
export async function updateIdeaGrow(
  db: Queryable,
  id: string,
  g: { title: string; what: string; deliverable: string | null; askMinor: number | null; sharedImpact: boolean; status: IdeaStatus },
): Promise<void> {
  await db.query(
    "UPDATE `funding_round_ideas` SET `title` = ?, `what` = ?, `deliverable` = ?, `ask_minor` = ?, `shared_impact` = ?, `status` = ? WHERE `id` = ?",
    [g.title, g.what, g.deliverable, g.askMinor, g.sharedImpact ? 1 : 0, g.status, id],
  );
}

export async function setIdeaThread(db: Queryable, id: string, threadId: string): Promise<void> {
  await db.query("UPDATE `funding_round_ideas` SET `thread_id` = ? WHERE `id` = ? AND `thread_id` IS NULL", [threadId, id]);
}

/** The ideas a member wrote, for their export. Their own words, so the author sees them whatever shown_as says. */
export async function ideasByAuthor(db: Queryable, authorId: string): Promise<IdeaRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `funding_round_ideas` WHERE `author_id` = ? ORDER BY `created_at`", [authorId]);
  return rows.map(toIdea);
}

// ── ticks (choose) ──────────────────────────────────────────────────────────

/** Replace a member's ticks in a round, in one transaction. */
export async function replaceMarks(conn: PoolConnection, roundId: string, userId: string, ideaIds: readonly string[]): Promise<void> {
  await conn.query("DELETE FROM `funding_round_marks` WHERE `round_id` = ? AND `user_id` = ?", [roundId, userId]);
  for (const ideaId of ideaIds) {
    await conn.query("INSERT INTO `funding_round_marks` (`round_id`, `user_id`, `idea_id`) VALUES (?, ?, ?)", [roundId, userId, ideaId]);
  }
}

export async function marksOf(db: Queryable, roundId: string): Promise<Array<{ userId: string; ideaId: string }>> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `user_id`, `idea_id` FROM `funding_round_marks` WHERE `round_id` = ? ORDER BY `user_id`, `idea_id`", [roundId]);
  return rows.map((r) => ({ userId: String(r.user_id), ideaId: String(r.idea_id) }));
}

/** Every tick a member has given, in every round, for their export. */
export async function allMarksOf(db: Queryable, userId: string): Promise<Array<{ roundId: string; ideaId: string; createdAt: string | null }>> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `round_id`, `idea_id`, `created_at` FROM `funding_round_marks` WHERE `user_id` = ? ORDER BY `created_at`", [userId]);
  return rows.map((r) => ({ roundId: String(r.round_id), ideaId: String(r.idea_id), createdAt: iso(r.created_at) }));
}

export async function marksOfMember(db: Queryable, roundId: string, userId: string): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `idea_id` FROM `funding_round_marks` WHERE `round_id` = ? AND `user_id` = ? ORDER BY `idea_id`", [roundId, userId]);
  return rows.map((r) => String(r.idea_id));
}

// ── earmarks and the outcome (harvest) ──────────────────────────────────────

/** What a pot's earmarks hold, owe and have paid. Released earmarks hold nothing. */
export async function earmarkTotals(db: Queryable, potId: string): Promise<{ held: number; owed: number; paid: number }> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `status`, COALESCE(SUM(`amount_minor`), 0) AS total FROM `funding_earmarks` WHERE `pot_id` = ? AND `status` <> 'released' GROUP BY `status`",
    [potId],
  );
  const out = { held: 0, owed: 0, paid: 0 };
  for (const r of rows) if (r.status === "held" || r.status === "owed" || r.status === "paid") out[r.status as "held"] = Number(r.total);
  return out;
}

/** Lock the pot row for the rest of the transaction, so two harvests cannot both spend its free money. */
export async function lockPot(conn: PoolConnection, potId: string): Promise<void> {
  await conn.query("SELECT `id` FROM `funding_pots` WHERE `id` = ? FOR UPDATE", [potId]);
}

/**
 * Write the round's outcome if nobody has yet. Returns false when another
 * request already did, so the caller writes no earmark: the count runs once.
 */
export async function claimOutcome(conn: PoolConnection, roundId: string, decider: "power" | "people", capPct: number, outcome: unknown): Promise<boolean> {
  const [res] = await conn.query<any>(
    "UPDATE `funding_rounds` SET `outcome` = ?, `decider` = ?, `weight_cap_pct` = ?, `counted_voice` = 'all' WHERE `id` = ? AND `outcome` IS NULL",
    [JSON.stringify(outcome), decider, capPct, roundId],
  );
  return Number(res?.affectedRows ?? 0) === 1;
}

export async function insertEarmark(
  conn: PoolConnection,
  e: { id: string; potId: string; roundId: string; ideaId: string; amountMinor: number; changedBy: string | null },
): Promise<void> {
  await conn.query(
    "INSERT INTO `funding_earmarks` (`id`, `pot_id`, `round_id`, `idea_id`, `quest_id`, `amount_minor`, `status`, `expires_on`, `released_reason`, `changed_by`) VALUES (?, ?, ?, ?, NULL, ?, 'held', NULL, NULL, ?)",
    [e.id, e.potId, e.roundId, e.ideaId, e.amountMinor, e.changedBy],
  );
}

/**
 * Claim a funded idea for the quest about to be made from it. True for exactly
 * one caller, so two harvest reads racing never put two quests on the board.
 */
export async function claimIdeaQuest(db: Queryable, ideaId: string, questId: string): Promise<boolean> {
  const [res] = await db.query<any>("UPDATE `funding_round_ideas` SET `quest_id` = ? WHERE `id` = ? AND `quest_id` IS NULL", [questId, ideaId]);
  return Number(res?.affectedRows ?? 0) === 1;
}

/** Give a claim back when the quest could not be saved, so the next read makes it. */
export async function releaseIdeaQuest(db: Queryable, ideaId: string, questId: string): Promise<void> {
  await db.query("UPDATE `funding_round_ideas` SET `quest_id` = NULL WHERE `id` = ? AND `quest_id` = ?", [ideaId, questId]);
}

/** Point the idea's earmark at the quest it pays. */
export async function setEarmarkQuest(db: Queryable, ideaId: string, questId: string): Promise<void> {
  await db.query("UPDATE `funding_earmarks` SET `quest_id` = ? WHERE `idea_id` = ? AND `quest_id` IS NULL", [questId, ideaId]);
}

// ── backing pledges (0348) ──────────────────────────────────────────────────

export type PledgeStatus = "pledged" | "withdrawn" | "firm" | "collected" | "paid" | "released_to_backer" | "moved_to_pot";
export type PledgeStage = "seed" | "grow" | "choose" | "harvest" | "after";

export interface PledgeRow {
  id: string;
  ideaId: string | null;
  potId: string | null;
  backerUserId: string;
  amountMinor: number;
  unitCode: string;
  stageAtPledge: PledgeStage;
  status: PledgeStatus;
  createdAt: string | null;
  firmAt: string | null;
}

function toPledge(r: RowDataPacket): PledgeRow {
  return {
    id: String(r.id),
    ideaId: str(r.idea_id),
    potId: str(r.pot_id),
    backerUserId: String(r.backer_user_id),
    amountMinor: Number(r.amount_minor),
    unitCode: String(r.unit_code),
    stageAtPledge: String(r.stage_at_pledge) as PledgeStage,
    status: String(r.status) as PledgeStatus,
    createdAt: iso(r.created_at),
    firmAt: iso(r.firm_at),
  };
}

export async function insertPledge(
  db: Queryable,
  p: { id: string; ideaId: string; backerUserId: string; amountMinor: number; unitCode: string; stageAtPledge: PledgeStage; status: "pledged" | "firm" },
): Promise<void> {
  await db.query(
    "INSERT INTO `funding_pledges` (`id`, `idea_id`, `pot_id`, `backer_user_id`, `amount_minor`, `unit_code`, `stage_at_pledge`, `status`, `on_abandon`, `rate_frozen`, `equity_posted_ref`, `badge_awarded_at`, `firm_at`, `withdrawn_at`, `collected_at`, `paid_at`, `released_at`) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'return', NULL, NULL, NULL, ?, NULL, NULL, NULL, NULL)",
    [p.id, p.ideaId, p.backerUserId, p.amountMinor, p.unitCode, p.stageAtPledge, p.status, p.status === "firm" ? new Date() : null],
  );
}

export async function pledgeById(db: Queryable, id: string): Promise<PledgeRow | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `funding_pledges` WHERE `id` = ?", [id]);
  return rows[0] ? toPledge(rows[0]) : null;
}

/** Every pledge on the ideas of a round, oldest first. */
export async function pledgesOfRound(db: Queryable, roundId: string): Promise<PledgeRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT p.* FROM `funding_pledges` p JOIN `funding_round_ideas` i ON i.`id` = p.`idea_id` WHERE i.`round_id` = ? ORDER BY p.`created_at`, p.`id`",
    [roundId],
  );
  return rows.map(toPledge);
}

export async function pledgesByBacker(db: Queryable, userId: string): Promise<PledgeRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `funding_pledges` WHERE `backer_user_id` = ? ORDER BY `created_at`", [userId]);
  return rows.map(toPledge);
}

export async function withdrawPledgeRow(db: Queryable, id: string): Promise<boolean> {
  const [res] = await db.query<any>("UPDATE `funding_pledges` SET `status` = 'withdrawn', `withdrawn_at` = ? WHERE `id` = ? AND `status` = 'pledged'", [new Date(), id]);
  return Number(res?.affectedRows ?? 0) === 1;
}

/** Choosing has closed: the standing pledges on these ideas turn firm. */
export async function firmPledges(conn: PoolConnection, ideaIds: readonly string[]): Promise<void> {
  if (ideaIds.length === 0) return;
  await conn.query(
    `UPDATE \`funding_pledges\` SET \`status\` = 'firm', \`firm_at\` = ? WHERE \`status\` = 'pledged' AND \`idea_id\` IN (${ideaIds.map(() => "?").join(",")})`,
    [new Date(), ...ideaIds],
  );
}

/** These ideas will not happen: their standing and firm pledges go back to the backer. Nothing was collected. */
export async function releasePledges(conn: PoolConnection, ideaIds: readonly string[]): Promise<void> {
  if (ideaIds.length === 0) return;
  await conn.query(
    `UPDATE \`funding_pledges\` SET \`status\` = 'released_to_backer', \`released_at\` = ? WHERE \`status\` IN ('pledged', 'firm') AND \`idea_id\` IN (${ideaIds.map(() => "?").join(",")})`,
    [new Date(), ...ideaIds],
  );
}

/** Firm pledges per idea in a round, in minor units. */
export async function firmTotals(db: Queryable, roundId: string): Promise<Map<string, number>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT p.`idea_id`, SUM(p.`amount_minor`) AS total FROM `funding_pledges` p JOIN `funding_round_ideas` i ON i.`id` = p.`idea_id` WHERE i.`round_id` = ? AND p.`status` IN ('firm', 'collected', 'paid') GROUP BY p.`idea_id`",
    [roundId],
  );
  return new Map(rows.map((r) => [String(r.idea_id), Number(r.total)]));
}

/** Lower a held earmark by a new firm pledge, never below zero. Locks the earmark row. */
export async function lowerEarmark(conn: PoolConnection, ideaId: string, byMinor: number): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT `id`, `amount_minor` FROM `funding_earmarks` WHERE `idea_id` = ? AND `status` = 'held' FOR UPDATE", [ideaId]);
  for (const r of rows) {
    await conn.query("UPDATE `funding_earmarks` SET `amount_minor` = ? WHERE `id` = ?", [Math.max(0, Number(r.amount_minor) - byMinor), r.id]);
  }
}

// ── the forum thread an idea opens ──────────────────────────────────────────

export async function insertIdeaThread(
  db: Queryable,
  t: { id: string; category: string; authorId: string; title: string; body: string; meta: Record<string, unknown> },
): Promise<void> {
  await db.query(
    "INSERT INTO forum_threads (id, category, author_id, title, body, kind, meta, image_url) VALUES (?, ?, ?, ?, ?, 'discussion', ?, NULL)",
    [t.id, t.category, t.authorId, t.title.slice(0, 255), t.body.slice(0, 20000), JSON.stringify(t.meta)],
  );
}

// ── the interaction record ──────────────────────────────────────────────────

export interface InteractionInput {
  actorUserId: string;
  kind: string;
  subjectType: string;
  subjectRef: string;
  roundId: string | null;
  visibility: "public" | "members" | "private";
  channel: "web" | "map" | "bot" | "api";
  dedupeKey: string;
}

/** Append one interaction. A repeated dedupe key is a no-op. */
export async function insertInteraction(db: Queryable, e: InteractionInput): Promise<void> {
  await db.query(
    "INSERT IGNORE INTO `interaction_events` (`actor_user_id`, `kind`, `subject_type`, `subject_ref`, `round_id`, `visibility`, `channel`, `dedupe_key`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [e.actorUserId, e.kind, e.subjectType, e.subjectRef, e.roundId, e.visibility, e.channel, e.dedupeKey.slice(0, 191)],
  );
}

export interface InteractionRow {
  occurredAt: string | null;
  kind: string;
  subjectType: string;
  subjectRef: string;
  roundId: string | null;
  visibility: string;
  channel: string;
}

export async function interactionsOf(db: Queryable, userId: string): Promise<InteractionRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `occurred_at`, `kind`, `subject_type`, `subject_ref`, `round_id`, `visibility`, `channel` FROM `interaction_events` WHERE `actor_user_id` = ? ORDER BY `id`",
    [userId],
  );
  return rows.map((r) => ({
    occurredAt: iso(r.occurred_at),
    kind: String(r.kind),
    subjectType: String(r.subject_type),
    subjectRef: String(r.subject_ref),
    roundId: str(r.round_id),
    visibility: String(r.visibility),
    channel: String(r.channel),
  }));
}

/** Counts of an idea's interactions by kind, for members. Private rows never count here. */
export async function interactionCountsFor(db: Queryable, subjectType: string, subjectRef: string): Promise<Record<string, number>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `kind`, COUNT(*) AS n FROM `interaction_events` WHERE `subject_type` = ? AND `subject_ref` = ? AND `visibility` <> 'private' GROUP BY `kind`",
    [subjectType, subjectRef],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.kind)] = Number(r.n);
  return out;
}

// ── erasure ─────────────────────────────────────────────────────────────────

/** The stand-in author an erased member's kept ideas carry. Never a real id. */
export const ERASED_AUTHOR = "erased";

/**
 * Forget a member across Funding rounds:
 * - their interaction rows: private ones deleted, the rest de-attributed;
 * - their ticks deleted (a closed round's counts live in its outcome);
 * - their ideas still in seed, withdrawn or held deleted; an idea already on
 *   the record (grown, on a ballot, funded, not funded, stopped) kept,
 *   de-attributed, and shown as "a member".
 */
export async function forgetMember(db: Queryable, userId: string): Promise<void> {
  await db.query("DELETE FROM `interaction_events` WHERE `actor_user_id` = ? AND `visibility` = 'private'", [userId]);
  await db.query("UPDATE `interaction_events` SET `actor_user_id` = NULL WHERE `actor_user_id` = ?", [userId]);
  await db.query("DELETE FROM `funding_round_marks` WHERE `user_id` = ?", [userId]);
  // A pledge that never turned firm goes; a firm promise of money stays, de-attributed (debts outlive erasure).
  await db.query("DELETE FROM `funding_pledges` WHERE `backer_user_id` = ? AND `status` IN ('pledged', 'withdrawn', 'released_to_backer')", [userId]);
  await db.query("UPDATE `funding_pledges` SET `backer_user_id` = ? WHERE `backer_user_id` = ?", [ERASED_AUTHOR, userId]);
  await db.query("DELETE FROM `funding_round_ideas` WHERE `author_id` = ? AND `status` IN ('seed', 'withdrawn', 'held')", [userId]);
  await db.query("UPDATE `funding_round_ideas` SET `author_id` = ?, `shown_as` = 'anonymous' WHERE `author_id` = ?", [ERASED_AUTHOR, userId]);
}

/** Open rounds, for the module's off-switch check: a round past seed and not closed. */
export async function openRoundCount(db: Queryable, now: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `funding_rounds` WHERE `closed_at` IS NULL AND `grow_at` IS NOT NULL AND `grow_at` <= ?",
    [now],
  );
  return Number(rows[0]?.n ?? 0);
}

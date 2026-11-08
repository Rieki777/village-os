/**
 * Every statement against the Funding rounds tables (drizzle/0338) and the
 * interaction record it introduced.
 *
 * Raw SQL, one place: the lib and the routes never query these tables
 * themselves. Every INSERT names every column it writes, so no DEFAULT is
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

export async function setIdeaThread(db: Queryable, id: string, threadId: string): Promise<void> {
  await db.query("UPDATE `funding_round_ideas` SET `thread_id` = ? WHERE `id` = ? AND `thread_id` IS NULL", [threadId, id]);
}

/** The ideas a member wrote, for their export. Their own words, so the author sees them whatever shown_as says. */
export async function ideasByAuthor(db: Queryable, authorId: string): Promise<IdeaRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `funding_round_ideas` WHERE `author_id` = ? ORDER BY `created_at`", [authorId]);
  return rows.map(toIdea);
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

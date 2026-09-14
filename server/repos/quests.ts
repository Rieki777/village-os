/**
 * Quests + quest claims repositories (S10): MySQL, camelCase interface, same
 * shapes the routes and client always saw.
 *
 * The reward-range columns (gratitude_min/gratitude_max) are DERIVED from the
 * advertised label ("50-100") at write time, here and only here â€” the same
 * parsing the importer uses. That is the trap-3.5 lesson institutionalized:
 * the label is what the board advertised (verbatim, a contract), the bounds
 * are what consent enforcement reads, and one writer keeps them in agreement.
 *
 * `consentedCount(userId)` exists because stage computation reads it on hot
 * paths; `consentedCounts()` (grouped) exists so listing N members costs one
 * query, not N.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { parseRewardRange } from "../../shared/questRewards";
import { calendarRemove, calendarUpsert } from "../lib/calendar";
import { questCalendarInput } from "../lib/calendarProviders";

/**
 * Retry a whole transaction that InnoDB killed as a deadlock victim.
 *
 * The same three attempts `postTransfer` takes, for the same reason written
 * over it: perfect lock ordering does not stop InnoDB picking a victim under
 * real contention, because a balance recompute reads rows a neighbour is
 * writing. Both transactions below reach the ledger's hot faucet row through
 * their caller's post callback, so they are under exactly that pressure.
 *
 * A rolled-back transaction moved nothing, so a retry is safe and honest, and
 * every write inside these two is either an insert of a fresh row or an
 * idempotency-keyed post. Giving up after three keeps a pathological case
 * from hiding as latency.
 */
async function withDeadlockRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e: any) {
      const retryable = e?.code === "ER_LOCK_DEADLOCK" || e?.code === "ER_LOCK_WAIT_TIMEOUT";
      if (!retryable || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 25 * attempt + Math.floor(Math.random() * 25)));
    }
  }
}

const toIso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

const toDb = (v: unknown): Date | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

// â”€â”€ Quests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface QuestRecord {
  id: string;
  title: string;
  /** One line under the title, the quest's own voice (0068). */
  subtitle?: string | null;
  description?: string | null;
  impact?: string | null;
  /** Why this quest matters, written to the member. Prose (0068). */
  story?: string | null;
  /** One small act that starts the quest, fifteen minutes or less (0068). */
  firstStep?: string | null;
  /** The path through the work, one string per step (0068). */
  steps?: string[];
  /** What the member shares when they submit (0068). */
  deliverable?: string | null;
  /** Hard-won advice, one string per tip (0068). */
  tips?: string[];
  /** Optional poster an admin sets; absent, the client paints a scene (0068). */
  imageUrl?: string | null;
  /** The advertised label, verbatim â€” "50-100", "75". A contract, never coerced. */
  gratitude: string;
  duration?: string | null;
  difficulty?: string | null;
  circle?: string | null;
  status: string;
  icon?: string | null;
  /** Display-only prose ("Requires: green thumb"). Never enforced. */
  roleRequired?: string | null;
  /** STRUCTURED stage floor â€” the claim gate enforces this. */
  minStage?: string | null;
  /** STRUCTURED role gate â€” the claim gate enforces this. */
  requiresRole?: string | null;
  /** Work-exchange (S31): stay credits released at consent, in a SEPARATE
   *  column from recognition â€” two currencies, one human gate, never blended. */
  stayCreditReward?: number | null;
  tags: string[];
  order: number;
  /** A standing example: renders on the board, refuses every claim. */
  isExample?: boolean;
  /** A window and a deadline (0085), ISO instants. Any one of them puts the
   *  quest on the village calendar through this repo's own save path. */
  startsAt?: string | null;
  endsAt?: string | null;
  dueAt?: string | null;
}

/**
 * Has the board shut this quest? One reading, for every door into a claim.
 *
 * A DENY-LIST AND NOT AN ALLOW-LIST, deliberately. Admin offers exactly two
 * words ("Open", "Closed"); `server/seeds/quests-seed.json` ships a
 * "Seasonal" one, `server/seeds/examples-seed.json` writes lowercase "open",
 * and the column is a free varchar a village can type its own word into. An
 * allow-list of "open" would have refused every seasonal quest on the board
 * and locked any village that renamed the state out of its own work, which is
 * a worse failure than the one being closed here. "Closed" is the only value
 * in the product that MEANS not taking claims, so it is the only one refused.
 *
 * Case and whitespace tolerant, matching `statusIs` in
 * `client/src/lib/questBoard.ts`: the board stores display casing and two call
 * sites there had already drifted apart over exactly that.
 */
export function questClosed(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "closed";
}

export interface QuestsRepo {
  all(): Promise<QuestRecord[]>;
  byId(id: string): Promise<QuestRecord | null>;
  add(q: QuestRecord): Promise<QuestRecord>;
  update(id: string, mutate: (q: QuestRecord) => void): Promise<QuestRecord | null>;
  remove(id: string): Promise<QuestRecord | null>;
}

const QUEST_SELECT =
  // is_example is selected so consumers can filter. Without it no downstream
  // code could tell an example quest from a real one â€” the work-exchange
  // suggester was offering seeded quests to real guests as paid work.
  "SELECT id, title, subtitle, description, impact, story, first_step, steps, deliverable, tips, image_url, gratitude, duration, difficulty, circle, status, icon, role_required, min_stage, requires_role, stay_credit_reward, tags, sort_order, is_example, starts_at, ends_at, due_at FROM quests";

/** JSON column â†’ string array, tolerant of junk: an empty list renders fine. */
function toList(v: unknown): string[] {
  try {
    const parsed = Array.isArray(v) ? v : JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed.map((s) => String(s)).filter((s) => s.trim() !== "") : [];
  } catch {
    return [];
  }
}

function rowToQuest(r: RowDataPacket): QuestRecord {
  const tags = toList(r.tags);
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    subtitle: r.subtitle ?? null,
    description: r.description ?? null,
    impact: r.impact ?? null,
    story: r.story ?? null,
    firstStep: r.first_step ?? null,
    steps: toList(r.steps),
    deliverable: r.deliverable ?? null,
    tips: toList(r.tips),
    imageUrl: r.image_url ?? null,
    gratitude: String(r.gratitude ?? ""),
    duration: r.duration ?? null,
    difficulty: r.difficulty ?? null,
    circle: r.circle ?? null,
    status: String(r.status ?? "open"),
    icon: r.icon ?? null,
    roleRequired: r.role_required ?? null,
    minStage: r.min_stage ?? null,
    requiresRole: r.requires_role ?? null,
    stayCreditReward: r.stay_credit_reward == null ? null : Number(r.stay_credit_reward),
    tags,
    order: Number(r.sort_order ?? 0),
    isExample: Number(r.is_example ?? 0) === 1,
    startsAt: toIso(r.starts_at),
    endsAt: toIso(r.ends_at),
    dueAt: toIso(r.due_at),
  };
}

/** A JSON list column: the list when it has content, NULL when it does not. */
function jsonListOrNull(list: string[] | null | undefined): string | null {
  const clean = (list ?? []).map((s) => String(s)).filter((s) => s.trim() !== "");
  return clean.length ? JSON.stringify(clean) : null;
}

function questParams(q: QuestRecord): any[] {
  const range = parseRewardRange(q.gratitude);
  return [
    q.id,
    q.title ?? "",
    q.description ?? null,
    q.impact ?? null,
    String(q.gratitude ?? ""),
    range.min,
    range.max,
    q.duration ?? null,
    q.difficulty ?? null,
    q.circle ?? null,
    q.status ?? "open",
    q.icon ?? null,
    q.roleRequired ?? null,
    q.minStage ?? null,
    q.requiresRole ?? null,
    q.stayCreditReward == null ? null : Math.max(0, Math.floor(Number(q.stayCreditReward))),
    JSON.stringify(q.tags ?? []),
    Number(q.order ?? 0),
    // The story layer (0068), appended so the historical column order above
    // stays byte-identical for anyone diffing against an older write path.
    q.subtitle ?? null,
    q.story ?? null,
    q.firstStep ?? null,
    // An empty list writes NULL, not '[]'. rowToQuest maps both to [], so the
    // round trip is unchanged, and anything that later reasons about these
    // columns with IS NULL reads what the migration actually meant.
    jsonListOrNull(q.steps),
    q.deliverable ?? null,
    jsonListOrNull(q.tips),
    q.imageUrl ?? null,
    // The calendar dates (0085), appended for the same reason as the story
    // layer: the historical column order above stays byte-identical.
    toDb(q.startsAt),
    toDb(q.endsAt),
    toDb(q.dueAt),
  ];
}

const QUEST_COLS =
  "(id, title, description, impact, gratitude, gratitude_min, gratitude_max, duration, difficulty, circle, status, icon, role_required, min_stage, requires_role, stay_credit_reward, tags, sort_order, subtitle, story, first_step, steps, deliverable, tips, image_url, starts_at, ends_at, due_at)";

/**
 * The quest's calendar row (0085): written on the quest's own save path, so a
 * planting day is stored once, on the calendar, and the quest keeps only its
 * dates. A quest with no date has no row; one that loses its dates loses its
 * row (marked, never deleted). A calendar failure is logged and never fails
 * the quest save; the hourly calendar-mirror job reconciles the difference.
 */
async function syncQuestCalendar(pool: Pool, q: QuestRecord): Promise<void> {
  try {
    const input = questCalendarInput(q);
    if (input) await calendarUpsert(pool, { ...input, sourceModule: "quests" });
    else await calendarRemove(pool, { sourceModule: "quests", sourceId: `quest:${q.id}` });
  } catch (err) {
    console.error("[quests] calendar sync failed (quest saved)", err);
  }
}

export function questsRepo(pool: Pool): QuestsRepo {
  return {
    async all() {
      const [rows] = await pool.query<RowDataPacket[]>(`${QUEST_SELECT} ORDER BY sort_order, id`);
      return rows.map(rowToQuest);
    },

    async byId(id) {
      const [rows] = await pool.query<RowDataPacket[]>(`${QUEST_SELECT} WHERE id = ?`, [id]);
      return rows[0] ? rowToQuest(rows[0]) : null;
    },

    async add(q) {
      await pool.query(
        `INSERT INTO quests ${QUEST_COLS} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        questParams(q),
      );
      await syncQuestCalendar(pool, q);
      return q;
    },

    async update(id, mutate) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query<RowDataPacket[]>(`${QUEST_SELECT} WHERE id = ? FOR UPDATE`, [id]);
        if (!rows[0]) {
          await conn.rollback();
          return null;
        }
        const quest = rowToQuest(rows[0]);
        mutate(quest);
        const p = questParams({ ...quest, id });
        await conn.query(
          "UPDATE quests SET title=?, description=?, impact=?, gratitude=?, gratitude_min=?, gratitude_max=?, " +
            "duration=?, difficulty=?, circle=?, status=?, icon=?, role_required=?, min_stage=?, requires_role=?, stay_credit_reward=?, tags=?, sort_order=?, " +
            "subtitle=?, story=?, first_step=?, steps=?, deliverable=?, tips=?, image_url=?, starts_at=?, ends_at=?, due_at=? WHERE id=?",
          [...p.slice(1), id],
        );
        await conn.commit();
        await syncQuestCalendar(pool, { ...quest, id });
        return { ...quest, id };
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    async remove(id) {
      const existing = await this.byId(id);
      if (!existing) return null;
      await pool.query("DELETE FROM quests WHERE id = ?", [id]);
      return existing;
    },
  };
}

// â”€â”€ Claims â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ClaimRecord {
  id: string;
  questId: string;
  questTitle: string;
  userId: string;
  userName: string;
  status: "claimed" | "submitted" | "consented" | "declined";
  artifactUrl?: string | null;
  note?: string | null;
  amount?: number | null;
  claimedAt: string | null;
  submittedAt?: string | null;
  /** Historical JSON name for when the claim was consented or declined. */
  resolvedAt?: string | null;
  /**
   * WHO witnessed the work (0070). `consented_at` has recorded the time since
   * 0001 and never the person, which leaves the one rule that matters
   * unenforceable after the fact: a steward may not confirm their own claim.
   * The route has always known the actor and has never written it down.
   */
  consentedBy?: string | null;
  /**
   * How the person doing the work says it is going (0055). Self-reported,
   * never computed, and nothing is paid or scored from it: a confidence
   * rating that feeds a reward is a rating people learn to inflate.
   */
  confidence?: "on_track" | "at_risk" | "stuck" | null;
  confidenceNote?: string | null;
  confidenceAt?: string | null;
}

/** What `openClaim` answers with, so a caller never has to guess. */
export type OpenClaimOutcome =
  | { ok: true; claim: ClaimRecord }
  /** The quest row was gone by the time the lock was taken. */
  | { ok: false; reason: "gone" }
  /** This member already holds a live claim on this quest. */
  | { ok: false; reason: "already"; existing: ClaimRecord };

/** What `consentOnce` answers with. Every branch is a different remedy. */
export type ConsentOutcome =
  | { ok: true; claim: ClaimRecord }
  /** No claim with that id, under the lock. */
  | { ok: false; reason: "missing" }
  /** Somebody else resolved it first, or it was never consentable. */
  | { ok: false; reason: "status"; status: ClaimRecord["status"] }
  /** The value could not move, so NOTHING was written. `error` is the ledger's own. */
  | { ok: false; reason: "post"; error: string };

/**
 * Move value at the same instant the claim flips, or move nothing.
 *
 * Runs inside `consentOnce`'s transaction, on its connection, after the claim
 * row is locked and written and before the commit. Return the ledger's own
 * sentence to refuse, which rolls the flip back with it.
 */
export type ConsentPost = (
  conn: PoolConnection,
  claim: ClaimRecord,
) => Promise<{ ok: true } | { ok: false; error: string }>;

export interface ClaimsRepo {
  all(): Promise<ClaimRecord[]>;
  byId(id: string): Promise<ClaimRecord | null>;
  forUser(userId: string): Promise<ClaimRecord[]>;
  add(c: ClaimRecord): Promise<ClaimRecord>;
  /**
   * Take a quest, at most once per member, under the quest's own row lock.
   *
   * ONE CLAIM PER MEMBER PER QUEST IS A READ-THEN-WRITE WITH NOTHING BEHIND
   * IT, and there is no unique index to fall back on. There cannot be one:
   * a declined claim frees the quest deliberately (see `remove` below and the
   * claim route's `status !== "declined"` test), so a member who was declined
   * and picked the quest up again holds TWO rows for the same pair, and a
   * member declined twice holds three. The natural key is not
   * `(quest_id, user_id)` and it is not `(quest_id, user_id, status)` either:
   * it is "at most one row that is not declined per (quest_id, user_id)",
   * which MySQL has no partial index to express, and which a plain UNIQUE
   * index would refuse to apply to any populated database that already holds
   * a decline cycle. `drizzle/0196` writes that reasoning down beside the
   * index it does add.
   *
   * So the invariant is held where it can be held: the quest row is locked
   * FOR UPDATE, and the existence test and the insert happen underneath it.
   * This is the shape `writeGratitudeRowOnce` uses in `server/lib/economy.ts`
   * for the allowance, for the same reason.
   *
   * The quest row is the lock rather than the member's, because it is the one
   * the caller has already proved exists and because a quest deleted between
   * the route's read and this insert then answers "gone" instead of leaving a
   * claim behind pointing at nothing.
   */
  openClaim(c: ClaimRecord): Promise<OpenClaimOutcome>;
  /**
   * Consent, as ONE commit: check the status, flip the row, move the value.
   *
   * The three steps used to be three transactions with awaits between them,
   * and both halves of that were reachable. A steward whose credit was
   * refused got a 500 over a claim permanently marked `consented` and a
   * member paid nothing, with no way back in: re-consent answers 409 on a
   * claim that is no longer `submitted`, and `remove` only deletes a
   * `claimed` one. And two stewards consenting the same claim at the same
   * moment both read `submitted` through a plain SELECT, both passed, and
   * both wrote: the ledger answered the second one `duplicate: true` and
   * moved nothing, so `amount` and `consented_by` were left naming a figure
   * and a witness with no posting behind them.
   *
   * `from` is the compare-and-set. The status is re-read under the row lock
   * and must still be one of these, so the second consenter is refused with
   * the status it actually found instead of overwriting the first.
   *
   * WHAT THIS REPLACED, and why the whole account lives here rather than at the
   * route. Consent was THREE transactions with awaits between them: a plain
   * SELECT that checked the status, a separate write that flipped it, and a
   * separate post that moved the tokens. Both gaps were reachable. Two stewards
   * consenting at once both passed the SELECT, and the loser's write landed, so
   * `amount` and `consented_by` held a figure and a witness with no ledger
   * movement behind them; and a post that failed after the flip left the claim
   * permanently consented, the member credited nothing, and no in-product way
   * back, because re-consent refuses a claim that is no longer submitted.
   *
   * `give()` in server/lib/economy.ts carries the gratitude allowance the same
   * way, for the same reason.
   */
  consentOnce(
    id: string,
    from: ClaimRecord["status"][],
    mutate: (c: ClaimRecord) => void,
    post: ConsentPost | null,
  ): Promise<ConsentOutcome>;
  update(id: string, mutate: (c: ClaimRecord) => void): Promise<ClaimRecord | null>;
  /**
   * Put back a quest that was picked up and not yet worked on.
   *
   * Deliberately NOT the same as declining. A decline is a steward's judgement
   * and part of the record; this is a person changing their mind before any
   * value moved, which should leave no trace and free the quest for somebody
   * else. The caller enforces that only a `claimed` row reaches here, because
   * a submitted or consented claim has work or recognition attached to it.
   */
  remove(id: string): Promise<ClaimRecord | null>;
  /** Stage rules read this on hot paths â€” a COUNT, never a full scan. */
  consentedCount(userId: string): Promise<number>;
  /** One grouped query for listing N members (admin players view). */
  consentedCounts(): Promise<Map<string, number>>;
  /** Per-quest life signs, aggregated in SQL. Examples excluded, both kinds. */
  fieldCounts(): Promise<Map<string, { active: number; done: number }>>;
  /** The newest consented claims, capped. Examples excluded, both kinds. */
  recentConsented(limit: number): Promise<FieldCompletion[]>;
  /**
   * The holder's own confidence flag, on an OPEN claim of THEIRS (0055).
   *
   * The ownership test and the status test ride in the WHERE rather than in a
   * read before it, so a claim that was consented between the caller's check
   * and this write is not re-flagged, and a member cannot set the flag on
   * somebody else's work. `false` means nothing matched, which is the route's
   * 404: no open claim of yours with that id.
   *
   * `value` is the raw field from the request and the caller has already
   * decided it is one of the four legal words. An empty string CLEARS the
   * flag, which is why the timestamp column is written literally rather than
   * as a parameter: MySQL takes CURRENT_TIMESTAMP or NULL there, never a
   * placeholder, and the branch is chosen from the value and never from input.
   */
  setConfidence(id: string, userId: string, value: string, note: string | null): Promise<boolean>;
  /** Open claims whose holder has flagged trouble, worst first. */
  needingAttention(): Promise<AttentionClaim[]>;
}

/**
 * An open claim somebody has flagged, as the attention list reads it.
 *
 * `userName` is the STORED name, not a display name: `firstName()` lives at
 * the route, because who may see how much of a name is a surface's decision
 * and not a table's.
 */
export interface AttentionClaim {
  id: string;
  questTitle: string;
  userName: string;
  status: string;
  confidence: string;
  note: string | null;
  saidAt: string | null;
  claimedAt: string | null;
}

export interface FieldCompletion {
  questId: string;
  questTitle: string;
  userName: string;
  when: string | null;
}

/**
 * Life-signs queries exclude BOTH an example quest and an example member, the
 * same rule the board applies everywhere: a seeded demo must never render as
 * somebody's real work. LEFT JOIN plus COALESCE so a claim whose member row is
 * gone still counts rather than vanishing.
 */
const REAL_CLAIM_JOIN =
  "FROM quest_claims c " +
  "JOIN quests q ON q.id = c.quest_id " +
  "LEFT JOIN users u ON u.id = c.user_id " +
  "WHERE COALESCE(q.is_example, 0) = 0 AND COALESCE(u.is_example, 0) = 0";

const CLAIM_SELECT =
  // confidence (0055) rides along so every read carries it. It is written by
  // its own targeted UPDATE and is deliberately absent from the generic
  // `update()` SET list below, which means no other write path can clobber it.
  "SELECT id, quest_id, quest_title, user_id, user_name, status, artifact_url, note, amount, claimed_at, submitted_at, consented_at, consented_by, confidence, confidence_note, confidence_at FROM quest_claims";

function rowToClaim(r: RowDataPacket): ClaimRecord {
  return {
    id: String(r.id),
    questId: String(r.quest_id ?? ""),
    questTitle: String(r.quest_title ?? ""),
    userId: String(r.user_id ?? ""),
    userName: String(r.user_name ?? ""),
    status: (r.status ?? "claimed") as ClaimRecord["status"],
    artifactUrl: r.artifact_url ?? null,
    note: r.note ?? null,
    amount: r.amount == null ? null : Number(r.amount),
    claimedAt: toIso(r.claimed_at),
    submittedAt: toIso(r.submitted_at),
    resolvedAt: toIso(r.consented_at),
    consentedBy: r.consented_by ?? null,
    // NULL is the common case and means nobody has said, which is not the
    // same as saying it is fine.
    confidence: (r.confidence ?? null) as ClaimRecord["confidence"],
    confidenceNote: r.confidence_note ?? null,
    confidenceAt: toIso(r.confidence_at),
  };
}

/*
 * ONE INSERT AND ONE UPDATE, NAMED ONCE.
 *
 * `add` and `openClaim` write the same row, and `update` and `consentOnce`
 * write the same columns. Two copies of either would be two things to keep in
 * agreement, and the pair that matters here writes the amount and the witness
 * a member is paid on. Same reasoning as `questParams` above.
 */
const CLAIM_INSERT =
  "INSERT INTO quest_claims (id, quest_id, quest_title, user_id, user_name, status, artifact_url, note, amount, claimed_at, submitted_at, consented_at) " +
  "VALUES (?,?,?,?,?,?,?,?,?,COALESCE(?, CURRENT_TIMESTAMP),?,?)";

const claimParams = (c: ClaimRecord): any[] => [
  c.id,
  c.questId,
  c.questTitle ?? "",
  c.userId,
  c.userName ?? "",
  c.status ?? "claimed",
  c.artifactUrl ?? null,
  c.note ?? null,
  c.amount ?? null,
  toDb(c.claimedAt),
  toDb(c.submittedAt),
  toDb(c.resolvedAt),
];

const CLAIM_UPDATE =
  "UPDATE quest_claims SET status=?, artifact_url=?, note=?, amount=?, submitted_at=?, consented_at=?, consented_by=? WHERE id=?";

const claimUpdateParams = (c: ClaimRecord, id: string): any[] => [
  c.status,
  c.artifactUrl ?? null,
  c.note ?? null,
  c.amount ?? null,
  toDb(c.submittedAt),
  toDb(c.resolvedAt),
  c.consentedBy ?? null,
  id,
];

export function claimsRepo(pool: Pool): ClaimsRepo {
  return {
    async all() {
      const [rows] = await pool.query<RowDataPacket[]>(`${CLAIM_SELECT} ORDER BY claimed_at, id`);
      return rows.map(rowToClaim);
    },

    async byId(id) {
      const [rows] = await pool.query<RowDataPacket[]>(`${CLAIM_SELECT} WHERE id = ?`, [id]);
      return rows[0] ? rowToClaim(rows[0]) : null;
    },

    async forUser(userId) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `${CLAIM_SELECT} WHERE user_id = ? ORDER BY claimed_at, id`,
        [userId],
      );
      return rows.map(rowToClaim);
    },

    async add(c) {
      await pool.query(CLAIM_INSERT, claimParams(c));
      return c;
    },

    async openClaim(c) {
      return withDeadlockRetry(async () => {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          // The lock. Everything after this reads a world nobody else can move.
          const [quest] = await conn.query<RowDataPacket[]>(
            "SELECT id FROM quests WHERE id = ? FOR UPDATE",
            [c.questId],
          );
          if (!quest.length) {
            await conn.rollback();
            return { ok: false, reason: "gone" } as const;
          }
          // The claim route's own test, run here under the lock instead of
          // several awaits before the insert. A declined row is not a live
          // claim: it is the quest handed back, and it must not block the
          // member from picking the quest up again.
          const [held] = await conn.query<RowDataPacket[]>(
            `${CLAIM_SELECT} WHERE quest_id = ? AND user_id = ? AND status <> 'declined' ` +
              "ORDER BY claimed_at DESC, id DESC LIMIT 1",
            [c.questId, c.userId],
          );
          if (held[0]) {
            const existing = rowToClaim(held[0]);
            await conn.rollback();
            return { ok: false, reason: "already", existing } as const;
          }
          await conn.query(CLAIM_INSERT, claimParams(c));
          await conn.commit();
          return { ok: true, claim: c } as const;
        } catch (e) {
          await conn.rollback();
          throw e;
        } finally {
          conn.release();
        }
      });
    },

    async consentOnce(id, from, mutate, post) {
      return withDeadlockRetry(async () => {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const [rows] = await conn.query<RowDataPacket[]>(`${CLAIM_SELECT} WHERE id = ? FOR UPDATE`, [id]);
          if (!rows[0]) {
            await conn.rollback();
            return { ok: false, reason: "missing" } as const;
          }
          const claim = rowToClaim(rows[0]);
          // The compare-and-set, under the lock the row is already holding.
          if (!from.includes(claim.status)) {
            const status = claim.status;
            await conn.rollback();
            return { ok: false, reason: "status", status } as const;
          }
          mutate(claim);
          await conn.query(CLAIM_UPDATE, claimUpdateParams(claim, id));
          if (post) {
            const moved = await post(conn, claim);
            if (!moved.ok) {
              // Nothing is written. The claim is still whatever it was, the
              // member is still owed, and the steward can try again once the
              // ledger's own reason is dealt with.
              await conn.rollback();
              return { ok: false, reason: "post", error: moved.error } as const;
            }
          }
          await conn.commit();
          return { ok: true, claim } as const;
        } catch (e) {
          await conn.rollback();
          throw e;
        } finally {
          conn.release();
        }
      });
    },

    async update(id, mutate) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query<RowDataPacket[]>(`${CLAIM_SELECT} WHERE id = ? FOR UPDATE`, [id]);
        if (!rows[0]) {
          await conn.rollback();
          return null;
        }
        const claim = rowToClaim(rows[0]);
        mutate(claim);
        await conn.query(CLAIM_UPDATE, claimUpdateParams(claim, id));
        await conn.commit();
        return claim;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    /*
     * Guarded in SQL as well as by the caller. The status test rides in the
     * WHERE so a claim that reached `submitted` between the caller's read and
     * this delete survives: value in flight is never removed by a race.
     */
    async remove(id) {
      const existing = await this.byId(id);
      if (!existing || existing.status !== "claimed") return null;
      const [res] = await pool.query<any>(
        "DELETE FROM quest_claims WHERE id = ? AND status = 'claimed'",
        [id],
      );
      return Number(res?.affectedRows ?? 0) > 0 ? existing : null;
    },

    async consentedCount(userId) {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM quest_claims WHERE user_id = ? AND status = 'consented'",
        [userId],
      );
      return Number(rows[0]?.n ?? 0);
    },

    async consentedCounts() {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT user_id, COUNT(*) AS n FROM quest_claims WHERE status = 'consented' GROUP BY user_id",
      );
      return new Map(rows.map((r) => [String(r.user_id), Number(r.n)]));
    },

    async fieldCounts() {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.quest_id, c.status, COUNT(*) AS n ${REAL_CLAIM_JOIN} ` +
          "AND c.status IN ('claimed','submitted','consented') GROUP BY c.quest_id, c.status",
      );
      const out = new Map<string, { active: number; done: number }>();
      for (const r of rows) {
        const id = String(r.quest_id);
        const slot = out.get(id) ?? { active: 0, done: 0 };
        if (r.status === "consented") slot.done += Number(r.n ?? 0);
        else slot.active += Number(r.n ?? 0);
        out.set(id, slot);
      }
      return out;
    },

    async recentConsented(limit) {
      const capped = Math.max(1, Math.min(50, Math.floor(Number(limit) || 8)));
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.quest_id, c.quest_title, c.user_name, c.consented_at ${REAL_CLAIM_JOIN} ` +
          "AND c.status = 'consented' ORDER BY c.consented_at DESC, c.id DESC LIMIT ?",
        [capped],
      );
      return rows.map((r) => ({
        questId: String(r.quest_id ?? ""),
        questTitle: String(r.quest_title ?? ""),
        userName: String(r.user_name ?? ""),
        when: toIso(r.consented_at),
      }));
    },

    async setConfidence(id, userId, value, note) {
      const [r] = await pool.query<any>(
        `UPDATE quest_claims
            SET confidence = ?, confidence_note = ?, confidence_at = ${value ? "CURRENT_TIMESTAMP" : "NULL"}
          WHERE id = ? AND user_id = ? AND status IN ('claimed','submitted')`,
        [value || null, value ? note : null, id, userId],
      );
      return Number(r?.affectedRows ?? 0) > 0;
    },

    async needingAttention() {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, quest_title, user_name, status, confidence, confidence_note, confidence_at, claimed_at
           FROM quest_claims
          WHERE status IN ('claimed','submitted') AND confidence IN ('at_risk','stuck')
          ORDER BY FIELD(confidence, 'stuck', 'at_risk'), confidence_at`,
      );
      // Field for field what the route used to build inline, so the response
      // shape is decided in one place and the move changed nothing about it.
      // `toIso` is deliberately NOT used: it answers null on an unparseable
      // date and this column has always thrown on one, which is the difference
      // between a silent hole in a steward's queue and a reported fault.
      return (rows as any[]).map((c) => ({
        id: String(c.id),
        questTitle: c.quest_title ?? "",
        userName: String(c.user_name ?? "Member"),
        status: String(c.status),
        confidence: String(c.confidence),
        note: c.confidence_note ?? null,
        saidAt: c.confidence_at ? new Date(c.confidence_at).toISOString() : null,
        claimedAt: c.claimed_at ? new Date(c.claimed_at).toISOString() : null,
      }));
    },
  };
}

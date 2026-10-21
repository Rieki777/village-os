/**
 * HAS THIS VILLAGE'S GAME STARTED, and the one thing that answer gates.
 *
 * R67, in the founder's words: "A game needs 3 people minimum to play (to
 * actually issue tokens) so they can do everything else to set up the game on
 * their own, but once they press 'start the Game' this proposal to actually be
 * able to start minting tokens."
 *
 * So a village has a before and an after. Before, a founder builds the whole
 * Game alone: modules, dials, quests, seasons, every item on the launch
 * journey. Token issuance is the one power that waits, because a token issued
 * is a claim on everybody and everybody has not agreed yet. The launch ballot
 * carrying is the moment it turns on (`shared/ballotSubjects.ts`: 100 unity
 * and 100 quorum, with three people on the roll).
 *
 * ── WHERE THE GATE SITS, AND WHY THERE ──────────────────────────────────────
 *
 * In `postTransfer` and `postTransferPair`, on `ledger_accounts.faucet`.
 *
 * Issuance already has an exact definition in this codebase and it is a
 * column, not a convention: 0009 built the ledger double-entry so that
 * "designated FAUCET accounts may run negative, and their negative balance IS
 * the issuance-to-date figure". A posting out of a faucet creates tokens. A
 * posting between two ordinary accounts moves tokens that already exist.
 *
 * That distinction is what makes one gate enough. There are at least four
 * faucets and different systems read them: `sys:gratitude-pool`,
 * `sys:cycle-pool`, `sys:mint` and `sys:library-mint`. The admin mint cap sees
 * exactly one of those. A gate on the column sees all four, and it sees the
 * fifth on the day somebody adds it, with nobody having to remember. Spending,
 * swapping, refunding and every member-to-member send are untouched: a village
 * that has not started its Game has nothing to spend, so this takes nothing
 * away from anybody.
 *
 * ── WHY IT READS THE DATABASE INSTEAD OF A CACHED FLAG ──────────────────────
 *
 * The obvious build is `loadTokenRegistry`'s: read the answer at boot, hold it
 * in the module, check the variable. It is wrong here for two reasons, and the
 * second one is the serious one.
 *
 * A cached flag would be WRONG IN EVERY OTHER PROCESS the moment a launch vote
 * carries. The deployment can run more than one instance, and the one that
 * closed the ballot would start issuing while its sibling kept refusing, with
 * nothing to tell them apart from outside. The fix would be a cache-invalidation
 * channel between processes, for a value that changes once in a village's life.
 *
 * And an unloaded cache has to choose between refusing everything in any code
 * path that skipped boot, or issuing freely in one. Neither is a good answer to
 * a question the database can answer in a primary-key read.
 *
 * The read runs inside the posting's own transaction, after the accounts are
 * locked, so it sees committed truth and the decision cannot race the write it
 * guards. It costs one indexed lookup on a path that already runs several, and
 * only on postings that issue.
 */
import type { Pool, PoolConnection } from "mysql2/promise";

export interface GameStart {
  started: boolean;
  /** ISO instant the Game started, or null. */
  startedAt: string | null;
  /**
   * The ballot that carried. Null on a village recorded as started by
   * migration 0112, which found it already issuing before the vote existed.
   */
  ballotId: string | null;
  /** Who closed that ballot, when there was one. */
  startedBy: string | null;
  /** Why this row says what it says, in a sentence. Empty when not started. */
  note: string;
}

const NOT_STARTED: GameStart = {
  started: false,
  startedAt: null,
  ballotId: null,
  startedBy: null,
  note: "",
};

const CONFIG_KEY = "game-start";

/** Read the fact. One row, and the absence of it is a real answer. */
export async function readGameStart(pool: Pool | PoolConnection): Promise<GameStart> {
  const [rows] = await pool.query<any[]>(
    "SELECT value FROM app_config WHERE config_key = ?",
    [CONFIG_KEY],
  );
  const row = rows[0];
  if (!row) return { ...NOT_STARTED };
  const doc = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  const startedAt = doc?.startedAt ? String(doc.startedAt) : null;
  if (!startedAt) return { ...NOT_STARTED };
  return {
    started: true,
    startedAt,
    ballotId: doc?.ballotId ? String(doc.ballotId) : null,
    startedBy: doc?.startedBy ? String(doc.startedBy) : null,
    note: doc?.note ? String(doc.note) : "",
  };
}

export interface RecordGameStartInput {
  /** The ballot that carried. Nothing else may start a Game. */
  ballotId: string;
  /** Whoever closed it. */
  startedBy: string;
  /** The sentence the village keeps. */
  note: string;
  /** Testable clock. */
  at?: Date;
}

/**
 * Start the Game, once, ever.
 *
 * `INSERT IGNORE` on the primary key is the idempotency, so a second close
 * that somehow reached here leaves the first row exactly as it was, with its
 * original instant and its original ballot. It returns what stands afterwards,
 * which is the honest answer whether this call wrote that row or found it.
 *
 * There is deliberately no function that un-starts a Game. Members hold
 * balances the moment issuance runs once, and a switch that could turn that
 * off is a power over everybody's holdings that nobody voted to create.
 */
export async function recordGameStart(
  pool: Pool | PoolConnection,
  input: RecordGameStartInput,
): Promise<GameStart> {
  const doc = {
    startedAt: (input.at ?? new Date()).toISOString(),
    ballotId: input.ballotId,
    startedBy: input.startedBy,
    note: String(input.note ?? "").slice(0, 500),
  };
  await pool.query("INSERT IGNORE INTO app_config (config_key, value) VALUES (?, ?)", [
    CONFIG_KEY,
    JSON.stringify(doc),
  ]);
  return readGameStart(pool);
}

/**
 * Why a faucet posting is refused right now, or null when it may proceed.
 *
 * The sentence is written for whoever reads the refusal, which on the quest
 * path is a steward consenting somebody's work. It says what is true and where
 * the answer comes from, and it makes no argument about launching sooner.
 */
export async function issuanceRefusal(conn: Pool | PoolConnection): Promise<string | null> {
  const fact = await readGameStart(conn);
  if (fact.started) return null;
  return (
    "This village has not started its Game yet, so no token can be issued. " +
    "Issuance opens when the village's launch vote carries."
  );
}

/**
 * WHETHER THE FOUNDER ROLE STILL CARRIES A POWER OF ITS OWN (R90).
 *
 * R90, in the founder's words: "The founder role disappears once the game
 * starts and a minimum of 3 people vote the game to start. After that they can
 * optionally vote in a steward role and give various powers to this steward to
 * immediately act."
 *
 * So launch is two facts landing in one moment. It was already the moment
 * issuance turns on (R67, R74). It is now also the moment the founder stops
 * being a standing power.
 *
 * ── WHAT ENDS ───────────────────────────────────────────────────────────────
 *
 * Every power the `founder` account role carries BEYOND an administrator's.
 * After launch a founder is an administrator and nothing else: the mint back
 * door R85 asked for closes, the exclusive claim on who administers the
 * village ends, and the personal immunity that stopped an administrator
 * resetting a founder's password ends with it.
 *
 * ── WHAT DELIBERATELY DOES NOT END, AND THIS IS THE LOAD-BEARING HALF ───────
 *
 * The admin panel. R90 says a village may choose never to vote in a steward
 * and must still work completely, so the scaffolding cannot go away in the
 * same moment the founder does. Eighteen branches in `server/index.ts` read
 * `role === "admin" || role === "founder"` and mean one thing by it: is this
 * person an administrator. Ending those at launch would leave a village that
 * had just voted to start its Game unable to be administered at all, and with
 * no way back, because the route that appoints an administrator sits behind
 * the same admin check and the shared bootstrap password is spent. R89's end
 * state is a village with no admins, and it arrives by powers crossing to the
 * village one vote at a time.
 *
 * ── WHY IT READS THE SAME ROW AS EVERYTHING ELSE ────────────────────────────
 *
 * `readGameStart` is already the one answer to "has this village started", and
 * this file's header says at length why that answer is read from the database
 * rather than held in a module. A second copy of launch state, whether a
 * rewritten column on `users` or a flag set at close, is a second thing that
 * can disagree with the first, can half-apply across rows, and leaves no
 * record of which state was intended. So this is a read. There is nothing to
 * migrate and nothing that can drift.
 */
export async function founderPowerStands(conn: Pool | PoolConnection): Promise<boolean> {
  return !(await readGameStart(conn)).started;
}

/**
 * BEFORE OR AFTER LAUNCH, FOR THE SETUP GAME'S PLANTING RULE.
 *
 * Ruling of 2026-10-13: "any founder should have full ability to do a task
 * before they go live." A keystone seed (`shared/guilds.ts`, `keystoneRule`)
 * always asks for a read-pause, and asks for a second person's co-sign only
 * after launch. This is the one signal that decides which side of launch a
 * planting is on, and it is `founderPowerStands` on purpose: it is already the
 * rule for what one founder may do alone (R90), and it reads as started for a
 * village that was live before the launch ballot existed, where
 * `launch-state.launchedAt` would read as not launched. `shared/guilds.ts`
 * says the same beside `PlantingPhase`.
 */
export async function plantingPhase(conn: Pool | PoolConnection): Promise<"before-launch" | "after-launch"> {
  return (await founderPowerStands(conn)) ? "before-launch" : "after-launch";
}

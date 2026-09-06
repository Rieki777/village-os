/**
 * The gratitude service (S8): budget math and the send path, extracted from
 * the route so future modules can acknowledge people without re-implementing
 * the rules. D5's forum hearts call sendGratitude() with kind:'heart' and a
 * context; the /api/game/gratitude/send route calls it with the defaults.
 * One set of guards, whoever the caller is.
 *
 * The host injects its dependencies (pool, repos, the variables file, the
 * stage multiplier) rather than this module importing server/index.ts —
 * the service must never need the whole server to exist before it can move
 * one token.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { boolVar, numberVar } from "./variables";
import { parseCycleId } from "./gratitude-cycles";
import { isExampleUser } from "./examples";
import { issuanceRefusal } from "./gameStart";
import { memberAccount, postTransferOn, RECOGNITION_FAUCET } from "./ledger";
import { allowanceFor, writeGratitudeRow, shareCapFor, recognitionName, type Allowance } from "./economy";
import { userIdForHandle } from "./profile";
import type { GratitudeLogRepo, GratitudeEntry } from "../repos/gratitude";
import type { UsersRepo } from "../repos/users";

// Re-exported so nothing importing `shareCapFor` from this module (it used to
// be DEFINED here) had to change when the concurrency fix below moved its
// definition to server/lib/economy.ts, the module that now owns every
// gratitude write's lock. server/lib/dryRun.ts is the other reader.
export { shareCapFor };

export interface GratitudeDeps {
  pool: Pool;
  log: GratitudeLogRepo;
  members: UsersRepo;
  /** stage.gratitudeMultiplier for this member — stage rules stay in the host.
   *  Async since S10: the stage's quest rule reads a MySQL count. */
  stageMultiplierFor(user: any): Promise<number>;
}

export interface GratitudeBudget {
  total: number;
  spent: number;
  remaining: number;
  cycleId: string;
}

/**
 * The one allowance, wearing the field name this module's callers already read.
 *
 * `Allowance.cycleKey` and `GratitudeBudget.cycleId` are the SAME string:
 * `cycleWindow().key` is `cycleIdFor()` and `server/cycleId.test.ts` fails the
 * moment they stop being. Only the key's name differs, so this maps and
 * computes nothing.
 */
export function asBudget(a: Allowance): GratitudeBudget {
  return { total: a.total, spent: a.spent, remaining: a.remaining, cycleId: a.cycleKey };
}

/**
 * What this member may still send this cycle.
 *
 * ONE ALLOWANCE (R73), AND THIS IS NO LONGER WHERE IT IS WORKED OUT. This
 * function computed `total - spentInCycle` and had no reversal term, while
 * `allowanceFor` in server/lib/economy.ts computed
 * `total - max(0, given - reversals)`. Both totals were the same
 * `gratitude.base_budget` times the same stage multiplier, and both summed the
 * same `gratitude_log` rows, so the two agreed right up until a gift in the
 * cycle was reversed. After that the profile rendered both of them at once,
 * "Sending budget: N of 100 left this cycle" from this one and "You can still
 * give N Gratitude this moon" from the other, with two different N.
 *
 * The comment at `allowanceFor` records the previous instance of this exact
 * shape, when the engine read a flat `economy.giving_allowance_per_moon` and
 * the acknowledgement flow read the stage-multiplied budget. It was resolved
 * by keeping ONE computation, in the guarded engine that already holds the
 * lock every gratitude write goes through, and that is the resolution here
 * too. `shareCapFor` moved the same way and for the same reason, and this
 * module still re-exports it.
 *
 * So this stays, as a shim over the one computation, and it maps one field
 * name. Be clear about who reaches it: NOTHING IN THE HOST DOES any more,
 * because `gratitudeBudget` in server/index.ts maps `allowanceFor` through
 * `asBudget` itself. Three suites do (`cycleId`, `gratitude.concurrency`,
 * `gratitude.gameStart`), and one of them asserts that the numbers out of
 * here and the numbers out of `allowanceFor` are the same numbers after a
 * reversal. That assertion is what this shim is for now. The number is not
 * computed here.
 */
export async function budgetFor(deps: GratitudeDeps, user: any): Promise<GratitudeBudget> {
  const multiplier = await deps.stageMultiplierFor(user);
  return asBudget(await allowanceFor(deps.pool, user.id, multiplier));
}

export interface SendInput {
  fromUser: any;
  /**
   * WHAT A MEMBER TYPED into the wall's one recipient field: an `@handle`, or
   * an address for anybody who still knows one. `toEmail` and `toId` below are
   * the RESOLVED forms, which is what every other caller passes; this is the
   * unresolved one, and `resolveTyped` turns it into one of them.
   */
  to?: string;
  toEmail?: string;
  toId?: string;
  amount: number;
  message?: string;
  /** 'gratitude' (default) = budgeted send. 'heart' (D5) = content acknowledgment. */
  kind?: string;
  contextType?: string;
  contextRef?: string;
}

export type SendOutcome =
  | { ok: true; entry: GratitudeEntry; recipient: any; budget: GratitudeBudget }
  | { ok: false; status: number; error: string };

/**
 * WHO IT IS FOR, out of the one field a member types on the wall.
 *
 * That field asked for an EMAIL, and it asked with `type="email" required`, so
 * the browser refused anything else. Nothing in this build ever shows a
 * member's address: `publicView` (server/lib/profile.ts) serves a profile as
 * handle, name, title, joined date and moons, the forum renders handles, and
 * the wall itself renders first names. The form demanded a fact the person
 * filling it in had no way to obtain.
 *
 * A picker would need a member DIRECTORY, and a list of everyone's names and
 * ids readable by anyone signed in is a privacy surface with its own question
 * to answer (that reasoning is written out at `/api/wallet/send` and it still
 * stands). This needs neither. Handles are ALREADY public: `ProfileHero`
 * prints `@handle` under a member's name and `/profile/:handle` is how a
 * stranger reaches them. Somebody who can see the profile can read the handle
 * off it, and a member who tells you their handle has published one fact about
 * themselves on purpose. Nothing here can be asked for a LIST.
 *
 * Both spellings resolve, so nobody mid-flow is broken and every e2e suite and
 * script that posts `toEmail` is untouched:
 *   - an @ at the FRONT, or no @ at all, is a handle;
 *   - an @ in the MIDDLE is an address, read the way it always was.
 *
 * EXAMPLES STAY UNREACHABLE THROUGH BOTH. `userIdForHandle` matches only
 * `is_example = 0`, so a standing example's handle never resolves, and the
 * `isExampleUser` guard below still runs on whatever row does come back.
 */
async function resolveTyped(
  deps: GratitudeDeps,
  typed: string,
): Promise<{ ok: true; toId?: string; toEmail?: string } | { ok: false; status: number; error: string }> {
  if (typed.includes("@") && !typed.startsWith("@")) return { ok: true, toEmail: typed };
  // Handles are lowercase by construction (`slugifyHandle` lowercases and the
  // handle pattern admits nothing else), so lowering what was typed costs
  // nothing and saves a fork whose collation is case sensitive.
  const handle = typed.replace(/^@+/, "").toLowerCase();
  const toId = handle ? await userIdForHandle(deps.pool, handle) : null;
  if (!toId) {
    return {
      ok: false,
      status: 404,
      error: "No villager with that handle. A member's handle sits under their name on their profile page.",
    };
  }
  return { ok: true, toId };
}

/**
 * The one send path. Order of refusals is part of the contract (the loop test
 * asserts the guard messages): bad input → unknown recipient → self-send →
 * no budget → over budget → heart tap count → per-recipient share → whether
 * this village may issue at all (R67, and see the block above that check for
 * why it is last of the reads and first of everything else). Then, in ONE
 * transaction: the log row (the heart index may refuse a duplicate) and the
 * ledger post (recognition issues from the faucet — the sender spends BUDGET,
 * not balance). The recipient's cached balance is written after that commits.
 */
export async function sendGratitude(deps: GratitudeDeps, input: SendInput): Promise<SendOutcome> {
  const user = input.fromUser;
  const kind = input.kind ?? "gratitude";
  const amt = Math.floor(Number(input.amount) || 0);
  const typed = String(input.to ?? "").trim();
  if ((!typed && !input.toEmail && !input.toId) || amt <= 0) {
    return { ok: false, status: 400, error: "Recipient and a positive amount are required" };
  }
  if (kind === "gratitude" && boolVar("gratitude.require_message") && !String(input.message ?? "").trim()) {
    return { ok: false, status: 400, error: "A few words of appreciation are required" };
  }

  const who = typed ? await resolveTyped(deps, typed) : { ok: true as const, ...input };
  if (!who.ok) return who;

  const recipient = who.toId
    ? await deps.members.byId(who.toId)
    : await deps.members.byEmail(String(who.toEmail));
  // Named for the door the caller actually came through. A typed @handle is an
  // id by the time it reaches here, so a member who typed a handle and whose
  // recipient left the village between the two reads used to be told their
  // email was wrong, about an email they never typed.
  if (!recipient) {
    return {
      ok: false,
      status: 404,
      error: who.toId ? "No member here with that id" : "No member found with that email",
    };
  }
  if (recipient.id === user.id) return { ok: false, status: 400, error: `Send ${recognitionName()} to others` };
  // The example identities have fixed, public @examples.invalid addresses, so
  // without this any member can send to one: the sender's real budget is spent
  // and recognition is issued from the faucet into an account belonging to
  // nobody, which the cycle close would then pay a real pool share to. One
  // check here covers hearts too, since both channels come through this door.
  if (isExampleUser(recipient)) {
    return { ok: false, status: 409, error: "That is a standing example, not a member. Appreciation flows to real people." };
  }

  // `total` is a stage fact (base variable times the giver's stage
  // multiplier): nothing but a stage change moves it, and nothing here races
  // that, so it is safe to read before any lock. What it is NOT safe to read
  // unlocked is REMAINING, because that depends on what this cycle has
  // already spent, and that is exactly what concurrent sends race over. See
  // `writeGratitudeRow` in server/lib/economy.ts for the rest of this story.
  const multiplier = await deps.stageMultiplierFor(user);
  const total = Math.round(numberVar("gratitude.base_budget") * multiplier);
  if (total <= 0) {
    return { ok: false, status: 403, error: "Your sending budget unlocks as you progress on the path" };
  }

  /*
   * THE LOCK. Everything that used to be three unlocked statements here (the
   * remaining-budget read, the per-recipient running total, and the
   * `gratitude_log` write) is now one call into the SAME SERIALIZABLE
   * transaction, `FOR UPDATE` on the giver's row, that `server/lib/economy.ts`
   * `give()` has always used. Before this, five acknowledgments (or five
   * hearts, or five of each) arriving together could each read the same
   * "nothing spent yet" snapshot from `budgetFor`/`sumPair`/`countPair` and
   * each commit, moving more Gratitude than the cycle's allowance ever
   * promised and letting one recipient take more than the concentration cap
   * allows. The guard below runs INSIDE that lock, so what it reads cannot
   * move between the read and the write that follows it.
   *
   * The guard also reproduces the documented order of refusals exactly: over
   * budget, then heart tap count (kind 'heart' only), then per-recipient
   * share, then whether this village may issue at all (R67), LAST, so a
   * member who is over budget or over the share hears about THAT and not the
   * launch gate. `issuanceRefusal` now reads the SAME transaction connection
   * rather than the bare pool, which costs nothing and cannot see a stale
   * answer the write does not.
   */
  const result = await writeGratitudeRow(
    deps.pool,
    {
      fromUserId: user.id,
      toUserId: recipient.id,
      amount: amt,
      kind,
      message: String(input.message ?? "").trim(),
      fromName: user.name ?? null,
      toName: recipient.name ?? null,
      contextType: input.contextType ?? null,
      contextRef: input.contextRef ?? null,
    },
    multiplier,
    async (conn, allowance, alreadyGiven) => {
      if (amt > allowance.remaining) {
        return { ok: false, error: `Only ${allowance.remaining} left in your budget this cycle`, status: 400 };
      }

      // One count cap, then one share (R73). The refusal NAMES which one
      // fired, because a silent 409 teaches nothing.
      //
      // The heart cap counts TAPS and is the last count cap in the village: a
      // heart is a gesture whose size is already fixed by `feed.heart_amount`,
      // so how many of them is the meaningful question. Read under this same
      // lock, on the same connection, so it cannot race the write below it
      // any more than the allowance can.
      if (kind === "heart") {
        const heartCap = numberVar("feed.max_hearts_per_recipient_per_cycle");
        const [rows] = await conn.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM `gratitude_log` WHERE `from_id` = ? AND `to_id` = ? AND `cycle_id` = ? AND `kind` = ?",
          [user.id, recipient.id, allowance.cycleKey, kind],
        );
        const taps = Number(rows[0]?.n ?? 0);
        if (taps >= heartCap) {
          return {
            ok: false,
            status: 409,
            error: `Hearts to one person are capped at ${heartCap} per cycle (feed.max_hearts_per_recipient_per_cycle)`,
          };
        }
      }

      // The share, and it counts GRATITUDE across BOTH channels. The cap it
      // replaced counted SENDS and defaulted to 1, which bounded how OFTEN
      // one member could acknowledge another and never how MUCH: a member at
      // the top of the ladder could hand one person 500 in a single send and
      // break no rule. Gratitude is the voting-weight token by default, so
      // that was a limit on concentrated voice that did not exist.
      const cap = shareCapFor(allowance.total);
      if (alreadyGiven + amt > cap) {
        const left = Math.max(0, cap - alreadyGiven);
        return {
          ok: false,
          status: 409,
          error:
            `${cap} is the most you can give one person this cycle, and you have given them ${alreadyGiven}. ` +
            `That leaves ${left} for them (gratitude.max_share_per_recipient)`,
        };
      }

      /*
       * ── CAN THIS VILLAGE ISSUE AT ALL? ASKED BEFORE THE NOTE IS TAKEN (R67) ─
       *
       * This row IS the spend: the allowance above is computed by summing
       * `gratitude_log`, so writing it charges the cycle. The ledger post
       * that follows (on this same connection, before this transaction
       * commits) is what puts anything in the recipient's hands, and the
       * poster refuses every faucet posting until the launch vote carries.
       *
       * Asked in that order, the refusal used to arrive too late to matter:
       * the note committed, the allowance was spent, and the recipient
       * received nothing. A retry does not heal it either, because a retry
       * mints a new entry id and is a second charge. For a village setting
       * itself up, which under R67 is every village until its launch ballot
       * carries, that fired on every heart and every acknowledgement anybody
       * sent. Found by Lane TESTRUN, fixed on the economy engine's `give`
       * path by Lane RULES, and this is the same shape on both doors.
       *
       * The post below now shares this transaction, so even a refusal nobody
       * could ask about in advance takes the note back with it. Asking early
       * is still worth doing, because a member hears the gate's own sentence
       * rather than watching their words vanish into a rollback.
       *
       * It runs last so the documented order of refusals still holds: a
       * member who is over budget or over the share hears about THAT.
       * Nothing above this line writes anything, and the answer only ever
       * moves one way, from closed to open, so a village that launches
       * between this check and the write below costs somebody one refused
       * send and never a lost note.
       */
      const closed = await issuanceRefusal(conn);
      if (closed) return { ok: false, status: 409, error: closed };

      return { ok: true };
    },
    /*
     * ── THE CREDIT, INSIDE THE NOTE'S OWN TRANSACTION ────────────────────
     *
     * Recognition ISSUES at send, and it now issues on the connection the note
     * is written on, before that note commits.
     *
     * It used to be a `postTransfer` call AFTER this whole call returned, with
     * nothing around it. `postTransfer` rolls back and RETHROWS on any
     * database error — a lock wait, a dropped connection — so a throw there
     * left the note committed, the cycle's allowance spent, and nothing in the
     * recipient's hands: a record saying gratitude was given, and no
     * gratitude. A retry does not heal it either, because a retry writes a NEW
     * note id and is therefore a second charge.
     *
     * `give()` in server/lib/economy.ts had the identical shape and was fixed
     * first. This is the same fix on the other door, through the same hook,
     * rather than a second implementation of it.
     *
     * Now a refusal rolls the note back and a throw rolls the note back, which
     * is the same answer arrived at two ways: the member keeps their allowance
     * and their words, and hears that it did not go through.
     *
     * Keyed on the note id, so nothing can double-credit.
     */
    async (conn, noteId) => {
      const res = await postTransferOn(conn, {
        from: RECOGNITION_FAUCET,
        to: memberAccount(recipient.id),
        amount: amt,
        source: kind === "heart" ? "heart_received" : "gratitude_received",
        sourceRef: noteId,
        description: `${recognitionName()} from ${String(user.name ?? "").split(" ")[0]}`,
        idempotencyKey: `gratitude_received:${noteId}`,
      });
      if (!res.ok) return { ok: false, error: res.error ?? "ledger refused the credit", status: 500 };
      return { ok: true, duplicate: res.duplicate, balance: res.toBalance };
    },
  );

  if (!result.ok) {
    if (result.duplicate) {
      // The unique heart index spoke: this sender already acknowledged this
      // content. One heart per person per thing is the rule, not an error
      // state. (Plain 'gratitude' sends carry no client-side dedupe key and
      // cannot land here; the nonce index that give()'s door uses is never
      // written by this one.)
      return { ok: false, status: 409, error: "You have already acknowledged this" };
    }
    if (result.error === "no such member") {
      return { ok: false, status: 404, error: "No such member" };
    }
    return { ok: false, status: result.status ?? 400, error: result.error };
  }

  const cycleId = result.allowance.cycleKey;
  const entry: GratitudeEntry = {
    id: result.noteId,
    kind,
    fromId: user.id,
    fromName: user.name,
    toId: recipient.id,
    toName: recipient.name,
    amount: amt,
    message: String(input.message ?? "").trim(),
    contextType: input.contextType ?? null,
    contextRef: input.contextRef ?? null,
    cycleId,
    cycleNumber: parseCycleId(cycleId),
    at: new Date().toISOString(),
  };

  // The balance column is a recomputed cache of the ledger, and the credit
  // that produced it committed with the note above.
  const balance = result.posted?.balance;
  if (balance !== undefined) {
    await deps.members.update(recipient.id, (u: any) => {
      u.recognitionBalance = balance;
    });
  }

  // The same allowance the guard above decided against, re-read now that the
  // row is written, and re-read with the multiplier THIS send already
  // resolved: asking `budgetFor` would recompute the giver's stage (a MySQL
  // quest count) to arrive at a number it already holds.
  return {
    ok: true,
    entry,
    recipient,
    budget: asBudget(await allowanceFor(deps.pool, user.id, multiplier)),
  };
}

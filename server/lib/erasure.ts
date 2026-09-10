/**
 * Leaving well, as one function instead of a hundred and fifty lines inside
 * `server/index.ts`.
 *
 * WHY IT MOVED. It did not move for tidiness. `server/index.ts` sits at a
 * downward-only size ratchet with no headroom, so the sweep could not gain a
 * single line, and the line it needed was the one that reaches a module's
 * records about a member. A promise that cannot be extended is a promise that
 * quietly stops being true as the system grows around it.
 *
 * WHAT IT PROMISES, and all three are published rather than internal:
 * `GET /api/profile/export` says "everything the village holds about me",
 * `shared/constitution.ts` publishes "Leaving well is guaranteed" on a page
 * anybody can read, and the module library contract sells a deletion driver as
 * not optional. This function is where all three are either kept or broken.
 *
 * THE SHAPE THAT MATTERS. De-attribution is not erasure. Nulling an id leaves
 * the sentence that names the person, so anywhere the TEXT restates them the
 * text goes too. That rule is applied to the notification body, the concierge
 * query, the contact request, a member's intents, and now to a vendor's quote.
 *
 * A PORTRAIT IS NEITHER, and it is the reason this file grew a volume
 * dependency. `character_portraits` holds filenames, `/api/uploads/:filename`
 * has no sign-in in front of it, and a published portrait's address is
 * therefore a capability anybody who ever saw the page still holds. Neither
 * nulling an id nor rewriting a sentence takes a picture off the internet. The
 * bytes have to be unlinked, so they are, and the rows and the forge budget go
 * with them. The character sheet goes too: `presentation` and `tone` are a
 * description of a person's chosen body, and two live readers JOIN it back to
 * the user row, so a tombstone with a character attached keeps republishing a
 * departed member's face under the name "A departed member".
 *
 * WHAT IT DELIBERATELY KEEPS. Value rows stay: the ledger, gratitude, claims,
 * loans, orders and badge awards are the village's record of what happened and
 * what is owed, and deleting them would break the conservation proof.
 *
 * ORDER IS LOAD-BEARING. The local sweep runs to completion FIRST, then the
 * outside stores are asked, so a slow or refusing vendor never delays the one
 * deletion this deployment fully controls.
 *
 * The injected dependencies are repositories, locks and a directory that live
 * in `server/index.ts` as module-local singletons. They are passed rather than
 * imported because constructing a second `dbCollection` over the same table
 * would give this function its own cache, and two caches over one table is the
 * defect `check-repo-payloads` and the store's own header both exist to
 * prevent.
 *
 * ══ WHY THIS IS A RESUMABLE SEQUENCE AND NOT ONE TRANSACTION ═══════════════
 *
 * Read this before reaching for `beginTransaction`. The choice was made
 * deliberately and the obvious answer is the wrong one.
 *
 * THE DEFECT BEING FIXED. This was a bare sequence of about twenty writes with
 * no transaction, no error handling and no record of itself. A failure part
 * way through (a dropped connection, a lock timeout, a deploy restarting the
 * process) left a member half-erased with NOTHING anywhere saying an erasure
 * had begun and not finished. Nobody could see it and nothing would retry it,
 * while the member had been told "deleted".
 *
 * WHY ONE TRANSACTION CANNOT BE THE ANSWER HERE. A MySQL transaction lives on
 * ONE connection. Four of this sweep's participants cannot be on it:
 *
 *   1. `deps.members`, `deps.submissionsRepo` and `deps.roleHoldersRepo` are
 *      repositories that take their own connections and keep their own
 *      in-memory caches. `members.update` opens its own transaction and locks
 *      the row itself.
 *   2. `forgetMemberEverywhere` makes NETWORK CALLS to outside vendors. No
 *      database transaction can contain those, and holding one open across
 *      them would pin a connection and a pile of row locks for the length of a
 *      third party's timeout.
 *   3. `forgetStewardActs`, `releaseSeatingsForUser`, `eraseIntentsForMember`
 *      and `forgetMemberInProposals` take a `Pool` and would each need their
 *      signature changed to accept a connection, across four modules this
 *      change does not own.
 *   4. Unlinking a file is not transactional in any database. A rollback
 *      cannot put a portrait back on the volume.
 *
 * So a transaction around the statements that COULD join one would leave the
 * rest outside it, still able to fail half way, while LOOKING closed. That is
 * worse than what was here before: a reviewer reads `beginTransaction` and
 * stops asking.
 *
 * WHAT IS HERE INSTEAD. Every step is idempotent by construction, and the fact
 * is checked rather than assumed: each one is either a DELETE keyed on the
 * member, or an UPDATE writing a CONSTANT keyed on the member, so a second run
 * either matches nothing or writes the same value twice. `member_erasures`
 * records that a sweep began, which steps landed, and where it stopped, and
 * the steward's erasure queue resumes it.
 *
 * THE LEDGER IS NOT THE CORRECTNESS ARGUMENT, IDEMPOTENCY IS. A step is noted
 * AFTER its writes land, so a death in between leaves a finished step
 * unrecorded and a resume re-runs it, which costs one UPDATE that matches
 * nothing. Noting first would let a resume skip work that never happened,
 * which is the one direction this may not fail in.
 *
 * WHAT IS STILL TRUE AFTER A FAILURE, and it is worth knowing which half you
 * get: the steps run local-first and the tombstone is late, so a sweep that
 * dies early leaves an account that still works, and one that dies late leaves
 * an account that does not exist with some traces outstanding. Neither is
 * silent any more.
 */
import type { Pool } from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { forgetStewardActs } from "./stewardship";
import { eraseIntentsForMember } from "./intents";
import { isExampleUser } from "./examples";
import { forgetMemberInProposals } from "./externalProposals";
import { forgetMemberEverywhere, type ErasureOutcome } from "./memberDrivers";
import { recordEvent } from "./events";
import { releaseSeatingsForUser } from "./orgChart";
import { forgetPortraitsForMember } from "../repos/characterPortraits";
import { forgetCharactersForMember } from "../repos/playerCharacters";
import { forgetAgentForMember } from "../repos/memberAgent";
import {
  beginErasure,
  erasureRecord,
  noteErasureFailed,
  noteErasureFinished,
  noteResumeAttempt,
  noteStepDone,
} from "../repos/memberErasure";

export type ErasureDeps = {
  /** The users repository. Its `update` writes the tombstone. */
  members: {
    byId(id: string): Promise<any>;
    update(id: string, fn: (u: any) => void): Promise<unknown>;
  };
  /** Submissions, scrubbed of PII keys while the proposal content stays. */
  submissionsRepo: { all(): unknown[]; replaceAll(rows: unknown[]): Promise<unknown> };
  /** Permission holdings, which end here. The org chart is a different plane. */
  roleHoldersRepo: { replaceAll(rows: unknown[]): Promise<unknown> };
  withRoleHolderLock: <T>(fn: () => Promise<T>) => Promise<T>;
  loadRoleHolders: () => Array<{ userId: string }>;
  /**
   * The uploads volume. A portrait's bytes outlive its row, and its address
   * needs no sign-in, so revoking a face means unlinking a file.
   */
  uploadsDir: string;
};

/** What one attempt at the sweep did. */
export interface SweepResult {
  /** Step names this attempt actually ran. Empty on a resume with nothing left. */
  ran: string[];
  /** The local sweep is complete and the outside stores have been asked. */
  finished: boolean;
  /**
   * What the outside stores answered, or null when this attempt did not need
   * to ask because an earlier one already had.
   */
  external: ErasureOutcome | null;
}

const ANON = "A departed member";

/** Nothing outside holds anything, and nothing was asked. */
const ASKED_NOBODY: ErasureOutcome = { asked: [], confirmed: [], unconfirmed: [] };

/**
 * Unlink a file the database no longer names.
 *
 * Never throws, and the same shape `server/routes/characterPortraits.ts` uses
 * for the same reason: bytes lingering after their row is gone are a wasted few
 * hundred kilobytes, while a throw here would abort an erasure whose database
 * work had already landed. A failure to unlink is REPORTED, because a portrait
 * that is still fetchable after a deletion is exactly the thing this step
 * exists to prevent and it must not go by in silence.
 */
function unlink(uploadsDir: string, fileName: string): void {
  const name = String(fileName ?? "").trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return;
  try {
    fs.unlinkSync(path.join(uploadsDir, name));
  } catch (err: any) {
    // ENOENT is the ordinary case: the row named a file the volume no longer
    // has. Anything else is a picture this village failed to take down.
    if (err?.code !== "ENOENT") {
      console.error(`[erasure] could not unlink "${name}": ${err?.message ?? err}`);
    }
  }
}

/** One named, idempotent piece of the sweep. */
interface Step {
  name: string;
  run: () => Promise<void>;
}

/**
 * THE SWEEP, IN ORDER.
 *
 * Every entry is keyed on this one member and writes either a deletion or a
 * constant, which is what makes a resume safe. A step that ever stops being
 * idempotent breaks the resume guarantee, so anything added here has to be
 * checked against that first.
 *
 * The NAMES are stored in `member_erasures.steps_done` and matched back by
 * string. Renaming one makes a resume re-run it, which is the safe direction;
 * reusing a name for different work is the unsafe one.
 */
function sweepSteps(pool: Pool, target: any, actorId: string | null, deps: ErasureDeps): Step[] {
  const { members, submissionsRepo, roleHoldersRepo, withRoleHolderLock, loadRoleHolders } = deps;
  return [
    {
      // Ledger descriptions first, while gratitude_log still links names to refs.
      name: "ledger-descriptions",
      run: async () => {
        await pool.query( // module-review-ok: the ledger DESCRIPTION only, never an amount; value rows are deliberately kept and this rewrites the sentence that names a departed member
          "UPDATE token_ledger SET description = 'Gratitude from a departed member' " + // module-review-ok: same statement as the line above, a description rewrite rather than a write to the ledger's value columns
            "WHERE source IN ('gratitude_received','heart_received') " +
            "AND source_ref IN (SELECT id FROM gratitude_log WHERE from_id = ?)",
          [target.id],
        );
      },
    },
    {
      name: "gratitude-names",
      run: async () => {
        await pool.query("UPDATE gratitude_log SET from_name = ? WHERE from_id = ?", [ANON, target.id]); // module-review-ok: gratitude_log stores from_name as text beside the id, so de-attribution alone would leave the name; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
        await pool.query("UPDATE gratitude_log SET to_name = ? WHERE to_id = ?", [ANON, target.id]); // module-review-ok: gratitude_log stores to_name the same way; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
      },
    },
    {
      name: "quest-claim-names",
      run: async () => {
        await pool.query("UPDATE quest_claims SET user_name = ? WHERE user_id = ?", [ANON, target.id]); // module-review-ok: quest_claims stores user_name as text; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
      },
    },
    {
      // De-attribution is not enough: the TEXT restates the person. A
      // restorative intake notification carries "A private intake from <their
      // full name>" in the title and up to 2000 characters of their message in
      // the body, and nulling the actor id leaves every word of that in the
      // steward's inbox.
      name: "notifications",
      run: async () => {
        await pool.query("DELETE FROM notifications WHERE user_id = ?", [target.id]); // module-review-ok: notifications for a departed member are deleted outright; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
        await pool.query( // module-review-ok: the notification TITLE and BODY restate the person in their own words, so nulling the actor id is not enough; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
          "UPDATE notifications SET actor_user_id = NULL, title = 'A message from a departed member', body = NULL WHERE actor_user_id = ?",
          [target.id],
        );
      },
    },
    {
      name: "tool-clicks",
      run: async () => {
        await pool.query("UPDATE tool_clicks SET user_id = NULL WHERE user_id = ?", [target.id]); // module-review-ok: tool_clicks is de-attributed rather than deleted, because the count is a real metric; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
      },
    },
    {
      name: "public-health-events",
      run: async () => {
        await pool.query("DELETE FROM health_events WHERE audience = 'public' AND actor_user_id = ?", [target.id]); // module-review-ok: a public health event naming a departed member is removed; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
      },
    },
    {
      // Governance free text: the acts a departing member WROTE keep their
      // shape and lose their words, because what the village stopped is the
      // village's record and the sentence about a neighbour is the member's.
      //
      // PORTED ON MERGE. This call was added to the copy of anonymizeMember
      // that lived in server/index.ts while main was extracting that function
      // to this file. Taking main's deletion of the inline copy without moving
      // this line across would have dropped a member's erasure right silently,
      // which is the one class of merge loss nobody would have noticed from a
      // green suite.
      name: "steward-acts",
      run: async () => {
        await forgetStewardActs(pool, target.id);
      },
    },
    {
      // Scrub PII keys inside submissions they authored; the proposal content
      // itself stays part of the village record.
      name: "submissions",
      run: async () => {
        const submissions = submissionsRepo.all();
        let scrubbed = false;
        for (const s of submissions as any[]) {
          if (s.userId !== target.id) continue;
          s.userName = ANON;
          if (s.data && typeof s.data === "object") {
            for (const k of ["name", "firstName", "lastName", "email", "phone", "whatsapp", "telegram"]) {
              if (k in s.data) s.data[k] = "[removed at member's request]";
            }
          }
          scrubbed = true;
        }
        if (scrubbed) await submissionsRepo.replaceAll(submissions);
      },
    },
    {
      name: "role-holdings",
      run: async () => {
        await withRoleHolderLock(async () => {
          const holders = loadRoleHolders().filter((h) => h.userId !== target.id);
          await roleHoldersRepo.replaceAll(holders);
        });
      },
    },
    {
      // The step above ends PERMISSION holdings. The org chart is the other
      // plane called "role" (ARCHITECTURE 3.15) and shares nothing with it, so
      // it went on holding a departed member's seat under their real user id
      // while /api/org republished it to everyone with map.viewPeople.
      name: "org-seatings",
      run: async () => {
        await releaseSeatingsForUser(pool, target.id, "member left the village");
      },
    },
    /*
     * THE TRACES A TOMBSTONE DOES NOT COVER.
     *
     * Most identity here is a join: forum posts and quest claims carry only an
     * `author_id`, so once the user row becomes a tombstone they read as "a
     * departed member" for free. The steps below are the ones that do NOT work
     * that way. They either restate the person independently of the users
     * table, or they keep a live channel open to them after they have gone.
     *
     * Value rows stay, as always: the ledger, gratitude, claims, loans, orders
     * and badge awards are the village's record of what happened and what is
     * owed, and deleting those would break the conservation proof.
     */
    {
      // Claims a person made ABOUT THEMSELVES, published in a searchable
      // directory that joins straight back to users. Nothing else republishes
      // them, so nothing else would ever remove them.
      name: "skill-tags",
      run: async () => {
        await pool.query("DELETE FROM skill_tags WHERE user_id = ?", [target.id]); // module-review-ok: skill_tags are claims a person made about themselves in a searchable directory, and nothing else would ever remove them; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
      },
    },
    {
      // A live push endpoint is a route to somebody's phone. Leaving it meant a
      // "deleted" member could still be buzzed by the village they left.
      name: "push-subscriptions",
      run: async () => {
        await pool.query("DELETE FROM push_subscriptions WHERE user_id = ?", [target.id]); // module-review-ok: a live push endpoint is a route to somebody's phone after they have left; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
      },
    },
    {
      // Same reasoning, quieter channel: an unmuted thread subscription keeps
      // generating notifications for an account that no longer exists.
      name: "forum-subscriptions",
      run: async () => {
        await pool.query("DELETE FROM forum_subscriptions WHERE user_id = ?", [target.id]); // module-review-ok: an unmuted subscription keeps generating notifications for an account that no longer exists; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
      },
    },
    {
      // The proof-of-ownership challenge tying a wallet address to this person.
      name: "wallet-challenges",
      run: async () => {
        await pool.query("DELETE FROM wallet_challenges WHERE user_id = ?", [target.id]); // module-review-ok: the proof-of-ownership challenge tying a wallet to this person; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
      },
    },
    {
      // Free text they wrote, in their own words. The row is kept, because the
      // funnel it belongs to is a real metric, and the sentence goes, and so
      // does the attribution, because a question can identify its asker on its
      // own.
      name: "concierge-queries",
      run: async () => {
        await pool.query( // module-review-ok: free text the member wrote, cleared while the funnel row it belongs to stays; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
          "UPDATE concierge_queries SET query = '[removed with the member]', user_id = NULL WHERE user_id = ?",
          [target.id],
        );
      },
    },
    {
      name: "contact-requests",
      run: async () => {
        await pool.query( // module-review-ok: the message body of a contact request, in their own words; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
          "UPDATE contact_requests SET message = '[removed with the member]' WHERE from_user_id = ?",
          [target.id],
        );
      },
    },
    {
      // Intents are the same class of trace: their own words about what they
      // sought and offered, plus every matcher sentence where they were a party.
      name: "intents",
      run: async () => {
        await eraseIntentsForMember(pool, target.id);
      },
    },
    {
      // A vendor's record naming this member, holding a verbatim quote about
      // them. Absent from this sweep until 0152, so it survived a departure,
      // and absent from the export too, which together made three published
      // promises quietly false for anybody a module had written about. Drops
      // the subject rows AND clears the quote, for the reason stated at the top
      // of this file: the TEXT restates the person.
      name: "module-records",
      run: async () => {
        await forgetMemberInProposals(pool, target.id);
      },
    },
    {
      /*
       * THE MEMBER'S OWN AGENT, and the reason it is listed here at all.
       *
       * This sweep was rewritten into a named step list, and the list named
       * exactly the tables the findings that prompted it had named. Four were
       * absent: `agent_inboxes`, `agent_deliveries`, `member_llm_keys` and
       * `member_drafts`. Enumerating a sweep makes it LOOK complete, which is
       * why the omission survived a rewrite whose whole purpose was
       * completeness.
       *
       * The inbox is the sharp one. `agent-week-ahead` runs every 24 hours and
       * selects `FROM agent_inboxes WHERE enabled = 1` with no join to `users`,
       * so a tombstoned member's endpoint kept receiving the village's payloads
       * for as long as the row stood. `member_llm_keys` is the other: a
       * third-party API key, encrypted at rest, belonging to somebody who asked
       * to be forgotten.
       *
       * Order and idempotency live in the repo, because deliveries key on the
       * inbox rather than on the member and carry no foreign key.
       */
      name: "member-agent",
      run: async () => {
        await forgetAgentForMember(pool, target.id);
      },
    },
    {
      // The character sheet: which class they walk, and how they chose to look
      // walking it. See `server/repos/playerCharacters.ts` for why the rows go
      // instead of being de-attributed.
      name: "character-sheet",
      run: async () => {
        await forgetCharactersForMember(pool, target.id);
      },
    },
    {
      /*
       * THE PUBLISHED FACE.
       *
       * The rows come out and the FILES come off the volume, in that order.
       * The order is the safe one: a death between them leaves files on disk
       * that no row names, which the uploads sweep collects, while the other
       * order would leave rows pointing at bytes that are gone and a studio
       * rendering broken images at their owner.
       *
       * Unlinking is what makes this a revocation. `/api/uploads/:filename` has
       * no sign-in in front of it, so while the bytes are there the address is
       * a capability, and deleting a row that nobody can read any more removes
       * the picture from listings and from nothing else.
       */
      name: "portraits",
      run: async () => {
        for (const file of await forgetPortraitsForMember(pool, target.id)) {
          unlink(deps.uploadsDir, file);
        }
      },
    },
    {
      name: "tombstone",
      run: async () => {
        await members.update(target.id, (u: any) => {
          u.name = ANON;
          u.email = `deleted-${u.id}@anonymized.invalid`;
          u.handle = `departed-${String(u.id).slice(-8)}`;
          u.passwordHash = "";
          u.tokenVersion = (u.tokenVersion ?? 0) + 1; // every session dies now
          u.bio = "";
          u.avatar = null;
          u.paths = [];
          u.journeys = {};
          u.prefs = {};
          u.contributions = [];
          u.role = "member";
          u.stageGranted = null;
          u.membershipGranted = false;
          u.walletAddress = null;
          u.walletVerifiedAt = null;
        });
      },
    },
    {
      name: "audit",
      run: async () => {
        await recordEvent(pool, {
          kind: "audit",
          text: "member:anonymized",
          actorUserId: actorId,
          entityType: "user",
          entityRef: target.id,
          audience: "admin",
        });
      },
    },
  ];
}

/**
 * Ask every store outside this village, and record what each one owes.
 *
 * A STEP LIKE ANY OTHER, and last on purpose. Asked AFTER the local sweep, so a
 * slow or refusing driver never delays the one deletion this deployment fully
 * controls. Inside the resumable sequence rather than beside it, because a
 * process that died before this ran would otherwise have left the vendors never
 * asked at all, with nothing recording that either: `subject_refs` only learns
 * about an obligation once a driver has ANSWERED.
 */
async function askEveryStore(
  pool: Pool,
  userId: string,
  actorId: string | null,
): Promise<ErasureOutcome> {
  const external = await forgetMemberEverywhere(pool, userId);
  for (const miss of external.unconfirmed) {
    // An erasure that did not complete is a fact about an OBLIGATION, so it
    // gets an audit row of its own beside the integration_health failure the
    // wrapper already wrote. A health row answers "is that integration well";
    // this answers "does this village still owe this person something", and
    // those are different questions that go stale at different rates.
    await recordEvent(pool, {
      kind: "audit",
      text: `member:forget-unconfirmed:${miss.module}`,
      actorUserId: actorId,
      entityType: "user",
      entityRef: userId,
      audience: "admin",
    });
    console.error(
      `[erasure] "${miss.module}" did not confirm deletion for ${userId}: ${miss.detail}. This village still owes that member a confirmation`,
    );
  }
  return external;
}

/** The name of the last step, the one that reaches outside this village. */
const EXTERNAL_STEP = "external-stores";

/**
 * Run the steps this member still needs, note each one that lands, and mark the
 * sweep finished when none are left.
 *
 * A failing step records WHERE it stopped and then rethrows, so the caller
 * still fails loudly and a route still refuses to report success. The record is
 * what makes the failure survivable: it is the only thing that will still be
 * true after the process that saw the error is gone.
 */
async function runSweep(
  pool: Pool,
  target: any,
  actorId: string | null,
  deps: ErasureDeps,
  done: ReadonlySet<string>,
): Promise<SweepResult> {
  const ran: string[] = [];
  let external: ErasureOutcome | null = null;

  const steps = sweepSteps(pool, target, actorId, deps);
  steps.push({
    name: EXTERNAL_STEP,
    run: async () => {
      external = await askEveryStore(pool, target.id, actorId);
    },
  });

  for (const step of steps) {
    if (done.has(step.name)) continue;
    try {
      await step.run();
    } catch (err: any) {
      await noteErasureFailed(pool, target.id, step.name, String(err?.message ?? err));
      throw err;
    }
    await noteStepDone(pool, target.id, step.name);
    ran.push(step.name);
  }

  await noteErasureFinished(pool, target.id);
  return { ran, finished: true, external };
}

/**
 * Erase a member, from the beginning.
 *
 * Every step runs, whatever any earlier attempt recorded. An erasure asked for
 * a second time genuinely happens a second time: treating a finished record as
 * "nothing to do" would make a repeat request a silent no-op over any trace
 * that appeared since, and "we already did that" is the one answer a deletion
 * request must never be given by accident.
 */
export async function anonymizeMember(
  pool: Pool,
  target: any,
  actorId: string | null,
  deps: ErasureDeps,
): Promise<ErasureOutcome> {
  // Defensive: every route into here refuses example identities, and if one
  // ever slips through, the scrub would rename the author of every seeded
  // thread and feed post to "A departed member" - irreversibly, since the
  // rename is a write and the seed is only re-applied on a refresh.
  if (isExampleUser(target)) return ASKED_NOBODY;

  await beginErasure(pool, target.id);
  const result = await runSweep(pool, target, actorId, deps, new Set());
  return result.external ?? ASKED_NOBODY;
}

/**
 * Finish a sweep that stopped part way.
 *
 * WHY THIS IS PRESSED AND NOT SCHEDULED. The same argument
 * `server/routes/erasureQueue.ts` makes about re-asking a vendor: nothing else
 * will ever erase these members again, because they are already gone, so the
 * retry has to be something somebody does. It lives on the queue that already
 * shows the count, because the person reading the number is the person who
 * wants to press it. A scheduled job can come later, once anybody has watched
 * this work.
 *
 * RE-READS THE MEMBER rather than taking one. The record outlives the request
 * that made it, and the row may have been tombstoned by the attempt that
 * failed, so the only honest source for "who is this" is the database now.
 */
export async function resumeErasure(
  pool: Pool,
  userId: string,
  deps: ErasureDeps,
): Promise<SweepResult> {
  const record = await erasureRecord(pool, userId);
  if (record?.finishedAt) return { ran: [], finished: true, external: null };

  const target = await deps.members.byId(userId);
  if (!target) {
    // The user row is gone entirely, which the tombstone path never does. There
    // is no member left to sweep and no honest way to run the remaining steps,
    // so this says so and leaves the record open for a person to read.
    await noteErasureFailed(pool, userId, "load-member", "no user row to resume from");
    return { ran: [], finished: false, external: null };
  }
  if (isExampleUser(target)) return { ran: [], finished: false, external: null };

  await noteResumeAttempt(pool, userId);
  // The actor is the village rather than a person: a resume is the queue
  // finishing an obligation, and attributing it to whoever pressed the button
  // would put their name on an act somebody else began.
  return runSweep(pool, target, null, deps, new Set(record?.stepsDone ?? []));
}

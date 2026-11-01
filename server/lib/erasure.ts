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
 * what is owed, and deleting them would break the conservation proof. A kept
 * row still loses the words and the address it carries about the person: a
 * stay keeps its nights and loses its notes, an order keeps its amount and
 * loses the payer's address, and a housing request keeps the home it holds
 * (reserved rows count toward a hamlet's homes taken) and loses the name,
 * address, phone and notes on it.
 *
 * Six more things stay on purpose, each for its own reason:
 *
 *   MESSAGES. What they wrote in a conversation stays in it, read as "A
 *   departed member" through the join to the tombstone, the way a forum post
 *   is. The other people in a thread keep the conversation they had, and a
 *   direct message was written TO somebody, so taking it out of their history
 *   is a choice about that person's record as much as the leaver's. The leaver
 *   walks out of every thread first, so nothing new reaches them and a group
 *   they owned has an owner again. Whether a direct message should go with its
 *   author instead is Rye's to decide (raised 2026-10-22).
 *   VOUCHES THEY GAVE SOMEBODY ALREADY ADMITTED. Each is the record of that
 *   admission, so the row stays and only the words they wrote on it go. A
 *   vouch they gave somebody still waiting records no admission yet, and kept
 *   it would count toward one in their name, so it goes whole, as do the
 *   vouches written ABOUT them.
 *   INVESTOR PATH FACTS. A dated record that an interest was registered, a
 *   packet released, an accreditation declared or an agreement signed is the
 *   kind a village may be obliged to keep after a person leaves, and whether
 *   it must is a legal question for each village. The fact and its dates stay,
 *   de-attributed; the free text beside it goes. Rye decides whether a village
 *   should be able to delete them outright (raised 2026-10-22).
 *   VOTES ALREADY CAST (round 4, R4-8). A yes, no or abstain the member cast
 *   in person on a ballot still open stays in `ballot_votes` and counts when
 *   the ballot closes, because that ballot froze them into its roll: the
 *   snapshot law (server/lib/ballots.ts, the header) and docs/ECONOMICS.md,
 *   which already says a former member can vote on a ballot that froze them
 *   in. It was their own act while present, as a forum post is. The row holds
 *   a choice, the tombstone's id and any reason they typed on it
 *   (`ballot_votes.reason`, which no step clears today, so it stays the way a
 *   forum post's words do). Every COPIED vote goes: the delegations step ends each
 *   delegation they gave or carried and derives every open ballot again
 *   ("delegations-after-tombstone"). The member hears this before either door
 *   (`VOTE_CAST_STAYS`, client/src/components/LeavingKeeps.tsx). Whether a
 *   cast vote on an open ballot should go with its author is Rye's to decide
 *   (raised 2026-10-30); that would be a new id-only step after the tombstone
 *   that deletes their rows with no `followed_user_id` on open ballots, before
 *   the delegations step re-derives.
 *   SUBMISSIONS, AS ROWS. A raised hand, a seat claim, a signing, a quest idea
 *   or a form they sent, on their account or signed out under their address,
 *   keeps its row, type, status and time: the inbox is the village's record of
 *   what was asked and what it decided. Inside it every value goes, their
 *   words and their name, except what another person relies on: which of the
 *   village's seats, powers, emails or documents it was about (the stewards'
 *   queues find a claim or a hand by them), the letter version a signing was
 *   made against and its acknowledgements (an admission stands on them), a
 *   quest idea's words (the idea in review is the village's, by the rule the
 *   quest-proposals step follows), and an investor's declared accreditation,
 *   for the reason given just above. `KEPT_BY_TYPE` in
 *   server/lib/submissionWords.ts is the list, with the reason beside each.
 *   PULSE LINES SOMEBODY ELSE WROTE ABOUT THEM. "Ann appreciated Wren" stays
 *   Ann's line and reads "Ann appreciated a departed member". The village
 *   counts its active members and each holder's activity by the actors of
 *   these lines, so deleting the row would take a living member's activity
 *   out of every count it sits in. Only the name goes.
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
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { forgetStewardActs } from "./stewardship";
import { eraseIntentsForMember } from "./intents";
import { forgetMemberNeeds } from "./needs";
import { forgetMemberJournal } from "./journal";
import { forgetMemberGeneKeys } from "./geneKeys";
import { forgetMemberCards } from "./sessionCard";
import { forgetMemberInOutbox } from "./saberraOutbox";
import { eraseApplicationWords, withdrawUnseatedOf } from "../repos/seatApplications";
import { deleteDraftsOf } from "./proposalDrafts";
import { eraseFromAlignments } from "./alignmentErasure";
import { recordPartyLeft } from "./alignmentEndings";
import { eraseSeasonPlanWords } from "../repos/seasonPlans";
import { forgetMemberSessions } from "./liveSessions";
import { forgetRoleTensionsFor } from "./roleTensions";
import { forgetMemberProposals } from "../repos/roleProposals";
import { isExampleUser } from "./examples";
import { forgetMemberInProposals } from "./externalProposals";
import { forgetMemberEverywhere, type ErasureOutcome } from "./memberDrivers";
import { recordEvent } from "./events";
import { releaseSeatingsForUser } from "./orgChart";
import { forgetMemberInDrafts } from "./orgDrafts";
import { forgetPortraitsForMember, portraitFilesForMember } from "../repos/characterPortraits";
import { forgetCharactersForMember } from "../repos/playerCharacters";
import { forgetAgentForMember } from "../repos/memberAgent";
import { forgetCompanionsForMember } from "../repos/companions";
import { forgetAsksForMember } from "../repos/memberAsks";
import { forgetRewardMomentsOf } from "../repos/rewardMoment";
import { forgetProposer } from "../repos/questProposals";
import { contactsForPerson, enrollmentIdsOf, forgetCommsPerson, forgetHousingAlertsOf, housingAddressesOf } from "../repos/commsPeople";
import { forgetNoticesByKey, forgetNoticesOf } from "../repos/noticesNaming";
import { pathHandoffKey } from "./comms/notices";
import { forgetBallotWordsOf, forgetProposalBallotWordsOf } from "./ballotErasure";
import { forgetMeetMeWindowsOf } from "./gatherings";
import { forgetOwnExitNotes } from "./exit";
import { forgetCheckinNotesOf } from "./economy";
import { revokeOpenInvitesOf } from "../repos/memberInvites";
import { releasePlacesOf } from "./calendarCommunity";
import { scrubReservationsOf, secondAddressesOf } from "../repos/housing";
import { forgetVouchesOf } from "../repos/vouches";
import { leaveEveryConversation } from "./messaging";
import { endDelegationsOf } from "./delegation";
import { insertNotification, type NotifyDeps, type NotifyInput } from "./notify";
import { forgetVenturesOf } from "../repos/ventures";
import { forgetFactWordsOf } from "../repos/investorPath";
import { forgetStayNotesOf } from "../repos/stays";
import { forgetPayerEmailOf, liveSubscriptionsOf } from "../repos/productPurchases";
import { recordSubscriptionCancels } from "../repos/subscriptionCancels";
import { cancelSubscription, stripeConfigured } from "./payments";
import { forgetSeatJournalNames } from "../repos/orgSeatErasure";
import { leaveEveryCrewOf } from "../repos/questCrewErasure";
import { releaseOpenClaimsOf } from "../repos/questClaimErasure";
import { forgetReportReasonsOf } from "../repos/placePhotos";
import { heldByAnotherAccount, usersRepo } from "../repos/users";
import { forgetPulseLinesNaming } from "../repos/pulseLines";
import { forgetSubmissionWords } from "./submissionWords";
import { emailKeyOf } from "../../shared/comms/address";
import { guestPersonKey } from "../../shared/comms/kinds";
import { isTombstone } from "./oauthAccounts";
import {
  abandonErasure,
  beginErasure,
  erasedIdentity,
  erasureRecord,
  finishedErasureSubjects,
  noteBackfilledStep,
  noteErasureFailed,
  noteErasureFinished,
  noteResumeAttempt,
  noteStepDone,
  stayedSinceLastAttempt,
  openBackfillRecord,
  type ErasedIdentity,
} from "../repos/memberErasure";

export type ErasureDeps = {
  /**
   * The users repository. Its `update` writes the tombstone, and `erasure`
   * is how the tombstone step says so: once a row is a tombstone, the
   * repository keeps its identity fixed against every other writer
   * (`server/repos/users.ts`), and this sweep is the one writer that may
   * still change it. Two steps pass it: "tombstone", and
   * "handle-after-tombstone", which takes the handle off a tombstone that
   * still has one.
   */
  members: {
    byId(id: string): Promise<any>;
    update(id: string, fn: (u: any) => void, opts?: { erasure?: boolean }): Promise<unknown>;
  };
  /** Submissions, which keep their rows and lose the member's words and name (server/lib/submissionWords.ts). */
  submissionsRepo: { all(): unknown[]; replaceAll(rows: unknown[]): Promise<unknown> };
  /** Permission holdings, which end here. The org chart is a different plane. */
  roleHoldersRepo: { remove(ids: string[]): Promise<unknown> };
  withRoleHolderLock: <T>(fn: () => Promise<T>) => Promise<T>;
  /** `roleId` is read by a former member's resolve, to name the roles it ends (round 4). */
  loadRoleHolders: () => Array<{ id: string; userId: string; roleId?: string }>;
  /**
   * The uploads volume. A portrait's bytes outlive its row, and its address
   * needs no sign-in, so revoking a face means unlinking a file.
   */
  uploadsDir: string;
  /**
   * The notification spine as the server holds it, so a notice this sweep
   * writes follows each recipient's mail preference. The delegations step
   * tells the members who had handed the leaver their voice. Absent, the
   * notice is written to the bell with no mail (`bellOnly` below), so leaving
   * it out loses no notice.
   */
  notify?: (input: NotifyInput) => Promise<unknown>;
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
  /**
   * True when the resume ran nothing because the member's departure was
   * cancelled after this sweep stopped: they stayed (`resumeErasure`).
   */
  stayed?: boolean;
}

const ANON = "A departed member";

/** What a scrubbed key of a submission reads as. */
const REMOVED = "[removed at member's request]";

/** The inbox's word for an ask to be confirmed in a documented seating (server/routes/org.ts). */
const SEAT_CLAIM_TYPE = "seat-claim";

/** The address the tombstone carries, and the one a scrubbed row is given in place of theirs. */
const tombstoneAddress = (id: string): string => `deleted-${id}@anonymized.invalid`;

/**
 * The member's real address as a match key, or "" when it is no longer known.
 * `target` carries their real address on every run: the record read before
 * the sweep began on a first run, and on a resume the identity
 * `member_erasures` held from before the tombstone (`asTheyWere`, 0282). Only
 * a record from before 0282 that stopped past the tombstone gets "", and so
 * does a resume whose old address another account holds now (`asTheyWere`
 * says why). The steps that match by address then find its rows by user id
 * alone, the limit the comms step states.
 */
const realEmailKey = (target: any): string => {
  const email = String(target?.email ?? "");
  return email && !isTombstone({ email }) ? emailKeyOf(email) : "";
};

/**
 * The member's real name, or null for a target that is still a tombstone and
 * names nobody. A resume whose old address somebody else holds now comes back
 * with no address and its real name (`asTheyWere`), and the name still counts.
 * For the steps that can only find a line or an alert by the name it printed.
 */
const realName = (target: any): string | null => {
  if (isTombstone({ email: String(target?.email ?? "") })) return null;
  const name = String(target?.name ?? "").trim();
  return name && name !== ANON ? name : null;
};

/** The real name and the real address, whichever of the two the sweep still knows. */
const knownAs = (target: any): string[] => {
  const email = String(target?.email ?? "");
  return [realName(target) ?? "", email && !isTombstone({ email }) ? email : ""].filter(Boolean);
};

/**
 * The notification spine with no mail, for a host that hands this sweep no
 * `notify`. The row still lands in the bell under its stable key, and the
 * daily digest still picks it up; only an immediate email needs the host's
 * mailer. The server always passes `notify`, so this is the path a script or
 * a test takes, and it means no caller can lose a delegator's notice by
 * leaving a field out.
 */
function bellOnly(pool: Pool, members: ErasureDeps["members"]): NotifyDeps {
  return {
    pool,
    memberById: (id) => members.byId(id),
    sendEmail: async () => ({ accepted: false, status: "skipped", reason: "the erasure was handed no mailer" }),
    origin: () => "",
    projectName: () => "",
    isPresent: (m) => !!m && !isTombstone({ email: String(m.email ?? "") }),
  };
}

/**
 * The spine a notice from this sweep goes through: the host's when it handed
 * one, else the bell alone (`bellOnly`). Exported for the former-member resolve
 * (`keepAsFormerMember`, server/lib/exitResolve.ts), which ends a leaver's
 * delegations with the same call and tells the same people the same way.
 */
export function noticeSpine(pool: Pool, deps: Pick<ErasureDeps, "members" | "notify">): (input: NotifyInput) => Promise<unknown> {
  return deps.notify ?? ((input: NotifyInput) => insertNotification(bellOnly(pool, deps.members), input));
}

/** Nothing outside holds anything, and nothing was asked. */
const ASKED_NOBODY: ErasureOutcome = { asked: [], confirmed: [], unconfirmed: [] };

/**
 * Take one file off the volume, or say why not by throwing.
 *
 * ENOENT is the ordinary case and passes: the row named a file the volume no
 * longer has, which is also what a resume meets for a file an earlier attempt
 * already removed. ANY OTHER FAILURE THROWS, and that is the change from what
 * stood here. This used to log and return, so the step was recorded as done
 * while the picture stayed on the volume, and `/api/uploads/:filename` serves
 * whatever file is there to anybody holding the address. A throw stops the
 * sweep at this step, `runSweep` records where, and a resume comes back for the
 * same file, which it can still find because the rows naming it are deleted
 * only after every file is off.
 *
 * A name that could climb out of the uploads directory is skipped: it is not a
 * file this village wrote, and nothing of the member's sits at that path.
 */
function unlink(uploadsDir: string, fileName: string): void {
  const name = String(fileName ?? "").trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return;
  try {
    fs.unlinkSync(path.join(uploadsDir, name));
  } catch (err: any) {
    if (err?.code === "ENOENT") return;
    throw new Error(`could not take "${name}" off the volume: ${err?.message ?? err}`);
  }
}

/**
 * End every PERMISSION holding (`role_holders`) a departing member has.
 *
 * The erasure's "role-holdings" step, and the former-member resolve
 * (server/lib/exitResolve.ts) calls it too, so a member who stays on after
 * leaving and one who is erased give up their roles by one code path.
 *
 * By id (0123). A departing member who held the village's only permission
 * seat left a filtered snapshot with no rows in it, and an empty payload
 * carries no version stamp, so the whole-table write deleted every seat
 * granted since the snapshot was taken. Called even with nothing to take, so
 * a repository that refuses the write still fails loudly; `remove([])` is a
 * no-op. Idempotent: a second call finds no holding to remove.
 */
export async function endPermissionHoldings(
  userId: string,
  deps: Pick<ErasureDeps, "roleHoldersRepo" | "withRoleHolderLock" | "loadRoleHolders">,
): Promise<void> {
  await deps.withRoleHolderLock(async () => {
    await deps.roleHoldersRepo.remove(
      deps.loadRoleHolders().filter((h) => h.userId === userId).map((h) => String(h.id)),
    );
  });
}

/** A duplicate key on the users table's address, the one collision the tombstone answers. */
const isAddressTaken = (err: any): boolean => err?.code === "ER_DUP_ENTRY" && /users_email_unique/.test(String(err?.message ?? ""));

/**
 * Close the account: the update the "tombstone" step makes, and the reason
 * that step's header gives for its handle and its address.
 *
 * The address is tried in its plain form first, so every tombstone nobody
 * squatted reads exactly as it always has. Only a duplicate key on the address
 * is answered, by the suffixed form; the database's own key decides, so an
 * address that differs by case or by an accent the collation folds is caught
 * the same way. Anything else still throws, and the sweep records where.
 *
 * `erasure`: a second erasure of a tombstone writes these fields again. Two
 * steps may pass it, this one and "handle-after-tombstone", which takes the
 * handle off a tombstone that still has one (see ErasureDeps).
 */
async function writeTombstone(members: ErasureDeps["members"], id: string): Promise<void> {
  const close = (address: string) =>
    members.update(id, (u: any) => {
      u.name = ANON;
      u.email = address;
      u.handle = null;
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
      u.emailVerifiedAt = null; // the proof was of the address that just went
    }, { erasure: true });
  try {
    await close(tombstoneAddress(id));
  } catch (err) {
    if (!isAddressTaken(err)) throw err;
    await close(`deleted-${id}-${randomBytes(6).toString("hex")}@anonymized.invalid`);
  }
}

/**
 * A person's comms rows, with the day-21 hand-offs that named them first.
 *
 * The hand-off asks a path's contact person to write to somebody by first
 * name, on that person's bell with no actor, keyed on the walker's journey
 * enrollment, and emailed. The comms rows below delete the enrollment, the one
 * record that ties those rows to the walker, so they are rewritten here while
 * it stands (round 2, finding 12). Both callers need it: the comms step for the
 * member, and the housing-contacts step for a second address they typed, which
 * a ticked box walks onto the resident path too.
 */
async function forgetCommsAndHandOffs(pool: Pool, who: { userId?: string | null; emailKeys?: string[]; name?: string | null }): Promise<void> {
  await forgetNoticesByKey(pool, (await enrollmentIdsOf(pool, who)).map(pathHandoffKey));
  await forgetCommsPerson(pool, who);
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
 *
 * A step added after the tombstone is also named in `BACKFILL_BY_ID` or
 * `BACKFILL_LEAVES_OUT` (below `resumeErasure`), which decides whether an
 * erasure that finished before the step existed is given it at boot.
 */
function sweepSteps(pool: Pool, target: any, actorId: string | null, deps: ErasureDeps): Step[] {
  const { members, submissionsRepo, roleHoldersRepo, withRoleHolderLock, loadRoleHolders } = deps;
  const submissionIdsOf = (userId: string): string[] =>
    (submissionsRepo.all() as any[]).filter((s) => s?.userId === userId).map((s) => String(s.id));
  /*
   * The names a seat's journal may quote for this member, and the rewrite
   * (server/repos/orgSeatErasure.ts says how each is found). Their own name
   * comes from `target`, which holds it on a resume too (`asTheyWere`), and
   * from nothing when the row is still a tombstone, whose name is nobody's.
   */
  const forgetSeatJournal = async (): Promise<void> => {
    const name = isTombstone({ email: String(target.email ?? "") }) ? "" : String(target.name ?? "").trim();
    await forgetSeatJournalNames(pool, {
      userId: target.id,
      ownNames: name ? [name, name.split(/\s+/)[0]] : [],
      claims: (submissionsRepo.all() as any[])
        .filter((s) => s?.type === SEAT_CLAIM_TYPE && s?.userId === target.id)
        .map((s) => ({ roleId: String(s.data?.roleId ?? ""), name: String(s.data?.recordedName ?? ""), held: s.status === "accepted" }))
        .filter((c) => c.name !== REMOVED),
    });
  };
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
      // steward's inbox. Their own bell goes; every row naming them to
      // somebody else, found by its actor or, for rows the admin producers
      // wrote with no actor, by the record its key was built from, loses its
      // words, and its emailed copies go blank first (server/repos/noticesNaming.ts).
      name: "notifications",
      run: async () => {
        await forgetNoticesOf(pool, { userId: target.id, submissionIds: submissionIdsOf(target.id) });
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
      // Their submissions keep their rows and lose their words and name: every
      // row on their account and every row sent signed out under their
      // address, with the team alerts those set off blanked first, while the
      // rows still say what the alerts said. A quest idea's words and the
      // other values `KEPT_BY_TYPE` lists stay (server/lib/submissionWords.ts).
      // Before any of that, a Work With Us file only their rows name comes off
      // the volume through `unlink`, so a file that will not come off stops
      // this step with the rows still naming it.
      // This pass ran first with seven contact keys and the account match
      // alone; a record that already holds this name gets the rest from
      // "submission-words-after-tombstone", which every record runs.
      name: "submissions",
      run: async () => {
        await forgetSubmissionWords(pool, submissionsRepo, { userId: target.id, emailKey: realEmailKey(target), knownAs: knownAs(target) }, (file) => unlink(deps.uploadsDir, file));
      },
    },
    {
      // A quest idea they sent through the public form keeps its words and
      // loses its author's id. It holds no name or contact details, and its
      // batch id names the submission, never them: server/lib/publicForms.ts.
      name: "quest-proposals",
      run: async () => {
        await forgetProposer(pool, target.id);
      },
    },
    {
      /*
       * Aligned terms (0260, seat settings PR8): every text the member is a
       * party to that has not ended gets a `party_left` ending, so the record
       * says how it ended. Leaving never waits on terms; this only writes.
       * BEFORE the holdings and the org seatings are released, because a released seating ends
       * seat terms by the derivation and the record would then never say why.
       * Keyed on the text, so a resume writes nothing twice.
       */
      name: "alignment-party-left",
      run: async () => {
        await recordPartyLeft(pool, target.id, new Date());
      },
    },
    {
      name: "role-holdings",
      run: async () => {
        await endPermissionHoldings(target.id, { roleHoldersRepo, withRoleHolderLock, loadRoleHolders });
      },
    },
    {
      // The step above ends PERMISSION holdings. The org chart is the other
      // plane called "role" (ARCHITECTURE 3.15) and shares nothing with it, so
      // it went on holding a departed member's seat under their real user id
      // while /api/org republished it to everyone with map.viewPeople.
      //
      // The seat's journal first: its lines quote the names the release takes
      // off the seatings, and once they are off, a seating a steward confirmed
      // under some other spelling has nothing left to find its lines by. It
      // runs again after the tombstone, for the reason that step gives.
      name: "org-seatings",
      run: async () => {
        await forgetSeatJournal();
        await releaseSeatingsForUser(pool, target.id, "member left the village");
      },
    },
    {
      // The seatings that have not happened YET. An open draft restates a
      // person inside JSON rather than in a column, so every column-shaped
      // trace could go while their name sat in a draft that /api/org/vision
      // publishes. The shape of that JSON is decided in orgDrafts.ts, so the
      // emptying is too. A sweep resumed after this step was added still runs
      // it, because progress is kept by step NAME in `steps_done`.
      name: "org-drafts",
      run: async () => {
        await forgetMemberInDrafts(pool, target.id, ANON);
      },
    },
    {
      // The wizard's unfinished proposals (red team S2). Private to their
      // author and never a record of anything the village decided, so they
      // go whole: a half-written seat application carries the member's words
      // and their terms, and nothing else would ever remove them.
      name: "proposal-drafts",
      run: async () => {
        await deleteDraftsOf(pool, target.id);
      },
    },
    /*
     * THE TRACES A TOMBSTONE DOES NOT COVER.
     *
     * Most identity here is a join: forum posts, quest claims and messages
     * carry only an author id, so once the user row becomes a tombstone they
     * read as "a departed member" for free. The steps below are the ones that
     * do NOT work that way. They either restate the person independently of the users
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
       *
       * IT RUNS AGAIN AFTER THE TOMBSTONE, as "member-agent-after-tombstone",
       * because the member can still write to all of this until then. This
       * first pass stays, under its old name, for the reason that step gives.
       */
      name: "member-agent",
      run: async () => {
        await forgetAgentForMember(pool, target.id);
      },
    },
    {
      /*
       * THE MEMBER'S COMPANIONS (0295): the companions, every question and
       * draft they brought, the member's answers, and every chat. All of it is
       * the member's own, so all of it goes, and nothing is de-attributed. It
       * runs again after the tombstone, as "companions-after-tombstone", for
       * the reason "member-agent-after-tombstone" gives.
       */
      name: "companions",
      run: async () => {
        await forgetCompanionsForMember(pool, target.id);
      },
    },
    {
      /*
       * THE MEMBER'S ASKS (0299): every ask they sent and every ask sent to
       * them. A row is the two members on it and nobody else, so it goes
       * whole. It runs again after the tombstone, as
       * "member-asks-after-tombstone", because an ask can still be sent to
       * them until then.
       */
      name: "member-asks",
      run: async () => {
        await forgetAsksForMember(pool, target.id);
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
       * The FILES come off the volume first, and only then do the rows go.
       *
       * THE OTHER ORDER STOOD HERE, and its comment called it the safe one: a
       * death between the two "leaves files on disk that no row names, which
       * the uploads sweep collects". Nothing collects them. The daily uploads
       * job only measures orphans, removing one takes an admin pressing a
       * button, and `/api/uploads/:filename` serves any file on the volume to
       * anybody holding the address. The rows are the only record of which
       * files are this member's face, so a resume that found them gone found
       * nothing to unlink, and the pictures stayed public for good.
       *
       * This order's cost is the one the old comment feared: a death between
       * the two leaves rows naming files that are already gone, so a studio
       * shows a broken image to a member who is being erased. That is the right
       * way round. The resume re-reads the rows, meets ENOENT, which passes,
       * and deletes them.
       *
       * Unlinking is what makes this a revocation. While the bytes are there
       * the address is a capability, and deleting a row nobody can read any
       * more takes the picture out of listings and out of nothing else. A file
       * that refuses to come off throws (see `unlink`), so the step is recorded
       * as failed with its rows still in place.
       */
      name: "portraits",
      run: async () => {
        for (const file of await portraitFilesForMember(pool, target.id)) {
          unlink(deps.uploadsDir, file);
        }
        await forgetPortraitsForMember(pool, target.id);
      },
    },
    {
      /*
       * NOTHING HERE IS A NAME ANOTHER MEMBER CAN TAKE FIRST (round 2, finding
       * 5). This update ends the member's sessions, so it has to land whatever
       * anybody else did. It used to write the handle `departed-<last eight of
       * the id>` and the address `deleted-<id>@anonymized.invalid`, both under a
       * unique key, and any member who could read an id could take either first:
       * the handle through their own profile, the address at sign-up. Every run
       * then failed on the duplicate key, and the leaver kept their name,
       * address, role and live sessions for good.
       *
       * So the handle is NULL, which the unique key admits any number of times
       * and which a handle already means when nobody has chosen one. The address
       * keeps its form, because `isTombstone` and every `@anonymized.invalid`
       * filter read it, and sign-up now refuses that domain
       * (server/routes/register.ts). A database may already hold an account at
       * one, though, so when the address is taken the step writes the same form
       * with a random suffix nobody can guess (`writeTombstone`). A later run
       * writes a tombstone address again the same way, so the step stays
       * idempotent in what it leaves: an account closed at an address that is
       * its own.
       */
      name: "tombstone",
      run: async () => {
        await writeTombstone(members, target.id);
      },
    },
    {
      /*
       * THE HANDLE A TOMBSTONE STILL CARRIES (adversarial round 3, finding 13).
       *
       * Before round 2 the tombstone wrote the handle `departed-<last eight of
       * the id>`, and forum bylines print a handle through a live join, so
       * anybody could find it. `GET /api/profiles/<handle>` needs no sign-in
       * and read the tombstone like any member: the date they joined, their
       * moons on the land and, because the tombstone never reset `privacy`,
       * their token chips and gratitude counts. A typed @handle in the
       * gratitude form found them too. Both look the handle up through
       * `userIdForHandle`, so a tombstone with no handle has no page.
       *
       * The backfill never runs "tombstone" again, so this step is how an old
       * tombstone loses the handle (it is in `BACKFILL_BY_ID`). It comes first
       * after the tombstone so a member whose backfill keeps stopping at a
       * later step still loses the page.
       *
       * `erasure`: the users repository puts a tombstone's handle back after
       * any other writer (TOMBSTONE_FIXED, server/repos/users.ts), so without
       * it this step would be noted as done and change nothing. A tombstone
       * with no handle is not written at all, so a second run, and every
       * tombstone written since round 2, changes nothing.
       */
      name: "handle-after-tombstone",
      run: async () => {
        const row = await members.byId(target.id);
        if (row?.handle == null) return;
        await members.update(target.id, (u: any) => {
          u.handle = null;
        }, { erasure: true });
      },
    },
    {
      /*
       * THE MEMBER'S OWN AGENT, A SECOND TIME, once nothing can write to it.
       *
       * "member-agent" runs before the tombstone, while the member's sessions
       * still live, and `POST /api/agent/tokens` and `PUT /api/agent/inbox`
       * write for anybody signed in. A sweep that stopped between the two
       * ("portraits" throws on a file that will not come off the volume) left
       * an account that still worked with "member-agent" recorded as done. A
       * token minted or an inbox set in that window was skipped by the resume
       * and stood for good, and `agent-week-ahead`, which selected enabled
       * inboxes with no join to `users`, kept delivering to it. Here, the
       * delete comes after the last moment a NEW request of the member's can
       * pass its session check, for the reason the needs step below gives.
       *
       * A request already past that check can still land after this step,
       * and no step runs again. `PUT /api/agent/inbox` waits on a DNS lookup
       * the member's own nameserver can stretch to seconds before it writes.
       * So the two writes that wait (`setInbox`, `storeMemberKey`) read their
       * holder after writing and take the row back for a tombstone, and every
       * enqueue, the week-ahead job and the drain refuse an inbox nobody
       * stands behind (`holderListens`, server/lib/agentInbox.ts).
       *
       * A NEW NAME, AND THE FIRST PASS STAYS. Records already hold
       * "member-agent" by name, and a resume skips what a record holds, so
       * moving that step or reusing its name would change what an in-flight
       * resume does. This one is new to every record, so an old record runs
       * it, which is the safe direction the header of this list names.
       * `forgetAgentForMember` is DELETEs keyed on the member, so this pass
       * matches nothing when nothing was written in between.
       */
      name: "member-agent-after-tombstone",
      run: async () => {
        await forgetAgentForMember(pool, target.id);
      },
    },
    {
      /*
       * THE SEATS AND QUEUE PLACES THEY HELD AS A GUEST, before they joined.
       * A guest's answer is kept under `guest:<contactId>`, never moved onto
       * the account when they join, and the contact found by their account or
       * their address IS them (server/lib/comms/linkPerson.ts). The comms step
       * below deletes those rows with the contact, and a bare delete frees a
       * seat the queue never hears about: the next walk-up took it ahead of
       * whoever was waiting. Given up here first, by the same rules as their
       * own places (`releasePlacesOf`): a seat ahead serves the queue, and the
       * queue place and slot go.
       *
       * BEFORE COMMS, and so outside the block of new steps further down,
       * because comms deletes the contacts that say whose key it is. A new name,
       * so an older record that already ran comms runs it and finds nothing.
       * While the sweep is stopped before it, the waitlist passes over a guest
       * key whose contact is a tombstone's (`promoteWaitlist`).
       */
      name: "guest-places-after-tombstone",
      run: async () => {
        const key = realEmailKey(target);
        for (const contact of await contactsForPerson(pool, { userId: target.id, emailKeys: key ? [key] : [] })) {
          await releasePlacesOf(pool, guestPersonKey(contact.id));
        }
      },
    },
    {
      /*
       * EVERY COMMS ROW THAT IS THIS PERSON (Village Comms, 0244 to 0246): their
       * contacts and answers, journeys and paths, guest rows, votes,
       * attendance and feedback, the delivery reports that name them, and no
       * suppression kept, because a suppression is the address under another
       * name. Their emails stay on the ledger with the address, subject and
       * words blanked, so the village's counts still add up. The rows and
       * their reasons are in server/repos/commsPeople.ts.
       *
       * AFTER THE TOMBSTONE, for the reason the needs step below gives: the
       * member's sessions die there, so nothing they do afterwards can write a
       * fresh comms row behind this step. `target` carries the member's real
       * address here on every run: the record read before the sweep began on a
       * first run, and on a resume the identity `member_erasures` held from
       * before the tombstone (`asTheyWere`). Only a record from before 0282
       * that stopped past the tombstone has no address left, or a resume whose
       * old address another account holds now, and those find the rest by
       * user id alone.
       */
      name: "comms",
      run: async () => {
        const email = String(target.email ?? "");
        await forgetCommsAndHandOffs(pool, {
          userId: target.id,
          emailKeys: email && !isTombstone({ email }) ? [emailKeyOf(email)] : [],
          name: String(target.name ?? ""),
        });
      },
    },
    {
      /*
       * member_needs (0205) tells its member "Only you can read this", so it
       * leaves with them. A named step, so a resumed erasure knows whether it
       * already ran.
       *
       * AFTER THE TOMBSTONE, because the tombstone is where the member's
       * sessions die. `PUT /api/needs/mine` writes a row for anybody signed in,
       * so a deletion that ran while a session still lived could be followed by
       * a fresh answer, and a resume would skip the deletion as done and leave
       * that answer standing for good. Run here, the delete comes after the
       * last moment the member could write.
       *
       * RENAMED FROM "needs" ON PURPOSE. That name was recorded in
       * `member_erasures.steps_done` when this step ran before the tombstone,
       * so on an old record it means "deleted while the member could still
       * write". Matching it here would let a resume skip exactly the case this
       * move exists for. Under a new name an old record re-runs the delete,
       * which is the safe direction the header of this list names, and the old
       * name is never reused.
       */
      name: "needs-after-tombstone",
      run: async () => {
        await forgetMemberNeeds(pool, target.id);
      },
    },
    {
      /*
       * The journal (0227): entries, pulse numbers, the feedback yes, and
       * feedback in both directions. "Only you can read this" is the whole
       * promise of those tables, so they leave with the member, deleted.
       *
       * AFTER THE TOMBSTONE, for the reason the needs step gives: the routes
       * write for anybody signed in, and the tombstone is where the member's
       * sessions die. Run here, the delete comes after the last moment they
       * could save an entry or queue a message.
       */
      name: "journal-after-tombstone",
      run: async () => {
        await forgetMemberJournal(pool, target.id);
      },
    },
    {
      /*
       * Invitation links (0209): every link the member made that nobody has
       * used is withdrawn. A link is its maker's vouch, and using one records
       * an `arrival` vouch from them that can admit somebody on its own, so a
       * departed member's open links would keep letting people in under the
       * name "A departed member" for up to fourteen days. A used link made an
       * account and stays the record of that.
       *
       * AFTER THE TOMBSTONE, for the reason the needs step gives:
       * `POST /api/invites` makes a link for anybody signed in who may vouch,
       * and the tombstone is where the member's sessions die. The door refuses
       * a tombstone's link on its own as well (server/lib/inviteDoor.ts), so a
       * sweep that stops between the two still lets nobody in.
       */
      name: "invites-after-tombstone",
      run: async () => {
        await revokeOpenInvitesOf(pool, target.id);
      },
    },
    {
      /*
       * The bridge to organisational memory (0261): every outbox row filed
       * under the member's code-name loses its words, and the code-name is
       * marked pending a vendor delete. The map entry is NOT dropped: the
       * founder promised the vendor that the village scrubs its own records,
       * asks them to delete, and drops the entry only on their confirm. They
       * have no delete endpoint yet, so the entry stays, marked, and the
       * admin panel says so.
       *
       * AFTER THE TOMBSTONE AND THE JOURNAL, for the journal's own reason: a
       * save through a still-live session queues an entry, so the scrub comes
       * after the last moment one could be queued.
       */
      name: "saberra-bridge-after-tombstone",
      run: async () => {
        await forgetMemberInOutbox(pool, target.id);
      },
    },
    {
      /*
       * Seat applications (0257): the member's own words, what they would have
       * done and why them, go. The application stays: its seats, its terms and
       * the village's decision are the record of what the village agreed to,
       * and the tombstoned user row de-attributes it without remapping ids.
       * After the tombstone, for the reason the steps above give.
       */
      name: "seat-application-words-after-tombstone",
      run: async () => {
        await eraseApplicationWords(pool, target.id);
        // And nothing they applied for is seated after they have gone.
        await withdrawUnseatedOf(pool, target.id);
      },
    },
    /*
     * FIVE THINGS THE SWEEP NEVER REACHED (lane E2), each after the tombstone
     * for the reason the needs step gives: until then the member's sessions
     * live, and each of these is written by something a signed-in member
     * does, so a pass that ran earlier could be followed by a fresh row.
     */
    {
      /*
       * Meet-me windows: "Meet <first name>", their place and their note, on
       * the village layer a signed-out visitor reads. The window is the
       * member's own offer, so it goes, freed the way any gathering is.
       */
      name: "meet-me-windows-after-tombstone",
      run: async () => {
        await forgetMeetMeWindowsOf(pool, target.id);
      },
    },
    {
      /*
       * The notifications step again, once nothing can ring a bell in the
       * member's name: a library reservation or a stay request in the window
       * before the tombstone writes an admin's row after that step ran.
       */
      name: "notices-naming-after-tombstone",
      run: async () => {
        await forgetNoticesOf(pool, { userId: target.id, submissionIds: submissionIdsOf(target.id) });
      },
    },
    {
      /*
       * The ballots that name them (round 2, finding 6). A vote to seat them
       * or take a role back from them keeps its subject, its votes and its
       * outcome, and its title, document and closer's note stop naming them;
       * its public pulse lines go. A ballot they opened loses the name on its
       * "Asked by" line. The notices those ballots rang went in the two steps
       * above, found by the ballot's id. After the tombstone, because opening
       * a ballot is something a signed-in member does, and directly after the
       * notices step, so the words and the notices go together.
       * server/lib/ballotErasure.ts says which spellings and why.
       */
      name: "ballot-words-after-tombstone",
      run: async () => {
        await forgetBallotWordsOf(pool, { id: target.id, name: target.name, handle: target.handle, email: target.email });
      },
    },
    {
      /*
       * Three ballot templates the step above never knew (round 4, finding 9):
       * a game-mechanics vote's "Proposed by <first name>" line, found through
       * the proposal the member made whoever opened the vote, a launch vote's
       * three opener sentences, and their "- <first name>" line on a launch
       * vote's steward slate. A new name, because old records already hold
       * the step above as done, and found by the member's id alone, so a
       * tombstone with no name left is cleaned the same way.
       * server/lib/ballotErasure.ts, forgetProposalBallotWordsOf, says how.
       */
      name: "proposal-ballot-words-after-tombstone",
      run: async () => {
        await forgetProposalBallotWordsOf(pool, { id: target.id, name: target.name, handle: target.handle, email: target.email });
      },
    },
    {
      /*
       * The note a member wrote when they opened their own departure. The
       * exit record stays, with the lines the settle step wrote under it,
       * the split of record among them; a note a steward wrote on a departure
       * the steward opened is the village's record and stays.
       */
      name: "exit-notes-after-tombstone",
      run: async () => {
        await forgetOwnExitNotes(pool, target.id);
      },
    },
    {
      /*
       * An email that carried their words to somebody else loses its subject
       * with its reply-to. The comms step reaches the ones sent from their
       * account's address (a relay, a housing alert); these are the housing
       * alerts sent under a different address they typed into a request of
       * their own, read off that request here, before anything scrubs it.
       *
       * ONLY THEIR OWN ALERTS (round 2, findings 3 and 16). An address they
       * typed can be a partner's account address or a porch inbox a
       * stranger's own public request also uses, and each of those people's
       * requests sent its own alert under the same reply-to. So the requests
       * at each address say whose each alert is, by the name its subject was
       * written with (`forgetHousingAlertsOf`, server/repos/commsPeople.ts),
       * and a living person's own alert keeps its subject and its reply-to.
       */
      name: "relayed-mail-after-tombstone",
      run: async () => {
        const key = realEmailKey(target);
        await forgetHousingAlertsOf(pool, {
          userId: target.id,
          name: String(target.name ?? ""),
          keys: await housingAddressesOf(pool, target.id),
          ownKeys: key ? [key] : [],
        });
      },
    },
    {
      /*
       * A steward's note on the member's check-in. The check-in stays, as the
       * record of who was there; the note about them goes.
       */
      name: "checkin-notes-after-tombstone",
      run: async () => {
        await forgetCheckinNotesOf(pool, target.id);
      },
    },
    {
      /*
       * The public pulse lines that name them. "public-health-events" took
       * the lines they wrote, and only while their sessions lived; this takes
       * those again, and the lines that name them with somebody else as the
       * actor: "Ann appreciated Wren", "Wren joined the Stewards", "Wren sits
       * in Steward, by a vote of the whole village." A signed-out visitor
       * reads every one at `GET /api/game/pulse`. Those rows stay with the
       * living actor and lose the name, so nobody's activity count moves.
       * Lines recording them as their subject are found by id; older role
       * lines by the audit row beside a vote, or by their words when no
       * living member shares the first name (server/repos/pulseLines.ts).
       */
      name: "pulse-lines-naming-after-tombstone",
      run: async () => {
        await forgetPulseLinesNaming(pool, { userId: target.id, name: realName(target) });
      },
    },
    {
      /*
       * Their submissions again, once nothing can file one: a hand raised,
       * a seat claimed or a form sent between the first pass and the
       * tombstone keeps its words otherwise, and a record that holds
       * "submissions" from before that pass took words never ran it. The
       * files only their rows name come off the volume first, as above.
       */
      name: "submission-words-after-tombstone",
      run: async () => {
        await forgetSubmissionWords(pool, submissionsRepo, { userId: target.id, emailKey: realEmailKey(target), knownAs: knownAs(target) }, (file) => unlink(deps.uploadsDir, file));
      },
    },
    {
      /*
       * The alignment store (0259): their name and handle come out of the
       * words of every alignment text, the seats' terms on offer and the
       * village presets; the words otherwise stay, de-attributed (decision 2).
       * Hash, parties and seal are untouched, so receipts still verify.
       * `target` holds the member's real name and handle on every run, a
       * resume included, for the reason the comms step gives; a handle
       * another account holds now is left out (`asTheyWere`).
       *
       * A target that is STILL a tombstone has no name left to look for: a
       * record from before 0282 that stopped past the tombstone, or an erasure
       * asked again after one finished. Its strings name nobody, and scrubbing
       * "A departed member" out of other people's words would rewrite every
       * departed member they mention, so the step finds nothing to do.
       * server/lib/alignmentErasure.ts says the rest.
       */
      name: "alignment-names-after-tombstone",
      run: async () => {
        if (isTombstone({ email: String(target.email ?? "") })) return;
        await eraseFromAlignments(pool, { id: target.id, name: target.name, handle: target.handle });
      },
    },
    {
      /*
       * Season plans (0258): the member's own words, their aim, the goal they
       * served and what they committed to, go. The seats they handed back stay
       * on the row, as the village's record of who held what, de-attributed by
       * the tombstone. After the tombstone, for the reason the steps above give.
       */
      name: "season-plan-words-after-tombstone",
      run: async () => {
        await eraseSeasonPlanWords(pool, target.id);
      },
    },
    {
      /*
       * Role tensions (0269): the member comes off every tension they raised
       * or answered. The words of each tension they raised that nobody
       * answered are cleared, since a tension often names a person and its
       * words were only ever for the role's holders and them. Answered words
       * stay, de-attributed, as the role's record; their answer notes go.
       */
      name: "role-tensions-after-tombstone",
      run: async () => {
        await forgetRoleTensionsFor(pool, target.id);
      },
    },
    /*
     * THE ROWS A MEMBER OWNED THAT NOTHING SWEPT (review of 2026-10-22). Ten
     * steps, each after the tombstone for the reason the needs step gives:
     * every one of these tables takes a write from anybody signed in, and the
     * tombstone is where the member's sessions die. Each has a new name of its
     * own, so a resume of an older record runs it. (Their guest-era places
     * have an eleventh, before comms, for the reason it gives.)
     */
    {
      /*
       * Their places at gatherings: every answer, queue place and slot. A seat
       * they held on an evening still ahead goes to whoever is waiting for it,
       * and a fee still held for a place ahead comes back, which are the seat
       * rules every other exit follows (server/lib/calendarCommunity.ts).
       */
      name: "event-places-after-tombstone",
      run: async () => {
        await releasePlacesOf(pool, target.id);
      },
    },
    {
      /*
       * A SECOND ADDRESS TYPED INTO A HOUSING REQUEST. Signed in, a member can
       * give any contact address, and with the paths box ticked comms makes a
       * contact for it, records the yes, and walks it onto the resident path.
       * That contact carries no account, so the comms step never finds it, and
       * the scrub below writes the tombstone address over the only row that
       * said whose it was. So the addresses on their own requests that nobody
       * else holds are read here, first, and forgotten in comms the way the
       * comms step forgets them, after their guest places are given up the way
       * the guest-places step gives them up. `secondAddressesOf` says which
       * addresses count as nobody else's.
       *
       * BEFORE THE SCRUB, its own step, so a death between the two is resumed
       * by a read that still finds the rows.
       */
      name: "housing-contacts-after-tombstone",
      run: async () => {
        const keys = await secondAddressesOf(pool, target.id);
        if (!keys.length) return;
        for (const contact of await contactsForPerson(pool, { emailKeys: keys })) {
          await releasePlacesOf(pool, guestPersonKey(contact.id));
        }
        await forgetCommsAndHandOffs(pool, { emailKeys: keys });
      },
    },
    {
      /*
       * Housing requests (0077): SCRUBBED, never deleted, because a reserved
       * row is a home held and counts toward the homes taken. The name, the
       * address, the phone, the notes and the account link go; the request
       * made under their address with no account on it goes with the rest,
       * and so does the admin audit line each one wrote. A request another
       * member made at their address stays that member's, and only the
       * address comes off it. server/repos/housing.ts says why.
       */
      name: "housing-reservations-after-tombstone",
      run: async () => {
        await scrubReservationsOf(pool, {
          userId: target.id,
          emailKey: realEmailKey(target),
          name: ANON,
          address: tombstoneAddress(target.id),
        });
      },
    },
    {
      /*
       * Vouches (0198): the ones written about them go, and so do the ones they
       * gave somebody still waiting, which would otherwise count toward that
       * person's admission in the name of somebody gone. The ones that
       * admitted somebody stay without their words, as the record of it. The
       * vouch route refuses a new one for a tombstone, and both doors that
       * admit on a count leave a tombstone's vouch out of it.
       */
      name: "vouches-after-tombstone",
      run: async () => {
        await forgetVouchesOf(pool, target.id);
      },
    },
    {
      /*
       * Conversations (0066): they leave every thread they are still in, so a
       * group they owned passes to its longest-standing living member, and
       * every group they were ever in is checked for a living owner, which a
       * resume repeats. Their messages stay, de-attributed: see WHAT IT
       * DELIBERATELY KEEPS at the top.
       */
      name: "conversations-after-tombstone",
      run: async () => {
        await leaveEveryConversation(pool, target.id);
      },
    },
    {
      /*
       * Delegations (0174): every one they gave or carried ends, each member
       * who handed them a voice is told through the spine, and every open
       * ballot is derived again so no vote copied from them still stands.
       */
      name: "delegations-after-tombstone",
      run: async () => {
        await endDelegationsOf(pool, target.id, noticeSpine(pool, deps));
      },
    },
    {
      // Ventures (0157): their own business in their own words, published when listed. Deleted.
      name: "ventures-after-tombstone",
      run: async () => {
        await forgetVenturesOf(pool, target.id);
      },
    },
    {
      // Investor path facts (0156): the dated facts stay, their words go. See WHAT IT DELIBERATELY KEEPS.
      name: "investor-fact-words-after-tombstone",
      run: async () => {
        await forgetFactWordsOf(pool, target.id);
      },
    },
    {
      // Stays (0021): a value row, so the stay stays; the notes they wrote go.
      name: "stay-notes-after-tombstone",
      run: async () => {
        await forgetStayNotesOf(pool, target.id);
      },
    },
    {
      // Orders (0032): a value row, so the order stays; the address beside the tombstone's name goes.
      name: "purchase-emails-after-tombstone",
      run: async () => {
        await forgetPayerEmailOf(pool, { userId: target.id, emailKey: realEmailKey(target) });
      },
    },
    {
      /*
       * Role proposals (0273): the member's drafts go, with the feedback on
       * them; a proposal they submitted loses its words and its link, since
       * the application keeps the record of what was decided; and feedback
       * they left on somebody else's draft stays, naming nobody.
       */
      name: "role-proposals-after-tombstone",
      run: async () => {
        await forgetMemberProposals(pool, target.id);
      },
    },
    /*
     * WHAT A SEAT STILL HELD FOR THEM (adversarial round 2, findings 8 to 10).
     * Four steps, each after the tombstone for the reason the needs step gives:
     * a claim, a confirm, a seating and a carried seat vote can each land while
     * the member's sessions live, behind the steps that ran before it. Each has
     * a new name, so a resume of an older record runs it. The org chart's doors
     * refuse a tombstone on their own as well (`claimSeating`, the confirm and
     * admin seat routes, the role_seat closer and the seat vote opener).
     */
    {
      /*
       * A seat's journal: the lines that quote the name a seating was recorded
       * under, which `GET /api/org/:kind/:id/journal` serves to every account
       * holding `map.viewPeople`, keep their act and date and lose the name.
       * BEFORE the seat claims are scrubbed, because a claim's recorded name
       * is one of the ways the lines are found.
       */
      name: "seat-journal-after-tombstone",
      run: forgetSeatJournal,
    },
    {
      /*
       * Their seat claims. An open one goes on asking a steward to confirm a
       * member who has gone, with their recorded name beside "A departed
       * member", so it closes the way a decline closes it, with nobody told.
       * Every one of theirs, open or answered, loses the recorded name and the
       * words the submissions step takes, which a claim filed while the sweep
       * ran still carries.
       */
      name: "seat-claims-after-tombstone",
      run: async () => {
        const rows = submissionsRepo.all() as any[];
        let changed = false;
        for (const s of rows) {
          if (s?.type !== SEAT_CLAIM_TYPE || s.userId !== target.id) continue;
          if (s.status !== "accepted" && s.status !== "declined") {
            s.status = "declined";
            changed = true;
          }
          if (s.userName !== ANON) {
            s.userName = ANON;
            changed = true;
          }
          if (s.data && typeof s.data === "object") {
            for (const k of ["recordedName", "name", "firstName", "lastName", "email", "phone", "whatsapp", "telegram"]) {
              if (k in s.data && s.data[k] !== REMOVED) {
                s.data[k] = REMOVED;
                changed = true;
              }
            }
          }
        }
        if (changed) await submissionsRepo.replaceAll(rows);
      },
    },
    {
      /*
       * A seating confirmed for them after "org-seatings" ran: a steward
       * pressing Confirm, or an admin seating them, while the account still
       * worked. Released the way that step releases one, and its journal
       * lines first, while the seating still carries the recorded name that
       * finds them.
       */
      name: "org-seatings-after-tombstone",
      run: async () => {
        await forgetSeatJournal();
        await releaseSeatingsForUser(pool, target.id, "member left the village");
      },
    },
    {
      /*
       * A permission holding that landed after "role-holdings" ran: a carried
       * role_seat vote coming due, or an appointment, while they were not yet
       * a tombstone. The closer and the appoint route refuse a tombstone, so
       * after this nothing seats them again. The same call as "role-holdings"
       * and the former-member resolve, so the three end a holding one way.
       */
      name: "role-holdings-after-tombstone",
      run: async () => {
        await endPermissionHoldings(target.id, { roleHoldersRepo, withRoleHolderLock, loadRoleHolders });
      },
    },
    {
      /*
       * Live Sessions (0238): the member leaves every room. Their people rows,
       * answers and written entries are deleted, the actions they held go back
       * to nobody, the hosts and adders they were read 0, and every closed
       * record that named them has its minutes written again from what is
       * left, so the name is gone from the text too. De-attribution is not
       * erasure, which is why the minutes are rebuilt and not only the rows.
       *
       * AFTER THE TOMBSTONE, for the reason the needs step gives: every door
       * writes for anybody signed in, and the tombstone is where the member's
       * sessions die. The names the rebuilt minutes print are read live, and by
       * now nothing in those records points at the leaver.
       */
      name: "sessions-after-tombstone",
      run: async () => {
        await forgetMemberSessions(pool, target.id, (id) => members.byId(id));
      },
    },
    {
      /*
       * Gene Keys (0272): the member's one saved result goes, deleted. It is
       * a reading of their own birth, and no birth data was ever stored to
       * de-attribute, so there is nothing to keep.
       *
       * AFTER THE TOMBSTONE, for the reason the needs step gives: the save door
       * writes for anybody signed in, and the tombstone is where the member's
       * sessions die.
       */
      name: "gene-keys-after-tombstone",
      run: async () => {
        await forgetMemberGeneKeys(pool, target.id);
      },
    },
    {
      /*
       * Quest crews (0067): they leave every crew they are in, the way
       * `crewsRepo.leave` lets a member walk out, and a crew left with nobody
       * in it disbands. Kept, a full crew refused the next person in their
       * name and every roster listed them as "A". The founder id stays as a
       * historical id: crews have no handover (server/repos/questCrewErasure.ts).
       *
       * AFTER THE TOMBSTONE, for the reason the needs step gives: the join
       * door writes for anybody signed in until the sessions die.
       */
      name: "quest-crews-after-tombstone",
      run: async () => {
        await leaveEveryCrewOf(pool, target.id);
      },
    },
    {
      /*
       * Their open quest claims (Rye, 2026-10-31, item 9). Nobody can work
       * one now: the tombstone cannot sign in and consent refuses to pay it.
       * Kept, each counted as somebody working the quest, sat in the
       * steward's queue, and held the quest against its delete. A `claimed`
       * one goes, the way a member puts a quest back; a `submitted` one is
       * declined, so the work handed in stays on the record. Consented and
       * declined claims are history and stay (server/repos/questClaimErasure.ts).
       *
       * AFTER THE TOMBSTONE, for the reason the needs step gives: the claim
       * doors write for anybody signed in until the sessions die.
       */
      name: "quest-claims-after-tombstone",
      run: async () => {
        await releaseOpenClaimsOf(pool, target.id);
      },
    },
    {
      /*
       * Place-photo reports (0093): the words they typed go, the reports stay.
       * The curators' queue serves them to every holder of `map.curatePhotos`,
       * a role or badge power, and a subject request often names the person.
       * The photograph is not touched, so a picture they asked to come down
       * stays dark.
       *
       * AFTER THE TOMBSTONE, for the reason the needs step gives: the report
       * doors write for anybody signed in until the sessions die.
       */
      name: "photo-report-reasons-after-tombstone",
      run: async () => {
        await forgetReportReasonsOf(pool, target.id);
      },
    },
    {
      /*
       * Session cards (0296): every card that named the member, read or only
       * welcomed, goes whole with all its lines, since its collective words
       * may name them. A card lives only while its session is open anyway.
       *
       * AFTER THE TOMBSTONE, for the reason the needs step gives.
       */
      name: "session-cards-after-tombstone",
      run: async () => {
        await forgetMemberCards(pool, target.id);
      },
    },
    {
      // An ask can still reach them between the first pass and the tombstone.
      name: "member-asks-after-tombstone",
      run: async () => {
        await forgetAsksForMember(pool, target.id);
      },
    },
    {
      /*
       * Reward moment markers (0294): the baseline row says when the member
       * first opened the app, and each seen row which of their payments they
       * were shown. Personal data about them, deleted whole. A debt is kept
       * through an erasure (`cash_owed`, Rye, 2026-10-31); a marker of what
       * somebody saw is not one.
       *
       * AFTER THE TOMBSTONE, for the reason the needs step gives: a moment
       * shown in the last seconds before it is still caught. Keyed on the
       * member, so a resume or a second run finds nothing.
       */
      name: "reward-moments-after-tombstone",
      run: async () => {
        await forgetRewardMomentsOf(pool, target.id);
      },
    },
    {
      // A chat or a draft can still land between the first pass and the
      // tombstone, so it runs again, as the last step that deletes the
      // member's own data. Two steps follow it on purpose and touch none:
      // "audit", which writes the sweep's own line, and
      // "product-subscriptions-after-tombstone", which asks Stripe and so
      // waits for the local sweep to finish (its comment says why). A new
      // member-data step goes above this one. DELETEs keyed on the member,
      // so this matches nothing when nothing was written in between.
      name: "companions-after-tombstone",
      run: async () => {
        await forgetCompanionsForMember(pool, target.id);
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
    {
      /*
       * Recurring purchases (0032, S69): every Stripe subscription their
       * purchases hold is cancelled, so their card stops being charged. The
       * village gives a member no door to cancel one, so before this a member
       * who left kept paying every period, and each renewal paid the
       * product's tokens into the tombstone (round 3, finding 5). The orders
       * stay as the record of what was paid; nothing is refunded and no token
       * moves. A charge that lands anyway is refused delivery and an admin is
       * told (`settleProductPurchase`, server/index.ts).
       *
       * LAST BEFORE THE OUTSIDE STORES, after the audit line, because it asks
       * Stripe: the local sweep finishes first, for the reason this file's
       * header gives. After the tombstone, and a new name, so a resume or a
       * second erasure runs it. Idempotent: `cancelSubscription` reads first,
       * and one already over or unknown to Stripe is done. A Stripe that
       * fails with the key present throws: the sweep stops here, loudly, and
       * the hourly job and the queue resume it.
       *
       * NO KEY IS A PERSON'S JOB, AND THE STEP IS DONE. A village that once
       * sold subscriptions and has since removed its Stripe key can never
       * cancel one from here, so throwing held every such erasure open at
       * this step for good, ten retries and then "needs a person", with
       * `external-stores` behind it never asked. Connecting Stripe later is
       * no help to a record the queue has given up on. So with no key the
       * step asks every admin to cancel each one by hand in the Stripe
       * dashboard, writes the count and the ids to the audit trail, and
       * counts itself done (`askAdminsToCancelByHand`).
       */
      name: "product-subscriptions-after-tombstone",
      run: async () => {
        const subs = await liveSubscriptionsOf(pool, target.id);
        if (!subs.length) return;
        if (!stripeConfigured()) {
          await askAdminsToCancelByHand(pool, target.id, actorId, subs.map((s) => s.subscriptionId), deps);
          return;
        }
        for (const sub of subs) {
          await cancelSubscription(sub.subscriptionId);
        }
        // Settles anything an earlier run, or the renewal gate, handed to a
        // person (server/lib/owedCancels.ts): the newest row naming an id wins.
        await recordSubscriptionCancels(pool, { userId: target.id, kind: "cancelled", subscriptionIds: subs.map((s) => s.subscriptionId), actorUserId: actorId });
      },
    },
  ];
}

/**
 * The subscriptions a leaver's erasure could not cancel, handed to the people
 * who can: every admin and founder hears it on the bell, through the host's
 * notice spine when it hands one over, and the audit trail records the count
 * and every id as the step's result.
 *
 * THE ALARM THE ADMINS ALREADY GET for money that needs a person: the
 * `payments_alert` kind, one row per admin under `<key>:<admin id>`, the
 * shape `notifyAdmins` writes in server/index.ts. It names the subscription
 * ids, because those are what the Stripe dashboard finds, and never the
 * leaver, who is a tombstone by now: no actor, no name, no address.
 *
 * ONCE PER LEAVER. The key is the leaver's id, so an erasure asked for again
 * with the key still missing rings nobody twice. The audit line is written on
 * every run, as every attempt is.
 */
async function askAdminsToCancelByHand(
  pool: Pool,
  userId: string,
  actorId: string | null,
  subscriptionIds: readonly string[],
  deps: ErasureDeps,
): Promise<void> {
  const notify = deps.notify ?? ((input: NotifyInput) => insertNotification(bellOnly(pool, deps.members), input));
  const title =
    `Cancel ${subscriptionIds.length} recurring payment(s) by hand in the Stripe dashboard. A departed member's erasure could not cancel them, ` +
    "because Stripe is not connected, and Stripe may keep charging them.";
  const body =
    `Subscription ids to find in the Stripe dashboard: ${subscriptionIds.join(", ")}. ` +
    "Cancel each one still active, and refund any period charged after the account was deleted.";
  const admins = (await usersRepo(pool).all()).filter(
    (u: any) => (u.role === "admin" || u.role === "founder") && String(u.id) !== userId && !isTombstone({ email: String(u.email ?? "") }),
  );
  for (const admin of admins) {
    await notify({
      userId: String(admin.id),
      type: "payments_alert",
      title,
      body,
      link: "/admin",
      dedupeKey: `erasure-subscriptions-by-hand:${userId}:${admin.id}`,
    });
  }
  /*
   * THIS ROW IS THE OBLIGATION. Nothing else records that these cancels are
   * owed: the step counts itself done, `steps_done` keeps it, and /review,
   * Finish and the hourly job derive what is owed from this row and the
   * cancelled row that later settles it (server/lib/owedCancels.ts).
   *
   * It survives only because it is audience 'admin'. The erasure's own
   * `public-health-events` step deletes rows with audience = 'public' whose
   * actor is the leaver, and on a self-delete the leaver IS this row's actor,
   * so a re-erasure runs that DELETE over it. Widening that DELETE to admin
   * rows would silently drop every owed cancel. Pinned by
   * server/lib/erasure.subscriptions.test.ts.
   *
   * The shape works only because this step is id-only: its re-run needs
   * `liveSubscriptionsOf(pool, userId)` and a Stripe id, never the identity
   * the erasure cleared.
   */
  await recordSubscriptionCancels(pool, { userId, kind: "by-hand", subscriptionIds, actorUserId: actorId });
  console.error(
    `[erasure] Stripe is not connected, so ${subscriptionIds.length} subscription(s) of ${userId} were handed to the admins to cancel by hand`,
  );
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
      // Inside the try (round 5): a note that does not land is this step failing, recorded at once. Outside
      // it, the record showed no failed step and read as possibly running for ten minutes. The step re-runs.
      await noteStepDone(pool, target.id, step.name);
    } catch (err: any) {
      await noteErasureFailed(pool, target.id, step.name, String(err?.message ?? err));
      throw err;
    }
    ran.push(step.name);
  }

  await noteErasureFinished(pool, target.id);
  return { ran, finished: true, external };
}

/**
 * Who this row says the member is, for `member_erasures` to hold, or null when
 * the row is already a tombstone and says nothing true about them.
 */
function identityOf(row: any): ErasedIdentity | null {
  const email = String(row?.email ?? "");
  if (!email || isTombstone({ email })) return null;
  return { name: String(row?.name ?? ""), email, handle: row?.handle == null ? null : String(row.handle) };
}

/**
 * The member as they were before the tombstone, for every step to match by.
 *
 * THE DEFECT THIS CLOSES. A resume re-reads the user row, and after the
 * tombstone that row says "A departed member" at `deleted-<id>@anonymized.invalid`
 * with no handle. Every step that finds the member by name or
 * address (the comms address book, the alignment words, and any step added
 * later) then matched nothing, and the record still read finished.
 *
 * A row that is not a tombstone is the truth and is used as it stands. A
 * tombstone gets back the name, address and handle the first attempt held in
 * `member_erasures.erased_identity` (0282), which the finish clears. Only those
 * three fields come back; the id and every other field stay the row's own. A
 * record from before 0282 holds nothing, and the tombstone is all there is.
 *
 * AN ADDRESS OR HANDLE SOMEBODY ELSE HOLDS NOW IS NOT HANDED BACK. The
 * tombstone frees both, so the person can sign up again with them before the
 * retry comes round, and matching by them then scrubbed the living account's
 * housing request, order and comms contact (round 2, finding 0). Such an
 * address comes back empty, so every step finds the leaver by user id alone,
 * the limit the comms step states; such a handle comes back null. The name
 * still comes back.
 */
async function asTheyWere(pool: Pool, target: any): Promise<any> {
  if (identityOf(target)) return target;
  const held = await erasedIdentity(pool, String(target.id));
  if (!held) return target;
  const taken = await heldByAnotherAccount(pool, String(target.id), { emailKey: emailKeyOf(held.email), handle: held.handle });
  return {
    ...target,
    name: held.name,
    email: taken.email ? "" : held.email,
    handle: taken.handle ? null : held.handle,
  };
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
  opts: { begun?: boolean } = {},
): Promise<ErasureOutcome> {
  // Defensive: every route into here refuses example identities, and if one
  // ever slips through, the scrub would rename the author of every seeded
  // thread and feed post to "A departed member" - irreversibly, since the
  // rename is a write and the seed is only re-applied on a refresh.
  if (isExampleUser(target)) return ASKED_NOBODY;

  if (!opts.begun) await beginMemberErasure(pool, target);
  const result = await runSweep(pool, await asTheyWere(pool, target), actorId, deps, new Set());
  return result.external ?? ASKED_NOBODY;
}

/**
 * Open the erasure record that `anonymizeMember` sweeps under, on its own.
 *
 * For a caller that must open it at one exact moment and sweep after: a
 * resolve opens it while it holds the exit's row (`resolveExit`,
 * server/lib/exitResolve.ts, round 4), so a "They're staying" from then on
 * finds the deletion running and refuses, and one that landed first stops the
 * resolve before any record exists. That caller then passes `begun`. An
 * example identity opens nothing, as `anonymizeMember` erases nothing for one.
 */
export async function beginMemberErasure(pool: Pool, target: any): Promise<void> {
  if (isExampleUser(target)) return;
  await beginErasure(pool, target.id, identityOf(target));
}

/**
 * A sweep that stopped before the close, whose member's departure was then
 * cancelled: they stayed, so it is ended and never run (round 2, finding 1).
 *
 * The exit cancel ends such a record itself now (`cancelExit`,
 * server/lib/exit.ts). A cancel made before it did left the record armed, and
 * without this the next Finish them, pressed for somebody else, restarted it
 * from the top and closed the account of a member who stayed. Only the restart
 * asks, and only for an account that still works: past the tombstone the
 * account is closed and the sweep finishes as before. An erasure asked for
 * again after the cancel moves the record's last attempt past it, so it runs
 * (`stayedSinceLastAttempt`).
 *
 * "PAST THE TOMBSTONE" IS READ OFF THE ACCOUNT, NOT THE RECORD (round 3,
 * finding 17). A record can lack "tombstone" over an account that is one: the
 * write committed and its note was lost (a deploy's SIGTERM can land between
 * them; a note that fails with the process alive is recorded as the step
 * failing since round 5, see `runSweep`), or a second
 * resolve over the closed account emptied the steps and stopped early. The old
 * cancel route flipped such an exit with no look at the account, and this
 * then ended the record of somebody who could no longer sign in, with every
 * step after the tombstone unrun. `cancelExit` refuses a closed account for
 * the same reason (server/lib/exit.ts).
 *
 * The record goes the way the cancel would have taken it (`abandonErasure`);
 * one that may still be running is left alone and still not run.
 */
async function endForAMemberWhoStayed(pool: Pool, userId: string): Promise<SweepResult> {
  const ended = await abandonErasure(pool, userId);
  if (ended.outcome === "abandoned") {
    await recordEvent(pool, {
      kind: "audit",
      text: "member:erasure-abandoned:stayed",
      actorUserId: null,
      entityType: "user",
      entityRef: userId,
      audience: "admin",
    });
  }
  return { ran: [], finished: false, external: null, stayed: true };
}

/**
 * Finish a sweep that stopped part way.
 *
 * WHO CALLS THIS. Nothing else will ever erase these members again, because
 * they are already gone, so something has to come back for them. Two things
 * do. The retry button on /review (`server/routes/erasureQueue.ts`), pressed by
 * a steward, finishes any sweep. The hourly failed-actions job
 * (`server/lib/failedActions.ts`) finishes only a sweep that stopped AFTER the
 * tombstone step, when the account is already closed, and its header says why
 * it goes no further than that.
 *
 * RE-READS THE MEMBER rather than taking one. The record outlives the request
 * that made it, and the row may have been tombstoned by the attempt that
 * failed, so the only honest source for "who is this" is the database now,
 * with the name and address the tombstone took handed back (`asTheyWere`).
 *
 * BEFORE THE TOMBSTONE, A RESUME STARTS AGAIN FROM THE TOP. The tombstone is
 * where the member's sessions die, so until it lands the account works and
 * the member can write behind any step already recorded as done: a contact
 * request, a thank-you naming them, a skill tag, a bell notice to a neighbour.
 * Skipping those steps by name left the words standing for good, which
 * "member-agent-after-tombstone" fixed for the agent tables alone. Every step is
 * idempotent by the rule this list's header states, so running them all again
 * costs only the writes that match something. Past the tombstone nothing can
 * write any more, and the record's steps are skipped as they always were.
 *
 * A RESTART NEVER RUNS FOR A MEMBER WHO STAYED: a departure cancelled after
 * the sweep stopped ends the record instead (`endForAMemberWhoStayed`). A
 * closed account cannot have stayed, whatever its record's steps say, so its
 * restart runs to the end.
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

  const done = new Set(record?.stepsDone ?? []);
  const restart = !done.has("tombstone");
  const closed = isTombstone({ email: String(target.email ?? "") });
  if (restart && !closed && (await stayedSinceLastAttempt(pool, userId))) return endForAMemberWhoStayed(pool, userId);
  await noteResumeAttempt(pool, userId, { restart, identity: identityOf(target) });
  // The actor is the village rather than a person: a resume is the queue
  // finishing an obligation, and attributing it to whoever pressed the button
  // would put their name on an act somebody else began.
  return runSweep(pool, await asTheyWere(pool, target), null, deps, restart ? new Set() : done);
}

/*
 * ══ A FINISHED ERASURE, GIVEN THE STEPS IT PREDATES ════════════════════════
 *
 * THE GAP. `resumeErasure` returns at `finishedAt`, and neither the queue nor
 * the hourly job reads a finished record, so a step added to this list after
 * a member's sweep finished never ran for them. A sweep that finished before
 * "member-agent-after-tombstone" kept the agent tokens minted in the window
 * before the tombstone; one that finished before "invites-after-tombstone"
 * kept their open links letting people in; and so on down the list.
 * `steps_done` survives the finish, so what a record lacks can be read off it.
 *
 * WHAT RUNS. Steps after the tombstone, the ones written for an account that
 * can no longer act, and of those only the ones that find what they reach by
 * the member's user id. A finished record holds no name or address any more
 * (`noteErasureFinished` clears them, and the user row is the tombstone), so
 * the target here is the tombstone and nothing else. A step that also matches
 * by address (comms, the guest places, the housing scrub, the order address)
 * finds what is keyed on the account and nothing by address, which is the
 * limit a resume of a record from before 0282 already has. Those are named in
 * `BACKFILL_BY_ID`; a step that finds nothing without the name is named in
 * `BACKFILL_LEAVES_OUT` with why. The backfill test holds every step after the
 * tombstone to exactly one of the two, so a step added later fails it until
 * whoever adds the step decides which. Neither is a default.
 *
 * IN THE SWEEP'S ORDER, FROM THE SWEEP'S OWN LIST. The same closures run, so a
 * backfilled step cannot drift from the step it stands for, and a step that
 * reads a row before another scrubs it (housing contacts before the housing
 * scrub) still reads it first.
 *
 * NO VALUE MOVES TWICE. Four of these give a fee back or seat somebody from a
 * queue: the places at gatherings, the guest-era places, the guest places of
 * a second housing address, and the meet-me windows. Each claims a held
 * charge before it posts a refund leg under the charge's own key, and deletes
 * the answers it frees (`releasePlacesOf`, `removeGatheringRows`), so a run
 * after a lost note finds no answer to free and no held charge to claim, the
 * ledger refuses the key a second time, and escrow cannot pay out what it no
 * longer holds. The backfill test runs them twice over a neighbour's fee.
 *
 * WHAT IT RECORDS. Each step that lands is appended to `steps_done` on a record
 * that is still finished, and `finished_at` stays where the sweep put it
 * (`noteBackfilledStep`). A member given any step gets one audit line,
 * `member:erasure-backfilled`. A tombstone with no record at all is an erasure
 * from before 0195, and is given a finished record first, with no attempts on
 * it, so what ran is written down the same way and a second run reads it done.
 *
 * WHAT IT NEVER RUNS. Anything before the tombstone or the tombstone itself,
 * which were written for an account that still worked. Four of those came
 * after some records had finished ("quest-proposals", "org-drafts",
 * "proposal-drafts", "alignment-party-left"), and whether a finished record is
 * given them is Rye's to decide (raised 2026-10-24). The audit line, which
 * would say a second time that an erasure happened. And the outside stores,
 * which were asked when the sweep finished and are the /review button's to
 * ask again. An open record is the queue's.
 */

/**
 * Steps after the tombstone a finished erasure is given when its record lacks
 * them: each finds what it reaches by the member's user id. The sweep's list
 * decides the order they run in; this decides only which.
 */
export const BACKFILL_BY_ID: ReadonlySet<string> = new Set([
  "handle-after-tombstone",
  "member-agent-after-tombstone",
  "guest-places-after-tombstone",
  "comms",
  "needs-after-tombstone",
  "journal-after-tombstone",
  "invites-after-tombstone",
  "saberra-bridge-after-tombstone",
  "seat-application-words-after-tombstone",
  "meet-me-windows-after-tombstone",
  "notices-naming-after-tombstone",
  "ballot-words-after-tombstone",
  "proposal-ballot-words-after-tombstone",
  "exit-notes-after-tombstone",
  "relayed-mail-after-tombstone",
  "checkin-notes-after-tombstone",
  "pulse-lines-naming-after-tombstone",
  "submission-words-after-tombstone",
  "season-plan-words-after-tombstone",
  "role-tensions-after-tombstone",
  "event-places-after-tombstone",
  "housing-contacts-after-tombstone",
  "housing-reservations-after-tombstone",
  "vouches-after-tombstone",
  "conversations-after-tombstone",
  "delegations-after-tombstone",
  "ventures-after-tombstone",
  "investor-fact-words-after-tombstone",
  "stay-notes-after-tombstone",
  "purchase-emails-after-tombstone",
  "role-proposals-after-tombstone",
  "seat-journal-after-tombstone",
  "seat-claims-after-tombstone",
  "org-seatings-after-tombstone",
  "role-holdings-after-tombstone",
  "sessions-after-tombstone",
  "gene-keys-after-tombstone",
  "quest-crews-after-tombstone",
  "quest-claims-after-tombstone",
  "photo-report-reasons-after-tombstone",
  "session-cards-after-tombstone",
  "reward-moments-after-tombstone",
  "companions-after-tombstone",
  "member-asks-after-tombstone",
  "product-subscriptions-after-tombstone",
]);

/** Steps after the tombstone a finished erasure is never given, and why. */
export const BACKFILL_LEAVES_OUT: Readonly<Record<string, string>> = {
  "alignment-names-after-tombstone":
    "it finds the member in other people's words by the name and handle the tombstone took, and a finished record holds neither",
  audit: "the sweep wrote its line when it finished, and a second would say the erasure happened twice",
  [EXTERNAL_STEP]: "the outside stores were asked when the sweep finished, and asking them again is the /review button's job",
};

/** Every step name in the order the sweep runs them, the outside stores last. */
export function sweepStepNames(): string[] {
  return [...sweepSteps(null as unknown as Pool, { id: "" }, null, {} as ErasureDeps).map((s) => s.name), EXTERNAL_STEP];
}

/** The steps a finished erasure is given when its record lacks them, in sweep order. */
export function backfillStepNames(): string[] {
  const names = sweepSteps(null as unknown as Pool, { id: "" }, null, {} as ErasureDeps).map((s) => s.name);
  return names.slice(names.indexOf("tombstone") + 1).filter((name) => BACKFILL_BY_ID.has(name));
}

/**
 * The runOnce id the boot job is recorded under, one per list of steps it
 * gives. A step added to that list later changes the id, so the next boot runs
 * the job again and every finished record is given the new step too; one that
 * already holds a step skips it, so a rerun costs a read per member.
 */
export function erasureBackfillJob(): string {
  const digest = createHash("sha256").update([...backfillStepNames()].sort().join("\n")).digest("hex").slice(0, 12);
  return `erasure-steps-backfill-${digest}`;
}

/**
 * Give one finished erasure every step after the tombstone that its record
 * lacks and that finds its rows by user id. Returns the steps it ran.
 *
 * Runs nothing for a member whose row is gone, is an example, or is not a
 * tombstone, or whose record is open. A step that throws stops this member
 * here, with every step before it already noted, and the error names it.
 */
export async function backfillFinishedErasure(pool: Pool, userId: string, deps: ErasureDeps): Promise<string[]> {
  const target = await deps.members.byId(userId);
  if (!target || isExampleUser(target) || !isTombstone({ email: String(target.email ?? "") })) return [];
  let record = await erasureRecord(pool, userId);
  if (!record) {
    await openBackfillRecord(pool, userId);
    record = await erasureRecord(pool, userId);
  }
  if (!record?.finishedAt) return [];

  const done = new Set(record.stepsDone);
  const wanted = new Set(backfillStepNames());
  const ran: string[] = [];
  try {
    for (const step of sweepSteps(pool, target, null, deps)) {
      if (!wanted.has(step.name) || done.has(step.name)) continue;
      try {
        await step.run();
      } catch (err: any) {
        throw new Error(`step "${step.name}": ${String(err?.message ?? err)}`);
      }
      await noteBackfilledStep(pool, userId, step.name);
      ran.push(step.name);
    }
  } finally {
    if (ran.length) {
      await recordEvent(pool, {
        kind: "audit",
        text: "member:erasure-backfilled",
        actorUserId: null,
        entityType: "user",
        entityRef: userId,
        audience: "admin",
      });
    }
  }
  return ran;
}

/** What one run of the boot job did, counted. */
export interface ErasureBackfillCounts {
  /** Finished erasures read, tombstones with no record among them. */
  read: number;
  /** Members given at least one step. */
  given: number;
  /** Steps run, across every member. */
  steps: number;
  /** Members a step stopped part way, left for the next boot. */
  stopped: number;
}

/**
 * THE BOOT JOB: every finished erasure, given the steps it predates.
 *
 * Registered through `runOnce` in server/index.ts, LATE in boot, after the
 * waitlist's promotion sink and the comms dispatcher are wired, because a seat
 * this frees tells whoever it goes to the way any promotion does.
 *
 * One member's failure stops only that member. The rest still run, and then
 * this throws, so `runOnce` leaves the job unrecorded and the next boot runs
 * it again; what already landed is noted, so that run starts where this one
 * stopped.
 */
export async function backfillFinishedErasures(
  pool: Pool,
  deps: ErasureDeps,
  log: (line: string) => void = console.log,
): Promise<ErasureBackfillCounts> {
  const subjects = await finishedErasureSubjects(pool);
  const counts: ErasureBackfillCounts = { read: subjects.length, given: 0, steps: 0, stopped: 0 };
  for (const userId of subjects) {
    try {
      const ran = await backfillFinishedErasure(pool, userId, deps);
      if (ran.length) {
        counts.given += 1;
        counts.steps += ran.length;
      }
    } catch (err: any) {
      counts.stopped += 1;
      console.error(`[erasure] the backfill stopped for ${userId} at ${String(err?.message ?? err)}. The next boot tries again.`);
    }
  }
  log(
    `[erasure] finished-erasure backfill: ${counts.read} finished erasure(s) read, ${counts.given} given ` +
      `${counts.steps} step(s) they predate, ${counts.stopped} stopped part way.`,
  );
  if (counts.stopped) throw new Error(`${counts.stopped} finished erasure(s) stopped part way, so the job stays unrecorded for the next boot`);
  return counts;
}

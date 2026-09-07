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
 * WHAT IT DELIBERATELY KEEPS. Value rows stay: the ledger, gratitude, claims,
 * loans, orders and badge awards are the village's record of what happened and
 * what is owed, and deleting them would break the conservation proof.
 *
 * ORDER IS LOAD-BEARING. The local sweep runs to completion FIRST, then the
 * outside stores are asked, so a slow or refusing vendor never delays the one
 * deletion this deployment fully controls.
 *
 * The five injected dependencies are repositories and locks that live in
 * `server/index.ts` as module-local singletons. They are passed rather than
 * imported because constructing a second `dbCollection` over the same table
 * would give this function its own cache, and two caches over one table is the
 * defect `check-repo-payloads` and the store's own header both exist to
 * prevent.
 */
import type { Pool } from "mysql2/promise";
import { forgetStewardActs } from "./stewardship";
import { eraseIntentsForMember } from "./intents";
import { forgetMemberNeeds } from "./needs";
import { isExampleUser } from "./examples";
import { forgetMemberInProposals } from "./externalProposals";
import { forgetMemberEverywhere, type ErasureOutcome } from "./memberDrivers";
import { recordEvent } from "./events";
import { releaseSeatingsForUser } from "./orgChart";

export type ErasureDeps = {
  /** The users repository. Its `update` writes the tombstone. */
  members: { update(id: string, fn: (u: any) => void): Promise<unknown> };
  /** Submissions, scrubbed of PII keys while the proposal content stays. */
  submissionsRepo: { all(): unknown[]; replaceAll(rows: unknown[]): Promise<unknown> };
  /** Permission holdings, which end here. The org chart is a different plane. */
  roleHoldersRepo: { replaceAll(rows: unknown[]): Promise<unknown> };
  withRoleHolderLock: <T>(fn: () => Promise<T>) => Promise<T>;
  loadRoleHolders: () => Array<{ userId: string }>;
};

export async function anonymizeMember(
  pool: Pool,
  target: any,
  actorId: string | null,
  deps: ErasureDeps,
): Promise<ErasureOutcome> {
  const { members, submissionsRepo, roleHoldersRepo, withRoleHolderLock, loadRoleHolders } = deps;
  // Defensive: every route into here refuses example identities, and if one
  // ever slips through, the scrub would rename the author of every seeded
  // thread and feed post to "A departed member" — irreversibly, since the
  // rename is a write and the seed is only re-applied on a refresh.
  if (isExampleUser(target)) return { asked: [], confirmed: [], unconfirmed: [] };
  const anon = "A departed member";

  // Ledger descriptions first, while gratitude_log still links names to refs.
  await pool.query( // module-review-ok: the ledger DESCRIPTION only, never an amount; value rows are deliberately kept and this rewrites the sentence that names a departed member
    "UPDATE token_ledger SET description = 'Gratitude from a departed member' " + // module-review-ok: same statement as the line above, a description rewrite rather than a write to the ledger's value columns
      "WHERE source IN ('gratitude_received','heart_received') " +
      "AND source_ref IN (SELECT id FROM gratitude_log WHERE from_id = ?)",
    [target.id],
  );
  await pool.query("UPDATE gratitude_log SET from_name = ? WHERE from_id = ?", [anon, target.id]); // module-review-ok: gratitude_log stores from_name as text beside the id, so de-attribution alone would leave the name; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
  await pool.query("UPDATE gratitude_log SET to_name = ? WHERE to_id = ?", [anon, target.id]); // module-review-ok: gratitude_log stores to_name the same way; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
  await pool.query("UPDATE quest_claims SET user_name = ? WHERE user_id = ?", [anon, target.id]); // module-review-ok: quest_claims stores user_name as text; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
  await pool.query("DELETE FROM notifications WHERE user_id = ?", [target.id]); // module-review-ok: notifications for a departed member are deleted outright; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
  // De-attribution is not enough: the TEXT restates the person. A restorative
  // intake notification carries "A private intake from <their full name>" in
  // the title and up to 2000 characters of their message in the body, and
  // nulling the actor id leaves every word of that in the steward's inbox.
  await pool.query( // module-review-ok: the notification TITLE and BODY restate the person in their own words, so nulling the actor id is not enough; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
    "UPDATE notifications SET actor_user_id = NULL, title = 'A message from a departed member', body = NULL WHERE actor_user_id = ?",
    [target.id],
  );
  await pool.query("UPDATE tool_clicks SET user_id = NULL WHERE user_id = ?", [target.id]); // module-review-ok: tool_clicks is de-attributed rather than deleted, because the count is a real metric; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
  await pool.query("DELETE FROM health_events WHERE audience = 'public' AND actor_user_id = ?", [target.id]); // module-review-ok: a public health event naming a departed member is removed; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on

  // Governance free text: the acts a departing member WROTE keep their shape
  // and lose their words, because what the village stopped is the village's
  // record and the sentence about a neighbour is the member's.
  //
  // PORTED ON MERGE. This call was added to the copy of anonymizeMember that
  // lived in server/index.ts while main was extracting that function to this
  // file. Taking main's deletion of the inline copy without moving this line
  // across would have dropped a member's erasure right silently, which is the
  // one class of merge loss nobody would have noticed from a green suite.
  await forgetStewardActs(pool, target.id);

  // Scrub PII keys inside submissions they authored; the proposal content
  // itself stays part of the village record.
  const submissions = submissionsRepo.all();
  let scrubbed = false;
  for (const s of submissions as any[]) {
    if (s.userId !== target.id) continue;
    s.userName = anon;
    if (s.data && typeof s.data === "object") {
      for (const k of ["name", "firstName", "lastName", "email", "phone", "whatsapp", "telegram"]) {
        if (k in s.data) s.data[k] = "[removed at member's request]";
      }
    }
    scrubbed = true;
  }
  if (scrubbed) await submissionsRepo.replaceAll(submissions);

  await withRoleHolderLock(async () => {
    const holders = loadRoleHolders().filter((h) => h.userId !== target.id);
    await roleHoldersRepo.replaceAll(holders);
  });

  // The line above ends PERMISSION holdings. The org chart is the other plane
  // called "role" (ARCHITECTURE §3.15) and shares nothing with it, so it went
  // on holding a departed member's seat under their real user id while
  // /api/org republished it to everyone with map.viewPeople.
  await releaseSeatingsForUser(pool, target.id, "member left the village");

  /*
   * THE TRACES A TOMBSTONE DOES NOT COVER.
   *
   * Most identity here is a join: forum posts and quest claims carry only an
   * `author_id`, so once the user row becomes a tombstone they read as "a
   * departed member" for free. The rows below are the ones that do NOT work
   * that way — they either restate the person independently of the users
   * table, or they keep a live channel open to them after they have gone.
   *
   * Value rows stay, as always: the ledger, gratitude, claims, loans, orders
   * and badge awards are the village's record of what happened and what is
   * owed, and deleting those would break the conservation proof.
   */
  // Claims a person made ABOUT THEMSELVES, published in a searchable
  // directory that joins straight back to users. Nothing else republishes
  // them, so nothing else would ever remove them.
  await pool.query("DELETE FROM skill_tags WHERE user_id = ?", [target.id]); // module-review-ok: skill_tags are claims a person made about themselves in a searchable directory, and nothing else would ever remove them; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
  // A live push endpoint is a route to somebody's phone. Leaving it meant a
  // "deleted" member could still be buzzed by the village they left.
  await pool.query("DELETE FROM push_subscriptions WHERE user_id = ?", [target.id]); // module-review-ok: a live push endpoint is a route to somebody's phone after they have left; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
  // Same reasoning, quieter channel: an unmuted thread subscription keeps
  // generating notifications for an account that no longer exists.
  await pool.query("DELETE FROM forum_subscriptions WHERE user_id = ?", [target.id]); // module-review-ok: an unmuted subscription keeps generating notifications for an account that no longer exists; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
  // The proof-of-ownership challenge tying a wallet address to this person.
  await pool.query("DELETE FROM wallet_challenges WHERE user_id = ?", [target.id]); // module-review-ok: the proof-of-ownership challenge tying a wallet to this person; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
  // Free text they wrote, in their own words. The row is kept — the funnel
  // it belongs to is a real metric — but the sentence goes, and so does the
  // attribution, because a question can identify its asker on its own.
  await pool.query( // module-review-ok: free text the member wrote, cleared while the funnel row it belongs to stays; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
    "UPDATE concierge_queries SET query = '[removed with the member]', user_id = NULL WHERE user_id = ?",
    [target.id],
  );
  await pool.query( // module-review-ok: the message body of a contact request, in their own words; the erasure sweep reaches tables that have no repo, and one repo per table would still not give the single enumerable sweep the leaving-well promise depends on
    "UPDATE contact_requests SET message = '[removed with the member]' WHERE from_user_id = ?",
    [target.id],
  );
  // Intents are the same class of trace: their own words about what they
  // sought and offered, plus every matcher sentence where they were a party.
  await eraseIntentsForMember(pool, target.id);
  // member_needs (0167) says "Only you can read this", so it goes too.
  await forgetMemberNeeds(pool, target.id);
  // A vendor's record naming this member, holding a verbatim quote about
  // them. Absent from this sweep until now, so it survived a departure, and
  // absent from the export too, which together made three published promises
  // quietly false for anybody a module had written about. Drops the subject
  // rows AND clears the quote, for the reason stated twenty lines above: the
  // TEXT restates the person.
  await forgetMemberInProposals(pool, target.id);

  await members.update(target.id, (u: any) => {
    u.name = anon;
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

  await recordEvent(pool, {
    kind: "audit",
    text: "member:anonymized",
    actorUserId: actorId,
    entityType: "user",
    entityRef: target.id,
    audience: "admin",
  });

  // ── Lane C: the stores outside this village ────────────────────────────────
  // Asked AFTER the local sweep, so a slow or refusing driver never delays the
  // one deletion this deployment fully controls.
  const external = await forgetMemberEverywhere(pool, target.id);
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
      entityRef: target.id,
      audience: "admin",
    });
    console.error(
      `[erasure] "${miss.module}" did not confirm deletion for ${target.id}: ${miss.detail}. This village still owes that member a confirmation`,
    );
  }
  return external;
  // ── End Lane C zone ────────────────────────────────────────────────────────
}

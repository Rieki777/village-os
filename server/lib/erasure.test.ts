/**
 * An erasure that is INTERRUPTED, and what a resume does about it.
 *
 * ── WHY THIS FILE EXISTS AND WHAT IT REFUSES TO TEST ─────────────────────
 *
 * "It works when nothing fails" is what the code already did. `anonymizeMember`
 * was a bare sequence of about twenty writes with no transaction, no error
 * handling and no record of itself, and a happy-path test over it passes
 * whether or not the resumable half exists. So every case here breaks the
 * sequence in the middle on purpose and then asserts the two things that
 * decide whether "we delete your account" is true:
 *
 *   WHAT SURVIVED THE FAILURE. Not the scrub, which any test can check, but
 *   the RECORD: that a sweep began, that it did not finish, and which step it
 *   stopped at. Without that the half-erased member is invisible and nothing
 *   will ever come back for them.
 *
 *   WHAT A RESUME DOES. That the steps after the break land on the second
 *   attempt, that the ones before it are not the reason it works (they are
 *   idempotent and are proved so by running the whole sweep twice), and that a
 *   finished sweep stays finished.
 *
 * ── WHY THE INTERRUPTION IS A DEPENDENCY AND NOT A MOCKED QUERY ──────────
 *
 * `roleHoldersRepo.replaceAll` is a dependency this function is HANDED, so a
 * test can make it throw without patching a module, without a spy on `pool`,
 * and without teaching the test anything about the order of statements inside
 * a step. What it costs is that the break always lands at the same place, so
 * a second case breaks the tombstone instead, which is the other side of the
 * ordering: an account that still works against an account that does not.
 *
 * ── WHY A REAL DATABASE ──────────────────────────────────────────────────
 *
 * Every claim here is about rows: which tables were scrubbed, which were not,
 * and what `member_erasures` holds afterwards. A stand-in pool would let this
 * file pass while the sweep wrote nothing anywhere. No TEST_DATABASE_URL and
 * the suite skips (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { agentRowsRemaining } from "../repos/memberAgent";
import { anonymizeMember, resumeErasure, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord, noteStepDone, unfinishedErasures } from "../repos/memberErasure";
import { saveMemberNeed } from "./needs";
import { queueFeedback, saveEntry, savePrefs } from "./journal";
import { addEntry, closeSession, ensureMemberNo, joinSession, patchEntry, respond, saveArrival, startSession } from "./liveSessions";
import { answerTask } from "./sessionTasks";
import { reserveSend } from "./sessionTaskMail";
import { sessionIdsNaming } from "../repos/liveSessions";
import * as portraits from "../repos/characterPortraits";
import { charactersForMember } from "../repos/playerCharacters";
import { landPublicSubmission } from "./publicForms";

const configured = testDbConfigured();
const VILLAGE = "local";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir: string;

/** Whatever the fake submissions repository is holding this case. */
let submissions: any[] = [];

/**
 * The five singletons plus the volume, with one seam a case can break.
 *
 * `usersRepo` is the real one, because the tombstone is a write this suite
 * asserts on and a fake would let the assertion pass over nothing.
 */
function deps(broken?: "role-holdings" | "tombstone", beforeTombstone?: () => Promise<void>): ErasureDeps {
  const real = usersRepo(pool);
  let lived = true;
  return {
    members: {
      byId: (id: string) => real.byId(id),
      update: async (id: string, fn: (u: any) => void) => {
        if (broken === "tombstone") throw new Error("the member row would not take the tombstone");
        // The last instant the member's sessions still live, before the
        // sweep's first write to the row (the tombstone). A write here is one
        // a signed-in request could make; "handle-after-tombstone" writes the
        // row again after they died, so this does not fire again.
        if (lived) {
          lived = false;
          await beforeTombstone?.();
        }
        return real.update(id, fn);
      },
    },
    submissionsRepo: {
      all: () => submissions,
      replaceAll: async (rows: unknown[]) => {
        submissions = rows as any[];
      },
    },
    roleHoldersRepo: {
      remove: async () => {
        if (broken === "role-holdings") throw new Error("the role holder write was refused");
      },
    },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

async function q(sql: string, params: any[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

/** A member carrying one trace in each table the sweep reaches from a different step. */
async function seedMember(id: string): Promise<any> {
  await q(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, "Wren Halloway", `${id}@examples.invalid`],
  );
  // Step "skill-tags": a claim they made about themselves, before the break.
  await q("INSERT INTO `skill_tags` (`id`, `user_id`, `tag`) VALUES (?,?,?)", [`st-${id}`, id, "beekeeping"]);
  // Step "push-subscriptions": a live route to their phone, after the break.
  await q(
    "INSERT INTO `push_subscriptions` (`id`, `user_id`, `endpoint`, `p256dh`, `auth`) VALUES (?,?,?,?,?)",
    [`ps-${id}`, id, `https://push.invalid/${id}`, "k", "a"],
  );
  // Step "character-sheet": the body they chose, and the pointer that publishes it.
  await q(
    "INSERT INTO `player_characters` (`id`,`village_id`,`user_id`,`archetype_key`,`presentation`,`tone`) " +
      "VALUES (?,?,?,?,?,?)",
    [`pc-${id}`, VILLAGE, id, "building", "f", "olive"],
  );
  await q("UPDATE `users` SET `primary_character_id` = ? WHERE `id` = ?", [`pc-${id}`, id]);
  // Step "portraits": a published face, with real bytes on the volume.
  const fileName = `portrait-${id}.webp`;
  fs.writeFileSync(path.join(uploadsDir, fileName), Buffer.from("not really a picture"));
  await portraits.upsertPortrait(pool, {
    id: `cp-${id}`,
    villageId: VILLAGE,
    userId: id,
    archetypeKey: "building",
    fileName,
    source: "uploaded",
    width: 512,
    height: 512,
    bytes: 20,
  });
  await portraits.setPublished(pool, VILLAGE, id, "building", true);
  await portraits.loadCounters(pool, VILLAGE, id);

  submissions = [{ id: `sub-${id}`, userId: id, userName: "Wren Halloway", data: { email: "wren@examples.invalid" } }];
  const target = await usersRepo(pool).byId(id);
  return target;
}

const portraitFileExists = (id: string) => fs.existsSync(path.join(uploadsDir, `portrait-${id}.webp`));

describe.skipIf(!configured)("an erasure that stops part way", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-"));
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  beforeEach(async () => {
    // No driver is registered, so the external step asks nobody and confirms
    // nothing. That is the ordinary shape of a village with no module
    // connected, and it keeps these cases about the LOCAL sweep.
    clearMemberDrivers();
    await q("DELETE FROM `member_erasures`");
  });

  it("records where it stopped, leaves the later steps undone, and rethrows", async () => {
    const id = "er-broken-1";
    const target = await seedMember(id);

    await expect(anonymizeMember(pool, target, "admin-1", deps("role-holdings"))).rejects.toThrow(
      /role holder write was refused/,
    );

    const record = await erasureRecord(pool, id);
    expect(record).not.toBeNull();
    expect(record!.startedAt).toBeTruthy();
    // The whole finding in one assertion: an erasure that did not finish says
    // so, and says where. Before 0195 this row did not exist and the member was
    // half-erased with nothing anywhere recording it.
    expect(record!.finishedAt).toBeNull();
    expect(record!.failedStep).toBe("role-holdings");
    expect(record!.lastError).toContain("role holder write was refused");
    expect(record!.attempts).toBe(1);

    // Everything BEFORE the break landed.
    expect(record!.stepsDone).toContain("notifications");
    expect(record!.stepsDone).toContain("submissions");
    expect(submissions[0].userName).toBe("A departed member");
    // Everything AFTER it did not, which is what makes this a half-erasure.
    expect(record!.stepsDone).not.toContain("skill-tags");
    expect(await q("SELECT `id` FROM `skill_tags` WHERE `user_id` = ?", [id])).toHaveLength(1);
    expect(await q("SELECT `id` FROM `push_subscriptions` WHERE `user_id` = ?", [id])).toHaveLength(1);
    expect(await charactersForMember(pool, id)).toHaveLength(1);
    expect(await portraits.portraitsForMember(pool, id)).toHaveLength(1);
    expect(portraitFileExists(id)).toBe(true);
    // The account still works. A sweep that dies before the tombstone leaves a
    // member who can sign in, which is the better half to be left in.
    const stillThere = await usersRepo(pool).byId(id);
    expect(stillThere!.name).toBe("Wren Halloway");
  });

  it("shows up in the queue of sweeps nobody finished", async () => {
    const id = "er-broken-2";
    const target = await seedMember(id);
    await expect(anonymizeMember(pool, target, null, deps("role-holdings"))).rejects.toThrow();

    const stalled = await unfinishedErasures(pool);
    expect(stalled.map((r) => r.userId)).toContain(id);
    expect(stalled.find((r) => r.userId === id)!.failedStep).toBe("role-holdings");
  });

  it("finishes the rest on a resume, and stops being outstanding", async () => {
    const id = "er-resume-1";
    const target = await seedMember(id);
    await expect(anonymizeMember(pool, target, null, deps("role-holdings"))).rejects.toThrow();
    const before = await erasureRecord(pool, id);

    const out = await resumeErasure(pool, id, deps());

    expect(out.finished).toBe(true);
    // FROM THE TOP, because the break came before the tombstone. Until then
    // the account worked, so a step recorded as done proves nothing about
    // what the member wrote since, and every step runs again (they are
    // idempotent, as the next cases prove). That the record IS read shows on
    // a resume past the tombstone, which skips what it holds: the pinned list
    // below for "tombstone" itself, and erasure.identity.test.ts for the rest.
    expect(out.ran[0]).toBe("ledger-descriptions");
    expect(out.ran).toContain("notifications");
    expect(out.ran).toContain("role-holdings");
    expect(out.ran).toContain("portraits");
    // And the record says what this attempt did, once each.
    const ranOnce = (await erasureRecord(pool, id))!.stepsDone;
    expect(ranOnce).toEqual(out.ran);

    const after = await erasureRecord(pool, id);
    expect(after!.finishedAt).toBeTruthy();
    expect(after!.failedStep).toBeNull();
    expect(after!.attempts).toBe(2);
    // The age is the age of the OBLIGATION and never of the last attempt.
    expect(after!.startedAt).toBe(before!.startedAt);
    expect(await unfinishedErasures(pool)).toHaveLength(0);

    // And the steps that had never run, ran.
    expect(await q("SELECT `id` FROM `skill_tags` WHERE `user_id` = ?", [id])).toHaveLength(0);
    expect(await q("SELECT `id` FROM `push_subscriptions` WHERE `user_id` = ?", [id])).toHaveLength(0);
    const tombstoned = await usersRepo(pool).byId(id);
    expect(tombstoned!.name).toBe("A departed member");
  });

  it("revokes the face on the resume: rows, budget and the bytes on the volume", async () => {
    const id = "er-face-1";
    const target = await seedMember(id);
    await expect(anonymizeMember(pool, target, null, deps("role-holdings"))).rejects.toThrow();
    expect(portraitFileExists(id)).toBe(true);

    await resumeErasure(pool, id, deps());

    expect(await portraits.portraitsForMember(pool, id)).toHaveLength(0);
    expect(await portraits.grantsForMember(pool, id)).toHaveLength(0);
    expect(await charactersForMember(pool, id)).toHaveLength(0);
    expect((await q("SELECT `primary_character_id` AS p FROM `users` WHERE `id` = ?", [id]))[0].p).toBeNull();
    // The row going is not the revocation. `/api/uploads/:filename` has no
    // sign-in in front of it, so while the bytes are there the address a
    // stranger wrote down still works.
    expect(portraitFileExists(id)).toBe(false);
  });

  it("STOPS AT A FILE THAT WILL NOT COME OFF, keeps the rows naming it, and the resume takes it down", async () => {
    // This used to log the failure and record the step as done, AFTER the rows
    // naming the file had already been deleted, so nothing could ever find the
    // file again and `/api/uploads/:filename` went on serving it. A directory
    // standing where the file was makes unlink refuse with something other than
    // ENOENT on every platform (EPERM on Windows and macOS, EISDIR on Linux).
    const id = "er-stuck-file-1";
    const target = await seedMember(id);
    const onVolume = path.join(uploadsDir, `portrait-${id}.webp`);
    fs.rmSync(onVolume, { force: true });
    fs.mkdirSync(onVolume);

    await expect(anonymizeMember(pool, target, null, deps())).rejects.toThrow(/could not take .* off the volume/);

    const record = await erasureRecord(pool, id);
    expect(record!.failedStep).toBe("portraits");
    expect(record!.finishedAt).toBeNull();
    expect(record!.stepsDone).not.toContain("portraits");
    // The rows are still there, which is the only way a resume finds the file.
    expect(await portraits.portraitsForMember(pool, id)).toHaveLength(1);

    // Whatever stood in the way clears, and the picture is still on the volume.
    fs.rmdirSync(onVolume);
    fs.writeFileSync(onVolume, Buffer.from("still a picture"));

    const out = await resumeErasure(pool, id, deps());
    expect(out.finished).toBe(true);
    expect(out.ran).toContain("portraits");
    expect(portraitFileExists(id)).toBe(false);
    expect(await portraits.portraitsForMember(pool, id)).toHaveLength(0);
    expect(await portraits.grantsForMember(pool, id)).toHaveLength(0);
  });

  it("is safe to resume twice, and a finished sweep stays finished", async () => {
    const id = "er-resume-2";
    const target = await seedMember(id);
    await expect(anonymizeMember(pool, target, null, deps("role-holdings"))).rejects.toThrow();
    await resumeErasure(pool, id, deps());
    const first = await erasureRecord(pool, id);

    const again = await resumeErasure(pool, id, deps());

    expect(again.finished).toBe(true);
    expect(again.ran).toEqual([]);
    // Nothing was re-run, so nothing was re-counted.
    expect((await erasureRecord(pool, id))!.attempts).toBe(first!.attempts);
    expect((await erasureRecord(pool, id))!.finishedAt).toBe(first!.finishedAt);
  });

  it("every step can run twice, which is the whole resume guarantee", async () => {
    const id = "er-idempotent-1";
    const target = await seedMember(id);

    await anonymizeMember(pool, target, null, deps());
    const once = await erasureRecord(pool, id);
    expect(once!.finishedAt).toBeTruthy();

    // The SECOND full sweep is the assertion. Every step is keyed on this
    // member and writes either a deletion or a constant, so running the whole
    // thing again over an already-erased member has to be uneventful. If any
    // step ever stops being idempotent this is where it shows, and the resume
    // guarantee dies with it.
    const fresh = await usersRepo(pool).byId(id);
    await anonymizeMember(pool, fresh, null, deps());

    const twice = await erasureRecord(pool, id);
    expect(twice!.finishedAt).toBeTruthy();
    expect(twice!.failedStep).toBeNull();
    expect(twice!.attempts).toBe(2);
    expect(await q("SELECT `id` FROM `skill_tags` WHERE `user_id` = ?", [id])).toHaveLength(0);
    expect((await usersRepo(pool).byId(id))!.name).toBe("A departed member");
  });

  it("takes the member's name off a quest idea they sent through the form, and keeps the idea", async () => {
    // The idea waits in /review, and its words are part of the village record,
    // the rule the submission it came from already follows. Its author is not.
    const id = "er-idea-1";
    const target = await seedMember(id);
    const idea = {
      id: `sub-idea-${id}`,
      type: "quest-proposal",
      userId: id,
      userName: "Wren Halloway",
      data: {
        name: "Wren Halloway",
        email: "wren@examples.invalid",
        title: "Mend the long bench",
        whatYouWantToDo: "Sand and oil the bench by the pond.",
      },
    };
    await landPublicSubmission({ insert: async (e) => void submissions.push(e) }, pool, idea);
    const ref = `submission:${idea.id}`;
    expect(await q("SELECT `proposed_by` FROM `quest_proposals` WHERE `source_ref` = ?", [ref])).toEqual([
      { proposed_by: id },
    ]);

    await anonymizeMember(pool, target, null, deps());

    expect(await q("SELECT `title`, `proposed_by` FROM `quest_proposals` WHERE `source_ref` = ?", [ref])).toEqual([
      { title: "Mend the long bench", proposed_by: null },
    ]);
    expect((await erasureRecord(pool, id))!.stepsDone).toContain("quest-proposals");
    // The submission it came from is scrubbed by its own step, as it always was.
    expect(submissions.find((s) => s.id === idea.id).data.email).toBe("[removed at member's request]");
  });

  /*
   * THE LOST NOTE (round 3's open problem, closed in round 5). The step's write
   * commits, then the UPDATE that notes it done fails: a dropped connection, a
   * deploy's SIGTERM. `noteStepDone` sat outside the step's try, so nothing
   * recorded the failure, and the record read as possibly running for ten
   * minutes with no failed step until somebody pressed Finish them.
   *
   * The pool here is the real one with one statement refused: the note for
   * "skill-tags". Everything else, the step's own write included, lands.
   */
  it("a step whose note is lost is recorded as the failed step, at once", async () => {
    const id = "er-lost-note-1";
    const target = await seedMember(id);
    const losing = new Proxy(pool, {
      get(t, p) {
        const v = Reflect.get(t, p, t);
        if (p !== "query") return typeof v === "function" ? v.bind(t) : v;
        return (sql: unknown, params?: unknown) =>
          typeof sql === "string" && sql.includes("JSON_ARRAY_APPEND") && Array.isArray(params) && params[0] === "skill-tags"
            ? Promise.reject(new Error("the connection dropped before the note landed"))
            : (t.query as any)(sql, params);
      },
    }) as mysql.Pool;

    await expect(anonymizeMember(losing, target, null, deps())).rejects.toThrow(/before the note landed/);

    const record = await erasureRecord(pool, id);
    // The step ran, and its write is there.
    expect(await q("SELECT `id` FROM `skill_tags` WHERE `user_id` = ?", [id])).toHaveLength(0);
    // And the record says where it stopped, which is what makes it truthful now and not in ten minutes.
    expect(record!.finishedAt).toBeNull();
    expect(record!.failedStep).toBe("skill-tags");
    expect(record!.lastError).toContain("before the note landed");
    expect(record!.stepsDone).not.toContain("skill-tags");

    const out = await resumeErasure(pool, id, deps());
    expect(out.finished).toBe(true);
    expect((await erasureRecord(pool, id))!.failedStep).toBeNull();
  });

  it("records a break AFTER the tombstone, where the account is already gone", async () => {
    const id = "er-late-1";
    const target = await seedMember(id);

    await expect(anonymizeMember(pool, target, null, deps("tombstone"))).rejects.toThrow(
      /would not take the tombstone/,
    );

    const record = await erasureRecord(pool, id);
    expect(record!.failedStep).toBe("tombstone");
    expect(record!.finishedAt).toBeNull();
    // The other half of the ordering: everything local has been scrubbed and
    // the account still exists. Loud, recorded, and finishable.
    expect(record!.stepsDone).toContain("portraits");
    expect(portraitFileExists(id)).toBe(false);
    expect((await usersRepo(pool).byId(id))!.name).toBe("Wren Halloway");

    const out = await resumeErasure(pool, id, deps());
    expect(out.finished).toBe(true);
    // The comms rows, the needs deletion and the journal deletion sit after the
    // tombstone, so a break AT the tombstone leaves them undone and the resume
    // runs them. The tombstone never landed, so the account still worked and
    // the resume starts again from the top: every step before it runs a second
    // time, for anything the member wrote in between. The ORDER here is the
    // order erasure.ts declares its steps in, ALL of them, so every new step
    // has to be named here; the merge of wt/comms with main checks it against
    // the source below.
    expect(out.ran).toEqual([
      "ledger-descriptions",
      "gratitude-names",
      "quest-claim-names",
      "notifications",
      "tool-clicks",
      "public-health-events",
      "steward-acts",
      "submissions",
      "quest-proposals",
      "alignment-party-left",
      "role-holdings",
      "org-seatings",
      "org-drafts",
      "proposal-drafts",
      "skill-tags",
      "push-subscriptions",
      "forum-subscriptions",
      "wallet-challenges",
      "concierge-queries",
      "contact-requests",
      "intents",
      "module-records",
      "member-agent",
      "companions",
      "character-sheet",
      "portraits",
      "tombstone",
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
      "alignment-names-after-tombstone",
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
      "audit",
      "product-subscriptions-after-tombstone",
      "external-stores",
    ]);
    expect((await usersRepo(pool).byId(id))!.name).toBe("A departed member");
  });

  /*
   * A NEEDS ANSWER SAVED WHILE THE SWEEP RUNS.
   *
   * The member's sessions die at the tombstone, so until then
   * `PUT /api/needs/mine` still takes their answers. When the needs deletion
   * ran BEFORE the tombstone, a sweep that stopped at the tombstone had already
   * marked it done, the member answered again, and the resume skipped the
   * deletion and left the answer standing for good. `member_needs` tells its
   * member "Only you can read this", and the village would have kept it.
   */
  describe("a needs answer written before the member's sessions die", () => {
    const needsRowsFor = async (id: string) =>
      Number((await q("SELECT COUNT(*) AS n FROM `member_needs` WHERE `user_id` = ?", [id]))[0].n);

    it("is gone after a resume, when it landed after the sweep began and before the tombstone", async () => {
      const id = "er-needs-window-1";
      const target = await seedMember(id);
      await expect(anonymizeMember(pool, target, null, deps("tombstone"))).rejects.toThrow(
        /would not take the tombstone/,
      );

      // Still signed in, so this is a write the real route would take.
      const saved = await saveMemberNeed(pool, id, {
        needKey: "love",
        depth: "deprived",
        note: "written after the sweep began",
      });
      expect(saved.ok, "the fixture must put a row there, or the zero below proves nothing").toBe(true);
      expect(await needsRowsFor(id)).toBe(1);

      await resumeErasure(pool, id, deps());

      expect(await needsRowsFor(id)).toBe(0);
    });

    it("is gone after one uninterrupted sweep, when it landed at the last instant a session lived", async () => {
      const id = "er-needs-window-2";
      const target = await seedMember(id);
      let wrote = false;

      await anonymizeMember(
        pool,
        target,
        null,
        deps(undefined, async () => {
          const saved = await saveMemberNeed(pool, id, { needKey: "play", depth: "unmet" });
          wrote = saved.ok;
        }),
      );

      expect(wrote, "the fixture must put a row there, or the zero below proves nothing").toBe(true);
      expect(await needsRowsFor(id)).toBe(0);
    });

    it("re-runs the deletion on a record written while the step was still called needs", async () => {
      const id = "er-needs-old-record-1";
      const target = await seedMember(id);
      await expect(anonymizeMember(pool, target, null, deps("tombstone"))).rejects.toThrow();
      // What a record from the old order holds: the step under its old name,
      // marked done while the member could still write.
      await noteStepDone(pool, id, "needs");
      await saveMemberNeed(pool, id, { needKey: "growth", depth: "alive" });
      expect(await needsRowsFor(id)).toBe(1);

      const out = await resumeErasure(pool, id, deps());

      expect(out.ran).toContain("needs-after-tombstone");
      expect(await needsRowsFor(id)).toBe(0);
    });
  });

  /*
   * THE JOURNAL LEAVES WITH ITS MEMBER, all four tables, feedback both ways.
   *
   * Asserts the ROWS, never that the step ran: a step that ran and deleted
   * from the wrong column reports the same "done". A neighbour who stays keeps
   * everything of theirs that does not name the leaver.
   */
  it("takes their unfinished proposals with them, a half-written seat application included (red team S2)", async () => {
    const id = "er-drafts-1";
    const neighbour = "er-drafts-neighbour";
    const target = await seedMember(id);
    for (const [draftId, owner] of [["pd-er-1", id], ["pd-er-2", neighbour]] as const) {
      await q("INSERT INTO `proposal_drafts` (`id`, `user_id`, `wizard_type`, `payload`, `step_index`) VALUES (?,?,?,?,?)", [
        draftId, owner, "role_application", JSON.stringify({ fitStatement: "I kept the orchard ledger." }), 2,
      ]);
    }
    // CONTROL: the draft is there before the sweep.
    expect(await q("SELECT `id` FROM `proposal_drafts` WHERE `user_id` = ?", [id])).toHaveLength(1);
    await anonymizeMember(pool, target, null, deps());
    expect(await q("SELECT `id` FROM `proposal_drafts` WHERE `user_id` = ?", [id])).toHaveLength(0);
    expect((await erasureRecord(pool, id))!.stepsDone).toContain("proposal-drafts");
    expect(await q("SELECT `id` FROM `proposal_drafts` WHERE `user_id` = ?", [neighbour])).toHaveLength(1);
  });

  it("takes the journal with them: entries, pulse, the feedback yes, and feedback both ways", async () => {
    const id = "er-journal-1";
    const neighbour = "er-journal-neighbour";
    const target = await seedMember(id);
    const tz = "UTC";
    await saveEntry(pool, id, {
      clientId: "c-1", practice: "pulse", depth: "light", writtenAt: new Date().toISOString(),
      answers: [{ questionKey: "help-most", prompt: "What would help?", text: "rest" }],
      scores: { load: 4 },
    }, tz);
    await saveEntry(pool, neighbour, {
      clientId: "c-n", practice: "free", depth: "light", writtenAt: new Date().toISOString(),
      answers: [{ questionKey: "free", prompt: "What is on your mind?", text: "mine" }],
    }, tz);
    await savePrefs(pool, id, { open: true, style: "direct", note: "" });
    await savePrefs(pool, neighbour, { open: true, style: "gentle", note: "" });
    const parts = { observation: "o", feeling: "f", need: "n", request: "r" };
    const sent = await queueFeedback(pool, id, { recipientId: neighbour, ...parts }, "to the neighbour", { timeZone: tz, recipientName: "N" });
    const got = await queueFeedback(pool, neighbour, { recipientId: id, ...parts }, "to the leaver", { timeZone: tz, recipientName: "W" });
    expect(sent.ok && got.ok, "the fixture must queue both, or the zeros below prove nothing").toBe(true);
    const named = async () =>
      Number((await q(
        "SELECT (SELECT COUNT(*) FROM `journal_entries` WHERE `user_id` = ?) + " +
          "(SELECT COUNT(*) FROM `journal_pulse` WHERE `user_id` = ?) + " +
          "(SELECT COUNT(*) FROM `journal_feedback_prefs` WHERE `user_id` = ?) + " +
          "(SELECT COUNT(*) FROM `journal_feedback` WHERE `author_id` = ? OR `recipient_id` = ?) AS n",
        [id, id, id, id, id],
      ))[0].n);
    expect(await named()).toBe(5);

    await anonymizeMember(pool, target, null, deps());

    expect(await named()).toBe(0);
    expect((await erasureRecord(pool, id))!.stepsDone).toContain("journal-after-tombstone");
    // The neighbour keeps their own entry and their own yes.
    expect(await q("SELECT `id` FROM `journal_entries` WHERE `user_id` = ?", [neighbour])).toHaveLength(1);
    expect(await q("SELECT `user_id` FROM `journal_feedback_prefs` WHERE `user_id` = ?", [neighbour])).toHaveLength(1);
  });

  /*
   * LIVE SESSIONS: THE MEMBER LEAVES EVERY ROOM, AND THE RECORD FORGETS THEM.
   *
   * Asserts the ROWS and the stored MINUTES. A closed record keeps its minutes
   * as text, so deleting the rows alone would leave the name in the record:
   * de-attribution is not erasure. A neighbour who stays keeps their own
   * words and their place in the room.
   */
  it("takes them out of every live session, and writes the closed record again without their name", async () => {
    const id = "er-sessions-1";
    const neighbour = "er-sessions-neighbour";
    const target = await seedMember(id);
    await q(
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [neighbour, "Rowan Ashby", `${neighbour}@examples.invalid`],
    );
    const lookup = (uid: string) => usersRepo(pool).byId(uid);
    const leaverNo = await ensureMemberNo(pool, id);
    const neighbourNo = await ensureMemberNo(pool, neighbour);
    const leaver = { no: leaverNo, admin: false };
    const stays = { no: neighbourNo, admin: false };

    // A closed session the leaver opened and facilitated, wrote a proposal in,
    // gave a closing word in, and left holding the neighbour's action.
    const closedId = await startSession(pool, leaverNo, { title: "Orchard circle", circleId: null, durationMin: 30 });
    expect((await joinSession(pool, closedId, neighbourNo)).ok).toBe(true);
    await saveArrival(pool, closedId, leaver, { score: 6, wish: "a long walk" });
    const proposal = await addEntry(pool, closedId, leaver, { kind: "decision", text: "We prune in the dry season" });
    const action = await addEntry(pool, closedId, stays, { kind: "action", text: "Sharpen the shears" });
    const note = await addEntry(pool, closedId, stays, { kind: "note", text: "The pears came early" });
    expect(proposal.ok && action.ok && note.ok, "the fixture must write all three").toBe(true);
    if (!proposal.ok || !action.ok || !note.ok) return;
    expect((await patchEntry(pool, closedId, leaver, action.value.id, { claim: true })).ok).toBe(true);
    // An action the leaver wrote, which the neighbour holds.
    const theirs = await addEntry(pool, closedId, leaver, { kind: "action", text: "Mend the gate" });
    expect(theirs.ok, "the fixture must write it").toBe(true);
    if (!theirs.ok) return;
    expect((await patchEntry(pool, closedId, stays, theirs.value.id, { claim: true })).ok).toBe(true);
    await respond(pool, closedId, stays, { target: `decision:${proposal.value.id}`, value: "consent" });
    await respond(pool, closedId, leaver, { target: "word", value: "rooted" });
    expect((await closeSession(pool, closedId, leaver, { lookup, circleName: () => null })).ok).toBe(true);
    // After the call: the leaver moves the date on the task they hold, with a
    // line of their own; the neighbour answers the one the leaver wrote; the
    // leaver presses Send the task emails.
    const tasks = { lookup, circleName: () => null };
    const moved = await answerTask(pool, { userId: id, admin: false }, action.value.id, { op: "not_yet", version: 1, dueOn: "2099-01-01", note: "After the rain" }, tasks);
    const finished = await answerTask(pool, { userId: neighbour, admin: false }, theirs.value.id, { op: "done", version: 1 }, tasks);
    expect(moved.ok && finished.ok, "the fixture must answer both").toBe(true);
    await reserveSend(pool, closedId, leaverNo);
    // And an open one they are still sitting in.
    const openId = await startSession(pool, neighbourNo, { title: "Orchard circle, again", circleId: null, durationMin: 30 });
    expect((await joinSession(pool, openId, leaverNo)).ok).toBe(true);

    const minutes = async () => String((await q("SELECT `minutes_people` FROM `live_sessions` WHERE `id` = ?", [closedId]))[0].minutes_people);
    expect(await minutes(), "the fixture must name them, or the absence below proves nothing").toContain("Wren Halloway");
    const named = async () =>
      Number((await q(
        "SELECT (SELECT COUNT(*) FROM `live_session_people` WHERE `member_no` = ?) + " +
          "(SELECT COUNT(*) FROM `live_session_responses` WHERE `member_no` = ?) + " +
          "(SELECT COUNT(*) FROM `live_session_entries` WHERE `author_no` = ? OR `owner_no` = ?) + " +
          "(SELECT COUNT(*) FROM `live_sessions` WHERE `facilitator_no` = ? OR `created_by_no` = ? OR `secretary_no` = ?) + " +
          "(SELECT COUNT(*) FROM `live_session_members` WHERE `user_id` = ?) + " +
          "(SELECT COUNT(*) FROM `live_session_task_state` WHERE `owner_no` = ? OR `changed_by_no` = ?) + " +
          "(SELECT COUNT(*) FROM `live_session_task_events` WHERE `by_no` = ? OR `owner_no` = ?) + " +
          "(SELECT COUNT(*) FROM `live_session_task_sends` WHERE `sent_by_no` = ?) AS n",
        [leaverNo, leaverNo, leaverNo, leaverNo, leaverNo, leaverNo, leaverNo, id, leaverNo, leaverNo, leaverNo, leaverNo, leaverNo],
      ))[0].n);
    expect(await named()).toBeGreaterThan(0);
    // The erasure finds every session the task layer names them in.
    expect(await sessionIdsNaming(pool, leaverNo)).toContain(closedId);

    await anonymizeMember(pool, target, null, deps());

    expect(await named()).toBe(0);
    expect((await erasureRecord(pool, id))!.stepsDone).toContain("sessions-after-tombstone");
    // The task layer. The task they wrote went with its entry, state and answers both.
    expect(await q("SELECT `entry_id` FROM `live_session_task_state` WHERE `entry_id` = ?", [theirs.value.id])).toEqual([]);
    expect(await q("SELECT `id` FROM `live_session_task_events` WHERE `entry_id` = ?", [theirs.value.id])).toEqual([]);
    // The task they held is back with the circle, and their answer keeps its kind and loses their name and their words.
    expect(await q("SELECT `status`, `owner_no`, `owner_seat_id`, `changed_by_no`, `latest_note` FROM `live_session_task_state` WHERE `entry_id` = ?", [action.value.id])).toEqual([
      { status: "open", owner_no: null, owner_seat_id: null, changed_by_no: 0, latest_note: null },
    ]);
    expect(await q("SELECT `kind`, `by_no`, `note` FROM `live_session_task_events` WHERE `entry_id` = ?", [action.value.id])).toEqual([
      { kind: "not_yet", by_no: 0, note: null },
    ]);
    // The send they pressed reads as nobody's.
    expect(await q("SELECT `send_no`, `sent_by_no` FROM `live_session_task_sends` WHERE `session_id` = ?", [closedId])).toEqual([{ send_no: 1, sent_by_no: 0 }]);
    // The answers to the proposal they wrote went with it.
    expect(await q("SELECT `id` FROM `live_session_responses` WHERE `target` = ?", [`decision:${proposal.value.id}`])).toEqual([]);
    // The record is written again from what is left.
    const after = await minutes();
    expect(after).not.toContain("Wren Halloway");
    expect(after).not.toContain("We prune in the dry season");
    expect(after).toContain("Facilitated by A member.");
    expect(after).toContain("Present: Rowan Ashby.");
    expect(after).toContain("Sharpen the shears, held by nobody yet.");
    // The neighbour keeps their words and their place in both rooms.
    expect(await q("SELECT `id` FROM `live_session_entries` WHERE `author_no` = ?", [neighbourNo])).toHaveLength(2);
    expect(await q("SELECT `session_id` FROM `live_session_people` WHERE `member_no` = ? ORDER BY `session_id`", [neighbourNo])).toEqual([
      { session_id: closedId },
      { session_id: openId },
    ]);
  });

  it("says so rather than pretending, when there is no member left to resume", async () => {
    const id = "er-gone-1";
    const target = await seedMember(id);
    await expect(anonymizeMember(pool, target, null, deps("role-holdings"))).rejects.toThrow();
    await q("DELETE FROM `users` WHERE `id` = ?", [id]);

    const out = await resumeErasure(pool, id, deps());

    expect(out.finished).toBe(false);
    expect((await erasureRecord(pool, id))!.failedStep).toBe("load-member");
    // Still outstanding, because it is. A resume that reported success here
    // would clear the one row that says somebody is owed something.
    expect((await unfinishedErasures(pool)).map((r) => r.userId)).toContain(id);
  });

  it("takes the member's own agent with them: inbox, queue, key, drafts, tokens, note and statements", async () => {
    /*
     * THE GAP A REVIEWER FOUND BY ASKING WHAT A MEMBER OWNS, rather than by
     * reading the step list. The sweep was rewritten into named steps and the
     * list named exactly the tables the prompting findings had named; these four
     * were in neither. Enumerating a sweep makes it LOOK complete, which is how
     * the omission survived a rewrite whose purpose was completeness.
     *
     * The inbox is the sharp one: `agent-week-ahead` selects
     * `FROM agent_inboxes WHERE enabled = 1` with no join to `users`, so this
     * row standing meant a departed member's endpoint kept receiving the
     * village's payloads. `member_llm_keys` holds their third-party API key.
     *
     * `agent_tokens` was missed the same way, later: a `vat_` token is not a
     * session, so the tombstone's tokenVersion bump never reached it, and the
     * token kept reading the calendar and the directory as the erased member.
     *
     * ASSERTS COMPLETENESS, NOT THAT THE STEP RAN. "It did not throw" is what
     * the sweep already reported before these tables were in it.
     */
    const id = "er-agent-1";
    const target = await seedMember(id);

    // Every NOT NULL column is supplied and every enum value is a real member
    // of its set. Strict MySQL REFUSES a row that is missing either, so a
    // fixture that guesses does not insert a partial row, it inserts nothing —
    // and the assertion below would then pass over an empty table.
    await pool.query(
      "INSERT INTO `agent_inboxes` (`id`, `user_id`, `url`, `enabled`) VALUES (?,?,?,1)",
      [`inbox-${id}`, id, "https://example.test/hook"],
    );
    await pool.query(
      "INSERT INTO `agent_deliveries` (`id`, `inbox_id`, `kind`, `payload`) VALUES (?,?,?,?)",
      [`del-${id}`, `inbox-${id}`, "week-ahead", JSON.stringify({ note: "queued" })],
    );
    await pool.query(
      "INSERT INTO `member_llm_keys` (`user_id`, `provider`, `ciphertext`, `iv`, `tag`, `last4`) VALUES (?,?,?,?,?,?)",
      [id, "anthropic", "cipher", "iv", "tag", "abcd"],
    );
    await pool.query(
      "INSERT INTO `member_drafts` (`id`, `user_id`, `kind`, `payload`, `source`, `status`) VALUES (?,?,?,?,?,?)",
      [`draft-${id}`, id, "note", JSON.stringify({ body: "unsent" }), "assistant", "proposed"],
    );
    await pool.query( // module-review-ok: a fixture seeding member_drafts before erasure, not a product read path
      "INSERT INTO `agent_tokens` (`id`, `user_id`, `name`, `token_hash`, `prefix`, `scopes`, `expires_at`) VALUES (?,?,?,?,?,?, UTC_TIMESTAMP() + INTERVAL 90 DAY)",
      [`tok-${id}`, id, "laptop agent", "a".repeat(64), "vat_abcdef", JSON.stringify(["calendar.read"])],
    );
    await pool.query( // module-review-ok: a fixture seeding agent_tokens before erasure, not a product read path
      "INSERT INTO `agent_profiles` (`user_id`, `about_me`, `about_tier`) VALUES (?,?,?)",
      [id, "I garden on Tuesdays and I am learning Spanish.", "assistant"],
    );
    await pool.query( // module-review-ok: a fixture seeding agent_profiles before erasure, not a product read path
      "INSERT INTO `assistant_statements` (`id`, `subject_user_id`, `mode`, `text`) VALUES (?,?,?,?)",
      [`stmt-${id}`, id, "member", "You garden on Tuesdays."],
    );

    const before = await agentRowsRemaining(pool, id);
    expect(
      before,
      "the fixture must actually put rows there, or the assertion below passes over nothing",
    ).toEqual({ deliveries: 1, inboxes: 1, keys: 1, drafts: 1, tokens: 1, profiles: 1, statements: 1 });

    await anonymizeMember(pool, target, "admin-1", deps());

    expect(await agentRowsRemaining(pool, id)).toEqual({
      deliveries: 0,
      inboxes: 0,
      keys: 0,
      drafts: 0,
      tokens: 0,
      profiles: 0,
      statements: 0,
    });
  });
});

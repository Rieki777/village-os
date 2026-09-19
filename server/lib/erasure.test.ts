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
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { agentRowsRemaining } from "../repos/memberAgent";
import { anonymizeMember, resumeErasure, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord, noteStepDone, unfinishedErasures } from "../repos/memberErasure";
import { saveMemberNeed } from "./needs";
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
  return {
    members: {
      byId: (id: string) => real.byId(id),
      update: async (id: string, fn: (u: any) => void) => {
        if (broken === "tombstone") throw new Error("the member row would not take the tombstone");
        // The last instant the member's sessions still live. A write here is
        // one a signed-in request could make.
        await beforeTombstone?.();
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
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
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
    // Only what was left. A resume that re-ran the whole sweep would still be
    // correct, and would prove nothing about the record having been read.
    expect(out.ran).toContain("role-holdings");
    expect(out.ran).toContain("portraits");
    expect(out.ran).not.toContain("notifications");

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
    // The needs deletion sits after the tombstone, so a break AT the tombstone
    // leaves it undone and the resume runs it.
    expect(out.ran).toEqual(["tombstone", "needs-after-tombstone", "audit", "external-stores"]);
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

  it("takes the member's own agent with them: inbox, queue, key and drafts", async () => {
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

    const before = await agentRowsRemaining(pool, id);
    expect(
      before,
      "the fixture must actually put rows there, or the assertion below passes over nothing",
    ).toEqual({ deliveries: 1, inboxes: 1, keys: 1, drafts: 1 });

    await anonymizeMember(pool, target, "admin-1", deps());

    expect(await agentRowsRemaining(pool, id)).toEqual({
      deliveries: 0,
      inboxes: 0,
      keys: 0,
      drafts: 0,
    });
  });
});

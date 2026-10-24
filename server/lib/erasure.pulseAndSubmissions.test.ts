/**
 * WHAT AN ERASED MEMBER STILL LEFT IN TWO PLACES OTHER PEOPLE READ, after the
 * sweep finished (adversarial round 2, findings 7 and 11).
 *
 *   7. The public pulse kept every line that named them with somebody else as
 *      its actor: "Ann appreciated Wren", "Wren joined the Stewards", "Wren sits
 *      in Steward, by a vote of the whole village." `GET /api/game/pulse` serves
 *      those to a signed-out visitor. The one pulse step deleted only the lines
 *      whose ACTOR was the member, and only while their sessions still lived.
 *  11. The admin inbox kept the member's own words on every submission they
 *      sent (a raised hand's note, a seat claim's recorded name, why they asked
 *      to join and how they heard of the village), kept everything they sent
 *      signed out under their address in full, and Sent mail kept the team
 *      alert's subject naming them.
 *
 * EVERY CLAIM IS ABOUT ROWS, read the way their readers read them: the pulse
 * through `recentEvents`, the very read `GET /api/game/pulse` makes, and the
 * inbox through the repository the admin route returns whole. Each case reads
 * the leftover first, so a zero afterwards cannot be a fixture that never
 * landed, and each carries a bystander whose rows of the same shape must come
 * through untouched.
 *
 * WHAT A LIVING MEMBER RELIES ON is asserted beside each fix: a line somebody
 * else wrote keeps its row, its actor and its time, and the village's active
 * count does not move; a submission keeps its row and the values its queue
 * reads.
 *
 * A real database, for the reason `erasure.test.ts` gives. No
 * TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { anonymizeMember, resumeErasure, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import { recentEvents } from "./events";
import { countActiveMembers } from "../repos/mapStats";
import { ERASED_SUBJECT } from "../repos/commsPeople";
import { forgetPulseLinesNaming } from "../repos/pulseLines";

const configured = testDbConfigured();
const VILLAGE = "local";
const REMOVED = "[removed at member's request]";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";

/**
 * The submissions table as the server's repository serves it: `all()` hands
 * out copies, so a scrub that is never written back changes nothing, exactly
 * as `dbCollection` behaves (server/repos/store-db.ts).
 */
let submissions: any[] = [];
let refuseNextWrite = false;

function deps(beforeTombstone?: () => Promise<void>): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: {
      byId: (id: string) => real.byId(id),
      update: async (id: string, fn: (u: any) => void) => {
        // The last instant the member's sessions still live.
        await beforeTombstone?.();
        return real.update(id, fn);
      },
    },
    submissionsRepo: {
      all: () => structuredClone(submissions),
      replaceAll: async (rows: unknown[]) => {
        if (refuseNextWrite) {
          refuseNextWrite = false;
          throw new Error("injected fault: the submissions write was refused");
        }
        submissions = structuredClone(rows as any[]);
      },
    },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

async function person(id: string, name: string, email = `${id}@example.test`): Promise<void> {
  await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, name, email]);
}

async function erase(id: string, hook?: () => Promise<void>): Promise<void> {
  const target = await usersRepo(pool).byId(id);
  expect(target, `${id} must exist before it is erased`).toBeTruthy();
  await anonymizeMember(pool, target, "r2-admin", deps(hook));
  expect((await erasureRecord(pool, id))?.finishedAt, `${id}'s sweep must finish`).toBeTruthy();
}

/** One health_events row, written with every column the spine writes, an hour in the past. */
async function line(row: {
  id: string;
  kind: string;
  text: string;
  actor: string | null;
  entityType: string | null;
  entityRef: string | null;
  audience?: "public" | "admin";
  minutesAgo?: number;
}): Promise<void> {
  await q(
    "INSERT INTO health_events (id, kind, text, actor_user_id, actor_kind, entity_type, entity_ref, audience, at) " +
      "VALUES (?,?,?,?,'human',?,?,?, CURRENT_TIMESTAMP - INTERVAL ? MINUTE)",
    [row.id, row.kind, row.text, row.actor, row.entityType, row.entityRef, row.audience ?? "public", row.minutesAgo ?? 60],
  );
}

/** The pulse, read the way `GET /api/game/pulse` reads it. */
const pulse = async (): Promise<string[]> => (await recentEvents(pool, "public", 500)).map((e) => e.text);

const rowOf = async (id: string) =>
  (await q("SELECT text, actor_user_id AS actor, kind, UNIX_TIMESTAMP(at) AS t FROM health_events WHERE id = ?", [id]))[0];

/** A `comms_messages` row of the given shape. Every NOT NULL column is supplied. */
async function mail(row: { id: string; origin: string; subject: string; to?: string; hoursAgo?: number }): Promise<void> {
  const to = row.to ?? "team@village.test";
  await q(
    "INSERT INTO comms_messages (id, village_id, idempotency_key, to_email, email_key, kind, origin, subject, status, created_at) " +
      "VALUES (?,?,?,?,?,'essential',?,?,'sent', CURRENT_TIMESTAMP - INTERVAL ? MINUTE)",
    [row.id, VILLAGE, `essential:${row.id}`, to, to.toLowerCase(), row.origin, row.subject, Math.round((row.hoursAgo ?? 0) * 60)],
  );
}

const subjectOf = async (id: string): Promise<string> => String((await q("SELECT subject FROM comms_messages WHERE id = ?", [id]))[0]?.subject);

/**
 * The pool, except that the first statement `match` names throws, once: a
 * query that never came back, with everything before it landed. The same
 * shape server/lib/erasure.ownedRows.resume.test.ts breaks its steps with.
 */
function faultOnce(real: mysql.Pool, match: (sql: string) => boolean): mysql.Pool {
  let fired = false;
  return new Proxy(real, {
    get(t: any, prop) {
      if (prop === "query" || prop === "execute") {
        return async (sql: unknown, params?: unknown) => {
          const text = typeof sql === "string" ? sql : String((sql as any)?.sql ?? "");
          if (!fired && match(text)) {
            fired = true;
            throw new Error(`injected fault on: ${text.slice(0, 80)}`);
          }
          return t[prop](sql, params);
        };
      }
      const v = Reflect.get(t, prop, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

describe.skipIf(!configured)("what an erased member left on the pulse and in the inbox", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-r2h3-"));
    clearMemberDrivers();
    await person("r2-admin", "Avery Steward");
    await person("r2-closer", "Sam Closer");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  // ── 7 ─────────────────────────────────────────────────────────────────────
  describe("7: the public pulse", () => {
    it("takes their name off every line somebody else wrote about them, and the living actor keeps the line", async () => {
      const wren = "r2-p-wren";
      const ann = "r2-p-ann";
      const bay = "r2-p-bay";
      await person(wren, "Wren Halloway");
      await person(ann, "Ann Ash");
      await person(bay, "Bay Holt");

      // Exactly as the gratitude route writes it (server/index.ts): actor the sender, the recipient as the entity.
      await line({ id: "pe-grat-w", kind: "gratitude", text: "Ann appreciated Wren", actor: ann, entityType: "user", entityRef: wren });
      // The three role producers, as they write a line now: the member they seat, unseat or appoint is the entity.
      await line({ id: "pe-join-w", kind: "role", text: "Wren joined the Stewards", actor: "r2-admin", entityType: "user", entityRef: wren });
      await line({ id: "pe-seat-w", kind: "governance", text: "Wren sits in Steward, by a vote of the whole village.", actor: "r2-closer", entityType: "user", entityRef: wren });
      await line({ id: "pe-unseat-w", kind: "governance", text: "Wren no longer sits in Steward, by a vote of the whole village.", actor: "r2-closer", entityType: "user", entityRef: wren });
      // The bystander's lines of every same shape, the control.
      await line({ id: "pe-grat-b", kind: "gratitude", text: "Ann appreciated Bay", actor: ann, entityType: "user", entityRef: bay });
      await line({ id: "pe-join-b", kind: "role", text: "Bay joined the Stewards", actor: "r2-admin", entityType: "user", entityRef: bay });

      expect((await pulse()).filter((t) => t.includes("Wren")), "the control: four lines name them today").toHaveLength(4);
      const before = await rowOf("pe-grat-w");
      const window = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
      const activeBefore = await countActiveMembers(pool, window.from, window.to);
      expect(activeBefore, "the control: Ann, the admin and the closer are active").toBeGreaterThanOrEqual(3);

      await erase(wren);

      expect((await pulse()).filter((t) => t.includes("Wren")), "no public line names them").toEqual([]);
      // Ann's line is still Ann's, at the time it happened: nothing a living member did is taken off the record.
      expect(await rowOf("pe-grat-w")).toEqual({ text: "Ann appreciated a departed member", actor: ann, kind: "gratitude", t: before.t });
      expect((await rowOf("pe-join-w")).text).toBe("A departed member joined the Stewards");
      expect((await rowOf("pe-seat-w")).text).toBe("A departed member sits in Steward, by a vote of the whole village.");
      expect((await rowOf("pe-unseat-w")).text).toBe("A departed member no longer sits in Steward, by a vote of the whole village.");
      expect(await countActiveMembers(pool, window.from, window.to), "the village's active count does not move").toBe(activeBefore);
      expect((await rowOf("pe-grat-b")).text).toBe("Ann appreciated Bay");
      expect((await rowOf("pe-join-b")).text).toBe("Bay joined the Stewards");

      // A second sweep changes nothing, byte for byte.
      const once = await pulse();
      await erase(wren);
      expect(await pulse()).toEqual(once);
    });

    it("finds the role lines written before they recorded a subject: a vote's by the audit row beside it, an appointment's by its words", async () => {
      const wren = "r2-old-wren";
      const bay = "r2-old-bay";
      await person(wren, "Wren Marsh");
      await person(bay, "Bay Fenn");
      // Two seats filled by one landing, a minute apart at most: the same role, two members.
      await line({ id: "po-seat-w", kind: "governance", text: "Wren sits in Hearth, by a vote of the whole village.", actor: "r2-closer", entityType: "role", entityRef: "role-hearth" });
      await line({ id: "pa-seat-w", kind: "audit", text: `role:seated-by-ballot:role-hearth:${wren}:bal-w`, actor: "r2-closer", entityType: "role", entityRef: "role-hearth", audience: "admin" });
      await line({ id: "po-seat-b", kind: "governance", text: "Bay sits in Hearth, by a vote of the whole village.", actor: "r2-closer", entityType: "role", entityRef: "role-hearth" });
      await line({ id: "pa-seat-b", kind: "audit", text: `role:seated-by-ballot:role-hearth:${bay}:bal-b`, actor: "r2-closer", entityType: "role", entityRef: "role-hearth", audience: "admin" });
      // Taken back later, by another vote.
      await line({ id: "po-unseat-w", kind: "governance", text: "Wren no longer sits in Hearth, by a vote of the whole village.", actor: "r2-closer", entityType: "role", entityRef: "role-hearth", minutesAgo: 30 });
      await line({ id: "pa-unseat-w", kind: "audit", text: `role:unseated-by-ballot:role-hearth:${wren}:bal-w2`, actor: "r2-closer", entityType: "role", entityRef: "role-hearth", audience: "admin", minutesAgo: 30 });
      // An admin's appointment, which wrote nothing beside its line.
      await line({ id: "po-join-w", kind: "role", text: "Wren joined the Gardeners", actor: "r2-admin", entityType: "role", entityRef: "role-gardeners" });
      await line({ id: "po-join-b", kind: "role", text: "Bay joined the Gardeners", actor: "r2-admin", entityType: "role", entityRef: "role-gardeners" });

      const mine = ["po-seat-w", "po-unseat-w", "po-join-w"];
      const textsOfMine = async () => (await recentEvents(pool, "public", 500)).filter((e) => mine.includes(e.id)).map((e) => e.text);
      expect((await textsOfMine()).filter((t) => t.startsWith("Wren ")), "the control: all three name them on the pulse today").toHaveLength(3);

      await erase(wren);

      expect((await textsOfMine()).filter((t) => t.includes("Wren")), "none of them names them now").toEqual([]);
      expect((await rowOf("po-seat-w")).text).toBe("A departed member sits in Hearth, by a vote of the whole village.");
      expect((await rowOf("po-unseat-w")).text).toBe("A departed member no longer sits in Hearth, by a vote of the whole village.");
      expect((await rowOf("po-join-w")).text).toBe("A departed member joined the Gardeners");
      // The other member seated by the same landing, and appointed the same way, keeps their name.
      expect((await rowOf("po-seat-b")).text).toBe("Bay sits in Hearth, by a vote of the whole village.");
      expect((await rowOf("po-join-b")).text).toBe("Bay joined the Gardeners");
      // The admin trail is the legal record, and keeps its rows as they were.
      expect((await rowOf("pa-seat-w")).text).toBe(`role:seated-by-ballot:role-hearth:${wren}:bal-w`);
    });

    it("leaves an older appointment line alone when a living member has the same first name, and still reaches every line found by id", async () => {
      const juno = "r2-nm-juno";
      const namesake = "r2-nm-juno-oak";
      const ann = "r2-nm-ann";
      await person(juno, "Juno Byrne");
      await person(namesake, "Juno Oak");
      await person(ann, "Ann Reed");
      // Nothing says whose this is: it reads the same written for either Juno.
      await line({ id: "pn-join", kind: "role", text: "Juno joined the Bakers", actor: "r2-admin", entityType: "role", entityRef: "role-bakers" });
      await line({ id: "pn-grat", kind: "gratitude", text: "Ann appreciated Juno", actor: ann, entityType: "user", entityRef: juno });
      await line({ id: "pn-grat-oak", kind: "gratitude", text: "Ann appreciated Juno", actor: ann, entityType: "user", entityRef: namesake });

      await erase(juno);

      expect((await rowOf("pn-join")).text, "a living member's line is never called departed").toBe("Juno joined the Bakers");
      expect((await rowOf("pn-grat")).text).toBe("Ann appreciated a departed member");
      expect((await rowOf("pn-grat-oak")).text, "the namesake's own line is theirs").toBe("Ann appreciated Juno");
    });

    // Adversarial round 3, finding 1. The UPDATE matches the line's words under
    // the column's collation, which ignores accents as well as case (MySQL 8's
    // utf8mb4_0900_ai_ci, MariaDB's uca1400_ai_ci). So the namesake count has
    // to compare names the same way, or a living María is called departed when
    // a Maria leaves.
    it("counts a namesake whose first name differs only by an accent, in either direction, so their line is never called departed", async () => {
      const maria = "r3-nm-maria";
      const mariaOak = "r3-nm-maria-oak";
      const jose = "r3-nm-jose";
      const joseRuiz = "r3-nm-jose-ruiz";
      await person(maria, "Maria Lopez");
      await person(mariaOak, "María Oak");
      await person(jose, "José Mora");
      await person(joseRuiz, "Jose Ruiz");
      // Older appointment lines, written before lines recorded a subject: the living members'.
      await line({ id: "pn-join-maria-oak", kind: "role", text: "María joined the Bakers", actor: "r2-admin", entityType: "role", entityRef: "role-bakers" });
      await line({ id: "pn-join-jose-ruiz", kind: "role", text: "Jose joined the Potters", actor: "r2-admin", entityType: "role", entityRef: "role-potters" });
      // The control: this database compares names the way CI's MySQL 8 does, without accents.
      expect(
        (await q("SELECT id FROM users WHERE id = ? AND TRIM(name) LIKE 'Maria %'", [mariaOak])).length,
        "the control: the users table's collation ignores accents",
      ).toBe(1);
      expect(
        (await q("SELECT id FROM health_events WHERE id = ? AND text LIKE 'José joined the %'", ["pn-join-jose-ruiz"])).length,
        "the control: the pulse table's collation ignores accents",
      ).toBe(1);

      await erase(maria);
      await erase(jose);

      expect.soft((await rowOf("pn-join-maria-oak")).text, "a living María's line is never called departed").toBe("María joined the Bakers");
      expect.soft((await rowOf("pn-join-jose-ruiz")).text, "a living Jose's line is never called departed").toBe("Jose joined the Potters");
      // What is left standing is counted, as the step's answer says.
      expect((await forgetPulseLinesNaming(pool, { userId: maria, name: "Maria Lopez" })).appointmentLinesLeft).toBe(1);
    });

    it("takes a line they wrote themselves after the first pulse step and before their sessions died", async () => {
      const wren = "r2-late-wren";
      await person(wren, "Wren Late");
      await erase(wren, async () => {
        // Still signed in: a thank-you sent at the last instant, the way the gratitude route records it.
        await line({ id: "pl-own", kind: "gratitude", text: "Wren appreciated Ann", actor: wren, entityType: "user", entityRef: "r2-p-ann", minutesAgo: 0 });
        expect(await rowOf("pl-own"), "the fixture must land a line").toBeTruthy();
      });

      expect(await rowOf("pl-own")).toBeUndefined();
    });

    it("is resumable: a death after its first statement is finished by the resume, from the step that stopped", async () => {
      const wren = "r2-pause-wren";
      await person(wren, "Wren Pause");
      await line({ id: "pr-grat", kind: "gratitude", text: "Ann appreciated Wren", actor: "r2-p-ann", entityType: "user", entityRef: wren });
      await line({ id: "pr-join", kind: "role", text: "Wren joined the Weavers", actor: "r2-admin", entityType: "role", entityRef: "role-weavers" });
      const target = await usersRepo(pool).byId(wren);

      // Its own lines are gone by then; the rewrite of the lines about them never came back.
      await expect(anonymizeMember(faultOnce(pool, (sql) => sql.includes("text = CASE")), target, "r2-admin", deps())).rejects.toThrow(/injected fault/);
      const stopped = await erasureRecord(pool, wren);
      expect(stopped?.failedStep).toBe("pulse-lines-naming-after-tombstone");
      expect((await rowOf("pr-grat")).text, "the fault landed before the rewrite").toBe("Ann appreciated Wren");
      // Somebody signs up with the address the tombstone freed before the retry
      // comes round, so the resume gets no address back, and still the name.
      await person("r2-pause-newcomer", "Bea Newcomer", `${wren}@example.test`);

      const out = await resumeErasure(pool, wren, deps());

      expect(out.finished).toBe(true);
      expect(out.ran[0], "past the tombstone, the resume starts where it stopped").toBe("pulse-lines-naming-after-tombstone");
      // The name it matches the older line by is the one the record held from before the tombstone.
      expect((await rowOf("pr-grat")).text).toBe("Ann appreciated a departed member");
      expect((await rowOf("pr-join")).text).toBe("A departed member joined the Weavers");
    });
  });

  // ── 11 ────────────────────────────────────────────────────────────────────
  describe("11: the submissions inbox and its team alerts", () => {
    it("takes their words and name off everything they sent, signed in or signed out, and keeps what the queues read", async () => {
      const wren = "r2-s-wren";
      const email = "Wren.Sub@Example.test";
      await person(wren, "Wren Halloway", email);
      const now = new Date().toISOString();
      submissions = [
        // Sent before they had an account: no userId, their address.
        {
          id: "s-req-w", type: "membership-request", status: "new", rewarded: false, submittedAt: now,
          data: { name: "Wren Halloway", email: "wren.sub@example.test", why: "My grandmother lived on Calle 3", heardFrom: "Rowan at the market", commsConsent: true },
        },
        // A hand raised for a role, with their note.
        {
          id: "s-hand-w", type: "role-application", status: "new", rewarded: false, submittedAt: now, userId: wren, userName: "Wren Halloway",
          data: { roleId: "role-hearth", roleName: "Hearth", note: "I cooked for forty at my brother's wedding", email, name: "Wren Halloway", termEndsOn: "2027-03-01", followsSeason: true, caution: null },
        },
        // A seat claim, carrying the name the village had recorded for them.
        {
          id: "s-claim-w", type: "seat-claim", status: "new", rewarded: false, submittedAt: now, userId: wren, userName: "Wren Halloway",
          data: { assignmentId: "asg-1", roleId: "org-kitchen", roleName: "Kitchen lead", recordedName: "Wren Halloway", name: "Wren Halloway", email },
        },
        // A quest idea: its words are the village's, by the rule the quest-proposals step follows.
        {
          id: "s-idea-w", type: "quest-proposal", status: "new", rewarded: false, submittedAt: now, userId: wren, userName: "Wren Halloway",
          data: { title: "Mend the long bench", whatYouWantToDo: "Sand and oil it", name: "Wren Halloway", email },
        },
        // A neighbour's request, signed out, the control.
        {
          id: "s-req-b", type: "membership-request", status: "new", rewarded: false, submittedAt: now,
          data: { name: "Bay Holt", email: "bay.sub@example.test", why: "We walk the dogs past every day", heardFrom: "The fair" },
        },
      ];
      const neighbour = structuredClone(submissions.find((s) => s.id === "s-req-b"));
      expect(JSON.stringify(submissions.filter((s) => s.id !== "s-req-b")), "the control").toContain("grandmother");

      await erase(wren);

      const byId = (id: string) => submissions.find((s) => s.id === id);
      const theirs = JSON.stringify(submissions.filter((s) => s.id !== "s-req-b"));
      for (const word of ["Wren", "wren.sub", "grandmother", "Rowan at the market", "brother's wedding"]) {
        expect(theirs, `"${word}" is gone from every submission of theirs`).not.toContain(word);
      }
      expect(byId("s-req-w")).toMatchObject({
        type: "membership-request",
        data: { name: REMOVED, email: REMOVED, why: REMOVED, heardFrom: REMOVED, commsConsent: REMOVED },
      });
      // What the queues read stays: the seat a hand asked for and its term, the seating a claim names.
      expect(byId("s-hand-w").data).toEqual({
        roleId: "role-hearth", roleName: "Hearth", note: REMOVED, email: REMOVED, name: REMOVED, termEndsOn: "2027-03-01", followsSeason: true, caution: null,
      });
      expect(byId("s-hand-w").userName).toBe("A departed member");
      expect(byId("s-claim-w").data).toEqual({ assignmentId: "asg-1", roleId: "org-kitchen", roleName: "Kitchen lead", recordedName: REMOVED, name: REMOVED, email: REMOVED });
      expect(byId("s-idea-w").data).toEqual({ title: "Mend the long bench", whatYouWantToDo: "Sand and oil it", name: REMOVED, email: REMOVED });
      expect(byId("s-req-b"), "a neighbour's request is theirs").toEqual(neighbour);
    });

    it("blanks the team alert each one set off, and keeps a namesake's from another day", async () => {
      const wren = "r2-a-wren";
      await person(wren, "Wren Ashby", "wren.alert@example.test");
      const now = new Date().toISOString();
      submissions = [
        { id: "a-req-w", type: "membership-request", status: "new", rewarded: false, submittedAt: now, data: { name: "Wren Ashby", email: "wren.alert@example.test", why: "the river" } },
        { id: "a-visit-w", type: "visit-inquiry", status: "new", rewarded: false, submittedAt: now, userId: wren, userName: "Wren Ashby", data: { name: "Wren A.", email: "wren.alert@example.test", message: "two nights in May" } },
        { id: "a-req-b", type: "membership-request", status: "new", rewarded: false, submittedAt: now, data: { name: "Bay Ashby", email: "bay.alert@example.test" } },
      ];
      // As `/api/forms/submit` subjects them, seconds after each submission.
      await mail({ id: "m-req-w", origin: "forms.team_alert", subject: "[Village] New membership-request submission from Wren Ashby" });
      await mail({ id: "m-visit-w", origin: "forms.team_alert", subject: "[Village] New visit-inquiry submission from Wren A." });
      // Another Wren Ashby, who wrote in three hours earlier, and a neighbour: the controls.
      await mail({ id: "m-req-other", origin: "forms.team_alert", subject: "[Village] New membership-request submission from Wren Ashby", hoursAgo: 3 });
      await mail({ id: "m-req-b", origin: "forms.team_alert", subject: "[Village] New membership-request submission from Bay Ashby" });

      await erase(wren);

      expect(await subjectOf("m-req-w")).toBe(ERASED_SUBJECT);
      expect(await subjectOf("m-visit-w")).toBe(ERASED_SUBJECT);
      expect(await subjectOf("m-req-other"), "an alert from another day is somebody else's").toBe("[Village] New membership-request submission from Wren Ashby");
      expect(await subjectOf("m-req-b")).toBe("[Village] New membership-request submission from Bay Ashby");
    });

    it("finds an alert by their own name when an older pass already took the name off its row", async () => {
      const wren = "r2-old-sub-wren";
      await person(wren, "Wren Dale", "wren.dale@example.test");
      // As the first pass left a row before it took words: name and address gone, the rest standing.
      submissions = [
        { id: "o-visit-w", type: "visit-inquiry", status: "new", rewarded: false, submittedAt: new Date().toISOString(), userId: wren, userName: "A departed member", data: { name: REMOVED, email: REMOVED, message: "a room for my mother" } },
      ];
      await mail({ id: "m-old-w", origin: "forms.team_alert", subject: "[Village] New visit-inquiry submission from Wren Dale" });

      await erase(wren);

      expect(await subjectOf("m-old-w")).toBe(ERASED_SUBJECT);
      expect(submissions[0].data.message).toBe(REMOVED);
    });

    it("takes the words off a hand raised after the first pass and before their sessions died", async () => {
      const wren = "r2-win-wren";
      await person(wren, "Wren Window");
      submissions = [];
      await erase(wren, async () => {
        // Still signed in: `POST /api/map/roles/:id/raise-hand` writes this row for anybody signed in.
        submissions.push({
          id: "w-hand", type: "role-application", status: "new", rewarded: false, submittedAt: new Date().toISOString(), userId: wren, userName: "Wren Window",
          data: { roleId: "role-hearth", roleName: "Hearth", note: "written while the sweep ran", email: `${wren}@example.test`, name: "Wren Window" },
        });
      });

      expect(submissions[0].data).toMatchObject({ roleId: "role-hearth", note: REMOVED, name: REMOVED, email: REMOVED });
      expect(submissions[0].userName).toBe("A departed member");
    });

    it("is resumable: a write refused after the alerts went leaves the words, and the resume takes them", async () => {
      const wren = "r2-res-wren";
      await person(wren, "Wren Resume", "wren.resume@example.test");
      submissions = [
        // Sent signed in, so the first pass reaches it on every tree.
        { id: "r-req-w", type: "membership-request", status: "new", rewarded: false, submittedAt: new Date().toISOString(), userId: wren, userName: "Wren Resume", data: { name: "Wren Resume", email: "wren.resume@example.test", why: "the orchard" } },
      ];
      await mail({ id: "m-res-w", origin: "forms.team_alert", subject: "[Village] New membership-request submission from Wren Resume" });
      refuseNextWrite = true;

      const target = await usersRepo(pool).byId(wren);
      const stopped = anonymizeMember(pool, target, "r2-admin", deps());
      await expect(stopped.finally(() => (refuseNextWrite = false))).rejects.toThrow(/submissions write was refused/);
      expect((await erasureRecord(pool, wren))?.failedStep).toBe("submissions");
      // The alert went first, while the row still said whose it was.
      expect(await subjectOf("m-res-w")).toBe(ERASED_SUBJECT);
      expect(submissions[0].data.why, "the refused write left the words").toBe("the orchard");

      const out = await resumeErasure(pool, wren, deps());

      expect(out.finished).toBe(true);
      expect(submissions[0].data).toEqual({ name: REMOVED, email: REMOVED, why: REMOVED });
    });

    // Adversarial round 3, finding 10. A Work With Us attachment is served at
    // /api/uploads/<name> with no sign-in, and the row's `attachment` is the
    // only pointer the retention sweep deletes the file by. Scrubbing the
    // pointer and leaving the file kept the applicant's CV readable for good.
    const fileOn = (name: string) => fs.existsSync(path.join(uploadsDir, name));
    const put = (name: string) => fs.writeFileSync(path.join(uploadsDir, name), `bytes of ${name}`);

    it("takes their Work With Us files off the volume, and leaves a file somebody else's row names", async () => {
      const wren = "r3-f-wren";
      const email = "wren.files@example.test";
      await person(wren, "Wren Files", email);
      const now = new Date().toISOString();
      const own = "proposal-1700000000000-abcd1.pdf"; // named only by their signed-in row
      const signedOut = "proposal-1700000000003-mnop4.pdf"; // named only by a row sent signed out under their address
      const shared = "proposal-1700000000001-efgh2.pdf"; // named by theirs and by a neighbour's
      const brand = "brand-1700000000002-ijkl3.webp"; // another door's file, which their row names
      const neighbours = "proposal-1700000000005-uvwx6.pdf"; // the neighbour's own
      for (const f of [own, signedOut, shared, brand, neighbours]) put(f);
      submissions = [
        { id: "f-wwu-w", type: "work-with-us", status: "new", rewarded: false, submittedAt: now, userId: wren, userName: "Wren Files", data: { name: "Wren Files", email, attachment: own, attachmentName: "Wren-CV.pdf" } },
        { id: "f-wwu-out", type: "work-with-us", status: "handled", rewarded: false, submittedAt: now, data: { name: "Wren Files", email, attachment: signedOut, attachmentName: "portfolio.pdf" } },
        { id: "f-wwu-shared", type: "work-with-us", status: "new", rewarded: false, submittedAt: now, userId: wren, userName: "Wren Files", data: { name: "Wren Files", email, attachment: shared } },
        { id: "f-wwu-brand", type: "work-with-us", status: "new", rewarded: false, submittedAt: now, userId: wren, userName: "Wren Files", data: { name: "Wren Files", email, attachment: brand } },
        // The neighbour's rows: one naming the shared file (written another way, the same file), one their own.
        { id: "f-wwu-b", type: "work-with-us", status: "new", rewarded: false, submittedAt: now, data: { name: "Bay Holt", email: "bay.files@example.test", attachment: `./${shared}` } },
        { id: "f-wwu-b2", type: "work-with-us", status: "new", rewarded: false, submittedAt: now, data: { name: "Bay Holt", email: "bay.files@example.test", attachment: neighbours } },
      ];
      expect([own, signedOut, shared, brand, neighbours].every(fileOn), "the control: every file is on the volume today").toBe(true);

      await erase(wren);

      expect(fileOn(own), "their CV is off the volume").toBe(false);
      expect(fileOn(signedOut), "the file they sent signed out is off the volume").toBe(false);
      expect(fileOn(shared), "a file a neighbour's row names stays").toBe(true);
      expect(fileOn(brand), "a file another door wrote stays").toBe(true);
      expect(fileOn(neighbours), "the neighbour's own file stays").toBe(true);
      const byId = (id: string) => submissions.find((s) => s.id === id);
      expect(byId("f-wwu-w").data).toEqual({ name: REMOVED, email: REMOVED, attachment: REMOVED, attachmentName: REMOVED });
      expect(byId("f-wwu-b").data.attachment, "the neighbour's row still names the shared file").toBe(`./${shared}`);
      expect(byId("f-wwu-b2").data.attachment).toBe(neighbours);
    });

    it("takes the files off before the rows, so a file that will not come off stops the step with its row still naming it", async () => {
      const wren = "r3-fs-wren";
      await person(wren, "Wren Stuck", "wren.stuck@example.test");
      const stuck = "proposal-1700000000007-stuck7.pdf";
      // A directory where the file should be: unlink refuses it with something other than ENOENT.
      fs.mkdirSync(path.join(uploadsDir, stuck));
      submissions = [
        { id: "fs-wwu", type: "work-with-us", status: "new", rewarded: false, submittedAt: new Date().toISOString(), userId: wren, userName: "Wren Stuck", data: { name: "Wren Stuck", attachment: stuck } },
      ];
      const target = await usersRepo(pool).byId(wren);

      await expect(anonymizeMember(pool, target, "r2-admin", deps())).rejects.toThrow(/could not take/);
      expect((await erasureRecord(pool, wren))?.failedStep).toBe("submissions");
      expect(submissions[0].data.attachment, "the row still names the file, so a resume finds it").toBe(stuck);

      fs.rmdirSync(path.join(uploadsDir, stuck));
      put(stuck);
      const out = await resumeErasure(pool, wren, deps());

      expect(out.finished).toBe(true);
      expect(fileOn(stuck)).toBe(false);
      expect(submissions[0].data).toEqual({ name: REMOVED, attachment: REMOVED });
    });
  });
});

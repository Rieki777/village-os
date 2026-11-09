/**
 * THE ONE HAND-OVER CONTROL, on a real schema (Rye, 2026-11-01): "At launch the
 * stewards select WHAT powers are being passed over", and after launch they
 * hand over the rest by the same act.
 *
 * What the launch then does with the selection is pinned beside the closer
 * (server/stewardship.db.test.ts: exactly the selection crosses, and an empty
 * one moves nothing). What is pinned here:
 *
 *   BEFORE THE GAME STARTS
 *   - a founder writes the launch selection, which may be empty, and moves
 *     nothing yet;
 *   - an administrator who is not a founder, and a member, cannot set it.
 *
 *   AFTER THE GAME STARTS
 *   - a steward's act moves EXACTLY the powers named, held by the Steward
 *     role, with the steward's id on the row and a line on the record;
 *   - a power the village already holds stays exactly where it is;
 *   - an administrator with no steward seat, a member, a founder with no seat,
 *     and nobody at all are refused, and nothing moves;
 *   - nothing moves without the confirm, or when a named power is not one the
 *     stewards hold.
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BREAK_GLASS_SEAT, HANDOVER_SET, hasCapability } from "../../shared/capabilities";
import { readVillageFloors } from "../lib/villageFloors";
import { villageHeldCapabilities } from "../lib/capabilityHolding";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { STEWARD_ROLE_ID } from "../lib/capabilityHolding";
import { readLaunchSelection } from "../lib/launchHandover";
import { liveHoldersOfCapability } from "../lib/roleGrants";
import { insertRoleIfAbsent } from "../repos/stewardRoles";
import { adminDoorRefusal, HAND_OVER_PATH, HAND_OVER_WORDS, register } from "./stewardHandover";

const configured = testDbConfigured();
if (!configured) console.warn("[stewardHandover] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const PEOPLE: Record<string, { id: string; name: string; role: string }> = {
  "u-steward": { id: "u-steward", name: "Wren Alder", role: "member" },
  "u-founder": { id: "u-founder", name: "Ana Quill", role: "founder" },
  "u-admin": { id: "u-admin", name: "Rook Salt", role: "admin" },
  "u-member": { id: "u-member", name: "Ivo Lantern", role: "member" },
  "u-steward-2": { id: "u-steward-2", name: "Iris Fen", role: "member" },
  "u-founder-2": { id: "u-founder-2", name: "Oak Reed", role: "founder" },
};
/** Who sits where, as the gate's own counter reads it: one steward, seated for a term that has not lapsed. */
const ROLES = [{ id: STEWARD_ROLE_ID, capabilities: [...HANDOVER_SET] }];
const TERM = new Date(Date.now() + 90 * 86400000);
let SEATS = [{ roleId: STEWARD_ROLE_ID, userId: "u-steward", termEndsAt: TERM }];

describe.skipIf(!configured)("the one hand-over control, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let viewer: string | null = null;

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned
  const call = async (method: "GET" | "POST", body?: unknown) => {
    const r = await fetch(`${base}${HAND_OVER_PATH}`, { // module-review-ok: this test IS the client, calling the server it booted itself; there is no outbound call to correlate
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as any };
  };
  const handOver = (body: unknown) => call("POST", body);
  const holdings = () => q("SELECT capability, holder_role_id, moved_by_user_id, moved_by_ballot_id FROM capability_holding ORDER BY capability");
  const started = (yes: boolean) =>
    yes
      ? q("INSERT INTO app_config (config_key, value) VALUES ('game-start', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify({ startedAt: "2026-11-01T00:00:00.000Z" })])
      : q("DELETE FROM app_config WHERE config_key = 'game-start'");

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await insertRoleIfAbsent(pool, {
      id: STEWARD_ROLE_ID,
      name: "Steward",
      description: "Holds every power until it hands them to the village.",
      capabilitiesJson: JSON.stringify([...HANDOVER_SET]),
      sortOrder: 0,
    });
    await insertRoleIfAbsent(pool, {
      id: "keepers",
      name: "Library Keepers",
      description: "Look after the library.",
      capabilitiesJson: JSON.stringify(["library.keep"]),
      sortOrder: 1,
    });
    const app = express();
    app.use(express.json());
    register(app, {
      getPool: () => pool,
      authedUser: async () => (viewer ? PEOPLE[viewer] ?? null : null),
      overLimit: async () => false,
      liveHoldersOf: async (capability: string) => liveHoldersOfCapability(SEATS, ROLES, capability),
    });
    server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    viewer = null;
    await q("DELETE FROM capability_holding");
    await q("DELETE FROM app_config WHERE config_key IN ('launch-handover', 'handover-pending', 'handover-cooling', 'village-floors')");
  });

  it("the fixture's steward is the one live holder of the veto, counted the way the gate counts a seat", () => {
    expect(liveHoldersOfCapability(SEATS, ROLES, BREAK_GLASS_SEAT)).toEqual(["u-steward"]);
  });

  describe("before the Game starts: the launch selection", () => {
    beforeAll(() => started(false));
    afterAll(() => started(true));

    it("a founder chooses what the launch hands over, which may be none, and nothing moves yet", async () => {
      viewer = "u-founder";
      const shown = await call("GET");
      expect(shown.json.mayAct).toBe(true);
      expect(shown.json.gameStarted).toBe(false);
      expect(shown.json.powers.map((p: any) => p.capability)).toEqual([...HANDOVER_SET]);
      expect(shown.json.powers.every((p: any) => p.title && p.consequence), "every power in plain words").toBe(true);
      expect(shown.json.selected, "nothing selected by default").toEqual([]);

      const some = await handOver({ capabilities: ["story.tell", "org.seat"], confirm: true });
      expect(some.status, JSON.stringify(some.json)).toBe(200);
      expect(some.json).toEqual({ stage: "launch", selected: ["org.seat", "story.tell"] });
      expect((await readLaunchSelection(pool)).capabilities).toEqual(["org.seat", "story.tell"]);
      expect((await readLaunchSelection(pool)).chosenBy).toBe("u-founder");
      expect((await call("GET")).json.selected).toEqual(["org.seat", "story.tell"]);

      const none = await handOver({ capabilities: [], confirm: true });
      expect(none.status).toBe(200);
      expect((await readLaunchSelection(pool)).capabilities, "an empty selection is a selection").toEqual([]);

      expect(await holdings(), "choosing moves nothing: the launch does that").toEqual([]);
    });

    it("freezes the selection while the launch vote is open: the list is written into it", async () => {
      viewer = "u-founder";
      expect((await handOver({ capabilities: ["org.seat"], confirm: true })).status).toBe(200);
      await q(
        "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, weight_mode, " +
          "unity_pct, quorum_pct, total_weight, electorate_count, opened_by, opens_at, closes_at, status) " +
          "VALUES ('bal-launch','village_launch','start','village_launch:start','Start the Game','#','custom','equal',100,100,3,3,'u-founder', " +
          "'2026-11-01 00:00:00','2026-11-08 00:00:00','open')",
      );
      try {
        expect((await call("GET")).json.frozen).toBe(true);
        const r = await handOver({ capabilities: ["story.tell"], confirm: true });
        expect(r.status).toBe(409);
        expect(r.json.error).toBe(HAND_OVER_WORDS.frozen);
        expect((await readLaunchSelection(pool)).capabilities, "what members are voting on").toEqual(["org.seat"]);
      } finally {
        await q("DELETE FROM ballots WHERE id = 'bal-launch'");
      }
      expect((await call("GET")).json.frozen, "and it thaws when that vote is gone").toBe(false);
    });

    it("with two founders, holds the first founder's selection until the second signs the same list", async () => {
      for (const [id, name] of [["u-founder", "Ana Quill"], ["u-founder-2", "Oak Reed"]]) {
        await q("INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,'founder')", [id, name, `${id}@example.invalid`, "x"]);
      }
      try {
        viewer = "u-founder";
        const first = await handOver({ capabilities: ["story.tell"], confirm: true });
        expect(first.status, JSON.stringify(first.json)).toBe(202);
        expect((await readLaunchSelection(pool)).capabilities, "one signature selects nothing").toEqual([]);
        expect((await handOver({ capabilities: ["story.tell"], confirm: true })).status, "nor does the same founder twice").toBe(409);
        viewer = "u-founder-2";
        const second = await handOver({ capabilities: ["story.tell"], confirm: true });
        expect(second.status, JSON.stringify(second.json)).toBe(200);
        expect((await readLaunchSelection(pool)).capabilities).toEqual(["story.tell"]);
      } finally {
        await q("DELETE FROM users WHERE id IN ('u-founder', 'u-founder-2')");
      }
    });

    it("an administrator who is not a founder, and a member, cannot set the selection", async () => {
      // Before the Game starts the admin door is open as it always was; the stewards' door is not the admin's.
      expect(await adminDoorRefusal(pool, "u-admin", async (c) => liveHoldersOfCapability(SEATS, ROLES, c))).toBeNull();
      for (const who of ["u-admin", "u-member"]) {
        viewer = who;
        const r = await handOver({ capabilities: ["org.seat"], confirm: true });
        expect(r.status, who).toBe(403);
        expect(r.json.error, who).toBe(HAND_OVER_WORDS.notSteward);
        expect((await call("GET")).json, who).toEqual({ gameStarted: false, mayAct: false });
      }
      expect((await readLaunchSelection(pool)).capabilities).toEqual([]);
    });
  });

  describe("after the Game starts: the stewards hand a power over", () => {
    beforeAll(() => started(true));

    it("a steward's act moves exactly the power named, held by the Steward role, with the steward on the record", async () => {
      viewer = "u-steward";
      const r = await handOver({ capabilities: ["org.seat"], confirm: true });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.moved).toEqual(["org.seat"]);
      expect(await holdings()).toEqual([
        { capability: "org.seat", holder_role_id: STEWARD_ROLE_ID, moved_by_user_id: "u-steward", moved_by_ballot_id: null },
      ]);
      const lines = await q("SELECT kind, actor_user_id FROM health_events WHERE entity_ref = 'org.seat' ORDER BY kind");
      expect(lines.map((l: any) => [l.kind, l.actor_user_id])).toEqual([
        ["audit", "u-steward"],
        ["governance", "u-steward"],
      ]);
      expect((await call("GET")).json.powers.find((p: any) => p.capability === "org.seat").held).toBe(true);
    });

    it("moves a chosen set, and leaves a power the village already holds exactly where it is", async () => {
      await q("INSERT INTO capability_holding (capability, holder_role_id, moved_by_ballot_id) VALUES ('library.keep', 'keepers', 'bal-earlier')");
      viewer = "u-steward";
      const r = await handOver({ capabilities: ["library.keep", "story.tell", "org.seat", "story.tell"], confirm: true });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.moved).toEqual(["story.tell", "org.seat"]);
      expect(r.json.alreadyHeld).toEqual(["library.keep"]);
      expect(await holdings()).toEqual([
        { capability: "library.keep", holder_role_id: "keepers", moved_by_user_id: null, moved_by_ballot_id: "bal-earlier" },
        { capability: "org.seat", holder_role_id: STEWARD_ROLE_ID, moved_by_user_id: "u-steward", moved_by_ballot_id: null },
        { capability: "story.tell", holder_role_id: STEWARD_ROLE_ID, moved_by_user_id: "u-steward", moved_by_ballot_id: null },
      ]);
    });

    it("refuses an administrator with no steward seat, a member, a founder with no seat, and nobody, and moves nothing", async () => {
      for (const who of ["u-admin", "u-member", "u-founder"]) {
        viewer = who;
        const r = await handOver({ capabilities: ["org.seat"], confirm: true });
        expect(r.status, who).toBe(403);
        expect(r.json.error, who).toBe(HAND_OVER_WORDS.notSteward);
      }
      viewer = null;
      expect((await handOver({ capabilities: ["org.seat"], confirm: true })).status).toBe(401);
      expect(await holdings(), "the table the gate reads is untouched").toEqual([]);
    });

    it("closes the admin door to an administrator with no steward seat, and leaves it to a steward", async () => {
      const seated = async (capability: string) => liveHoldersOfCapability(SEATS, ROLES, capability);
      expect(await adminDoorRefusal(pool, "u-admin", seated)).toBe(HAND_OVER_WORDS.adminDoorClosed);
      expect(await adminDoorRefusal(pool, "u-steward", seated)).toBeNull();
      // With nobody in the steward seat the panel stays the scaffolding's, as an empty seat leaves it at launch.
      expect(await adminDoorRefusal(pool, "u-admin", async () => [])).toBeNull();
    });

    describe("two signatures when two stewards can sign (Rye, 2026-11-01)", () => {
      beforeAll(() => {
        SEATS = [...SEATS, { roleId: STEWARD_ROLE_ID, userId: "u-steward-2", termEndsAt: TERM }];
      });
      afterAll(() => {
        SEATS = SEATS.filter((s) => s.userId !== "u-steward-2");
      });

      it("holds a lone steward's hand-over, refuses the same steward twice, and the second steward completes it", async () => {
        viewer = "u-steward";
        const first = await handOver({ capabilities: ["org.seat"], confirm: true });
        expect(first.status, JSON.stringify(first.json)).toBe(202);
        expect(first.json).toEqual({ stage: "now", pending: true, capabilities: ["org.seat"] });
        expect(await holdings(), "one signature moves nothing").toEqual([]);
        expect((await call("GET")).json.pending).toEqual({ capabilities: ["org.seat"], mine: true });

        const again = await handOver({ capabilities: ["org.seat"], confirm: true });
        expect(again.status).toBe(409);
        expect(again.json.error).toBe(HAND_OVER_WORDS.signedAlready);
        expect(await holdings(), "the same person twice is still one signature").toEqual([]);

        viewer = "u-steward-2";
        expect((await call("GET")).json.pending).toEqual({ capabilities: ["org.seat"], mine: false });
        const second = await handOver({ capabilities: ["org.seat"], confirm: true });
        expect(second.status, JSON.stringify(second.json)).toBe(200);
        expect(second.json.moved).toEqual(["org.seat"]);
        expect(await holdings()).toEqual([
          { capability: "org.seat", holder_role_id: STEWARD_ROLE_ID, moved_by_user_id: "u-steward-2", moved_by_ballot_id: null },
        ]);
        expect((await call("GET")).json.pending, "signed and done").toBeNull();
      });

      it("takes a different list from the second steward as a new request, and moves nothing", async () => {
        viewer = "u-steward";
        expect((await handOver({ capabilities: ["org.seat"], confirm: true })).status).toBe(202);
        viewer = "u-steward-2";
        const other = await handOver({ capabilities: ["story.tell"], confirm: true });
        expect(other.status).toBe(202);
        expect(await holdings()).toEqual([]);
        viewer = "u-steward";
        expect((await call("GET")).json.pending, "now the first steward is asked").toEqual({ capabilities: ["story.tell"], mine: false });
      });
    });

    it("asks a second confirm for a mature-only power, and never blocks it: it waits its week, the rest crosses now", async () => {
      viewer = "u-steward";
      const asked = await handOver({ capabilities: ["steward.veto", "story.tell"], confirm: true });
      expect(asked.status).toBe(400);
      expect(asked.json.matureOnly).toEqual(["steward.veto"]);
      expect(await holdings(), "nothing moves on the first confirm alone").toEqual([]);
      const r = await handOver({ capabilities: ["steward.veto", "story.tell"], confirm: true, confirmMature: true });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.moved).toEqual(["story.tell"]);
      expect(r.json.cooling.map((c: any) => c.capability)).toEqual(["steward.veto"]);
      expect((await holdings()).map((h: any) => h.capability), "the veto waits; story.tell crossed").toEqual(["story.tell"]);
      expect((await call("GET")).json.powers.filter((p: any) => p.matureOnly).map((p: any) => p.capability).sort()).toEqual(
        ["cash.pay", "dial.set", "exchange.manage", "module.switch", "role.pay", "steward.veto"],
      );
    });

    it("moves nothing without the confirm, with nothing named, or with a power the stewards do not hold", async () => {
      viewer = "u-steward";
      const unconfirmed = await handOver({ capabilities: ["org.seat"] });
      expect(unconfirmed.status).toBe(400);
      expect(unconfirmed.json.error).toBe(HAND_OVER_WORDS.unconfirmed);
      const none = await handOver({ capabilities: [], confirm: true });
      expect(none.status).toBe(400);
      expect(none.json.error).toBe(HAND_OVER_WORDS.nonePicked);
      // `message.send` passes now, as its stage floor only (villageFloors.ts). `moon.approve` is
      // held back by decisions 18 and 19 and passes neither way.
      const stray = await handOver({ capabilities: ["org.seat", "moon.approve"], confirm: true });
      expect(stray.status).toBe(400);
      expect(stray.json.error).toBe(HAND_OVER_WORDS.notAPower("moon.approve"));
      expect(await holdings()).toEqual([]);
    });

    describe("a week to think again (ROLE_POWERS_DESIGN.md §4.1b)", () => {
      const cool = async () => {
        viewer = "u-steward";
        const r = await handOver({ capabilities: ["cash.pay"], confirm: true, confirmMature: true });
        expect(r.status, JSON.stringify(r.json)).toBe(200);
        return r;
      };
      const stop = (capability: string, body: unknown) =>
        fetch(`${base}${HAND_OVER_PATH}/cooling/${capability}/stop`, { // module-review-ok: this test IS the client, calling the server it booted itself
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));

      it("a mature-only power waits seven days, in the open, and nothing crosses before", async () => {
        const r = await cool();
        expect(r.json.moved).toEqual([]);
        const landsAt = new Date(r.json.cooling[0].landsAt).getTime();
        expect(Math.round((landsAt - Date.now()) / 86400000)).toBe(7);
        expect((await call("GET")).json.cooling.map((c: any) => c.capability)).toEqual(["cash.pay"]);
        expect(await holdings()).toEqual([]);
      });

      it("crosses once its week is up, the next time a steward opens the checklist, held by the Steward role", async () => {
        await cool();
        await q("UPDATE app_config SET value = JSON_SET(value, '$.entries[0].landsAt', '2026-01-01T00:00:00.000Z') WHERE config_key = 'handover-cooling'");
        const opened = await call("GET");
        expect(opened.json.cooling).toEqual([]);
        expect(await holdings()).toEqual([{ capability: "cash.pay", holder_role_id: STEWARD_ROLE_ID, moved_by_user_id: "u-steward", moved_by_ballot_id: null }]);
      });

      it("any steward stops it inside the week, with a reason, and it never crosses", async () => {
        await cool();
        viewer = "u-steward";
        expect((await stop("cash.pay", { reason: "" })).status, "a stop needs its reason").toBe(400);
        const stopped = await stop("cash.pay", { reason: "Our treasury is not ready yet." });
        expect(stopped.status, JSON.stringify(stopped.json)).toBe(200);
        expect((await call("GET")).json.cooling).toEqual([]);
        expect(await holdings()).toEqual([]);
        const [line] = await q("SELECT text FROM health_events WHERE kind = 'governance' AND entity_ref = 'cash.pay' ORDER BY id DESC LIMIT 1");
        expect(line.text).toContain("Our treasury is not ready yet.");
      });

      it("a member cannot stop one, and stopping nothing is a 404", async () => {
        await cool();
        viewer = "u-member";
        expect((await stop("cash.pay", { reason: "No thanks" })).status).toBe(403);
        viewer = "u-steward";
        expect((await stop("dial.set", { reason: "Nothing waits" })).status).toBe(404);
      });
    });

    describe("an everyday power passes as its floor only (the coordinator's guardrail, 2026-11-05)", () => {
      it("moves who sets the stage, writes no holding row, and every member at the stage still votes and posts", async () => {
        viewer = "u-steward";
        const r = await handOver({ capabilities: ["ballot.vote", "forum.post"], confirm: true });
        expect(r.status, JSON.stringify(r.json)).toBe(200);
        expect(r.json.floors).toEqual(["forum.post", "ballot.vote"]);
        expect(r.json.moved).toEqual([]);
        expect(await holdings(), "no role holds voting or posting for the village").toEqual([]);
        expect(await readVillageFloors(pool)).toEqual(expect.arrayContaining(["ballot.vote", "forum.post"]));
        // A member at the member stage, judged by the one gate with what the village holds now.
        const member = { stageIndex: 3, stageIndexOf: (id: string) => ["visitor", "guest", "contributor", "member"].indexOf(id), roleCapabilities: [], isAdmin: false, villageHeld: await villageHeldCapabilities(pool) };
        expect(hasCapability("ballot.vote", member)).toBe(true);
        expect(hasCapability("forum.post", member)).toBe(true);
        expect((await call("GET")).json.powers.filter((p: any) => p.floorOnly && p.held).map((p: any) => p.capability).sort()).toEqual(["ballot.vote", "forum.post"]);
      });

      it("control: the same power passed as a governance power would have written the row this one does not", async () => {
        viewer = "u-steward";
        await handOver({ capabilities: ["library.keep"], confirm: true });
        expect((await holdings()).map((h: any) => h.capability)).toEqual(["library.keep"]);
      });

      it("one pass that carries a floor and a mature-only power answers with both, floors and cooling", async () => {
        viewer = "u-steward";
        const r = await handOver({ capabilities: ["ballot.vote", "cash.pay"], confirm: true, confirmMature: true });
        expect(r.status, JSON.stringify(r.json)).toBe(200);
        expect(r.json.floors, "the floor is in the payload").toEqual(["ballot.vote"]);
        expect(r.json.cooling.map((c: any) => c.capability), "the waiting power is in the same payload").toEqual(["cash.pay"]);
        expect(r.json.moved).toEqual([]);
        expect(await holdings(), "neither writes a holding row today").toEqual([]);
      });

      it("a floor does not pass at launch, and says when it can", async () => {
        await started(false);
        try {
          viewer = "u-founder";
          const r = await handOver({ capabilities: ["ballot.vote"], confirm: true });
          expect(r.status).toBe(400);
          expect(r.json.error).toBe(HAND_OVER_WORDS.floorsAfterStart);
        } finally {
          await started(true);
        }
      });
    });
  });
});

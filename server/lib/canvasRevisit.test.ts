/**
 * THE FOUR KEY MOMENTS, DELIVERED: who hears one, how often, and what it
 * carries (plan 4.2; Wave 4).
 *
 * The pure half (which events are moments, which module moves cross the line,
 * who the rule picks in each power state) needs no database. The delivery half
 * runs the REAL notification spine (`insertNotification`, `runNotificationDigest`)
 * against a real scratch schema, because "deduplicated per (moment, block,
 * moon)" is a claim about a unique index and "never emailed at once" is a
 * claim about the spine's cadence table, and a model of either would prove
 * the model. The routes that raise each moment are driven through the built
 * server in server/canvasRevisit.routes.e2e.test.ts.
 *
 * DB-backed cases skip loudly without TEST_DATABASE_URL.
 */
import type { Pool } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import {
  canvasRevisitNotice,
  deliverCanvasRevisit,
  moonOf,
  observeKeyMoments,
  raiseCanvasRevisit,
  revisitAudience,
  setCanvasRevisitDelivery,
  settleCanvasRevisits,
  triggerForEvent,
  triggerForLifecycle,
  triggerForSubmission,
  type CanvasRevisitDeps,
} from "./canvasRevisit";
import { recordEvent } from "./events";
import { emailCadenceFor, insertNotification, resolveNotifyPrefs, runNotificationDigest, type NotifyDeps } from "./notify";
import { presenceTest } from "./memberPresence";
import { renderWeeklyBrief } from "./assistantTemplates";
import { MOMENT_BLOCKS, revisitBody, revisitTitle } from "../../shared/canvasRevisit";

const configured = testDbConfigured();
if (!configured) console.warn("[canvasRevisit] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

describe("which acts are key moments", () => {
  it("reads the four audit events server/index.ts records, and nothing that only resembles one", () => {
    expect(triggerForEvent({ kind: "audit", text: "bootstrap:founder", entityType: "user" })).toBe("instance-claimed");
    expect(triggerForEvent({ kind: "audit", text: "bootstrap:break-glass", entityType: "user" })).toBeNull();
    expect(triggerForEvent({ kind: "audit", text: "network:peer-added:Alder Creek", entityType: "peer" })).toBe("peer-added");
    expect(triggerForEvent({ kind: "audit", text: "network:publish:need:Rides", entityType: "shared_item" })).toBeNull();
    expect(triggerForEvent({ kind: "audit", text: "draft:accept:circle:water" })).toBe("circle-declared");
    expect(triggerForEvent({ kind: "audit", text: "draft:accept:role:water-keeper" })).toBeNull();
    expect(triggerForEvent({ kind: "audit", text: "launch:proposed:bal-1", entityType: "launch" })).toBe("birthing-opened");
    expect(triggerForEvent({ kind: "audit", text: "launch:confirm:bank:yes", entityType: "launch" })).toBeNull();
    // The same words on the public pulse are not the audit trail's event.
    expect(triggerForEvent({ kind: "governance", text: "bootstrap:founder" })).toBeNull();
  });

  it("counts a module move only when it crosses the line", () => {
    expect(triggerForLifecycle("governance", "off", "members")).toBe("governance-on");
    expect(triggerForLifecycle("governance", "preview", "public")).toBe("governance-on");
    expect(triggerForLifecycle("governance", "members", "public")).toBeNull();
    expect(triggerForLifecycle("governance", "off", "preview")).toBeNull();
    expect(triggerForLifecycle("governance", "members", "off")).toBeNull();
    expect(triggerForLifecycle("crowdpool", "off", "preview")).toBe("crowdpool-on");
    expect(triggerForLifecycle("crowdpool", "preview", "public")).toBeNull();
    expect(triggerForLifecycle("forum", "off", "public")).toBeNull();
  });

  it("counts an accepted Work With Us inquiry, and a Love Letter only when it admitted somebody", () => {
    expect(triggerForSubmission("work-with-us", false)).toBe("partner-accepted");
    expect(triggerForSubmission("membership-508", true)).toBe("love-letter-admitted");
    expect(triggerForSubmission("membership-508", false)).toBeNull();
    expect(triggerForSubmission("quest-proposal", true)).toBeNull();
  });
});

/** A host with every reader modelled, and the notify spine recorded. */
function fakeHost(over: Partial<CanvasRevisitDeps> = {}) {
  const rows: any[] = [];
  const deps: CanvasRevisitDeps = {
    notify: async (input) => {
      rows.push(input);
      return { fresh: true, id: `n-${rows.length}` };
    },
    villageHeld: async () => [],
    liveHoldersOf: async () => [],
    everyMember: async () => ["m1", "m2", "m3"],
    admins: async () => ["a1"],
    careHolders: async () => [],
    ...over,
  };
  return { deps, rows };
}

describe("who hears a moment, per power state", () => {
  it("before the handover, with nobody holding the pen: the admins", async () => {
    const { deps } = fakeHost();
    expect(await revisitAudience(deps, "funding")).toEqual({ audience: "admins", userIds: ["a1"] });
  });

  it("a role holds the pen with somebody seated: that holder, and not the admins", async () => {
    const { deps } = fakeHost({ liveHoldersOf: async (cap) => (cap === "story.tell" ? ["h1", "h1", ""] : []) });
    expect(await revisitAudience(deps, "collaboration")).toEqual({ audience: "live-holders", userIds: ["h1"] });
  });

  it("the village holds the pen: every admitted member, even with a holder seated", async () => {
    const { deps, rows } = fakeHost({ villageHeld: async () => ["story.tell"], liveHoldersOf: async () => ["h1"] });
    expect(await revisitAudience(deps, "partners")).toEqual({ audience: "every-member", userIds: ["m1", "m2", "m3"] });
    const out = await deliverCanvasRevisit(deps, { trigger: "partner-accepted" });
    expect(out.audience).toBe("every-member");
    expect(rows.every((r) => String(r.body).includes("anyone may raise this"))).toBe(true);
  });

  it("asks the key the rule asks: only story.tell, never another power", async () => {
    const asked: string[] = [];
    const { deps } = fakeHost({ liveHoldersOf: async (cap) => (asked.push(cap), []) });
    for (const moment of ["collaboration", "partners", "funding"] as const) await revisitAudience(deps, moment);
    expect(asked).toEqual(["story.tell", "story.tell", "story.tell"]);
  });

  it("conflict reaches the care holder only, whoever holds the pen", async () => {
    const { deps } = fakeHost({ careHolders: async () => ["c1"], villageHeld: async () => ["story.tell"] });
    expect(await revisitAudience(deps, "conflict")).toEqual({ audience: "care-holders", userIds: ["c1"] });
  });

  it("conflict with nobody holding the care role goes to the admins and never to the village", async () => {
    const { deps } = fakeHost({ villageHeld: async () => ["story.tell"] });
    expect(await revisitAudience(deps, "conflict")).toEqual({ audience: "admins", userIds: ["a1"] });
  });
});

describe("what a row carries", () => {
  it("is built from the moment and the block alone: fixed words, no actor, a key per moment, block, moon and person", () => {
    const n = canvasRevisitNotice({ moment: "conflict", block: "conflict", moon: 331, userId: "c1", audience: "care-holders" });
    expect(n).toEqual({
      userId: "c1",
      type: "canvas_revisit",
      title: revisitTitle("conflict", "conflict"),
      body: revisitBody("conflict", "care-holders"),
      link: "/journey-to-launch?view=canvas#canvas-block-conflict",
      actorUserId: null,
      dedupeKey: "canvas_revisit:conflict:conflict:331:c1",
    });
  });

  it("writes one row per block per person, and nothing about the act that raised it", async () => {
    const { deps, rows } = fakeHost();
    const out = await deliverCanvasRevisit(deps, { trigger: "birthing-opened" });
    expect(out.blocks).toEqual(["power", "resourcing", "legal", "impact"]);
    expect(rows.map((r) => r.title)).toEqual(MOMENT_BLOCKS.funding.map((b) => revisitTitle("funding", b)));
    expect(new Set(rows.map((r) => r.body))).toEqual(new Set([revisitBody("funding", "admins")]));
    expect(rows.every((r) => r.actorUserId === null)).toBe(true);
  });

  it("refuses a trigger this build does not know, before writing anything", async () => {
    const { deps, rows } = fakeHost();
    await expect(deliverCanvasRevisit(deps, { trigger: "a-coup" as any })).rejects.toThrow(/not a key moment/);
    expect(rows).toEqual([]);
  });
});

describe("the mail it may use", () => {
  it("is the daily digest, whatever the member's other preferences say, and off with the global switch", () => {
    expect(emailCadenceFor("canvas_revisit", resolveNotifyPrefs({}))).toBe("daily");
    const loud = resolveNotifyPrefs({ notify: { governanceEmail: "immediate", rolesEmail: "immediate", questsEmail: "immediate" } });
    expect(emailCadenceFor("canvas_revisit", loud)).toBe("daily");
    expect(emailCadenceFor("canvas_revisit", resolveNotifyPrefs({ notify: { emailsOff: true } }))).toBe("off");
  });
});

describe("the seam every call site raises through", () => {
  afterEach(() => setCanvasRevisitDelivery(null));

  it("does nothing, and throws nothing, before the host hands over a delivery", async () => {
    setCanvasRevisitDelivery(null);
    expect(() => raiseCanvasRevisit("peer-added")).not.toThrow();
    await settleCanvasRevisits();
  });

  it("returns before delivering, then delivers", async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setCanvasRevisitDelivery(async (req) => {
      await gate;
      seen.push(req.trigger);
    });
    raiseCanvasRevisit("exit-opened");
    expect(seen, "the caller is never made to wait").toEqual([]);
    release();
    await settleCanvasRevisits();
    expect(seen).toEqual(["exit-opened"]);
  });

  it("logs a delivery that throws and lets the act stand", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    setCanvasRevisitDelivery(async () => {
      throw new Error("the spine is down");
    });
    expect(() => raiseCanvasRevisit("objection-ruled")).not.toThrow();
    await settleCanvasRevisits();
    expect(logged.mock.calls.some((c) => String(c[0]).includes("objection-ruled"))).toBe(true);
    logged.mockRestore();
  });
});

describe("the weekly brief's canvas line", () => {
  it("prints the new moon's day and block titles, and drops a malformed section", () => {
    const r = renderWeeklyBrief({
      weekKey: "2026-10-04",
      timezone: "UTC",
      projectName: "Alder Creek",
      canvasMoon: { date: "2026-10-10", blocks: ["Stakeholders", "Power"] },
    });
    expect(r!.text).toContain("The canvas moon");
    expect(r!.text).toContain("New moon, Sat 10 Oct. The canvas moon looks at Stakeholders and Power.");
    const bad = renderWeeklyBrief({ weekKey: "2026-10-04", timezone: "UTC", projectName: "Alder Creek", canvasMoon: { date: 7, blocks: "Power" } });
    expect(bad!.text).not.toContain("canvas moon");
  });
});

describe.skipIf(!configured)("delivery through the real notification spine", () => {
  let db: TestDb;
  let pool: Pool;
  const sent: Array<{ to: string[]; subject: string; html: string }> = [];
  const SECRET = "canvas-revisit-test-secret"; // module-review-ok: a fixture signing secret for the presence test on a scratch schema, same as every DB-backed suite

  const spine = (): NotifyDeps => ({
    pool,
    memberById: async (id: string) => {
      const [[u]] = await pool.query<any[]>("SELECT * FROM users WHERE id = ?", [id]); // module-review-ok: reading the scratch schema this suite provisioned
      return u
        ? { id: u.id, name: u.name, email: u.email, passwordHash: u.password_hash, prefs: typeof u.prefs === "string" ? JSON.parse(u.prefs) : u.prefs }
        : null;
    },
    sendEmail: async (opts) => {
      sent.push(opts);
    },
    origin: () => "https://example.test",
    projectName: () => "Alder Creek",
    isPresent: presenceTest(SECRET),
  });

  const host = (over: Partial<CanvasRevisitDeps> = {}): CanvasRevisitDeps => ({
    notify: (input) => insertNotification(spine(), input),
    villageHeld: async () => [],
    liveHoldersOf: async () => [],
    everyMember: async () => ["rv-member"],
    admins: async () => ["rv-admin"],
    careHolders: async () => ["rv-care"],
    ...over,
  });

  const rowsFor = async (userId: string) => {
    const [rows] = await pool.query<any[]>( // module-review-ok: reading the scratch schema this suite provisioned
      "SELECT type, title, body, link, actor_user_id, dedupe_key, emailed_at FROM notifications WHERE user_id = ? ORDER BY dedupe_key",
      [userId],
    );
    return rows;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    for (const [id, name] of [["rv-admin", "Moss Fielding"], ["rv-member", "Ash Brook"], ["rv-care", "Wren Halloway"]]) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
        [id, name, `${id}@example.test`, "hash", id === "rv-admin" ? "admin" : "member"],
      );
    }
  }, 120_000);

  afterAll(async () => {
    setCanvasRevisitDelivery(null);
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    sent.length = 0;
    await pool.query("DELETE FROM notifications"); // module-review-ok: resetting the scratch schema between cases
  });

  it("writes each block once per moon: a repeat, or another trigger of the same moment, adds nothing", async () => {
    const at = new Date("2026-10-12T12:00:00Z");
    const first = await deliverCanvasRevisit({ ...host(), now: () => at }, { trigger: "governance-on" });
    expect(first).toMatchObject({ moment: "funding", audience: "admins", recipients: 1, fresh: 4, moon: moonOf(at) });

    const again = await deliverCanvasRevisit({ ...host(), now: () => new Date(at.getTime() + 3_600_000) }, { trigger: "governance-on" });
    const sibling = await deliverCanvasRevisit({ ...host(), now: () => at }, { trigger: "crowdpool-on" });
    expect(again.fresh).toBe(0);
    expect(sibling.fresh, "the dedupe is per moment, never per trigger").toBe(0);
    expect(await rowsFor("rv-admin")).toHaveLength(4);

    // The next moon asks again.
    const next = await deliverCanvasRevisit({ ...host(), now: () => new Date(at.getTime() + 30 * 86_400_000) }, { trigger: "birthing-opened" });
    expect(next.moon).toBe(first.moon + 1);
    expect(next.fresh).toBe(4);
    expect(await rowsFor("rv-admin")).toHaveLength(8);
  });

  it("dedupes per block: a moment that shares a block with another still asks it in its own words", async () => {
    const at = new Date("2026-10-12T12:00:00Z");
    await deliverCanvasRevisit({ ...host(), now: () => at }, { trigger: "birthing-opened" });
    const collab = await deliverCanvasRevisit({ ...host(), now: () => at }, { trigger: "peer-added" });
    expect(collab.fresh, "all twelve, Power included, under the collaboration moment").toBe(12);
    expect(await rowsFor("rv-admin")).toHaveLength(16);
  });

  it("carries nobody's words, no actor and no count, and is never emailed at once", async () => {
    const at = new Date("2026-10-12T12:00:00Z");
    await deliverCanvasRevisit({ ...host(), now: () => at }, { trigger: "exit-opened" });
    const rows = await rowsFor("rv-care");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "canvas_revisit",
      title: revisitTitle("conflict", "conflict"),
      body: revisitBody("conflict", "care-holders"),
      actor_user_id: null,
      emailed_at: null,
    });
    for (const name of ["Moss", "Ash", "Wren", "rv-admin", "rv-member"]) {
      expect(`${rows[0].title} ${rows[0].body} ${rows[0].link}`).not.toContain(name);
    }
    expect(await rowsFor("rv-member"), "nobody else hears a conflict moment").toEqual([]);
    expect(await rowsFor("rv-admin")).toEqual([]);
    expect(sent, "no immediate email for this kind").toEqual([]);
  });

  it("reaches the digest as its title alone", async () => {
    const at = new Date();
    await deliverCanvasRevisit({ ...host(), now: () => at }, { trigger: "love-letter-admitted" });
    const digest = await runNotificationDigest(spine());
    expect(digest).toEqual({ users: 1, rows: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["rv-admin@example.test"]);
    expect(sent[0].html).toContain("Does our Stakeholders answer still hold?");
    expect(sent[0].html, "the body stays in the app").not.toContain("Nothing was sent to them");
  });

  it("raises from a recorded audit event only once the row is written", async () => {
    const seen: string[] = [];
    setCanvasRevisitDelivery(async (req) => {
      seen.push(req.trigger);
    });
    const stop = observeKeyMoments();
    try {
      await recordEvent(pool, { kind: "audit", text: "network:peer-added:Alder Creek", entityType: "peer", entityRef: "peer-1", audience: "admin" });
      await recordEvent(pool, { kind: "audit", text: "exit:opened:voluntary", entityType: "user", entityRef: "u", audience: "admin" });
      const broken = { query: async () => { throw new Error("no database"); } } as unknown as Pool;
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      await recordEvent(broken, { kind: "audit", text: "bootstrap:founder", entityType: "user", entityRef: "u", audience: "admin" });
      quiet.mockRestore();
      await settleCanvasRevisits();
      expect(seen, "the peer event raised its moment; the exit event is raised by its route; a failed insert raised nothing").toEqual(["peer-added"]);
    } finally {
      stop();
    }
  });
});

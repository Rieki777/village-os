/**
 * The schedule beside Sync now, against a real schema.
 *
 * WHAT IS PINNED, each with the control that makes its absence mean something:
 *
 *   1. Off never calls the service and writes nothing. Neither does a module
 *      that is off. The control is the same check with the schedule on.
 *   2. A missing key is written once, never every check, and the service is
 *      never called while it is missing.
 *   3. ONLY A REAL CHANGE MAKES A BATCH. A scheduled read that matches the
 *      last read that landed leaves the review queue exactly as it was; the
 *      control is a changed read, which lands. A press still moves the waiting
 *      batch on an unchanged read, which is how Sync now has always behaved.
 *   4. A press and a scheduled run never run at once, and a process that dies
 *      holding the lock does not hold it for good.
 *   5. Failures stretch the gap and never shrink it below the schedule.
 *   6. The log holds no key and none of the service's words.
 *   7. A RECORD THE SERVICE STOPS SENDING LEAVES THE QUEUE, and comes back
 *      if the service sends it again. Only a kind read whole and not empty
 *      can say a record is gone; the controls are a failed, a cut-short and
 *      an empty read of the same kind, which withdraw nothing.
 *
 * The service is a stub; the queue, the facts, the lock and the log are real.
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { createHash } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type mysql from "mysql2/promise";
import type { SyncRun } from "../../shared/saberraSyncLog";

const state = vi.hoisted(() => ({
  token: "t0ken-SECRET-9f2a" as string | null,
  schedule: "every-6-hours" as string | undefined,
  lifecycle: "preview",
  session: "sess-1" as string | null,
  /** Records per wire kind. */
  read: {} as Record<string, unknown[]>,
  /** A failure per wire kind, in the client's own shape. */
  fail: {} as Record<string, { why: string; detail: string }>,
  /** Wire kinds whose every page says more follows, so the read is cut short. */
  endless: {} as Record<string, boolean>,
  /** Every call that reached the service: sessions opened and tools called. */
  calls: 0,
  /** When set, opening a session waits on it: a sync held mid-flight. */
  gate: null as Promise<void> | null,
  entered: null as (() => void) | null,
}));

vi.mock("./secrets", () => ({
  secretStatus: () => ({
    key: "sera_api_secret",
    configured: state.token !== null,
    source: state.token !== null ? "admin" : "none",
    last4: state.token !== null ? state.token.slice(-4) : null,
    setBy: null,
    setAt: null,
    atRest: "sealed",
    unreadable: false,
  }),
  villageSecretsConfigured: () => true,
  villageSecretsKeyProblem: () => null,
  secretValue: () => state.token,
}));

vi.mock("./saberraClient", () => ({
  openSession: async () => {
    state.calls += 1;
    state.entered?.();
    if (state.gate) await state.gate;
    return state.session;
  },
  listTools: async () => ({ ok: true, tools: [] }),
  callTool: async (_c: unknown, _s: string, _t: string, args: Record<string, unknown>) => {
    state.calls += 1;
    const wire = String(args.kind);
    const failure = state.fail[wire];
    if (failure) return { ok: false, ...failure };
    return { ok: true, records: state.read[wire] ?? [], cursor: state.endless[wire] ? "more" : null };
  },
}));

vi.mock("./modules", () => ({
  moduleConfig: () => ({
    apiUrl: "https://service.example.test/mcp",
    ...(state.schedule !== undefined ? { pollSchedule: state.schedule } : {}),
  }),
  effectiveLifecycle: () => state.lifecycle,
}));

vi.mock("./identity", () => ({ instanceIdentity: () => ({ instanceId: "village-1", bornAt: "" }) }));

import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { proposalsInBatch } from "./externalProposals";
import { proposalRowById } from "../repos/externalProposals";
import { BUSY_SENTENCE, SYNC_LOCK, pollOnce, syncByHand, syncRunsAnswer } from "./saberraSync";
import { withNamedLock } from "../repos/namedLock";
import { readSyncLogDocument, writeSyncLogDocument } from "../repos/saberraSyncLog";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const HOUR = 60 * 60 * 1000;

/** A page id that reads as one, distinct per test, so no two tests share a claim. */
const pageId = (tag: string) => createHash("sha256").update(tag).digest("hex").slice(0, 32);

/** The service's read for one test: a circle, and two roles naming it by page id. */
function serviceHolds(tag: string, waterAim = "Holds the water.") {
  const circle = pageId(`${tag}-circle`);
  state.read = {
    circle: [{ id: circle, fields: { "Circle Name": `${tag} Land Circle`, Status: "Active", Notes: "Jane Example keeps this" } }],
    role: [
      { id: `${tag}-water`, fields: { "Role Name": `${tag} Water Steward`, Circle: [circle], Body: waterAim, Status: "Active" } },
      { id: `${tag}-purse`, fields: { "Role Name": `${tag} Purse Keeper`, Circle: [circle], Status: "Vacant", "Active Holders": ["p-1"] } },
    ],
    role_assignment: [],
  };
}

/** The service's read for one test: these circles and nothing else. */
function circlesHeld(tag: string, names: readonly string[]) {
  state.read = {
    circle: names.map((n) => ({ id: pageId(`${tag}-${n}`), fields: { "Circle Name": `${tag} ${n}`, Status: "Active" } })),
    role: [],
    role_assignment: [],
  };
}

/** Each waiting proposal in a batch, by the circle it names. */
async function circlesWaiting(batch: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of await proposalsInBatch(pool, batch)) {
    if (p.kind === "circle.proposed" && p.status === "proposed") out.set(String((p.payload as Record<string, unknown>)["Circle Name"]), p.id);
  }
  return out;
}

async function runs(): Promise<SyncRun[]> {
  const doc = await readSyncLogDocument(pool);
  return ((doc?.runs as SyncRun[] | undefined) ?? []).slice();
}

const waiting = async (batch: string) =>
  (await proposalsInBatch(pool, batch)).filter((p) => p.status === "proposed").map((p) => `${p.kind}:${p.id}`).sort();

/** A clock this many milliseconds from a fixed start. */
let t0 = 0;
const at = (ms: number) => () => t0 + ms;

describe.skipIf(!configured)("the schedule beside Sync now", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    state.token = "t0ken-SECRET-9f2a";
    state.schedule = "every-6-hours";
    state.lifecycle = "preview";
    state.session = "sess-1";
    state.read = {};
    state.fail = {};
    state.endless = {};
    state.calls = 0;
    state.gate = null;
    state.entered = null;
    t0 = Date.now();
    // Every test starts from an empty log, written the way the sync writes it.
    await writeSyncLogDocument(pool, { runs: [], landedFingerprint: null });
  });

  describe("when the schedule may call", () => {
    it("OFF NEVER CALLS THE SERVICE AND WRITES NOTHING, absent or saved as off", async () => {
      serviceHolds("off");
      for (const schedule of [undefined, "off"]) {
        state.schedule = schedule;
        expect(await pollOnce(pool, at(48 * HOUR))).toBe("the schedule is off");
      }
      expect(state.calls).toBe(0);
      expect(await runs()).toEqual([]);

      // The control: the same check with the schedule on does call.
      state.schedule = "daily";
      await pollOnce(pool, at(48 * HOUR));
      expect(state.calls).toBeGreaterThan(0);
      expect((await runs())[0]).toMatchObject({ trigger: "scheduled", outcome: "landed" });
    });

    it("never polls a module that is off, whatever the schedule says", async () => {
      serviceHolds("module-off");
      state.lifecycle = "off";
      state.schedule = "daily";
      expect(await pollOnce(pool, at(48 * HOUR))).toBe("the module is off");
      expect(state.calls).toBe(0);
      expect(await runs()).toEqual([]);
    });

    it("SAYS 'NOT RUN: NO KEY' ONCE, never calls the service, and runs the check after the key arrives", async () => {
      serviceHolds("no-key");
      state.token = null;
      for (const later of [0, 5 * 60 * 1000, 10 * 60 * 1000, 7 * HOUR]) await pollOnce(pool, at(later));
      expect(state.calls).toBe(0);
      const said = await runs();
      expect(said).toHaveLength(1);
      expect(said[0]).toMatchObject({ trigger: "scheduled", outcome: "not-run", reason: "no-key", error: "Not run: no key is set for the service." });

      // The key arrives: the very next check calls, because nothing has yet.
      state.token = "t0ken-SECRET-9f2a";
      await pollOnce(pool, at(7 * HOUR + 5 * 60 * 1000));
      expect(state.calls).toBeGreaterThan(0);
      expect((await runs()).map((r) => r.outcome)).toEqual(["landed", "not-run"]);

      // Gone again, and due again: said once more, because it is news again.
      state.token = null;
      await pollOnce(pool, at(14 * HOUR));
      await pollOnce(pool, at(14 * HOUR + 5 * 60 * 1000));
      expect((await runs()).map((r) => r.outcome)).toEqual(["not-run", "landed", "not-run"]);
    });
  });

  describe("only a real change makes a batch", () => {
    it("A SCHEDULED READ THAT MATCHES THE LAST LANDING TOUCHES NOTHING IN THE QUEUE", async () => {
      serviceHolds("same");
      state.session = "same-press";
      expect((await syncByHand(pool)).status).toBe(200);
      const before = await waiting("sync-same-press");
      expect(before.length).toBeGreaterThan(1);

      state.session = "same-poll";
      const said = await pollOnce(pool, at(7 * HOUR));
      expect(said).toContain("no-change");
      expect(await waiting("sync-same-poll")).toEqual([]);
      expect(await waiting("sync-same-press")).toEqual(before);
      expect((await runs())[0]).toMatchObject({ trigger: "scheduled", outcome: "no-change", records: 3, landed: 0, rebatched: 0 });

      // The control: a changed claim at the service does land, as a new batch.
      serviceHolds("same", "Holds the water, and the wells.");
      state.session = "same-poll-2";
      expect(await pollOnce(pool, at(14 * HOUR))).toContain("landed");
      const fresh = await waiting("sync-same-poll-2");
      expect(fresh.some((p) => p.startsWith("org.proposed:"))).toBe(true);
      expect((await runs())[0]).toMatchObject({ trigger: "scheduled", outcome: "landed", superseded: 1 });
    });

    it("reads a change the boundary drops as no change, because nothing this village would propose moved", async () => {
      serviceHolds("dropped");
      state.session = "dropped-press";
      await syncByHand(pool);
      // A person added to a seat at the service: `Active Holders` never crosses.
      (state.read.role[1] as { fields: Record<string, unknown> }).fields["Active Holders"] = ["p-1", "p-2"];
      state.session = "dropped-poll";
      expect(await pollOnce(pool, at(7 * HOUR))).toContain("no-change");
      expect(await waiting("sync-dropped-poll")).toEqual([]);
    });

    it("A PRESS KEEPS TODAY'S BEHAVIOUR: an unchanged read still moves the waiting batch into its own", async () => {
      serviceHolds("press");
      state.session = "press-1";
      await syncByHand(pool);
      const first = await waiting("sync-press-1");
      state.session = "press-2";
      expect((await syncByHand(pool)).status).toBe(200);
      expect(await waiting("sync-press-1")).toEqual([]);
      expect((await waiting("sync-press-2")).length).toBe(first.length);
      expect((await runs()).map((r) => [r.trigger, r.outcome])).toEqual([
        ["by-hand", "landed"],
        ["by-hand", "landed"],
      ]);
    });

    it("lands nothing from a scheduled read with a kind missing, because half a read is not a change", async () => {
      serviceHolds("half");
      state.fail = { role: { why: "vendor-error", detail: "scope does not permit this tool" } };
      state.session = "half-poll";
      expect(await pollOnce(pool, at(0))).toBe("failed: kind-failed");
      expect(await waiting("sync-half-poll")).toEqual([]);
      expect((await runs())[0]).toMatchObject({
        outcome: "failed",
        reason: "kind-failed",
        failed: [{ kind: "role", why: "vendor-error" }],
        landed: 0,
      });
    });
  });

  describe("never two at once", () => {
    it("A PRESS AND A SCHEDULED RUN NEVER RUN TOGETHER, and the second press is told why", async () => {
      serviceHolds("overlap");
      let open!: () => void;
      state.gate = new Promise<void>((r) => (open = r));
      const inside = new Promise<void>((r) => (state.entered = r));
      const press = syncByHand(pool);
      await inside;
      state.entered = null;
      expect(state.calls).toBe(1);

      // Raced against a clock, so a second sync that DID go in, and is now
      // waiting on the same held call, fails here by name instead of hanging.
      const settle = <T,>(p: Promise<T>) =>
        Promise.race([p, new Promise<string>((r) => setTimeout(() => r("it went in beside the press"), 3000))]);
      expect(await settle(pollOnce(pool, at(48 * HOUR)))).toBe("a sync was already running, so this check waits for the next one");
      expect(await settle(syncByHand(pool))).toEqual({ status: 409, body: { error: BUSY_SENTENCE, state: "busy" } });
      // Neither of them reached the service.
      expect(state.calls).toBe(1);

      open();
      expect((await press).status).toBe(200);
      expect((await runs()).map((r) => r.trigger)).toEqual(["by-hand"]);
    });

    it("A HOLDER THAT DIES FREES THE LOCK, so a crash never shuts the sync out", async () => {
      serviceHolds("crash");
      const elsewhere = testPool(db, { connectionLimit: 1 });
      let inside!: () => void;
      const held = new Promise<void>((r) => (inside = r));
      // Another process takes the lock and never lets go of its own accord.
      void withNamedLock(elsewhere, SYNC_LOCK, async () => {
        inside();
        await new Promise<void>(() => undefined);
      }).catch(() => undefined);
      await held;
      expect((await syncByHand(pool)).status).toBe(409);
      expect(state.calls).toBe(0);

      // That process dies: its connection closes with the lock still taken.
      await elsewhere.end().catch(() => undefined);
      let status = 409;
      for (let i = 0; i < 30 && status === 409; i += 1) {
        status = (await syncByHand(pool)).status;
        if (status === 409) await new Promise((r) => setTimeout(r, 100));
      }
      expect(status).toBe(200);
    });
  });

  describe("backing off", () => {
    it("STRETCHES THE GAP AFTER CONSECUTIVE FAILURES, SAYS SO, and never asks faster than the schedule", async () => {
      serviceHolds("backoff");
      state.session = null;

      await pollOnce(pool, at(0));
      // One failure retries on the schedule itself.
      expect((await syncRunsAnswer(pool, at(1 * HOUR))).backoff).toEqual({ failures: 1, factor: 1 });
      expect(await pollOnce(pool, at(5 * HOUR))).toContain("next sync due");
      await pollOnce(pool, at(6 * HOUR));
      expect(state.calls).toBe(2);

      // Two in a row: the next wait is twice the schedule, and the panel is told.
      const two = await syncRunsAnswer(pool, at(7 * HOUR));
      expect(two.backoff).toEqual({ failures: 2, factor: 2 });
      expect(Date.parse(two.nextAt!)).toBe(t0 + 18 * HOUR);
      expect(await pollOnce(pool, at(12 * HOUR))).toContain("next sync due");
      expect(state.calls).toBe(2);

      await pollOnce(pool, at(18 * HOUR));
      // Three: four times, which is as far as it stretches.
      const three = await syncRunsAnswer(pool, at(19 * HOUR));
      expect(three.backoff).toEqual({ failures: 3, factor: 4 });
      expect(Date.parse(three.nextAt!)).toBe(t0 + 42 * HOUR);
      await pollOnce(pool, at(41 * HOUR));
      expect(state.calls).toBe(3);
      await pollOnce(pool, at(42 * HOUR));
      expect((await syncRunsAnswer(pool, at(43 * HOUR))).backoff).toEqual({ failures: 4, factor: 4 });

      // The service answers again: one whole read and the gap is the schedule's own.
      state.session = "backoff-back";
      await pollOnce(pool, at(66 * HOUR));
      const back = await syncRunsAnswer(pool, at(67 * HOUR));
      expect(back.backoff).toEqual({ failures: 0, factor: 1 });
      expect(Date.parse(back.nextAt!)).toBe(t0 + 72 * HOUR);
      const calls = state.calls;
      await pollOnce(pool, at(72 * HOUR - 60 * 1000));
      expect(state.calls).toBe(calls);
    });
  });

  describe("a record the service stops sending", () => {
    it("IS WITHDRAWN BY THE NEXT WHOLE READ OF ITS KIND, and the run counts it", async () => {
      circlesHeld("gone", ["Kept", "Dropped"]);
      state.session = "gone-1";
      await syncByHand(pool);
      const first = await circlesWaiting("sync-gone-1");
      expect([...first.keys()].sort()).toEqual(["gone Dropped", "gone Kept"]);

      circlesHeld("gone", ["Kept"]);
      state.session = "gone-2";
      const pressed = await syncByHand(pool);
      expect(pressed.body.gone).toBe(1);
      expect([...(await circlesWaiting("sync-gone-2")).keys()]).toEqual(["gone Kept"]);
      expect((await circlesWaiting("sync-gone-1")).size).toBe(0);
      expect((await proposalRowById(pool, first.get("gone Dropped")!))?.status).toBe("superseded");
      expect((await runs())[0]).toMatchObject({ trigger: "by-hand", outcome: "landed", gone: 1, rebatched: 1 });
    });

    it("is NOT withdrawn when its kind failed, was cut short, or came back empty", async () => {
      circlesHeld("kept", ["A", "B"]);
      state.session = "kept-1";
      await syncByHand(pool);
      const b = (await circlesWaiting("sync-kept-1")).get("kept B")!;

      // The kind failed: a press still lands the rest, and B is still waiting.
      circlesHeld("kept", ["A"]);
      state.fail = { circle: { why: "vendor-error", detail: "busy" } };
      state.session = "kept-2";
      await syncByHand(pool);
      expect((await proposalRowById(pool, b))?.status).toBe("proposed");

      // Cut short at the page ceiling: what was not reached is not missing.
      state.fail = {};
      state.endless = { circle: true };
      state.session = "kept-3";
      await syncByHand(pool);
      expect((await runs())[0]!.truncated).toEqual(["circle"]);
      expect((await proposalRowById(pool, b))?.status).toBe("proposed");

      // An empty answer for the kind is too thin to withdraw on.
      state.endless = {};
      state.read.circle = [];
      state.session = "kept-4";
      await syncByHand(pool);
      expect((await proposalRowById(pool, b))?.status).toBe("proposed");
      expect((await runs())[0]).toMatchObject({ gone: 0 });

      // The control: the same read, whole and not empty, does withdraw it.
      circlesHeld("kept", ["A"]);
      state.session = "kept-5";
      await syncByHand(pool);
      expect((await proposalRowById(pool, b))?.status).toBe("superseded");
    });

    it("COMES BACK when the service sends it again unchanged, into the newest batch", async () => {
      circlesHeld("back", ["A", "B"]);
      state.session = "back-1";
      await syncByHand(pool);
      const b = (await circlesWaiting("sync-back-1")).get("back B")!;
      circlesHeld("back", ["A"]);
      state.session = "back-2";
      await syncByHand(pool);
      expect((await proposalRowById(pool, b))?.status).toBe("superseded");

      circlesHeld("back", ["A", "B"]);
      state.session = "back-3";
      await syncByHand(pool);
      const now = await circlesWaiting("sync-back-3");
      expect([...now.keys()].sort()).toEqual(["back A", "back B"]);
      expect(now.get("back B")).toBe(b);
      expect((await runs())[0]).toMatchObject({ gone: 0 });
    });

    it("never withdraws what a steward already decided", async () => {
      circlesHeld("decided", ["A", "B"]);
      state.session = "decided-1";
      await syncByHand(pool);
      const b = (await circlesWaiting("sync-decided-1")).get("decided B")!;
      await pool.query("UPDATE external_proposals SET status = 'rejected' WHERE id = ?", [b]); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, standing in for a steward's reject
      circlesHeld("decided", ["A"]);
      state.session = "decided-2";
      await syncByHand(pool);
      expect((await proposalRowById(pool, b))?.status).toBe("rejected");
    });
  });

  describe("what the log keeps", () => {
    it("NEVER HOLDS THE KEY OR ANY OF THE SERVICE'S WORDS, scheduled or pressed", async () => {
      serviceHolds("words");
      state.fail = { role_assignment: { why: "vendor-error", detail: "scope refused for jane@example.org" } };
      state.session = "words-poll";
      await pollOnce(pool, at(0));
      state.session = "words-press";
      await syncByHand(pool);

      const doc = JSON.stringify(await readSyncLogDocument(pool));
      // The known positive: both runs are there, and their failure is named.
      const kept = await runs();
      expect(kept.map((r) => [r.trigger, r.outcome, r.reason])).toEqual([
        ["by-hand", "landed", "partial"],
        ["scheduled", "failed", "kind-failed"],
      ]);
      expect(kept[1]!.failed).toEqual([{ kind: "roleAssignment", why: "vendor-error" }]);
      expect(kept[0]!.circles).toMatchObject({ placed: 2, shapes: ["list of 1 id"] });
      for (const never of ["t0ken", "SECRET", "9f2a", "scope", "jane", "example.org", "Jane Example", "Water Steward", "Holds the water", "Circle Name", "Active Holders"]) {
        expect(doc).not.toContain(never);
      }
    });
  });
});

/**
 * THE CONTRIBUTOR RUNG, ON EVERY SURFACE THAT COMPUTES A STAGE.
 *
 * `computeStage` takes FOUR facts, and the fourth one is "has the village ever
 * paid this member for something they brought it". It carries the whole
 * Contributor rung, which is the rung that opens `member.vouch`.
 *
 * The fourth parameter CARRIED A DEFAULT of false until the commit that adds
 * this file. That default is what made the defect silent: a caller that handed
 * over three arguments compiled, ran, and answered a rung too low for anybody
 * the village had paid. The default is gone now, so the compiler asks the
 * question, and these cases hold the two surfaces to the answer. `stageOf` and
 * `GET /api/game/progression` pass all four. Two surfaces did not, and they are
 * the two a steward reads:
 *
 *   1. `GET /api/admin/players`, the roster (server/routes/players.ts). A
 *      steward deciding whether somebody may vouch a neighbour in reads the
 *      rung off this list, and it said Member for a member the village had paid.
 *   2. `members_at_stage:<rung>`, the vision metric (server/lib/orgDrafts.ts).
 *      An objective reading "twelve Contributors" is a TRIGGER: meeting it
 *      prompts a human to publish a reorganisation. Undercounting it holds the
 *      village back from a threshold it has already crossed.
 *
 * WHAT IS UNDER TEST HERE IS NOT THE LADDER. `climbLadder` has its own suite
 * (server/lib/admission.test.ts) and `hasBeenPaidByVillage` has its own
 * (server/ledger.test.ts). The question these cases ask is whether each surface
 * SUPPLIES the fourth fact, and whether it supplies one it read from the real
 * ledger. So the payment below is a real `postTransfer` through a real
 * migration-applied schema, read back through the real batched reader, and the
 * ladder stand-in records the argument it was handed as well as answering.
 *
 * AND WHAT IT COSTS. The roster lists every member, so a per-member read here
 * would turn one page into N queries. The cost case asserts ONE call for the
 * whole roll, which is what the consented counts and the training completions
 * beside it already go out of their way to do.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and it skips loudly.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import {
  CYCLE_POOL_FAUCET,
  contributionTokens,
  loadTokenRegistry,
  memberAccount,
  paidByVillageMany,
  postTransfer,
} from "./lib/ledger";
import { climbLadder } from "./lib/admission";
import { GAME_CONFIG } from "../shared/gameConfig";
import { register as registerPlayers } from "./routes/players";
import { measureVisionMetrics } from "./lib/orgDrafts";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

/** Everyone on the roll. `paid-*` is paid by the village; `dry-*` never is. */
const ROLL = [
  { id: "paid-worker", name: "Ada Paid", membershipGranted: true },
  { id: "dry-member", name: "Bo Dry", membershipGranted: true },
  { id: "dry-guest", name: "Cy Guest", membershipGranted: false },
];

/**
 * The ladder, built from the REAL `climbLadder` and the REAL stage array, with
 * the rules these cases turn on.
 *
 * It stands in for the `computeStage` that server/index.ts declares at module
 * scope: that one is a closure over the whole boot (the game variables, the
 * training catalogue, the capability registry) and cannot be imported, which is
 * exactly why both surfaces are handed it through `deps`. Substituting it here
 * is the same move `server/routes/pathLadders.test.ts` makes with the pool.
 *
 * `seen` records the fourth argument, so a case can fail on WHAT THE SURFACE
 * HANDED OVER and not only on the rung that came back. A surface that passes
 * nothing leaves `undefined` behind, which is a different failure from a
 * surface that passes a wrong answer, and the two deserve to be told apart.
 */
function ladder() {
  const seen = new Map<string, boolean | undefined>();
  const computeStage = (
    user: any,
    consentedQuests: number,
    trainingDone: readonly string[],
    paidByVillage?: boolean,
  ): string => {
    seen.set(String(user.id), paidByVillage);
    return climbLadder(GAME_CONFIG.stages, user, (stage) => {
      switch (stage.rule.type) {
        case "default":
        case "account":
          return true;
        case "membership":
          return !!user.membershipGranted;
        case "tokens":
          return !!paidByVillage;
        case "quests":
          return consentedQuests >= 3;
        // This village has no training modules, so nobody has finished them.
        case "training-complete":
          return false;
        default:
          return false;
      }
    });
  };
  return { computeStage, seen };
}

/** A pool that answers like the real one and counts what it was asked. */
function counting(real: mysql.Pool) {
  const asked: string[] = [];
  const wrapped: any = {
    query: (sql: any, params?: any) => {
      asked.push(String(typeof sql === "string" ? sql : sql?.sql ?? sql));
      return (real as any).query(sql, params);
    },
  };
  return { pool: wrapped as mysql.Pool, asked };
}

/** The roster handler, registered the way server/index.ts registers it. */
function roster(deps: Record<string, unknown>) {
  const handlers = new Map<string, (req: any, res: any) => Promise<unknown> | unknown>();
  const record = (method: string) => (path: string, handler: any) => {
    handlers.set(`${method} ${path}`, handler);
  };
  registerPlayers(
    { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") } as any,
    deps as any,
  );
  return handlers.get("GET /api/admin/players")!;
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

describe.skipIf(!configured)("the rung the village pays you onto reaches every surface", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await loadTokenRegistry(pool);
    // A REAL payment, through the real primitive, from a village faucet, for a
    // source `server/lib/contributionPay.ts` counts as the village paying
    // somebody for what they brought it.
    const posted = await postTransfer(pool, {
      from: CYCLE_POOL_FAUCET,
      to: memberAccount("paid-worker"),
      amount: 25,
      tokenType: "credits",
      source: "quest_consent",
      idempotencyKey: "paid-worker-consented-quest",
    });
    expect(posted.error ?? "", `the ledger refused this post: ${posted.error ?? ""}`).toBe("");
    expect(posted.ok).toBe(true);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /** What server/index.ts hands both surfaces, wired to the real reader. */
  const paidByVillage = (p: mysql.Pool) => (ids: readonly string[]) =>
    paidByVillageMany(p, ids, contributionTokens());

  it("the ledger says the village paid one of these three", async () => {
    // The floor under every case below. An empty answer here would make each of
    // them pass for the wrong reason, and an empty search proves nothing until
    // a known positive has hit.
    const paid = await paidByVillageMany(pool, ROLL.map((u) => u.id), contributionTokens());
    expect(paid.has("paid-worker")).toBe(true);
    expect(paid.has("dry-member")).toBe(false);
    expect(paid.has("dry-guest")).toBe(false);
  });

  it("the admin roster reads a paid member at Contributor", async () => {
    const { computeStage, seen } = ladder();
    const handler = roster({
      isAdmin: async () => true,
      members: { all: async () => ROLL },
      claimsRepo: { consentedCounts: async () => new Map<string, number>() },
      trainingCompletions: async () => new Map<string, string[]>(),
      paidByVillage: paidByVillage(pool),
      computeStage,
      hasMembership: (u: any) => !!u.membershipGranted,
      stageOf: async () => "",
      recordStageEvent: async () => {},
    });
    const { res, out } = makeRes();
    await handler({}, res);

    expect(out.status).toBe(200);
    const byId = new Map((out.body as any[]).map((r) => [r.id, r]));
    expect(byId.get("paid-worker")?.stageComputed).toBe("contributor");
    // The fourth fact ARRIVED, rather than being defaulted away. A surface that
    // passes nothing leaves undefined here even when the rung happens to read
    // right for some other reason.
    expect(seen.get("paid-worker")).toBe(true);
    expect(seen.get("dry-member")).toBe(false);
  });

  it("the admin roster still reads an unpaid member at the rung they earned", async () => {
    // The other half, so the fix cannot be "say contributor for everyone".
    const { computeStage } = ladder();
    const handler = roster({
      isAdmin: async () => true,
      members: { all: async () => ROLL },
      claimsRepo: { consentedCounts: async () => new Map<string, number>() },
      trainingCompletions: async () => new Map<string, string[]>(),
      paidByVillage: paidByVillage(pool),
      computeStage,
      hasMembership: (u: any) => !!u.membershipGranted,
      stageOf: async () => "",
      recordStageEvent: async () => {},
    });
    const { res, out } = makeRes();
    await handler({}, res);

    const byId = new Map((out.body as any[]).map((r) => [r.id, r]));
    expect(byId.get("dry-member")?.stageComputed).toBe("member");
    expect(byId.get("dry-guest")?.stageComputed).toBe("guest");
  });

  it("the admin roster asks the ledger ONCE for the whole roll", async () => {
    // The roster lists every member. A per-member read here is the N+1 the
    // grouped consented count and the batched training completions beside it
    // both exist to avoid, and it would arrive as a page that slows down as the
    // village grows rather than as a failure anybody notices.
    const { pool: counted, asked } = counting(pool);
    let calls = 0;
    const { computeStage } = ladder();
    const handler = roster({
      isAdmin: async () => true,
      members: { all: async () => ROLL },
      claimsRepo: { consentedCounts: async () => new Map<string, number>() },
      trainingCompletions: async () => new Map<string, string[]>(),
      paidByVillage: (ids: readonly string[]) => {
        calls += 1;
        return paidByVillageMany(counted, ids, contributionTokens());
      },
      computeStage,
      hasMembership: (u: any) => !!u.membershipGranted,
      stageOf: async () => "",
      recordStageEvent: async () => {},
    });
    const { res, out } = makeRes();
    await handler({}, res);

    expect(out.status).toBe(200);
    expect(calls).toBe(1);
    expect(asked.filter((s) => s.includes("token_ledger"))).toHaveLength(1);
  });

  it("the members_at_stage tally counts a paid member as a Contributor", async () => {
    const { computeStage, seen } = ladder();
    const measured = await measureVisionMetrics(pool, new Set(["members_at_stage:contributor"]), {
      lapseContext: () => ({ cadence: "never", currentSeasonId: null }),
      allMembers: async () => ROLL as any[],
      consentedCounts: async () => new Map<string, number>(),
      isExampleUser: () => false,
      computeStage,
      trainingCompletions: async () => new Map<string, string[]>(),
      paidByVillage: paidByVillage(pool),
      seasonsCompleted: () => 0,
    } as any);

    expect(measured.get("members_at_stage:contributor")).toBe(1);
    expect(seen.get("paid-worker")).toBe(true);
  });

  it("the members_at_stage tally counts the rungs below it the same way", async () => {
    // Member is a floor, so all three of the paid member, the admitted one and
    // nobody else clear it. This is the half that would still read right with
    // the fourth fact missing, and it must not move.
    const { computeStage } = ladder();
    const measured = await measureVisionMetrics(pool, new Set(["members_at_stage:member"]), {
      lapseContext: () => ({ cadence: "never", currentSeasonId: null }),
      allMembers: async () => ROLL as any[],
      consentedCounts: async () => new Map<string, number>(),
      isExampleUser: () => false,
      computeStage,
      trainingCompletions: async () => new Map<string, string[]>(),
      paidByVillage: paidByVillage(pool),
      seasonsCompleted: () => 0,
    } as any);

    expect(measured.get("members_at_stage:member")).toBe(2);
  });
});

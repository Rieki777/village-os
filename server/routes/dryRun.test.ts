/**
 * THE MEMBER'S DOOR ONTO THE TEST RUN (R12).
 *
 * Rye: "any member as all members may suggest upgrades and will need to run
 * models and tests." Until this lane, `POST /api/admin/dry-run` answered
 * `auth_required` to every signed-in member, so the only tool that says what a
 * village's settings would do was reachable by the two accounts least likely to
 * be surprised by the answer.
 *
 * This file drives the handler itself. `register` is called against a fake
 * Express that records handlers by method and path, the shape
 * `server/routes/needs.test.ts` and `server/routes/land.test.ts` use, so what
 * runs is the real registration and the real handler body. The pool is a stub
 * that answers three SELECTs and RECORDS every statement, which is how the "it
 * writes nothing" claim is measured here instead of asserted.
 *
 * The sibling `server/dryRun.routes.e2e.test.ts` proves the same properties
 * over HTTP against a real schema, with real sign-in and the real MySQL-backed
 * rate limiter. This one is the fast half and it can drive the cases that are
 * expensive to reach over the wire: the twenty-first run of an hour, a second
 * member who has run nothing, and a village whose rules carry a queued change.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cycleBoundsFor } from "../../shared/lunar";
import { loadTokenRegistry } from "../lib/ledger";
import { register, RUNS_PER_WINDOW, RUN_WINDOW_MS } from "./dryRun";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

/** A fake Express that keeps the handlers `register` hands it. */
function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") },
    handlers,
  };
}

/** Captures what a handler answered. */
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

/**
 * Two `mint_rules` rows, chosen so that BOTH halves of the narrowing are
 * visible in a sentence.
 *
 * The Gratitude rule is on and carries a queued amount change. The Credits
 * rule is switched OFF and carries a queued change that switches it on. That
 * second row is the one that took a rewrite to get right: a rule that is
 * merely disabled is invisible to an admin's report as well, because
 * `rulesInForce` filters on `enabled` for everybody, so a fixture without the
 * pending switch-on would have asserted a difference that does not exist and
 * gone green for the wrong reason. With the switch-on, the admin watches
 * Credits come on and start paying, and the member's report never mentions it.
 *
 * BUILT AT MOUNT TIME, never at import. The queued changes are stamped for the
 * moon after the one the run starts in, and a constant computed when this file
 * loaded would name the wrong moon for any run that crossed a lunation between
 * import and call. Reading the clock beside the handler removes the window.
 */
const ruleRows = (pendingFrom: number) => [
  {
    id: "rule-role.cycle-gratitude",
    trigger: "role.cycle",
    token_slug: "gratitude",
    amount: 20,
    ceiling: 100,
    enabled: 1,
    effective_from_cycle: 0,
    pending_amount: 45,
    pending_ceiling: 100,
    pending_enabled: 1,
    pending_from_cycle: pendingFrom,
  },
  {
    id: "rule-role.cycle-credits",
    trigger: "role.cycle",
    token_slug: "credits",
    amount: 25,
    ceiling: 100,
    enabled: 0,
    effective_from_cycle: 0,
    pending_amount: 25,
    pending_ceiling: 100,
    pending_enabled: 1,
    pending_from_cycle: pendingFrom,
  },
];

type RuleRow = ReturnType<typeof ruleRows>[number];

/**
 * A pool that answers the route's three reads and keeps every statement.
 *
 * The recording is the point. "This route writes nothing" is a claim about
 * what reaches the database, and the only honest way to check it here is to
 * read back what the handler actually sent.
 */
function stubPool(rules: RuleRow[]) {
  const statements: string[] = [];
  const pool = {
    async query(sql: string) {
      statements.push(sql);
      if (/FROM app_config/i.test(sql)) return [[], []];
      if (/org_role_assignments/i.test(sql)) return [[{ n: 2 }], []];
      if (/mint_rules/i.test(sql)) return [rules, []];
      throw new Error(`the route asked something this stub does not answer: ${sql}`);
    },
  } as any;
  return { statements, pool };
}

/**
 * A sliding-window limiter with the same shape as `overLimit` in
 * server/index.ts: count what is inside the window, refuse at the cap, and
 * otherwise record a hit. Keyed by bucket, so a wrong bucket key shows up as a
 * member limited by somebody else's runs.
 */
function limiter() {
  const hits = new Map<string, number[]>();
  const calls: Array<{ bucket: string; max: number; windowMs: number }> = [];
  return {
    hits,
    calls,
    overLimit: async (bucket: string, max: number, windowMs: number) => {
      calls.push({ bucket, max, windowMs });
      const now = Date.now();
      const seen = (hits.get(bucket) ?? []).filter((t) => t > now - windowMs);
      hits.set(bucket, seen);
      if (seen.length >= max) return true;
      seen.push(now);
      return false;
    },
  };
}

interface MountOptions {
  user?: { id: string } | null;
  admin?: boolean;
  /** Whether the enabled rule is switched off too, for the all-off case. */
  allOff?: boolean;
  overLimit?: (bucket: string, max: number, windowMs: number) => Promise<boolean>;
}

function mount(opts: MountOptions = {}) {
  const { app, handlers } = collect();
  const rows = ruleRows(cycleBoundsFor(new Date()).cycleNumber + 1);
  const { statements, pool } = stubPool(opts.allOff ? rows.map((r) => ({ ...r, enabled: 0 })) : rows);
  register(app, {
    authedUser: async () => (opts.user === undefined ? { id: "member-1" } : opts.user),
    isAdmin: async () => opts.admin === true,
    overLimit: opts.overLimit ?? (async () => false),
    getPool: () => pool,
  } as any);
  const run = async (body: unknown = { moons: 3 }) => {
    const handler = handlers.get("POST /api/dry-run");
    if (!handler) throw new Error("no handler registered for POST /api/dry-run");
    const { res, out } = makeRes();
    await handler({ params: {}, body }, res);
    return out;
  };
  return { handlers, statements, run };
}

beforeAll(async () => {
  /*
   * The token registry is an in-memory map that `loadTokenRegistry` fills at
   * boot from the `tokens` table. Without it every rule below would read as
   * paying an unregistered token and the report would carry the wrong refusal
   * for the right reason. Same four rows server/dryRun.test.ts uses.
   */
  const rows = [
    { slug: "gratitude", name: "Gratitude", kind: "recognition", governance: "platform", transferable: 0, decimals: 0, active: 1, is_example: 0 },
    { slug: "village-voice", name: "Village Voice", kind: "voice", governance: "platform", transferable: 0, decimals: 3, active: 1, is_example: 0 },
    { slug: "voice", name: "Voice", kind: "voice", governance: "hypha", transferable: 0, decimals: 3, active: 1, is_example: 0 },
    { slug: "credits", name: "Village Credits", kind: "credit", governance: "platform", transferable: 0, decimals: 4, active: 1, is_example: 0 },
  ];
  await loadTokenRegistry({ query: async () => [rows, []] } as any);
});

describe("one door, and it is not an admin one", () => {
  it("registers exactly POST /api/dry-run, and nothing under /api/admin", () => {
    const { handlers } = mount();
    expect([...handlers.keys()]).toEqual(["POST /api/dry-run"]);
    expect([...handlers.keys()].filter((k) => k.includes("/api/admin"))).toEqual([]);
  });

  it("refuses a signed-out caller, and never reaches the database", async () => {
    const { run, statements } = mount({ user: null });
    const out = await run();
    expect(out.status).toBe(401);
    expect(out.body.error).toBe("auth_required");
    expect(out.body.message, "a refusal says what to do next").toMatch(/sign in/i);
    expect(statements, "a refused run must not read the village").toEqual([]);
  });

  it("hands a signed-in member the report", async () => {
    const { run } = mount({ user: { id: "wren" } });
    const out = await run({ moons: 3 });
    expect(out.status).toBe(200);
    expect(out.body.moons).toBe(3);
    expect(out.body.turns).toHaveLength(3);
    // Every field the launch page's card reads by name.
    for (const field of ["turns", "runFindings", "allowances", "jobs", "refusals", "covered", "notCovered"]) {
      expect(Array.isArray(out.body[field]), `${field} must be an array the card can map over`).toBe(true);
    }
    expect(out.body.isolation).toMatch(/wrote nothing/i);
  });

  it("refuses a length nobody asked for rather than inventing one", async () => {
    const { run, statements } = mount();
    expect((await run({ moons: 0 })).status).toBe(400);
    expect((await run({ moons: 5000 })).status).toBe(400);
    expect((await run({ moons: 2.5 })).status).toBe(400);
    expect(statements, "a refused length must not read the village either").toEqual([]);
  });

  it("sends the database nothing but SELECTs", async () => {
    const { run, statements } = mount({ user: { id: "wren" } });
    const out = await run({ moons: 12 });
    expect(out.status).toBe(200);
    expect(statements.length, "the run read the village").toBeGreaterThan(0);
    for (const sql of statements) {
      expect(sql.trim().slice(0, 6).toUpperCase(), `not a read: ${sql}`).toBe("SELECT");
    }
  });
});

describe("what a member's report leaves out", () => {
  /**
   * Settlement sentences only, and that narrowness is load-bearing.
   *
   * The first draft searched the WHOLE report for "Village Credits" and went
   * red on a sentence that has nothing to do with rules: `gratitude.pool_token`
   * defaults to credits, so every report says what a cycle close would share.
   * A member is entitled to that. What they must not read is a payment from a
   * rule this village has switched off.
   */
  const settlementsIn = (body: any) =>
    JSON.stringify(body.turns.flatMap((t: any) => t.findings).filter((f: any) => f.area === "settlement"));

  it("drops the rule that is switched off, and the queued change on the one that is not", async () => {
    const { run } = mount({ user: { id: "wren" }, admin: false });
    const out = await run({ moons: 6 });
    expect(out.status).toBe(200);
    // The Credits rule is off. Its queued switch-on lands inside this run and
    // the member never reads a Credits payment because of it.
    expect(settlementsIn(out.body)).not.toContain("Village Credits");
    // No queued change is announced, in any moon.
    expect(out.body.turns.some((t: any) => t.findings.some((f: any) => f.area === "rules"))).toBe(false);
    expect(JSON.stringify(out.body)).not.toContain("20 becomes 45");
    // And the settlement pays the rule as it stands today, every moon, instead
    // of promoting the queued 45 partway through.
    for (const t of out.body.turns) {
      const paid = t.findings.find((f: any) => f.area === "settlement" && f.outcome === "issued");
      expect(paid?.sentence, `moon ${t.cycleNumber} settles at the live amount`).toContain("20 Gratitude");
    }
  });

  it("gives an admin the queued changes and the moon they land in", async () => {
    const { run } = mount({ user: { id: "founder" }, admin: true });
    const out = await run({ moons: 6 });
    expect(out.status).toBe(200);
    const landings = out.body.turns.filter((t: any) => t.findings.some((f: any) => f.area === "rules"));
    expect(landings, "both queued changes land in the same one moon").toHaveLength(1);
    const said = JSON.stringify(landings[0].findings);
    expect(said).toContain("20 becomes 45");
    expect(said, "a rule switching on is announced as that").toContain("it switches on");
    // From that moon the seat settles at the new amount, and Credits pays.
    const amountIn = (i: number, token: string) =>
      out.body.turns[i].findings.find(
        (f: any) => f.area === "settlement" && f.outcome === "issued" && String(f.sentence).includes(token),
      )?.sentence ?? "";
    expect(amountIn(0, "Gratitude")).toContain("20 Gratitude");
    expect(amountIn(1, "Gratitude")).toContain("45 Gratitude");
    expect(amountIn(0, "Village Credits"), "off in the first moon").toBe("");
    expect(amountIn(1, "Village Credits"), "on from the moon its change landed").toContain("25 Village Credits");
  });

  /*
   * AN EMPTY SNAPSHOT AND A REAL ZERO ARE DIFFERENT FACTS. A village whose
   * every rule is switched off must tell a member the same true sentence it
   * tells an admin, and not fall through to "every rule starts later", which
   * is what a narrowing that only filtered would have produced.
   */
  it("says the same true thing to both when every rule is off", async () => {
    const member = await mount({ user: { id: "wren" }, admin: false, allOff: true }).run({ moons: 2 });
    const admin = await mount({ user: { id: "founder" }, admin: true, allOff: true }).run({ moons: 2 });
    const sentence = "No mint rule is switched on for this village, so a moon settlement would pay nobody.";
    expect(JSON.stringify(member.body.turns[0].findings)).toContain(sentence);
    expect(JSON.stringify(admin.body.turns[0].findings)).toContain(sentence);
  });
});

describe("the per-person budget", () => {
  it("fires on the run after the last one of the hour, with a sentence", async () => {
    const lim = limiter();
    const { run } = mount({ user: { id: "wren" }, overLimit: lim.overLimit });
    for (let i = 0; i < RUNS_PER_WINDOW; i++) {
      const ok = await run({ moons: 1 });
      expect(ok.status, `run ${i + 1} of ${RUNS_PER_WINDOW} is inside the budget`).toBe(200);
    }
    const over = await run({ moons: 1 });
    expect(over.status).toBe(429);
    expect(over.body.error).toBe("too_many");
    expect(over.body.message, "the refusal is a sentence, not a code").toContain(String(RUNS_PER_WINDOW));
    expect(over.body.message).toMatch(/hour/i);
    // The bucket names the person, and the window is the one the module declares.
    expect(lim.calls[0].bucket).toBe("dry-run:wren");
    expect(lim.calls[0].max).toBe(RUNS_PER_WINDOW);
    expect(lim.calls[0].windowMs).toBe(RUN_WINDOW_MS);
  });

  it("leaves a second member's budget alone", async () => {
    const lim = limiter();
    const wren = mount({ user: { id: "wren" }, overLimit: lim.overLimit });
    const ash = mount({ user: { id: "ash" }, overLimit: lim.overLimit });
    for (let i = 0; i < RUNS_PER_WINDOW; i++) await wren.run({ moons: 1 });
    expect((await wren.run({ moons: 1 })).status, "wren has spent the hour").toBe(429);
    expect((await ash.run({ moons: 1 })).status, "ash has spent nothing").toBe(200);
    expect([...lim.hits.keys()].sort()).toEqual(["dry-run:ash", "dry-run:wren"]);
  });

  it("spends the budget before it reads the village, so a refused run costs one insert", async () => {
    const lim = limiter();
    const { run, statements } = mount({ user: { id: "wren" }, overLimit: lim.overLimit });
    for (let i = 0; i < RUNS_PER_WINDOW; i++) await run({ moons: 1 });
    const before = statements.length;
    expect((await run({ moons: 1 })).status).toBe(429);
    expect(statements.length, "a refused run read nothing more").toBe(before);
  });

  it("fails open, the way every other guard here does", async () => {
    const { run } = mount({ user: { id: "wren" }, overLimit: async () => false });
    expect((await run({ moons: 1 })).status).toBe(200);
  });
});

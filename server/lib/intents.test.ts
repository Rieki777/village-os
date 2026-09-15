/**
 * Intents and introductions (round 4, lane L7), against the real scratch
 * schema plus a pure section that needs no database.
 *
 * The harm metrics live here by name, each a loud test:
 *   (a) incognito text, why, topics and name never reach a non-owner, admin
 *       included;
 *   (b) no code path writes an acceptance without the accepting member's own
 *       request: a unit refusal, a source grep over server/**, and a sweep
 *       run that leaves every row proposed;
 *   (c) the recipient cap holds under 20 candidate pairs against one person:
 *       3 surfaced, 17 held, none dropped;
 *   (d) unambiguous fixtures leave zero usage rows on the model path;
 *   (e) private rows never leave their owner's responses.
 *
 * Runs on the S5 harness. No TEST_DATABASE_URL: the DB half skips loudly.
 */
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { wireAssistant } from "./assistant";
import { presenceTest } from "./memberPresence";
import {
  acceptOpportunity,
  adminDemand,
  buildReasons,
  createIntent,
  declineOpportunity,
  eraseIntentsForMember,
  exportIntentsForMember,
  getPolicy,
  hideReason,
  intentById,
  isAmbiguous,
  listBoard,
  listMyIntents,
  listMyOpportunities,
  matchIntent,
  opportunitiesForBrief,
  opportunityById,
  projectOpportunityFor,
  putPolicy,
  runIntentsSweep,
  scorePairs,
  suggestOffers,
  trySurface,
  updateIntent,
  type CandidateInput,
  type IntentRow,
  type IntentsDeps,
  type OpportunityRow,
  type SeekerInput,
} from "./intents";

const configured = testDbConfigured();

// ── Pure: scoring ────────────────────────────────────────────────────────────

const seekerOf = (over: Partial<SeekerInput> = {}): SeekerInput => ({
  intentId: "int-seek",
  userId: "usr-seeker",
  text: "looking for help with a permaculture food forest",
  topics: ["food"],
  circleIds: [],
  joinedAt: null,
  ...over,
});

const candidateOf = (over: Partial<CandidateInput> = {}): CandidateInput => ({
  intentId: "int-cand",
  userId: "usr-cand",
  kind: "offer",
  tier: "members",
  text: "happy to teach permaculture design and food forest layout",
  topics: ["food"],
  fragments: [],
  circleIds: [],
  joinedAt: null,
  ...over,
});

describe("scorePairs", () => {
  it("adds exactly two points per shared topic", () => {
    const base = scorePairs(seekerOf({ topics: [] }), [candidateOf({ topics: [] })], { floor: 0 });
    const one = scorePairs(seekerOf({ topics: ["food"] }), [candidateOf({ topics: ["food"] })], { floor: 0 });
    const two = scorePairs(
      seekerOf({ topics: ["food", "land"] }),
      [candidateOf({ topics: ["food", "land"] })],
      { floor: 0 },
    );
    expect(one[0].score).toBeCloseTo(base[0].score + 2, 5);
    expect(two[0].score).toBeCloseTo(base[0].score + 4, 5);
    expect(two[0].sharedTopics.sort()).toEqual(["food", "land"]);
  });

  it("adds one point when the pair share no circle by seat, and nothing when they do", () => {
    const apart = scorePairs(
      seekerOf({ circleIds: ["cir-1"] }),
      [candidateOf({ circleIds: ["cir-2"] })],
      { floor: 0 },
    );
    const together = scorePairs(
      seekerOf({ circleIds: ["cir-1"] }),
      [candidateOf({ circleIds: ["cir-1", "cir-2"] })],
      { floor: 0 },
    );
    const seatless = scorePairs(seekerOf(), [candidateOf({ circleIds: ["cir-2"] })], { floor: 0 });
    expect(apart[0].crossCircle).toBe(true);
    expect(together[0].crossCircle).toBe(false);
    expect(seatless[0].crossCircle).toBe(false);
    expect(apart[0].score).toBeCloseTo(together[0].score + 1, 5);
  });

  it("adds one point when arrivals sit more than 90 days apart, and only with both dates", () => {
    const now = Date.now();
    const gap = scorePairs(
      seekerOf({ joinedAt: new Date(now) }),
      [candidateOf({ joinedAt: new Date(now - 120 * 86_400_000) })],
      { floor: 0 },
    );
    const near = scorePairs(
      seekerOf({ joinedAt: new Date(now) }),
      [candidateOf({ joinedAt: new Date(now - 10 * 86_400_000) })],
      { floor: 0 },
    );
    const unknown = scorePairs(seekerOf({ joinedAt: new Date(now) }), [candidateOf()], { floor: 0 });
    expect(gap[0].cohortGap).toBe(true);
    expect(near[0].cohortGap).toBe(false);
    expect(unknown[0].cohortGap).toBe(false);
    expect(gap[0].score).toBeCloseTo(near[0].score + 1, 5);
  });

  it("holds the floor: nothing under it comes back at all", () => {
    const scored = scorePairs(
      seekerOf({ text: "seeking a welding mentor", topics: [] }),
      [candidateOf({ text: "offering sourdough starters", topics: [] })],
      { floor: 3 },
    );
    expect(scored).toEqual([]);
  });

  it("marks the consent-gated fragments that carried the seeker's own words", () => {
    const scored = scorePairs(
      seekerOf({ text: "who can teach beekeeping around here" }),
      [
        candidateOf({
          text: "new around the village, keen to meet people",
          topics: ["food"],
          fragments: [
            { source: "badge:bdg-1", label: "Beekeeping", text: "Carries the \"Beekeeping\" badge" },
            { source: "skill:carpentry", label: "carpentry", text: "Lists the skill \"carpentry\"" },
          ],
        }),
      ],
      { floor: 0 },
    );
    expect(scored[0].hitFragments.map((f) => f.source)).toEqual(["badge:bdg-1"]);
  });

  it("calls a one-point spread ambiguous and a two-point spread settled", () => {
    const a = { ...scorePairs(seekerOf(), [candidateOf()], { floor: 0 })[0] };
    expect(isAmbiguous([{ ...a, score: 5 }, { ...a, score: 4.2 }])).toBe(true);
    expect(isAmbiguous([{ ...a, score: 6 }, { ...a, score: 4 }])).toBe(false);
    expect(isAmbiguous([{ ...a, score: 5 }])).toBe(false);
  });
});

// ── Pure: reasons and the projection boundary ────────────────────────────────

const intentRowOf = (over: Partial<IntentRow>): IntentRow => ({
  id: "int-x",
  userId: "usr-x",
  kind: "seek",
  text: "seeking a hand with the orchard",
  why: null,
  tier: "members",
  lifecycle: "active",
  topics: ["food"],
  inferredFrom: null,
  expiresAt: null,
  remindedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

const oppRowOf = (over: Partial<OpportunityRow>): OpportunityRow => ({
  id: "opp-1",
  userA: "usr-ana",
  userB: "usr-ben",
  intentAId: "int-a",
  intentBId: "int-b",
  score: 5,
  method: "deterministic",
  reasons: [],
  status: "proposed",
  aAcceptedAt: null,
  bAcceptedAt: null,
  declinedBy: null,
  conversationId: null,
  surfacedAt: "2026-08-02T00:00:00.000Z",
  remindedAt: null,
  expiresAt: null,
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  ...over,
});

describe("buildReasons", () => {
  it("quotes both intents, names every subject, and never exceeds eight sentences", () => {
    const seeker = intentRowOf({ id: "int-a", userId: "usr-ana" });
    const pair = scorePairs(
      seekerOf({ intentId: "int-a", userId: "usr-ana", topics: ["food", "land", "water", "soil"] }),
      [
        candidateOf({
          intentId: "int-b",
          userId: "usr-ben",
          topics: ["food", "land", "water", "soil"],
          circleIds: ["cir-2"],
          fragments: [
            { source: "seat:role-1", label: "Orchard", text: "Holds the Orchard seat: fruit for the village" },
          ],
        }),
      ],
      { floor: 0 },
    )[0];
    const reasons = buildReasons({ intent: seeker }, pair);
    expect(reasons.length).toBeLessThanOrEqual(8);
    expect(reasons[0].source).toBe("intent:int-a");
    expect(reasons[0].subject).toBe("usr-ana");
    expect(reasons[1].source).toBe("intent:int-b");
    expect(reasons[1].subject).toBe("usr-ben");
    for (const r of reasons) expect(["usr-ana", "usr-ben"]).toContain(r.subject);
  });
});

describe("projectOpportunityFor (harm metric a: the privacy boundary)", () => {
  const ana = intentRowOf({ id: "int-a", userId: "usr-ana", text: "seeking a music partner", topics: ["music"] });
  const ben = intentRowOf({
    id: "int-b",
    userId: "usr-ben",
    kind: "offer",
    text: "I play fiddle and would love company",
    why: "evenings are long",
    topics: ["music"],
    tier: "incognito",
  });
  const opp = oppRowOf({
    reasons: [
      { text: 'Seeking: "seeking a music partner"', source: "intent:int-a", subject: "usr-ana" },
      { text: 'Offering: "I play fiddle and would love company"', source: "intent:int-b", subject: "usr-ben" },
      { text: 'You both name "music"', source: "intent:int-b", subject: "usr-ben" },
    ],
  });
  const ctx = { a: ana, b: ben, names: { "usr-ana": "Ana", "usr-ben": "Ben" } };

  it("gives an incognito owner's counterpart no text, why, topics or name", () => {
    const seen = projectOpportunityFor("usr-ana", opp, ctx)!;
    expect(seen.theirs.incognito).toBe(true);
    expect(seen.theirs.text).toBeNull();
    expect(seen.theirs.why).toBeNull();
    expect(seen.theirs.topics).toEqual([]);
    expect(seen.theirs.counterpart).toBeNull();
    const flat = JSON.stringify(seen);
    expect(flat).not.toContain("fiddle");
    expect(flat).not.toContain("evenings are long");
    expect(flat).not.toContain("Ben");
  });

  it("keeps only the viewer's own sentences when the other side is incognito", () => {
    const seen = projectOpportunityFor("usr-ana", opp, ctx)!;
    expect(seen.reasons.every((r) => r.aboutMe)).toBe(true);
    expect(seen.reasons.map((r) => r.source)).toEqual(["intent:int-a"]);
  });

  it("shows the incognito owner their own words in full", () => {
    const seen = projectOpportunityFor("usr-ben", opp, ctx)!;
    expect(seen.mine.text).toBe("I play fiddle and would love company");
    expect(seen.theirs.incognito).toBe(false);
    expect(seen.theirs.counterpart).toEqual({ userId: "usr-ana", firstName: "Ana" });
  });

  it("returns nothing at all to someone who is not a party", () => {
    expect(projectOpportunityFor("usr-nosy", opp, ctx)).toBeNull();
  });

  it("drops a hidden sentence for everyone", () => {
    const withHidden = oppRowOf({
      reasons: [
        { text: "Holds the Kitchen seat", source: "seat:role-9", subject: "usr-ben", hidden: true },
        { text: 'You both name "music"', source: "intent:int-b", subject: "usr-ben" },
      ],
    });
    const plainBen = { ...ben, tier: "members" as const };
    for (const viewer of ["usr-ana", "usr-ben"]) {
      const seen = projectOpportunityFor(viewer, withHidden, { ...ctx, b: plainBen })!;
      expect(JSON.stringify(seen.reasons)).not.toContain("Kitchen");
    }
  });

  it("treats a private intent like incognito if one ever reached a row (belt to the matcher's braces)", () => {
    const privateBen = { ...ben, tier: "private" as const };
    const seen = projectOpportunityFor("usr-ana", opp, { ...ctx, b: privateBen })!;
    expect(seen.theirs.text).toBeNull();
    expect(seen.theirs.counterpart).toBeNull();
  });
});

// ── Pure: harm metric b, the source grep ─────────────────────────────────────

describe("acceptance columns have one writer (harm metric b)", () => {
  it("greps server/**/*.ts: only intents.ts and its tests name the acceptance columns", () => {
    const root = path.resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(path.join(dir, entry.name));
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const full = path.join(dir, entry.name);
        const text = fs.readFileSync(full, "utf8");
        if (/[ab]_accepted_at/.test(text)) offenders.push(path.relative(root, full).replace(/\\/g, "/"));
      }
    };
    walk(root);
    // The two test files ASSERT on the columns; the library is the one writer.
    expect(offenders.sort()).toEqual(["intents.routes.e2e.test.ts", "lib/intents.test.ts", "lib/intents.ts"]);
    // And inside intents.ts itself: no SQL assigns either column by name
    // anywhere, and the one parametrised writer (the acting member's own
    // column, COALESCEd so a second tap changes nothing) appears exactly
    // once, inside acceptOpportunity.
    const lib = fs.readFileSync(path.join(root, "lib", "intents.ts"), "utf8");
    expect(lib.match(/[ab]_accepted_at\s*=[^=]/g) ?? []).toEqual([]);
    const writers = lib.match(/\$\{column\} = COALESCE\(\$\{column\}, NOW\(\)\)/g) ?? [];
    expect(writers.length).toBe(1);
  });
});

// ── The DB half ──────────────────────────────────────────────────────────────

let db: TestDb;
let pool: mysql.Pool;

const ANA = "usr-ana";
const BEN = "usr-ben";
const CARA = "usr-cara";

async function addUser(id: string, name: string, joinedDaysAgo = 0) {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO users (id, name, email, password_hash, joined_at) VALUES (?,?,?,?, (NOW() - INTERVAL ? DAY)) " +
      "ON DUPLICATE KEY UPDATE name = VALUES(name), joined_at = VALUES(joined_at)",
    [id, name, `${id}@example.test`, "hash", joinedDaysAgo],
  );
}

/** The host's bound presence predicate. The fixture users above all hold a password. */
const isPresent = presenceTest("intents-test-secret");

interface SpyDeps extends IntentsDeps {
  notified: Array<{ userId: string; type: string; title: string; dedupeKey: string; link?: string | null }>;
  agent: Array<{ userId: string; data: any }>;
  modelRuns: Array<{ userId: string | null }>;
  deterministicRuns: Array<string | null>;
}

function makeDeps(over: Partial<IntentsDeps> = {}): SpyDeps {
  const deps: SpyDeps = {
    notified: [],
    agent: [],
    modelRuns: [],
    deterministicRuns: [],
    notify: async (n) => {
      deps.notified.push(n as any);
    },
    enqueueAgent: async (userId, data) => {
      deps.agent.push({ userId, data });
    },
    noteUsage: async (_call, userId) => {
      deps.modelRuns.push({ userId });
    },
    noteDeterministicRun: async (userId) => {
      deps.deterministicRuns.push(userId);
    },
    budgetNearlySpent: async () => false,
    orgSeats: async () => [],
    isPresent,
    vars: {
      recipientDailyCap: () => 3,
      matchFloor: () => 3,
      opportunityDays: () => 10,
      retentionDays: () => 90,
    },
    ...over,
  };
  return deps;
}

/** The assistant is unwired by default: any accidental model call refuses. */
function unwireModel() {
  wireAssistant({ villageKey: () => "", rateLimited: async () => false });
}

/** Wire a stub model whose one answer is the JSON the caller wants. */
function wireModelStub(answer: unknown, calls: any[] = []) {
  wireAssistant({
    villageKey: () => "sk-fixture",
    rateLimited: async () => false,
    fetchImpl: (async (_url: any, init: any) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: JSON.stringify(answer) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 21, output_tokens: 8 },
        }),
        text: async () => "",
      } as any;
    }) as any,
  });
}

describe.skipIf(!configured)("intents repo (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    unwireModel();
    await pool.query("DELETE FROM intent_opportunities"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM member_intents"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM member_intent_policies"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM contact_requests"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM conversation_members"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM conversations"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM skill_tags"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM badge_awards"); // module-review-ok: clearing the fixture award between tests; scratch schema, never the platform's award path
    await pool.query("DELETE FROM badges"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM quest_claims"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM assistant_usage"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM users"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await addUser(ANA, "Ana Ruiz");
    await addUser(BEN, "Ben Cole");
    await addUser(CARA, "Cara Diaz");
  });

  // ── Create, edit, policy ───────────────────────────────────────────────────

  it("creates an intent with the quiet defaults and cleans its topics", async () => {
    const row = await createIntent(pool, ANA, {
      kind: "seek",
      text: "  seeking a bread oven build partner  ",
      topics: ["Food", "food", " BUILD ", ""],
    });
    expect(row.tier).toBe("members");
    expect(row.lifecycle).toBe("active");
    expect(row.topics).toEqual(["food", "build"]);
    expect(row.text).toBe("seeking a bread oven build partner");
    expect(row.expiresAt).toBeTruthy();
  });

  it("refuses an empty text, an unknown tier and a flood of intents", async () => {
    await expect(createIntent(pool, ANA, { kind: "seek", text: "   " })).rejects.toThrow();
    await expect(
      createIntent(pool, ANA, { kind: "seek", text: "hello", tier: "loud" as any }),
    ).resolves.toMatchObject({ tier: "members" });
    for (let i = 0; i < 19; i++) {
      await createIntent(pool, ANA, { kind: "seek", text: `intent number ${i}` });
    }
    await expect(createIntent(pool, ANA, { kind: "seek", text: "one too many" })).rejects.toThrow(/Twenty/);
  });

  it("edits only the owner's own intent", async () => {
    const row = await createIntent(pool, ANA, { kind: "seek", text: "seeking a beehive mentor" });
    expect(await updateIntent(pool, BEN, row.id, { text: "hijacked" })).toBeNull();
    const edited = await updateIntent(pool, ANA, row.id, { tier: "incognito", lifecycle: "paused" });
    expect(edited?.tier).toBe("incognito");
    expect(edited?.lifecycle).toBe("paused");
  });

  it("withdrawing consent pauses every active intent and deletes nothing", async () => {
    await putPolicy(pool, ANA, { consent: true });
    const a = await createIntent(pool, ANA, { kind: "seek", text: "seeking a guitar teacher" });
    const b = await createIntent(pool, ANA, { kind: "offer", text: "offering sourdough lessons" });
    await putPolicy(pool, ANA, { consent: false });
    expect((await getPolicy(pool, ANA))?.consentAt).toBeNull();
    expect((await intentById(pool, a.id))?.lifecycle).toBe("paused");
    expect((await intentById(pool, b.id))?.lifecycle).toBe("paused");
    expect(await listMyIntents(pool, ANA)).toHaveLength(2);
  });

  // ── Suggested offers ───────────────────────────────────────────────────────

  it("suggests offers only after the consent sentence, from all four sources", async () => {
    const deps = makeDeps({
      orgSeats: async () => [
        { userId: ANA, roleId: "role-1", roleName: "Orchard Keeper", aim: "fruit for all", domain: null, circleId: "cir-1" },
      ],
    });
    const before = await suggestOffers(pool, ANA, deps);
    expect(before.consentRequired).toBe(true);
    expect(before.suggestions).toEqual([]);

    await putPolicy(pool, ANA, { consent: true });
    await pool.query("INSERT INTO skill_tags (id, user_id, tag) VALUES ('sk-1', ?, 'carpentry')", [ANA]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("INSERT INTO badges (id, name, description) VALUES ('bdg-1', 'Beekeeper', 'bees')"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("INSERT INTO badge_awards (id, badge_id, user_id) VALUES ('awd-1', 'bdg-1', ?)", [ANA]); // module-review-ok: seeding the fixture award the suggestions read; scratch schema, never the platform's award path
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO quest_claims (id, quest_id, quest_title, user_id, status) VALUES ('clm-1', 'q-1', 'Fix the well pump', ?, 'consented')",
      [ANA],
    );
    const after = await suggestOffers(pool, ANA, deps);
    expect(after.consentRequired).toBe(false);
    const sources = after.suggestions.map((s) => s.source);
    expect(sources).toContain("skill:carpentry");
    expect(sources).toContain("seat:role-1");
    expect(sources).toContain("badge:bdg-1");
    expect(sources).toContain("quest:clm-1");

    // Confirming one writes the offer with its provenance and retires the chip.
    const chip = after.suggestions.find((s) => s.source === "skill:carpentry")!;
    const offer = await createIntent(pool, ANA, {
      kind: "offer",
      text: chip.text,
      inferredFrom: [{ source: chip.source, label: chip.label }],
    });
    expect(offer.inferredFrom?.[0]?.source).toBe("skill:carpentry");
    const again = await suggestOffers(pool, ANA, deps);
    expect(again.suggestions.map((s) => s.source)).not.toContain("skill:carpentry");
  });

  // ── The matcher ────────────────────────────────────────────────────────────

  it("matches deterministically, surfaces at once, and tells both sides (harm metric d on the way)", async () => {
    const deps = makeDeps();
    const seek = await createIntent(pool, ANA, {
      kind: "seek",
      text: "seeking help planning a permaculture food forest",
      topics: ["food", "land"],
    });
    await createIntent(pool, BEN, {
      kind: "offer",
      text: "offering permaculture design help and food forest experience",
      topics: ["food", "land"],
    });
    const run = await matchIntent(pool, deps, seek.id, { clientIp: "test", allowModel: true });
    expect(run.ran).toBe(true);
    expect(run.opportunityId).toBeTruthy();
    expect(run.method).toBe("deterministic");

    const opp = (await opportunityById(pool, run.opportunityId!))!;
    expect(opp.status).toBe("proposed");
    expect(opp.surfacedAt).toBeTruthy();
    expect(opp.score).toBeGreaterThanOrEqual(3);
    expect(opp.reasons.length).toBeGreaterThanOrEqual(2);
    for (const r of opp.reasons) expect([ANA, BEN]).toContain(r.subject);

    // Both people were told, once each, with per-side dedupe keys.
    expect(deps.notified.map((n) => n.userId).sort()).toEqual([ANA, BEN]);
    expect(new Set(deps.notified.map((n) => n.dedupeKey)).size).toBe(2);
    // One agent delivery per surfaced opportunity per side, projected.
    expect(deps.agent.map((a) => a.userId).sort()).toEqual([ANA, BEN]);

    // Harm metric d: an unambiguous run used no model and wrote the
    // deterministic row instead.
    expect(deps.modelRuns).toHaveLength(0);
    expect(deps.deterministicRuns).toEqual([ANA]);
  });

  it("surfaces nothing under the floor", async () => {
    const deps = makeDeps();
    const seek = await createIntent(pool, ANA, { kind: "seek", text: "seeking a welding mentor" });
    await createIntent(pool, BEN, { kind: "offer", text: "offering sourdough starters" });
    const run = await matchIntent(pool, deps, seek.id, { clientIp: "test", allowModel: true });
    expect(run.ran).toBe(true);
    expect(run.opportunityId).toBeNull();
    expect(deps.deterministicRuns).toEqual([ANA]);
  });

  it("reads a member's profile enrichment only after their consent", async () => {
    const deps = makeDeps({
      orgSeats: async () => [
        {
          userId: BEN,
          roleId: "role-9",
          roleName: "Beekeeper",
          aim: "hives, honey, harvest wisdom",
          domain: null,
          circleId: "cir-2",
        },
      ],
    });
    const seek = await createIntent(pool, ANA, {
      kind: "seek",
      text: "seeking beekeeper wisdom on hives, honey and the harvest",
      topics: ["bees"],
    });
    await createIntent(pool, BEN, { kind: "offer", text: "around most weekends", topics: ["bees"] });

    // Without Ben's consent the seat does not exist for the matcher: one
    // shared topic alone sits under the floor.
    const cold = await matchIntent(pool, deps, seek.id, { clientIp: "test", allowModel: true });
    expect(cold.opportunityId).toBeNull();

    await putPolicy(pool, BEN, { consent: true });
    const warm = await matchIntent(pool, deps, seek.id, { clientIp: "test", allowModel: true });
    expect(warm.opportunityId).toBeTruthy();
    const opp = (await opportunityById(pool, warm.opportunityId!))!;
    expect(opp.reasons.some((r) => r.source === "seat:role-9")).toBe(true);
  });

  it("never matches a private intent and never lists it anywhere (harm metric e)", async () => {
    const deps = makeDeps();
    await createIntent(pool, BEN, {
      kind: "offer",
      text: "a private note to myself about rare heirloom seeds",
      topics: ["food"],
      tier: "private",
    });
    const seek = await createIntent(pool, ANA, {
      kind: "seek",
      text: "seeking rare heirloom seeds for the food forest",
      topics: ["food"],
    });
    const run = await matchIntent(pool, deps, seek.id, { clientIp: "test", allowModel: true });
    expect(run.opportunityId).toBeNull();

    // The board never carries it, signed in or out. Ana's own seek is board
    // content; Ben's private words are the thing that must not be.
    expect(JSON.stringify(await listBoard(pool, ANA, isPresent))).not.toContain("private note");
    expect(await listBoard(pool, null, isPresent)).toEqual([]);

    // Admin demand carries no private words either.
    const demand = await adminDemand(pool);
    expect(JSON.stringify(demand)).not.toContain("private note");

    // Its owner still reads it in full.
    expect((await listMyIntents(pool, BEN))[0].text).toContain("rare heirloom seeds");
  });

  it("consults the model only inside a one-point tie and validates its answer (harm metric d)", async () => {
    const calls: any[] = [];
    const deps = makeDeps();
    // Two candidates the deterministic scorer cannot separate: same topics,
    // same-shaped text.
    const seek = await createIntent(pool, ANA, {
      kind: "seek",
      text: "seeking a garden mentor",
      topics: ["food", "garden"],
    });
    const offer1 = await createIntent(pool, BEN, {
      kind: "offer",
      text: "offering garden mentoring",
      topics: ["food", "garden"],
    });
    const offer2 = await createIntent(pool, CARA, {
      kind: "offer",
      text: "offering garden mentoring too",
      topics: ["food", "garden"],
    });

    wireModelStub({ matchId: offer2.id }, calls);
    const run = await matchIntent(pool, deps, seek.id, { clientIp: "test", allowModel: true });
    expect(calls.length).toBe(1);
    expect(deps.modelRuns).toHaveLength(1);
    expect(deps.deterministicRuns).toHaveLength(0);
    expect(run.method).toBe("llm");
    const opp = (await opportunityById(pool, run.opportunityId!))!;
    expect([opp.intentAId, opp.intentBId].sort()).toEqual([seek.id, offer2.id].sort());

    // An answer outside the candidate set is dropped, not obeyed.
    await declineOpportunity(pool, opp.id, ANA);
    const seek2 = await createIntent(pool, ANA, {
      kind: "seek",
      text: "seeking a garden mentor again",
      topics: ["food", "garden"],
    });
    wireModelStub({ matchId: "int-invented-by-the-model" }, calls);
    const run2 = await matchIntent(pool, deps, seek2.id, { clientIp: "test", allowModel: true });
    expect(run2.method).toBe("deterministic");
    expect(run2.opportunityId).toBeTruthy();
    expect([offer1.id, offer2.id]).toContain(
      [(await opportunityById(pool, run2.opportunityId!))!.intentAId, (await opportunityById(pool, run2.opportunityId!))!.intentBId].find(
        (x) => x !== seek2.id,
      ),
    );
  });

  it("makes no model call when allowModel is off, however ambiguous the tie", async () => {
    const calls: any[] = [];
    wireModelStub({ matchId: "anything" }, calls);
    const deps = makeDeps();
    const seek = await createIntent(pool, ANA, {
      kind: "seek",
      text: "seeking a garden mentor",
      topics: ["food", "garden"],
    });
    await createIntent(pool, BEN, { kind: "offer", text: "offering garden mentoring", topics: ["food", "garden"] });
    await createIntent(pool, CARA, {
      kind: "offer",
      text: "offering garden mentoring too",
      topics: ["food", "garden"],
    });
    const run = await matchIntent(pool, deps, seek.id, { clientIp: "test", allowModel: false });
    expect(run.opportunityId).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(deps.modelRuns).toHaveLength(0);
    expect(deps.deterministicRuns).toEqual([ANA]);
  });

  // ── Caps (harm metric c) ───────────────────────────────────────────────────

  /** A held proposal against Ben, written the way the matcher writes one. */
  async function heldPairAgainstBen(i: number): Promise<string> {
    const uid = `usr-seeker-${String(i).padStart(2, "0")}`;
    await addUser(uid, `Seeker ${i}`);
    const seek = await createIntent(pool, uid, {
      kind: "seek",
      text: `seeking timber framing help for build number ${i}`,
      topics: ["build"],
    });
    const [benOffer] = await listMyIntents(pool, BEN);
    const [userA, userB] = BEN < uid ? [BEN, uid] : [uid, BEN];
    const [intentA, intentB] = userA === BEN ? [benOffer.id, seek.id] : [seek.id, benOffer.id];
    const id = `opp-cap-${i}`;
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO intent_opportunities (id, user_a, user_b, intent_a_id, intent_b_id, score, method, reasons, status) " +
        "VALUES (?,?,?,?,?, 5, 'deterministic', JSON_ARRAY(), 'proposed')",
      [id, userA, userB, intentA, intentB],
    );
    return id;
  }

  it("holds the recipient cap under 20 candidate pairs: 3 surfaced, 17 held, none dropped", async () => {
    const deps = makeDeps();
    await createIntent(pool, BEN, {
      kind: "offer",
      text: "offering timber framing help and carpentry mentoring",
      topics: ["build"],
    });
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await heldPairAgainstBen(i));
    for (const id of ids) {
      await trySurface(pool, deps, (await opportunityById(pool, id))!);
    }
    const [[surfaced]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM intent_opportunities WHERE surfaced_at IS NOT NULL",
    );
    const [[held]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM intent_opportunities WHERE surfaced_at IS NULL AND status = 'proposed'",
    );
    const [[total]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM intent_opportunities");
    expect(Number(surfaced.n)).toBe(3);
    expect(Number(held.n)).toBe(17);
    expect(Number(total.n)).toBe(20);
    // The seekers each had a fresh day; Ben's cap is what held the door.
    expect(deps.notified.filter((n) => n.userId === BEN)).toHaveLength(3);
  });

  it("counts the map relay's received contacts into the same day", async () => {
    const deps = makeDeps();
    // Ben already received three relay contacts today: his day is full.
    for (let i = 0; i < 3; i++) {
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO contact_requests (id, from_user_id, to_user_id, message, source, idempotency_key) VALUES (?,?,?,?,?,?)",
        [`ctr-${i}`, CARA, BEN, "hello", "map", `k-${i}`],
      );
    }
    const seek = await createIntent(pool, ANA, {
      kind: "seek",
      text: "seeking timber framing help and carpentry mentoring",
      topics: ["build"],
    });
    await createIntent(pool, BEN, {
      kind: "offer",
      text: "offering timber framing help and carpentry mentoring",
      topics: ["build"],
    });
    const run = await matchIntent(pool, deps, seek.id, { clientIp: "test", allowModel: false });
    expect(run.opportunityId).toBeTruthy();
    const opp = (await opportunityById(pool, run.opportunityId!))!;
    expect(opp.surfacedAt).toBeNull(); // held, not dropped
    expect(deps.notified).toHaveLength(0);
  });

  it("honours the member's own weekly ration and pause once a policy row exists", async () => {
    const deps = makeDeps();
    await putPolicy(pool, BEN, { maxPerWeek: 1 });
    await createIntent(pool, BEN, { kind: "offer", text: "offering timber framing help", topics: ["build"] });
    const first = await heldPairAgainstBen(0);
    const second = await heldPairAgainstBen(1);
    expect(await trySurface(pool, deps, (await opportunityById(pool, first))!)).toBe(true);
    expect(await trySurface(pool, deps, (await opportunityById(pool, second))!)).toBe(false);
    expect((await opportunityById(pool, second))!.surfacedAt).toBeNull();

    // A pause holds the door the same way.
    await putPolicy(pool, "usr-seeker-01", { pauseDays: 7 });
    await pool.query("UPDATE intent_opportunities SET surfaced_at = NULL WHERE id = ?", [first]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("UPDATE member_intent_policies SET max_per_week = 5 WHERE user_id = ?", [BEN]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await putPolicy(pool, "usr-seeker-00", { pauseDays: 7 });
    expect(await trySurface(pool, deps, (await opportunityById(pool, first))!)).toBe(false);
  });

  // ── Accept, decline, hide (harm metric b) ──────────────────────────────────

  async function surfacedPair(): Promise<{ oppId: string; seekId: string; offerId: string }> {
    const deps = makeDeps();
    const seek = await createIntent(pool, ANA, {
      kind: "seek",
      text: "seeking help planning a permaculture food forest",
      topics: ["food"],
    });
    const offer = await createIntent(pool, BEN, {
      kind: "offer",
      text: "offering permaculture food forest help",
      topics: ["food"],
    });
    const run = await matchIntent(pool, deps, seek.id, { clientIp: "test", allowModel: false });
    expect(run.opportunityId).toBeTruthy();
    return { oppId: run.opportunityId!, seekId: seek.id, offerId: offer.id };
  }

  it("refuses an acceptance from anyone but the two people in it (harm metric b)", async () => {
    const { oppId } = await surfacedPair();
    await expect(acceptOpportunity(pool, oppId, CARA, makeDeps())).rejects.toThrow(/two people/);
    const opp = (await opportunityById(pool, oppId))!;
    expect(opp.aAcceptedAt).toBeNull();
    expect(opp.bAcceptedAt).toBeNull();
  });

  it("takes each yes separately and opens one thread on the second, with the relay rows", async () => {
    const deps = makeDeps();
    const { oppId } = await surfacedPair();
    const first = await acceptOpportunity(pool, oppId, ANA, deps);
    expect(first.opened).toBe(false);
    const mid = (await opportunityById(pool, oppId))!;
    expect(mid.aAcceptedAt).toBeTruthy();
    expect(mid.bAcceptedAt).toBeNull();
    expect(mid.status).toBe("a_accepted");
    expect(mid.conversationId).toBeNull();

    const second = await acceptOpportunity(pool, oppId, BEN, deps);
    expect(second.opened).toBe(true);
    const done = (await opportunityById(pool, oppId))!;
    expect(done.status).toBe("opened");
    expect(done.conversationId).toBeTruthy();

    // One direct conversation, both members in it, no message written.
    const [convs] = await pool.query<any[]>("SELECT * FROM conversations WHERE kind = 'direct'");
    expect(convs).toHaveLength(1);
    const [msgs] = await pool.query<any[]>("SELECT * FROM messages");
    expect(msgs).toHaveLength(0);

    // The relay rows: one per direction, source introduction.
    const [relay] = await pool.query<any[]>(
      "SELECT from_user_id, to_user_id, source FROM contact_requests ORDER BY from_user_id",
    );
    expect(relay).toHaveLength(2);
    expect(relay.every((r: any) => r.source === "introduction")).toBe(true);

    // Both were told the thread is open.
    const opens = deps.notified.filter((n) => n.dedupeKey.startsWith("intro-open:"));
    expect(opens.map((n) => n.userId).sort()).toEqual([ANA, BEN]);
    expect(opens[0].link).toContain("/messages/");
  });

  it("declines once and never re-proposes the same pair", async () => {
    const deps = makeDeps();
    const { oppId, seekId } = await surfacedPair();
    const declined = await declineOpportunity(pool, oppId, BEN);
    expect(declined.status).toBe("declined");
    expect(declined.declinedBy).toBe(BEN);
    // The intents are back in the pool, and the unique pair blocks a rerun.
    const rerun = await matchIntent(pool, makeDeps(), seekId, { clientIp: "test", allowModel: false });
    expect(rerun.opportunityId).toBeNull();
    expect(deps.notified.filter((n) => n.userId === ANA && n.dedupeKey.startsWith("intro-declined"))).toHaveLength(0);
  });

  it("lets only the subject hide a sentence, and pauses a hidden inferred offer", async () => {
    const deps = makeDeps();
    await putPolicy(pool, BEN, { consent: true });
    const offer = await createIntent(pool, BEN, {
      kind: "offer",
      text: "offering permaculture food forest help",
      topics: ["food"],
      inferredFrom: [{ source: "skill:permaculture", label: "permaculture" }],
    });
    const seek = await createIntent(pool, ANA, {
      kind: "seek",
      text: "seeking help planning a permaculture food forest",
      topics: ["food"],
    });
    const run = await matchIntent(pool, deps, seek.id, { clientIp: "test", allowModel: false });
    const opp = (await opportunityById(pool, run.opportunityId!))!;
    const benIdx = opp.reasons.findIndex((r) => r.source === `intent:${offer.id}`);
    expect(benIdx).toBeGreaterThanOrEqual(0);

    await expect(hideReason(pool, opp.id, benIdx, ANA)).rejects.toThrow(/about/);
    await hideReason(pool, opp.id, benIdx, BEN);

    const after = (await opportunityById(pool, opp.id))!;
    expect(after.reasons[benIdx].hidden).toBe(true);
    const anaView = projectOpportunityFor(ANA, after, {
      a: (await intentById(pool, seek.id))!,
      b: (await intentById(pool, offer.id))!,
    })!;
    expect(anaView.reasons.map((r) => r.index)).not.toContain(benIdx);
    // The inferred offer rests until Ben says otherwise.
    expect((await intentById(pool, offer.id))!.lifecycle).toBe("paused");
  });

  // ── Incognito through the whole stack (harm metric a) ──────────────────────

  it("matches an incognito intent and renders its words to nobody, admin included", async () => {
    const deps = makeDeps();
    const secret = await createIntent(pool, BEN, {
      kind: "seek",
      text: "quietly seeking a grief companion after a loss",
      topics: ["care", "listening"],
      tier: "incognito",
    });
    const offer = await createIntent(pool, ANA, {
      kind: "offer",
      text: "offering to be a grief companion for anyone seeking one",
      topics: ["care", "listening"],
    });
    const run = await matchIntent(pool, deps, secret.id, { clientIp: "test", allowModel: false });
    expect(run.opportunityId).toBeTruthy();

    // Ana's inbox: a match exists, with her own sentences only, no words and
    // no name from Ben.
    const anaInbox = await listMyOpportunities(pool, ANA);
    expect(anaInbox).toHaveLength(1);
    const flat = JSON.stringify(anaInbox);
    expect(flat).not.toContain("grief companion after a loss");
    expect(flat).not.toContain("Ben");
    expect(anaInbox[0].theirs.incognito).toBe(true);

    // Ben reads his own words in full.
    const benInbox = await listMyOpportunities(pool, BEN);
    expect(JSON.stringify(benInbox)).toContain("quietly seeking a grief companion");

    // The board never lists it, the admin demand never quotes it. Ana's own
    // offer is public board content; Ben's words are what must not travel.
    expect(JSON.stringify(await listBoard(pool, ANA, isPresent))).not.toContain("quietly seeking");
    const demand = await adminDemand(pool);
    expect(JSON.stringify(demand)).not.toContain("quietly seeking");
    expect(JSON.stringify(demand)).not.toContain("after a loss");

    // The agent delivery each side got obeys the same projection.
    const anaAgent = deps.agent.find((a) => a.userId === ANA);
    expect(JSON.stringify(anaAgent ?? {})).not.toContain("grief companion after a loss");

    // The export runs through the same projector as every route (the
    // security review's one finding closed): Ana's file carries neither
    // Ben's words nor his identity, and her own half in full.
    const anaExport = await exportIntentsForMember(pool, ANA);
    expect(anaExport.opportunities).toHaveLength(1);
    const exported = JSON.stringify(anaExport);
    expect(exported).not.toContain("quietly seeking");
    expect(exported).not.toContain("after a loss");
    expect(exported).not.toContain(BEN);
    expect(anaExport.opportunities[0].theirs.incognito).toBe(true);
    expect(exported).toContain("grief companion for anyone"); // her own offer

    // Ben's own export keeps his words: they are his.
    const benExport = await exportIntentsForMember(pool, BEN);
    expect(JSON.stringify(benExport)).toContain("quietly seeking a grief companion");
  });

  // ── The board ──────────────────────────────────────────────────────────────

  it("shows visitors public rows only, members the members shelf too, first names only", async () => {
    await createIntent(pool, ANA, { kind: "seek", text: "seeking a chess partner", tier: "public" });
    await createIntent(pool, BEN, { kind: "offer", text: "offering bicycle repair", tier: "members" });
    await createIntent(pool, CARA, { kind: "seek", text: "seeking quiet company", tier: "incognito" });

    const visitor = await listBoard(pool, null, isPresent);
    expect(visitor.map((b) => b.text)).toEqual(["seeking a chess partner"]);
    expect(visitor[0].firstName).toBe("Ana");
    expect(JSON.stringify(visitor)).not.toContain("Ruiz");

    const member = await listBoard(pool, BEN, isPresent);
    expect(member.map((b) => b.text).sort()).toEqual(["offering bicycle repair", "seeking a chess partner"]);
    expect(JSON.stringify(member)).not.toContain("quiet company");
  });

  // ── The sweep ──────────────────────────────────────────────────────────────

  it("reminds once, then expires, and the pool takes the intent back", async () => {
    const deps = makeDeps();
    const row = await createIntent(pool, ANA, { kind: "seek", text: "seeking a stargazing friend" });
    await pool.query("UPDATE member_intents SET expires_at = (NOW() - INTERVAL 1 DAY) WHERE id = ?", [row.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

    await runIntentsSweep(pool, deps);
    expect((await intentById(pool, row.id))!.lifecycle).toBe("active");
    expect(deps.notified.filter((n) => n.dedupeKey === `intent-reminder:${row.id}`)).toHaveLength(1);

    // A second sweep inside the week neither re-reminds nor expires.
    await runIntentsSweep(pool, deps);
    expect(deps.notified.filter((n) => n.dedupeKey === `intent-reminder:${row.id}`)).toHaveLength(1);
    expect((await intentById(pool, row.id))!.lifecycle).toBe("active");

    // A week past the reminder, the intent rests.
    await pool.query("UPDATE member_intents SET reminded_at = (NOW() - INTERVAL 8 DAY) WHERE id = ?", [row.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await runIntentsSweep(pool, deps);
    expect((await intentById(pool, row.id))!.lifecycle).toBe("expired");
  });

  it("reminds the quiet side of an opportunity once, then expires it back to the pool", async () => {
    const deps = makeDeps();
    const { oppId, seekId } = await surfacedPair();
    await acceptOpportunity(pool, oppId, ANA, deps);
    await pool.query("UPDATE intent_opportunities SET surfaced_at = (NOW() - INTERVAL 4 DAY) WHERE id = ?", [oppId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

    await runIntentsSweep(pool, deps);
    const reminders = deps.notified.filter((n) => n.dedupeKey.startsWith("intro-reminder:"));
    expect(reminders.map((n) => n.userId)).toEqual([BEN]);

    await pool.query("UPDATE intent_opportunities SET expires_at = (NOW() - INTERVAL 1 DAY) WHERE id = ?", [oppId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await runIntentsSweep(pool, deps);
    expect((await opportunityById(pool, oppId))!.status).toBe("expired");
    // Back in the pool: the seek may match somebody new.
    await addUser("usr-dana", "Dana Field");
    await createIntent(pool, "usr-dana", {
      kind: "offer",
      text: "offering permaculture food forest help too",
      topics: ["food"],
    });
    const rerun = await matchIntent(pool, makeDeps(), seekId, { clientIp: "test", allowModel: false });
    expect(rerun.opportunityId).toBeTruthy();
  });

  it("writes no acceptance anywhere, however long it runs (harm metric b)", async () => {
    const deps = makeDeps();
    await surfacedPair();
    await runIntentsSweep(pool, deps);
    await runIntentsSweep(pool, deps);
    const [rows] = await pool.query<any[]>(
      "SELECT status, a_accepted_at, b_accepted_at FROM intent_opportunities",
    );
    for (const r of rows) {
      expect(r.a_accepted_at).toBeNull();
      expect(r.b_accepted_at).toBeNull();
      expect(["proposed", "expired"]).toContain(r.status);
    }
  });

  it("makes zero model calls when the budget guard says the day is nearly spent", async () => {
    const calls: any[] = [];
    wireModelStub({ matchId: "anything" }, calls);
    const deps = makeDeps({ budgetNearlySpent: async () => true });
    await createIntent(pool, ANA, { kind: "seek", text: "seeking a garden mentor", topics: ["food"] });
    await createIntent(pool, BEN, { kind: "offer", text: "offering garden mentoring", topics: ["food"] });
    await createIntent(pool, CARA, { kind: "offer", text: "offering garden mentoring too", topics: ["food"] });
    const summary = await runIntentsSweep(pool, deps);
    expect(summary.matchRuns).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
    expect(deps.modelRuns).toHaveLength(0);
  });

  it("blanks reasons and expired words past the retention day, keeping the record", async () => {
    const deps = makeDeps();
    const { oppId, seekId } = await surfacedPair();
    await pool.query("UPDATE intent_opportunities SET created_at = (NOW() - INTERVAL 100 DAY) WHERE id = ?", [oppId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE member_intents SET lifecycle = 'expired', updated_at = (NOW() - INTERVAL 100 DAY) WHERE id = ?",
      [seekId],
    );
    await runIntentsSweep(pool, deps);
    const opp = (await opportunityById(pool, oppId))!;
    expect(opp.reasons).toEqual([]);
    const intent = (await intentById(pool, seekId))!;
    expect(intent.text).toBe("[expired]");
    expect(intent.why).toBeNull();
  });

  it("retries held opportunities and surfaces them when the day opens", async () => {
    const deps = makeDeps();
    await createIntent(pool, BEN, { kind: "offer", text: "offering timber framing help", topics: ["build"] });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await heldPairAgainstBen(i));
    for (const id of ids) {
      await trySurface(pool, deps, (await opportunityById(pool, id))!);
    }
    const [[held]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM intent_opportunities WHERE surfaced_at IS NULL AND status = 'proposed'",
    );
    expect(Number(held.n)).toBe(1);
    // The sweep alone changes nothing while the day is still full.
    await runIntentsSweep(pool, deps);
    const [[stillFull]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM intent_opportunities WHERE surfaced_at IS NULL AND status = 'proposed'",
    );
    expect(Number(stillFull.n)).toBe(1);
    // The day turns: age the surfaced ones out of the window.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE intent_opportunities SET surfaced_at = (NOW() - INTERVAL 2 DAY) WHERE surfaced_at IS NOT NULL",
    );
    const summary = await runIntentsSweep(pool, deps);
    expect(summary.surfacedHeld).toBe(1);
    const [[stillHeld]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM intent_opportunities WHERE surfaced_at IS NULL AND status = 'proposed'",
    );
    expect(Number(stillHeld.n)).toBe(0);
  });

  // ── The brief seam, erasure, export ────────────────────────────────────────

  it("hands the weekly brief plain lines only while a yes is actually waiting", async () => {
    const deps = makeDeps();
    const { oppId } = await surfacedPair();
    expect(await opportunitiesForBrief(pool, ANA)).toHaveLength(1);
    expect((await opportunitiesForBrief(pool, ANA))[0]).toContain("waiting for your yes");
    await acceptOpportunity(pool, oppId, ANA, deps);
    expect(await opportunitiesForBrief(pool, ANA)).toEqual([]);
    expect(await opportunitiesForBrief(pool, BEN)).toHaveLength(1);
  });

  it("erases a member's intents and policy and blanks every sentence where they were a party", async () => {
    const deps = makeDeps();
    const { oppId } = await surfacedPair();
    await putPolicy(pool, ANA, { consent: true });
    await eraseIntentsForMember(pool, ANA);
    expect(await listMyIntents(pool, ANA)).toEqual([]);
    expect(await getPolicy(pool, ANA)).toBeNull();
    expect((await opportunityById(pool, oppId))!.reasons).toEqual([]);
    // Ben's own intent survives; only the sentences went.
    expect(await listMyIntents(pool, BEN)).toHaveLength(1);
    expect(deps).toBeTruthy();
  });

  it("exports every introduction the member has seen, projected, beside their own rows", async () => {
    await surfacedPair();
    const doc = await exportIntentsForMember(pool, ANA);
    expect(doc.intents).toHaveLength(1);
    expect(doc.opportunities).toHaveLength(1);
    // Projected: her half whole, the counterpart's half as she saw it.
    expect(doc.opportunities[0].mine.text).toContain("permaculture food forest");
    expect(doc.opportunities[0].theirs.counterpart?.firstName).toBe("Ben");

    // A hidden sentence stays hidden in the export too.
    const opp = (await pool.query<any[]>("SELECT id FROM intent_opportunities"))[0][0];
    const full = (await opportunityById(pool, String(opp.id)))!;
    const benIdx = full.reasons.findIndex((r) => r.subject === BEN);
    if (benIdx >= 0) {
      await hideReason(pool, full.id, benIdx, BEN);
      const again = await exportIntentsForMember(pool, ANA);
      expect(again.opportunities[0].reasons.map((r) => r.index)).not.toContain(benIdx);
    }
  });

  it("counts model calls for the admin demand signal from the usage table", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO assistant_usage (id, village_id, mode, model, key_source, user_id, input_tokens, output_tokens, " +
        "cache_creation_input_tokens, cache_read_input_tokens, iterations, stop_reason, path) VALUES " +
        "('au-1', 'v', 'introductions', 'none', 'none', NULL, 0,0,0,0,0,NULL,'deterministic')," +
        "('au-2', 'v', 'introductions', 'claude', 'village', NULL, 10,5,0,0,1,'end_turn','loop')," +
        "('au-3', 'v', 'concierge', 'claude', 'village', NULL, 10,5,0,0,1,'end_turn','loop')",
    );
    const demand = await adminDemand(pool);
    expect(demand.counts.modelCallsThisMoon).toBe(1);
  });
});

/**
 * THE ROLE GUIDE'S DOOR (Rye, 2026-10-24), against a real scratch schema, with
 * the real card text reader and the village guide's reply faked at the
 * network edge.
 *
 * What is pinned:
 *   - only the draft's owner may ask, only while it is a draft;
 *   - what the guide is sent names people by their roles, and carries neither
 *     the terms nor any person's name;
 *   - the guide's card comes back as suggestions with the sentence of the
 *     member's own writing each came from, and its one question, named by role;
 *   - nothing is written: the draft is exactly as it was, and the document is
 *     nowhere in it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { usersRepo } from "../repos/users";
import { insertProposal, markSubmitted, readProposal } from "../repos/roleProposals";
import { createOrgRole, seatHolder } from "../lib/orgChart";
import { ensureInstanceIdentity } from "../lib/identity";
import { wireAssistant } from "../lib/assistant";
import { writeRoleCard } from "@shared/roleCardText";
import { emptyBody } from "@shared/roleProposals";
import type { GuideAnswer } from "@shared/roleGuide";
import { register } from "./roleGuide";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;
const DOOR = "POST /api/governance/role-proposals/:id/guide";

function collect() {
  const handlers = new Map<string, Handler>();
  return { app: { post: (p: string, h: Handler) => handlers.set(`POST ${p}`, h) } as any, handlers };
}

async function call(handlers: Map<string, Handler>, req: any) {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
  };
  await handlers.get(DOOR)!({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
  return out;
}

const SEASONS = [{ id: "s-next", name: "Next season", startsOn: "2099-01-01", endsOn: "2099-03-20", goals: [{ text: "Feed the village from its own land" }] }];

function deps(pool: any, who: () => any, limited = false) {
  return {
    authedUser: async () => who(),
    getPool: () => pool,
    clientIp: () => "10.0.0.9",
    overLimit: async () => limited,
    members: usersRepo(pool),
    seasonState: () => ({ current: null, seasons: SEASONS, timezone: "UTC" }),
    lapse: () => ({ currentSeasonId: null, cadence: "never" }),
    villageGuideName: () => "Maia",
    villageName: () => "the village",
  } as any;
}

afterEach(() => wireAssistant({ villageKey: () => "", rateLimited: async () => false }));

describe("the role guide door, without a database", () => {
  it("refuses a stranger, a step it does not know, and a member over the hour's limit", async () => {
    const dead = { query: async () => [[], []] };
    const a = collect();
    register(a.app, deps(dead, () => null));
    expect((await call(a.handlers, { params: { id: "rp-x" }, body: { step: "words" } })).status).toBe(401);
    const b = collect();
    register(b.app, deps(dead, () => ({ id: "u1" })));
    expect((await call(b.handlers, { params: { id: "rp-x" }, body: { step: "terms" } })).status).toBe(400);
    const c = collect();
    register(c.app, deps(dead, () => ({ id: "u1" }), true));
    expect((await call(c.handlers, { params: { id: "rp-x" }, body: { step: "words" } })).status).toBe(429);
  });
});

describe.skipIf(!testDbConfigured())("one turn of the role guide", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let roleId: string;
  let sent: any[] = [];
  let reply = "";
  const OWNER = { id: "guide-owner", name: "Member One", email: "one@example.test", prefs: {} };
  const DOCUMENT = "I plan the kitchen's weekly menu with Wren Example.\nI order the dry goods every Friday.";
  const PAY = { v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 4321000, per: "month" } };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await ensureInstanceIdentity(pool);
    const members = usersRepo(pool);
    await members.add({ ...OWNER });
    await members.add({ id: "guide-cook", name: "Wren Example", email: "wren@example.test" });
    roleId = await createOrgRole(pool, { name: "Kitchen keeper" });
    const pantry = await createOrgRole(pool, { name: "Pantry Lead" });
    await seatHolder(pool, pantry, { userId: "guide-cook" });
    await insertProposal(pool, {
      id: "rp-guide-1",
      userId: OWNER.id,
      targetSeasonId: "s-next",
      body: { ...emptyBody(), roles: [{ roleId, words: {}, reviewOn: null }], settings: PAY as any },
      now: new Date(),
    });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const wire = () => {
    sent = [];
    wireAssistant({
      villageKey: () => "test-village-key",
      rateLimited: async () => false,
      fetchImpl: (async (_url: string, init: any) => {
        sent.push(JSON.parse(init.body));
        return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: reply }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }), text: async () => "" };
      }) as unknown as typeof fetch,
    });
  };

  it("sends the guide the card and the document named by role, with no terms and no name, and reads its card back as suggestions", async () => {
    wire();
    reply = JSON.stringify({
      card: writeRoleCard({
        village: "the village",
        roles: [{ title: "Kitchen keeper", id: roleId, circle: null, words: { domain: "The kitchen's weekly menu", accountabilities: ["Plan the weekly menu", "Order the dry goods", "Keep the pantry list"] } }],
        measures: [],
        season: null,
      }),
      question: "Who takes the menu over when you rest, Wren Example?",
    });
    const before = await readProposal(pool, "rp-guide-1");
    const { app, handlers } = collect();
    register(app, deps(pool, () => OWNER));
    const out = await call(handlers, { params: { id: "rp-guide-1" }, body: { step: "words", document: DOCUMENT } });
    expect(out.status).toBe(200);
    const answer = out.body as GuideAnswer;

    // What crossed: named by role, no name, no terms.
    const crossed = JSON.stringify(sent);
    expect(sent).toHaveLength(1);
    expect(crossed).toContain("the Pantry Lead");
    expect(crossed).toContain("Kitchen keeper");
    expect(crossed).not.toContain("Wren");
    expect(crossed).not.toContain("4321000");
    expect(crossed).not.toContain("XTS");

    // What came back.
    expect(answer.guide).toEqual({ id: "village", name: "Maia" });
    const domain = answer.suggestions.find((s) => s.path === "roles.0.words.domain");
    expect(domain).toMatchObject({ roleId, field: "domain", words: "The kitchen's weekly menu", problem: null });
    expect(domain?.source).toBe("I plan the kitchen's weekly menu with the Pantry Lead.");
    const counted = answer.suggestions.find((s) => s.path === "roles.0.words.accountabilities");
    expect(counted?.words).toEqual(["Plan the weekly menu", "Order the dry goods", "Keep the pantry list"]);
    // Traced line by line: the menu line and the dry goods line each quote their own sentence; the pantry line finds none.
    expect(counted?.source).toBe("I plan the kitchen's weekly menu with the Pantry Lead. I order the dry goods every Friday.");
    expect(answer.question).toBe("Who takes the menu over when you rest, the Pantry Lead?");
    expect(JSON.stringify(answer)).not.toContain("Wren");

    // Nothing written: the draft is as it was, and the document is nowhere in it.
    const after = await readProposal(pool, "rp-guide-1");
    expect(after?.body).toEqual(before?.body);
    expect(JSON.stringify(after)).not.toContain("dry goods");
    const [usage] = await pool.query<any[]>("SELECT mode, user_id FROM assistant_usage WHERE user_id = ?", [OWNER.id]);
    expect(usage.map((u: any) => u.mode)).toEqual(["roleGuide"]);
  });

  it("answers another member's ask about this draft as if it were not there", async () => {
    wire();
    const { app, handlers } = collect();
    register(app, deps(pool, () => ({ id: "guide-cook", name: "Wren Example", prefs: {} })));
    expect((await call(handlers, { params: { id: "rp-guide-1" }, body: { step: "words" } })).status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it("refuses a submitted proposal before it asks the guide anything", async () => {
    wire();
    await insertProposal(pool, { id: "rp-guide-2", userId: OWNER.id, targetSeasonId: "s-next", body: emptyBody(), now: new Date() });
    await markSubmitted(pool, "rp-guide-2", "sa-0000000000000001", new Date());
    const { app, handlers } = collect();
    register(app, deps(pool, () => OWNER));
    expect((await call(handlers, { params: { id: "rp-guide-2" }, body: { step: "words" } })).status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it("answers 503 and asks nobody when no guide can answer", async () => {
    wireAssistant({ villageKey: () => "", rateLimited: async () => false });
    const { app, handlers } = collect();
    register(app, deps(pool, () => OWNER));
    expect((await call(handlers, { params: { id: "rp-guide-1" }, body: { step: "words" } })).status).toBe(503);
  });
});

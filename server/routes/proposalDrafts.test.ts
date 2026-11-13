/**
 * "ASK SERA FOR A FIRST DRAFT", the door (joining lane PR 5), against a real
 * scratch schema with the guide's reply faked at the network edge.
 *
 * Pinned:
 *   - a stranger is refused and nothing is asked of anyone;
 *   - what crosses to the model is EXACTLY the allow-listed fields (roles, why,
 *     aim) plus the roles' card words and the season's goals: the planted
 *     references, consent, links, files, name and email never appear;
 *   - a drafted goal moves only a goal its role lists, whatever the model says;
 *   - with the guide down the door answers plainly and the form is untouched.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { usersRepo } from "../repos/users";
import { createOrgRole } from "../lib/orgChart";
import { ensureInstanceIdentity } from "../lib/identity";
import { wireAssistant } from "../lib/assistant";
import { AI_SAFE_PROPOSAL_FIELDS } from "@shared/proposalAbout";
import type { DraftReply } from "@shared/seraDrafts";
import { register } from "./proposalDrafts";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;
const DOOR = "POST /api/governance/proposal-drafts";

function collect() {
  const handlers = new Map<string, Handler>();
  return { app: { post: (p: string, h: Handler) => handlers.set(`POST ${p}`, h) } as any, handlers };
}
async function call(handlers: Map<string, Handler>, body: any) {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
  await handlers.get(DOOR)!({ params: {}, body, query: {}, headers: {} }, res);
  return out;
}

const SEASONS = [{ id: "s-next", name: "Next season", startsOn: "2099-01-01", endsOn: "2099-03-20", goals: [{ id: "g1", text: "Feed the village from its own land" }] }];
const deps = (pool: any, who: () => any, limited = false) =>
  ({
    authedUser: async () => who(),
    getPool: () => pool,
    clientIp: () => "10.0.0.9",
    overLimit: async () => limited,
    seasonState: () => ({ current: null, seasons: SEASONS, timezone: "UTC" }),
    villageGuideName: () => "Maia",
    villageName: () => "the village",
    noteUsage: async () => {},
  }) as any;

afterEach(() => wireAssistant({ villageKey: () => "", rateLimited: async () => false }));

describe("the draft door, without a database", () => {
  it("refuses a stranger, an unknown part, and a member over the hour's limit", async () => {
    const dead = { query: async () => [[], []] };
    const a = collect();
    register(a.app, deps(dead, () => null));
    expect((await call(a.handlers, { kind: "aim" })).status).toBe(401);
    const b = collect();
    register(b.app, deps(dead, () => ({ id: "u1" })));
    expect((await call(b.handlers, { kind: "references" })).status).toBe(400);
    const c = collect();
    register(c.app, deps(dead, () => ({ id: "u1" }), true));
    expect((await call(c.handlers, { kind: "aim" })).status).toBe(429);
  });
});

describe.skipIf(!testDbConfigured())("one press of Ask Sera for a first draft", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let roleId: string;
  let sent: any[] = [];
  let reply = "";
  const ME = { id: "draft-owner", name: "Ines Vargas", email: "ines@example.test", prefs: {} };
  const GOALS = ["Plan the weekly menu", "Order the dry goods"];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await ensureInstanceIdentity(pool);
    await usersRepo(pool).add({ ...ME });
    roleId = await createOrgRole(pool, { name: "Kitchen keeper", aim: "Feed people well", accountabilities: GOALS });
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
  /** The JSON the model was handed as data: the one fenced block. */
  const handedOver = (): any => {
    const system = String(sent[0]?.system ?? "");
    const block = system.split('<village-data reader="')[1] ?? "";
    const json = block.split("\n").find((l) => l.startsWith("{")) ?? "{}";
    return JSON.parse(json);
  };

  // A body carrying everything a page could ever hold. Only three keys may survive.
  const planted = () => ({
    kind: "goals",
    roles: [{ roleId, note: "I cook for forty", name: "Ines Vargas" }],
    why: "I have fed the village for years",
    aim: "A kitchen that runs itself",
    references: [{ name: "Wren Example", how: "fence", contact: "wren@example.org" }],
    backgroundCheck: { needed: true, consent: { version: "cc-1" } },
    checkConsent: { given: true },
    about: { story: "my private story", based: "Uvita" },
    links: [{ label: "Site", url: "https://ines.example" }],
    files: [{ id: "pf-7" }],
    name: "Ines Vargas",
    email: "ines@example.test",
  });

  it("hands the model exactly the allow-listed fields, and nothing the candidate keeps private", async () => {
    wire();
    reply = JSON.stringify({ goals: [{ title: "Cook the first menu", doneWhen: "the menu is posted", moves: GOALS[0], roleId }] });
    const { app, handlers } = collect();
    register(app, deps(pool, () => ME));
    const out = await call(handlers, planted());
    expect(out.status).toBe(200);
    expect(sent).toHaveLength(1);

    const data = handedOver();
    // The exact payload: the candidate's three allow-listed fields (roles keep the id and the note, nothing else)...
    expect(data.candidate).toEqual({ roles: [{ roleId, note: "I cook for forty" }], why: "I have fed the village for years", aim: "A kitchen that runs itself" });
    expect(Object.keys(data.candidate).sort()).toEqual([...AI_SAFE_PROPOSAL_FIELDS].sort());
    // ...beside the role's own card words and the season's goals, which are the village's.
    expect(data.roleCards).toEqual([{ id: roleId, name: "Kitchen keeper", aim: "Feed people well", goals: GOALS }]);
    expect(data.seasonGoals).toEqual(["Feed the village from its own land"]);
    expect(Object.keys(data).sort()).toEqual(["ask", "candidate", "roleCards", "seasonGoals"]);

    // Nothing private rode along, anywhere in the request the provider received.
    const crossed = JSON.stringify(sent);
    for (const secret of ["Wren Example", "wren@example.org", "fence", "backgroundCheck", "cc-1", "my private story", "Uvita", "ines.example", "pf-7", "ines@example.test"]) {
      expect(crossed, secret).not.toContain(secret);
    }
    // The member's own name is not in what crossed either (the old planted `name` was on a role row).
    expect(crossed).not.toContain("Ines Vargas");

    const drafted = out.body as DraftReply;
    expect(drafted.guide).toEqual({ id: "village", name: "Maia" });
    expect(drafted.goals).toEqual([{ title: "Cook the first menu", doneWhen: "the menu is posted", moves: GOALS[0], roleId }]);
  });

  it("BREAK-THE-FIX CONTROL: a door that forwarded the whole body would put the planted data in front of the model", () => {
    const leaky = JSON.stringify({ candidate: planted() });
    expect(["wren@example.org", "my private story", "https://ines.example"].filter((s) => leaky.includes(s))).toHaveLength(3);
  });

  it("lets a drafted goal move only a goal its role lists, and only a role of the proposal", async () => {
    wire();
    reply = JSON.stringify({
      goals: [
        { title: "A", doneWhen: "a is done", moves: "Take over the whole village", roleId },
        { title: "B", doneWhen: "b is done", moves: GOALS[1], roleId: "some-other-role" },
        { title: "C", doneWhen: "c is done", moves: `  ${GOALS[0]} `, roleId },
        { title: "D", doneWhen: "d is done", moves: GOALS[0], roleId },
        { title: "E", doneWhen: "e is done", moves: GOALS[0], roleId },
      ],
    });
    const { app, handlers } = collect();
    register(app, deps(pool, () => ME));
    const out = await call(handlers, { kind: "goals", roles: [{ roleId }], why: "why", aim: "aim" });
    const goals = (out.body as DraftReply).goals!;
    expect(goals.map((g) => g.title)).toEqual(["A", "B", "C"]);
    expect(goals.map((g) => g.moves)).toEqual(["", GOALS[1], GOALS[0]]);
    expect(goals.every((g) => g.roleId === roleId)).toBe(true);
  });

  it("reads an aim and a story line, with no dashes between words, and writes nothing", async () => {
    wire();
    reply = JSON.stringify({ aim: "Food grows here — every season" });
    const { app, handlers } = collect();
    register(app, deps(pool, () => ME));
    const aim = await call(handlers, { kind: "aim", roles: [{ roleId }], why: "why", aim: "" });
    expect((aim.body as DraftReply).aim).toBe("Food grows here, every season");
    reply = JSON.stringify({ story: "" });
    const story = await call(handlers, { kind: "story", roles: [{ roleId }], why: "", aim: "" });
    expect(story.status).toBe(200);
    expect((story.body as DraftReply).story).toBeUndefined();
  });

  it("answers plainly and asks nobody when no guide can answer, so the form still works", async () => {
    wireAssistant({ villageKey: () => "", rateLimited: async () => false });
    const { app, handlers } = collect();
    register(app, deps(pool, () => ME));
    const out = await call(handlers, { kind: "aim", roles: [{ roleId }], why: "why", aim: "" });
    expect(out.status).toBe(503);
    expect(out.body.error).toContain("Your form works without it");
  });

  it("refuses to draft for a role the village does not have", async () => {
    wire();
    const { app, handlers } = collect();
    register(app, deps(pool, () => ME));
    expect((await call(handlers, { kind: "aim", roles: [{ roleId: "nope" }], why: "why", aim: "" })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

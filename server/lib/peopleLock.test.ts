/**
 * The people lock's pure parts: the tier, the scrub, the stranger's ballot,
 * and the middleware's choice of whom to scrub for. No database: the roster
 * is handed in. The walk over every real route is
 * server/anonymousPii.routes.e2e.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  ballotCardForViewer,
  ballotForViewer,
  compileRoster,
  hiddenFromStranger,
  peopleLockMiddleware,
  peopleTier,
  scrubPeople,
  type RosterPerson,
} from "./peopleLock";

const ROSTER: RosterPerson[] = [
  { id: "user-111-aaa", name: "Isadora Penhallow", handle: "isadora-penhallow", email: "isa@example.test" },
  { id: "user-222-bbb", name: "Caspian Ravensworth", handle: "caspian-ravensworth", email: null },
  { id: null, name: "Faustina Marchetti", handle: null, email: null },
  // Copy words the product prints everywhere are never treated as a name.
  { id: "user-333-ccc", name: "Member", handle: "member", email: null },
];
const r = compileRoster(ROSTER);

describe("peopleTier", () => {
  it("a member is a member at either setting; a stranger follows the lock", () => {
    expect(peopleTier(true, false)).toBe("member");
    expect(peopleTier(true, true)).toBe("member");
    expect(peopleTier(false, true)).toBe("public");
    expect(peopleTier(false, false)).toBe("none");
    expect(hiddenFromStranger(null, false)).toBe(true);
    expect(hiddenFromStranger(null, true)).toBe(false);
    expect(hiddenFromStranger({ id: "u" }, false)).toBe(false);
  });
});

describe("scrubPeople", () => {
  it("takes every name, part of a name, handle, id and email out of a sentence", () => {
    const line = "Isadora appreciated Caspian Ravensworth; see /profile/isadora-penhallow or mail isa@example.test (user-111-aaa).";
    const out = scrubPeople(line, r);
    for (const gone of ["Isadora", "Caspian", "Ravensworth", "isadora-penhallow", "isa@example.test", "user-111-aaa"]) {
      expect(out).not.toContain(gone);
    }
    expect(out).toBe("A member appreciated a member; see /profile/ or mail  ().");
  });

  it("keeps JSON parseable, and a name opening a value reads as a sentence", () => {
    const body = JSON.stringify({ votes: [{ name: "Isadora", choice: "yes" }], who: "Faustina Marchetti holds it", ref: "user-222-bbb@steward" });
    const parsed = JSON.parse(scrubPeople(body, r));
    expect(parsed.votes[0].name).toBe("A member");
    expect(parsed.who).toBe("A member holds it");
    expect(parsed.ref).toBe("@steward");
  });

  it("matches whole words only, and leaves copy words alone", () => {
    const out = scrubPeople("Isadoras and Caspianic are not names here. Member price applies.", r);
    expect(out).toBe("Isadoras and Caspianic are not names here. Member price applies.");
  });

  it("a handle that is a plain word goes only where a handle sits, never out of a sentence", () => {
    const plain = compileRoster([{ id: "user-444-ddd", name: "Wren Holloway", handle: "wren", email: null }]);
    expect(scrubPeople("A wren sang; see /profile/wren or @wren.", plain)).toBe("A wren sang; see /profile/ or @.");
    expect(JSON.parse(scrubPeople(JSON.stringify({ handle: "wren", note: "the wren nests" }), plain))).toEqual({ handle: "", note: "the wren nests" });
  });

  it("an empty roster scrubs nothing", () => {
    expect(scrubPeople("Isadora", compileRoster([]))).toBe("Isadora");
  });
});

describe("a stranger's ballot (R098)", () => {
  const member = {
    id: "bal-1",
    subjectRef: "user-222-bbb@steward",
    title: "Raise the budget",
    docMarkdown: "Proposed by Isadora",
    purposeAlignment: "It feeds people",
    outcomeNote: "Carried, thanks Caspian",
    closedBy: "Ottoline",
    votes: [{ name: "Caspian", choice: "yes", weight: 1, castAt: "2026-10-31T00:00:00Z" }],
    silent: [{ name: "Delphine", weight: 1 }],
    objections: [{ id: "o1", by: "Evander", text: "Wait a moon" }],
    votedCount: 1,
    electorateCount: 3,
    tallies: { yesW: 1, noW: 0, abstainW: 0 },
    myVote: { choice: "yes" },
    myWeight: 1,
    priorAttempts: [{ id: "bal-0", title: "Raise it", outcomeNote: "Isadora withdrew it" }],
  };

  it("a member reads the ballot exactly as served", () => {
    expect(ballotForViewer({ id: "u" }, member)).toBe(member);
  });

  it("a stranger reads counts, tallies and status, with every page key still present", () => {
    const s = ballotForViewer(null, member) as any;
    expect(s.viewerTier).toBe("stranger");
    expect(s.votes).toEqual([]);
    expect(s.silent).toEqual([]);
    expect(s.objections).toEqual([]);
    expect(s.objectionsFiled).toBe(1);
    expect(s.docMarkdown).toBe("");
    expect(s.subjectRef).toBe("");
    expect(s.purposeAlignment).toBeNull();
    expect(s.outcomeNote).toBeNull();
    expect(s.closedBy).toBeNull();
    expect(s.myVote).toBeNull();
    expect(s.myWeight).toBeNull();
    expect(s.priorAttempts[0].outcomeNote).toBeNull();
    // What a stranger is owed.
    expect(s.votedCount).toBe(1);
    expect(s.electorateCount).toBe(3);
    expect(s.tallies).toEqual({ yesW: 1, noW: 0, abstainW: 0 });
    expect(s.title).toBe("Raise the budget");
    // Nothing a person wrote or is called survives.
    for (const word of ["Isadora", "Caspian", "Delphine", "Evander", "Ottoline", "user-222-bbb"]) {
      expect(JSON.stringify(s)).not.toContain(word);
    }
  });

  it("a stranger's card drops the subject ref and the closing note", () => {
    const c = ballotCardForViewer(null, { id: "bal-1", subjectRef: "user-222-bbb@steward", outcomeNote: "x", myVote: null, myWeight: null }) as any;
    expect(c).toMatchObject({ subjectRef: "", outcomeNote: null, viewerTier: "stranger" });
  });
});

describe("peopleLockMiddleware", () => {
  type Sent = { body: unknown };
  const fakePool = (people: RosterPerson[]) =>
    ({
      query: async (sql: string) =>
        sql.includes("FROM `users`")
          ? [people.filter((p) => p.id).map((p) => ({ id: p.id, name: p.name, handle: p.handle, email: p.email }))]
          : [people.filter((p) => !p.id).map((p) => ({ display_name: p.name }))],
    }) as any;

  async function run(opts: { method?: string; path?: string; signedIn?: boolean; locked?: boolean; body: unknown; poolFails?: boolean }): Promise<Sent & { status?: number; passed?: boolean }> {
    const mw = peopleLockMiddleware({
      authedUser: async () => (opts.signedIn ? { id: "u" } : null),
      getPool: () => (opts.poolFails ? ({ query: async () => { throw new Error("down"); } } as any) : fakePool(ROSTER)),
      boolVar: (k) => (k === "org.public_people" ? !opts.locked : false),
    });
    const sent: Sent & { status?: number; passed?: boolean } = { body: undefined };
    const res: any = {
      send(b: unknown) { sent.body = b; return res; },
      status(n: number) { sent.status = n; return res; },
      json(b: unknown) { sent.body = b; return res; },
    };
    const path = opts.path ?? "/api/org";
    await mw({ method: opts.method ?? "GET", path, url: path } as any, res, () => { sent.passed = true; });
    res.send(opts.body);
    return sent;
  }

  it("scrubs a stranger's GET while the lock is on", async () => {
    expect((await run({ locked: true, body: '{"name":"Isadora Penhallow"}' })).body).toBe('{"name":"A member"}');
  });

  it("leaves a member, an open village, a write and a non-string body alone", async () => {
    expect((await run({ locked: true, signedIn: true, body: "Isadora" })).body).toBe("Isadora");
    expect((await run({ locked: false, body: "Isadora" })).body).toBe("Isadora");
    expect((await run({ locked: true, method: "POST", body: "Isadora" })).body).toBe("Isadora");
    const buf = Buffer.from("Isadora");
    expect((await run({ locked: true, body: buf })).body).toBe(buf);
  });

  it("fails closed when it cannot read whom to hide", async () => {
    const sent = await run({ locked: true, poolFails: true, body: "unused" });
    expect(sent.status).toBe(503);
  });

  // 2026-11-01. The middleware is an `app.use` with no path, registered before
  // `/health`, `/api/platform/info` and every static asset. With the lock on, a
  // roster read that failed (a cold pool, a database blip) answered the
  // liveness probe 503, and Railway replaces a container whose probe fails, so a
  // privacy rule could take a healthy village down. These paths carry no member
  // and are never scrubbed (static files are not sent through res.send), so
  // they must not depend on the roster at all.
  it("lets the liveness probe, the platform handshake and the built assets through when the roster cannot be read", async () => {
    for (const path of ["/health", "/api/platform/info", "/assets/index-3f9a.js", "/assets/fonts/inter.woff2"]) {
      const sent = await run({ locked: true, poolFails: true, path, body: "ok" });
      expect(sent.status, `${path} must not fail closed`).toBeUndefined();
      expect(sent.passed, `${path} must reach its route`).toBe(true);
    }
  });

  it("still fails closed on a page that is not a probe, and is not fooled by a lookalike path", async () => {
    for (const path of ["/", "/api/org", "/healthz", "/health/../api/org", "/api/platform/info/extra", "/assetsx/a.js", "/api/assets/x"]) {
      const sent = await run({ locked: true, poolFails: true, path, body: "unused" });
      expect(sent.status, `${path} must still fail closed`).toBe(503);
    }
  });
});

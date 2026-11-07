/**
 * EVERY SETTING'S HISTORY: who changed it, when and why, with a link to the
 * vote (change requests, Rye 2026-11-06, 3g).
 *
 * `GET /api/game/mechanics/history` was a single feed of every change, open
 * to strangers, naming each actor by first name. Three things change here:
 *
 *  - `?key=` narrows it to one setting, so every setting can show its own
 *    history.
 *  - Each row carries the proposal that made it (its title is the "why") when
 *    the change came from a vote.
 *  - Names follow III.2: "Role (FirstName)" for a signed-in reader, read from
 *    the roster at render time; the role alone, or "a member", for anyone else.
 *
 * Driven through the real `register` against a fake Express, with a pool
 * stub that answers by statement and records what it was asked.
 */
import { describe, expect, it } from "vitest";
import { actorLabel, proposalIdIn, register } from "./mechanicsHistory";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect() {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => void handlers.set(`${method} ${p}`, handler);
  return { app: { get: record("GET"), post: record("POST") } as any, handlers };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
  };
  return { res, out };
}

const ROWS = [
  { id: "m2", config_key: "governance.vote_days", old_value: "7", new_value: "9", actor_user_id: "u-rick", source: "governance", proposal_ref: "gm:gmp-1 bal:bal-9", note: null, at: new Date("2026-11-02T10:00:00Z") },
  { id: "m1", config_key: "governance.vote_days", old_value: null, new_value: "7", actor_user_id: "u-ana", source: "admin", proposal_ref: null, note: null, at: new Date("2026-10-01T10:00:00Z") },
  { id: "m0", config_key: "governance.quorum_pct", old_value: null, new_value: "30", actor_user_id: "u-gone", source: "admin", proposal_ref: null, note: null, at: new Date("2026-09-01T10:00:00Z") },
];

function harness(signedIn: boolean) {
  const asked: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      asked.push({ sql, params });
      if (sql.includes("FROM mechanics_changes")) {
        const key = sql.includes("WHERE config_key = ?") ? params[0] : null;
        return [key ? ROWS.filter((r) => r.config_key === key) : ROWS];
      }
      if (sql.includes("FROM mechanics_proposals")) return [[{ id: "gmp-1", title: "Longer votes for harvest season" }]];
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  const people: Record<string, { name: string }> = { "u-rick": { name: "Rick Moss" }, "u-ana": { name: "Ana Lopez" } };
  const roles: Record<string, string[]> = { "u-rick": ["Treasurer"], "u-ana": [] };
  const { app, handlers } = collect();
  register(app, {
    authedUser: async () => (signedIn ? ({ id: "u-reader", name: "Reader Person" } as any) : null),
    getPool: () => pool as any,
    members: { byId: async (id: string) => people[id] ?? null } as any,
    firstName: (n: string) => String(n).split(" ")[0],
    rolesOf: async (id: string) => roles[id] ?? [],
  });
  const get = async (query: Record<string, string> = {}) => {
    const { res, out } = makeRes();
    await handlers.get("GET /api/game/mechanics/history")!({ query, headers: {} }, res);
    return out;
  };
  return { get, asked };
}

describe("actorLabel (III.2)", () => {
  it("names the role first and the first name in parentheses for a signed-in reader", () => {
    expect(actorLabel({ signedIn: true, name: "Rick Moss", roles: ["Treasurer"] })).toBe("Treasurer (Rick)");
    expect(actorLabel({ signedIn: true, name: "Rick Moss", roles: ["Treasurer", "Steward"] })).toBe("Treasurer, Steward (Rick)");
  });

  it("gives a signed-in reader the first name alone when the actor holds no role", () => {
    expect(actorLabel({ signedIn: true, name: "Ana Lopez", roles: [] })).toBe("Ana");
  });

  it("gives everyone else the role alone, or 'a member', and never a name", () => {
    expect(actorLabel({ signedIn: false, name: "Rick Moss", roles: ["Treasurer"] })).toBe("Treasurer");
    expect(actorLabel({ signedIn: false, name: "Ana Lopez", roles: [] })).toBe("A member");
  });

  it("never prints a surname, or an email-shaped name", () => {
    expect(actorLabel({ signedIn: true, name: "Rick Moss", roles: [] })).not.toContain("Moss");
    expect(actorLabel({ signedIn: true, name: "ana@example.org", roles: [] })).toBe("A member");
  });

  it("says a departed member when the account is gone", () => {
    expect(actorLabel({ signedIn: true, name: null, roles: [] })).toBe("A departed member");
  });
});

describe("proposalIdIn", () => {
  it("reads the proposal id out of a stored reference", () => {
    expect(proposalIdIn("gm:gmp-1 bal:bal-9")).toBe("gmp-1");
    expect(proposalIdIn("gm:gmp-1776-ab12")).toBe("gmp-1776-ab12");
    expect(proposalIdIn(null)).toBeNull();
    expect(proposalIdIn("hypha:123")).toBeNull();
  });
});

describe("GET /api/game/mechanics/history", () => {
  it("narrows to one setting with ?key=, newest first, as data in the statement", async () => {
    const { get, asked } = harness(true);
    const out = await get({ key: "governance.vote_days" });
    expect(out.status).toBe(200);
    expect(out.body.map((r: any) => r.id)).toEqual(["m2", "m1"]);
    const sel = asked.find((a) => a.sql.includes("FROM mechanics_changes"))!;
    expect(sel.params[0]).toBe("governance.vote_days");
  });

  it("refuses a key longer than any stored key", async () => {
    const { get } = harness(true);
    const out = await get({ key: "x".repeat(192) });
    expect(out.status).toBe(400);
  });

  it("carries the proposal that made a governed change: its title is the why, with its vote", async () => {
    const { get } = harness(true);
    const out = await get({ key: "governance.vote_days" });
    expect(out.body[0].proposal).toEqual({ id: "gmp-1", title: "Longer votes for harvest season", ballotId: "bal-9" });
    expect(out.body[1].proposal).toBeNull();
  });

  it("names actors as Role (FirstName) for a signed-in reader", async () => {
    const { get } = harness(true);
    const out = await get();
    expect(out.body.find((r: any) => r.id === "m2").by).toBe("Treasurer (Rick)");
    expect(out.body.find((r: any) => r.id === "m1").by).toBe("Ana");
    expect(out.body.find((r: any) => r.id === "m0").by).toBe("A departed member");
  });

  it("names no person to a reader who is not signed in", async () => {
    const { get } = harness(false);
    const out = await get();
    const text = JSON.stringify(out.body);
    expect(text).not.toContain("Rick");
    expect(text).not.toContain("Ana");
    expect(out.body.find((r: any) => r.id === "m2").by).toBe("Treasurer");
    expect(out.body.find((r: any) => r.id === "m1").by).toBe("A member");
  });
});

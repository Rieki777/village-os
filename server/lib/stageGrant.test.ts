/**
 * The one path a stage is granted by (server/lib/stageGrant.ts): the admin
 * roster's `PUT /api/admin/players/:id/stage`, lifted out unchanged, and the
 * raise-only grant an adopted open role proposal makes. The admin route's own
 * e2e suites cover the HTTP; this pins the behaviour both callers share.
 */
import { describe, expect, it } from "vitest";
import { grantStage } from "./stageGrant";

function world(people: Record<string, any>) {
  const events: Array<{ id: string; from: string; to: string; reason: string }> = [];
  const deps = {
    members: {
      byId: async (id: string) => (people[id] ? { ...people[id] } : null),
      update: async (id: string, mutate: (u: any) => void) => {
        if (!people[id]) return null;
        const next = { ...people[id] };
        mutate(next);
        people[id] = next;
        return { ...next };
      },
    },
    stageOf: async (u: any) => (u.stageGranted ? String(u.stageGranted) : "guest"),
    recordStageEvent: async (u: any, from: string, to: string, reason: string) => {
      events.push({ id: String(u.id), from, to, reason });
    },
  } as any;
  return { deps, events, people };
}

describe("granting a stage", () => {
  it("the admin's grant sets the floor, moves it down, and clears it", async () => {
    const w = world({ u1: { id: "u1", stageGranted: null } });
    expect(await grantStage(w.deps, "u1", "co-creator", "granted by an admin")).toMatchObject({ ok: true, stageComputed: "co-creator", changed: true });
    expect(w.events).toEqual([{ id: "u1", from: "guest", to: "co-creator", reason: "granted by an admin" }]);
    expect(await grantStage(w.deps, "u1", "member", "granted by an admin")).toMatchObject({ ok: true, stageComputed: "member" });
    expect(await grantStage(w.deps, "u1", null, "grant removed")).toMatchObject({ ok: true, stageComputed: "guest" });
    expect(w.people.u1.stageGranted).toBeNull();
  });

  it("refuses an unknown stage, a missing member and an example identity, as the route did", async () => {
    const w = world({ ex: { id: "ex", isExample: true, email: "x@example.test" } });
    expect(await grantStage(w.deps, "ex", "nope", "x")).toEqual({ ok: false, status: 400, body: { error: "Unknown stage" } });
    expect(await grantStage(w.deps, "missing", "member", "x")).toEqual({ ok: false, status: 404, body: { error: "Not found" } });
    expect(await grantStage(w.deps, "ex", "member", "x")).toMatchObject({ ok: false, status: 409 });
    expect(w.people.ex.stageGranted).toBeUndefined();
  });

  it("a raise-only grant lifts a lower floor and never lowers a higher one", async () => {
    const w = world({ low: { id: "low", stageGranted: "guest" }, high: { id: "high", stageGranted: "co-creator" }, none: { id: "none" } });
    expect(await grantStage(w.deps, "low", "member", "a role proposal was adopted", { raiseOnly: true })).toMatchObject({ ok: true, changed: true });
    expect(w.people.low.stageGranted).toBe("member");
    expect(await grantStage(w.deps, "none", "member", "a role proposal was adopted", { raiseOnly: true })).toMatchObject({ ok: true, changed: true });
    expect(w.people.none.stageGranted).toBe("member");
    expect(await grantStage(w.deps, "high", "member", "a role proposal was adopted", { raiseOnly: true })).toMatchObject({ ok: true, changed: false, stageComputed: "co-creator" });
    expect(w.people.high.stageGranted).toBe("co-creator");
    // Already at the stage: nothing moves.
    expect(await grantStage(w.deps, "low", "member", "again", { raiseOnly: true })).toMatchObject({ ok: true, changed: false });
  });
});

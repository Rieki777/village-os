/**
 * Somebody arrived, and somebody is told.
 *
 * The property worth guarding is the FALLBACK, because the failure this
 * replaces was silence: registration wrote one activity row and told nobody at
 * all. A greeting mechanism that quietly reaches nobody is the same bug wearing
 * a feature's clothes, so every case here asks "who actually hears this".
 */
import { describe, expect, it, vi } from "vitest";

import { arrivalDedupeKey, arrivalNotice, greetArrival, greetersFor, type SeatRow } from "./arrival";

const seat = (over: Partial<SeatRow> = {}): SeatRow => ({
  orgRoleId: "role-greeter",
  holderKind: "member",
  userId: "u-greeter",
  endedAt: null,
  ...over,
});

describe("greetersFor", () => {
  it("finds the members sitting in the named seat", () => {
    expect(greetersFor("role-greeter", [seat(), seat({ userId: "u-2" })])).toEqual(["u-greeter", "u-2"]);
  });

  it("ignores every other seat", () => {
    expect(greetersFor("role-greeter", [seat({ orgRoleId: "role-other" })])).toEqual([]);
  });

  it("ignores a seating that has ENDED, which is a person who used to greet", () => {
    expect(greetersFor("role-greeter", [seat({ endedAt: new Date("2026-01-01") })])).toEqual([]);
  });

  it("ignores a documented holder, who has no account to notify", () => {
    // org_role_assignments can name a real person the village has not connected
    // to an account. There is nobody for a notification to reach.
    expect(greetersFor("role-greeter", [seat({ holderKind: "documented", userId: null })])).toEqual([]);
  });

  it("answers empty when no seat is named at all", () => {
    expect(greetersFor("", [seat()])).toEqual([]);
    expect(greetersFor("   ", [seat()])).toEqual([]);
  });

  it("names each member once even when they hold the seat twice", () => {
    expect(greetersFor("role-greeter", [seat(), seat()])).toEqual(["u-greeter"]);
  });
});

describe("greetArrival", () => {
  const newcomer = { id: "u-new", name: "Wren Alder", handle: "wren" };
  const everyone = [
    { id: "u-admin", role: "admin" },
    { id: "u-founder", role: "founder" },
    { id: "u-plain", role: "member" },
    { id: "u-greeter", role: "member" },
  ];

  it("tells the seat when somebody is sitting in it, and nobody else", () => {
    const sent: string[] = [];
    const notify = vi.fn(async (i: any) => void sent.push(i.userId));
    return greetArrival(newcomer, {
      greeterRoleId: "role-greeter",
      seats: [seat()],
      everyone,
      notify,
    }).then((told) => {
      expect(told).toEqual(["u-greeter"]);
      expect(sent).toEqual(["u-greeter"]);
    });
  });

  it("FALLS BACK TO THE FOUNDERS when no seat is named", async () => {
    // A village that has not built its org chart yet still finds out.
    const sent: string[] = [];
    const notify = vi.fn(async (i: any) => void sent.push(i.userId));
    await greetArrival(newcomer, { greeterRoleId: "", seats: [], everyone, notify });
    expect(sent).toEqual(["u-admin", "u-founder"]);
  });

  it("FALLS BACK when the seat is named and sitting VACANT", async () => {
    // The greeter stepped down last week. The village does not silently stop
    // greeting people, which is the failure this whole function replaces.
    const sent: string[] = [];
    const notify = vi.fn(async (i: any) => void sent.push(i.userId));
    await greetArrival(newcomer, {
      greeterRoleId: "role-greeter",
      seats: [seat({ endedAt: new Date("2026-01-01") })],
      everyone,
      notify,
    });
    expect(sent).toEqual(["u-admin", "u-founder"]);
  });

  it("never tells somebody that they themselves arrived", async () => {
    // The first founder of a village registers into an empty admin list.
    const sent: string[] = [];
    const notify = vi.fn(async (i: any) => void sent.push(i.userId));
    await greetArrival(
      { id: "u-admin", name: "First", handle: "first" },
      { greeterRoleId: "", seats: [], everyone, notify },
    );
    expect(sent).toEqual(["u-founder"]);
  });

  it("carries one stable key per arrival per recipient, so a retry is a no-op", async () => {
    const keys: string[] = [];
    const notify = vi.fn(async (i: any) => void keys.push(i.dedupeKey));
    await greetArrival(newcomer, { greeterRoleId: "role-greeter", seats: [seat()], everyone, notify });
    await greetArrival(newcomer, { greeterRoleId: "role-greeter", seats: [seat()], everyone, notify });
    expect(keys).toEqual([arrivalDedupeKey("u-new", "u-greeter"), arrivalDedupeKey("u-new", "u-greeter")]);
  });

  it("lets registration succeed even when notifying throws", async () => {
    // A person who cannot be greeted still joined. A failed greeting is not a
    // reason to refuse somebody an account.
    const notify = vi.fn(async () => {
      throw new Error("notify is down");
    });
    await expect(
      greetArrival(newcomer, { greeterRoleId: "role-greeter", seats: [seat()], everyone, notify }),
    ).resolves.toEqual([]);
  });

  it("names the person, because a greeter has to know who to greet", () => {
    const { title, link } = arrivalNotice("Wren Alder", "wren");
    expect(title).toContain("Wren Alder");
    expect(link).toBe("/profile/wren");
  });

  it("still points somewhere when a member has no handle yet", () => {
    expect(arrivalNotice("Wren Alder", "").link).toBe("/members");
    expect(arrivalNotice("", "").title).toContain("Someone new");
  });
});

/**
 * Quest crews (0067). The cases worth writing are the ones where two people
 * act at once, because that is what an invite link produces: one message, many
 * taps, all within a second of each other.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL → the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { cleanCrewName, crewsRepo, newInviteCode, type CrewsRepo } from "./crews";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let crews: CrewsRepo;
let n = 0;
const mk = async (over: Partial<{ maxSize: number; questId: string }> = {}) =>
  crews.create({
    id: `crew-${++n}`,
    questId: over.questId ?? "q-1",
    name: `Crew ${n}`,
    creatorId: "u-founder",
    maxSize: over.maxSize ?? 5,
  });

describe("cleanCrewName", () => {
  it("flattens whitespace and caps the length", () => {
    expect(cleanCrewName("  The   Thursday\nCrew ")).toBe("The Thursday Crew");
    expect(cleanCrewName("x".repeat(400))).toHaveLength(120);
  });

  it("turns nothing into nothing, so the caller can refuse it", () => {
    expect(cleanCrewName("   ")).toBe("");
    expect(cleanCrewName(null)).toBe("");
    expect(cleanCrewName(undefined)).toBe("");
  });
});

describe("newInviteCode", () => {
  it("is long and unguessable, and never repeats", () => {
    const codes = new Set(Array.from({ length: 500 }, () => newInviteCode()));
    expect(codes.size).toBe(500);
    expect([...codes][0].length).toBeGreaterThanOrEqual(16);
  });

  it("is URL-safe, because it rides in a link", () => {
    for (let i = 0; i < 100; i++) expect(newInviteCode()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe.skipIf(!configured)("crewsRepo (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 });
    crews = crewsRepo(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("a new crew already holds its founder", async () => {
    const crew = await mk();
    expect(crew.members).toHaveLength(1);
    expect(crew.members[0]).toMatchObject({ userId: "u-founder", role: "founder" });
    expect(crew.status).toBe("forming");
    expect(crew.inviteCode.length).toBeGreaterThan(10);
  });

  it("is reachable by its invite code", async () => {
    const crew = await mk();
    const found = await crews.byInvite(crew.inviteCode);
    expect(found?.id).toBe(crew.id);
    expect(await crews.byInvite("no-such-code")).toBeNull();
  });

  it("joining twice is not an error and does not duplicate a member", async () => {
    const crew = await mk();
    expect(await crews.join(crew.id, "u-2")).toBe("joined");
    expect(await crews.join(crew.id, "u-2")).toBe("already");
    const fresh = await crews.byId(crew.id);
    expect(fresh!.members).toHaveLength(2);
  });

  it("refuses past the size, and the check survives a stampede", async () => {
    // maxSize 3 means the founder plus two. Six people tap the same link at
    // once: exactly two may get in. Checking the count outside a transaction
    // is how all six would have got in.
    const crew = await mk({ maxSize: 3 });
    const results = await Promise.all(
      ["a", "b", "c", "d", "e", "f"].map((u) => crews.join(crew.id, `u-${u}`)),
    );
    expect(results.filter((r) => r === "joined")).toHaveLength(2);
    expect(results.filter((r) => r === "full")).toHaveLength(4);
    const fresh = await crews.byId(crew.id);
    expect(fresh!.members).toHaveLength(3);
  });

  it("a crew with somebody in it is active", async () => {
    const crew = await mk();
    await crews.join(crew.id, "u-9");
    expect((await crews.byId(crew.id))!.status).toBe("active");
  });

  it("leaving removes only the leaver", async () => {
    const crew = await mk();
    await crews.join(crew.id, "u-3");
    expect(await crews.leave(crew.id, "u-3")).toBe("left");
    const fresh = await crews.byId(crew.id);
    expect(fresh!.members.map((m) => m.userId)).toEqual(["u-founder"]);
  });

  it("the last member out disbands the crew, so no invite outlives it", async () => {
    const crew = await mk();
    expect(await crews.leave(crew.id, "u-founder")).toBe("disbanded");
    expect((await crews.byId(crew.id))!.status).toBe("disbanded");
    // A disbanded crew still resolves by code, and join refuses it.
    expect(await crews.join(crew.id, "u-late")).toBe("gone");
  });

  it("leaving a crew you are not in says so", async () => {
    const crew = await mk();
    expect(await crews.leave(crew.id, "u-stranger")).toBe("not-a-member");
  });

  it("lists live crews for a quest and hides disbanded ones", async () => {
    const a = await mk({ questId: "q-list" });
    const b = await mk({ questId: "q-list" });
    await crews.leave(b.id, "u-founder");
    const live = await crews.forQuest("q-list");
    expect(live.map((c) => c.id)).toEqual([a.id]);
  });

  it("rotating an invite kills the old link", async () => {
    const crew = await mk();
    const old = crew.inviteCode;
    const next = await crews.rotateInvite(crew.id);
    expect(next).not.toBe(old);
    expect(await crews.byInvite(old)).toBeNull();
    expect((await crews.byInvite(next))!.id).toBe(crew.id);
  });

  it("attaches a conversation when messaging is on, and works without one", async () => {
    const crew = await mk();
    expect(crew.conversationId).toBeNull();
    await crews.attachConversation(crew.id, "conv-1");
    expect((await crews.byId(crew.id))!.conversationId).toBe("conv-1");
  });
});

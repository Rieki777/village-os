/**
 * THE CIRCLE CARD ON A REAL SCHEMA: `GET /api/org/circles/:id/card`, read the
 * way `/api/org` reads, at two tiers.
 *
 * What is pinned:
 *
 *   - the circle's words come back from `circle_charters` (0270), in the
 *     card's order, with the purpose from `circles.purpose`;
 *   - each role in the circle reads filled, partly filled or open, the same
 *     state `/api/org` derives, and an open real role offers Apply;
 *   - a visitor gets no holder card links and one line saying why; a reader
 *     who sees the member holder rows gets one link per member holder, named
 *     by the role, at `/profile/:handle#role-<id>`;
 *   - no holder's name is anywhere in the payload, at either tier;
 *   - the adoption record counts published drafts that wrote the circle's
 *     words, newest first, says which one the village voted in, and leaves a
 *     reverted draft out;
 *   - `org.ccos_terms` off takes every CCOS term off the card;
 *   - an unknown circle answers 404.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register } from "./routes/circleCard";
import type { CircleCard, CircleSection } from "../shared/circleCard";
import { CIRCLE_SECTION_KEYS } from "../shared/circleCardWords";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const configured = testDbConfigured();
if (!configured) console.warn("[circleCard.db] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const CIRCLES = [
  { id: "c-root", name: "Coordinating circle", purpose: "Where the circles meet.", status: "active", parentCircleId: null },
  { id: "c-garden", name: "Garden circle", purpose: "Grow food together for every household.", status: "active", parentCircleId: "c-root" },
  { id: "c-new", name: "New circle", purpose: null, status: "forming", parentCircleId: "c-root" },
];

describe.skipIf(!configured)("the circle card, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handler: Handler;
  let admin = false;
  let terms = true;
  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  async function read(id: string): Promise<{ status: number; body: any }> {
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
    await handler({ params: { id }, headers: {} }, res);
    return out;
  }
  const section = (card: CircleCard, key: string): CircleSection => card.sections.find((s) => s.key === key)!;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const handlers = new Map<string, Handler>();
    const app: any = { get: (p: string, h: Handler) => handlers.set(`GET ${p}`, h), post: () => undefined };
    register(app, {
      authedUser: async () => (admin ? { id: "m-ana", name: "Ana Reyes" } : null),
      isAdmin: async () => admin,
      capabilityCtx: async () => ({ stageIndex: 0, stageIndexOf: () => 0, roleCapabilities: [], isAdmin: admin }) as any,
      getPool: () => pool as any,
      overLimit: async () => false,
      circles: () => CIRCLES,
      seasonState: () => ({ timezone: "UTC" }),
      lapse: () => ({ currentSeasonId: null, cadence: "never" }) as any,
      mapLifecycle: () => "public",
      sessionsLifecycle: () => "off",
      boolVar: (key: string) => (key === "org.ccos_terms" ? terms : key === "map.public_structure" || key === "org.public_people"),
      now: () => new Date("2026-10-22T12:00:00Z"),
    });
    handler = handlers.get("GET /api/org/circles/:id/card")!;

    await q(
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES " +
        "('m-cai', 'Cai Moreno', 'cai@example.test', 'x', 'cai'), ('m-gil', 'Gil Varga', 'gil@example.test', 'x', 'gil')",
    );
    await q(
      "INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `seats`, `active`, `is_example`, `sort_order`) VALUES " +
        "('seat-water', 'c-garden', 'Water Keeper', 1, 1, 0, 1), ('seat-bees', 'c-garden', 'Bee Steward', 2, 1, 0, 2), " +
        "('seat-seed', 'c-garden', 'Seed Librarian', 1, 1, 0, 3), ('seat-elsewhere', 'c-root', 'Treasurer', 1, 1, 0, 1)",
    );
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`) VALUES " +
        "('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai'), ('ora-gil', 'seat-bees', 'member', 'm-gil', 'm-gil')",
    );
    await q(
      "INSERT INTO `circle_charters` (`circle_id`, `exists_while`, `accountabilities`, `domains`, `circle_values`) VALUES (?, ?, ?, ?, ?)",
      [
        "c-garden",
        "the village eats from its own land",
        JSON.stringify(["Every household has fresh food each week", "The soil is richer each season"]),
        JSON.stringify(["The food forest", "The seed library"]),
        JSON.stringify([{ value: "Reciprocity", practice: "We share every harvest before we sell any of it." }]),
      ],
    );
    // Created by a vote, new words adopted directly, and a later change reverted.
    await q(
      "INSERT INTO `org_drafts` (`id`, `title`, `status`, `created_by`, `published_by`, `published_at`) VALUES " +
        "('d-make', 'Make the garden circle', 'published', 'm-ana', 'b-make', '2026-09-04 10:00:00'), " +
        "('d-words', 'New words for the garden circle', 'published', 'm-cai', 'm-ana', '2026-10-01 10:00:00'), " +
        "('d-undone', 'Words we took back', 'reverted', 'm-cai', 'm-ana', '2026-10-10 10:00:00')",
    );
    await q(
      "INSERT INTO `org_draft_changes` (`id`, `draft_id`, `op`, `org_role_id`, `payload`) VALUES " +
        "('ch-1', 'd-make', 'create_circle', 'circle:c-garden', '{}'), ('ch-2', 'd-words', 'update_circle', 'circle:c-garden', '{}'), " +
        "('ch-3', 'd-undone', 'update_circle', 'circle:c-garden', '{}')",
    );
    await q(
      "INSERT INTO `ballots` (`id`, `subject_type`, `subject_ref`, `open_key`, `title`, `doc_markdown`, `method`, `weight_mode`, " +
        "`unity_pct`, `quorum_pct`, `total_weight`, `electorate_count`, `opened_by`, `opens_at`, `closes_at`, `status`) VALUES " +
        "('b-make', 'org_draft', 'd-make', 'org_draft:d-make:b-make', 'Make the garden circle', 'x', 'consent', 'equal', " +
        "0, 0, 0, 0, 'm-ana', '2026-09-01 09:00:00', '2026-09-04 09:00:00', 'closed')",
    );
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("reads the circle's words in the card's order, purpose first", async () => {
    admin = false;
    const { status, body } = await read("c-garden");
    expect(status).toBe(200);
    const card: CircleCard = body.card;
    expect(card.header.name).toBe("Garden circle");
    expect(card.header.parent?.name).toBe("Coordinating circle");
    expect(card.header.parent?.href).toBe("/circles/c-root");
    expect(card.header.existsWhile).toEqual({ kind: "shown", value: "the village eats from its own land" });
    expect(card.sections.map((s) => s.key)).toEqual([...CIRCLE_SECTION_KEYS]);
    expect(section(card, "purpose").slot).toEqual({ kind: "shown", value: "Grow food together for every household." });
    const acc = section(card, "accountabilities") as Extract<CircleSection, { kind: "list" }>;
    expect(acc.slot).toEqual({ kind: "shown", value: ["Every household has fresh food each week", "The soil is richer each season"] });
    expect(acc.note).toBe("2 lines written. A circle answers for 3 to 6 things.");
    expect(section(card, "authorities").slot).toEqual({ kind: "empty", words: "Not written yet" });
    expect(section(card, "values").slot).toEqual({
      kind: "shown",
      value: [{ value: "Reciprocity", practice: "We share every harvest before we sell any of it." }],
    });
    expect(section(card, "domains").term).toBe("CCOS: Domains");
  });

  it("shows each role filled, partly filled or open, and a visitor gets no holder links", async () => {
    admin = false;
    const { body } = await read("c-garden");
    const roles = section(body.card, "roles") as Extract<CircleSection, { kind: "roles" }>;
    expect(roles.slot.kind).toBe("shown");
    const rows = roles.slot.kind === "shown" ? roles.slot.value : [];
    expect(rows.map((r) => [r.name, r.stateWords])).toEqual([
      ["Water Keeper", "Filled"],
      ["Bee Steward", "1 of 2 filled"],
      ["Seed Librarian", "Open"],
    ]);
    expect(rows.every((r) => r.holderCards.length === 0)).toBe(true);
    // A visitor is offered propose a role, with that role picked: the member door would only refuse them (2026-10-31).
    expect(rows.find((r) => r.id === "seat-seed")?.applyHref).toBe("/propose-a-role?role=seat-seed");
    expect(rows.find((r) => r.id === "seat-water")?.applyHref).toBeNull();
    expect(roles.note).toBe("Sign in to open the holders' cards.");

    // A reader who holds terms.read keeps the member door.
    admin = true;
    try {
      const member = section((await read("c-garden")).body.card, "roles") as Extract<CircleSection, { kind: "roles" }>;
      const memberRows = member.slot.kind === "shown" ? member.slot.value : [];
      expect(memberRows.find((r) => r.id === "seat-seed")?.applyHref).toBe("/propose?type=role_application&seat=seat-seed");
    } finally {
      admin = false;
    }
    const text = JSON.stringify(body);
    expect(text).not.toContain("Cai");
    expect(text).not.toContain("Gil");
  });

  it("links each member holder's card for a reader who sees the holder rows, and still names nobody", async () => {
    admin = true;
    const { body } = await read("c-garden");
    const roles = section(body.card, "roles") as Extract<CircleSection, { kind: "roles" }>;
    const rows = roles.slot.kind === "shown" ? roles.slot.value : [];
    expect(rows.find((r) => r.id === "seat-water")?.holderCards).toEqual([
      { href: "/profile/cai#role-seat-water", label: "See their card", ariaLabel: "See the card of the holder of Water Keeper" },
    ]);
    expect(rows.find((r) => r.id === "seat-bees")?.holderCards.map((h) => h.href)).toEqual(["/profile/gil#role-seat-bees"]);
    expect(roles.note).toBeNull();
    const text = JSON.stringify(body);
    expect(text).not.toContain("Cai Moreno");
    expect(text).not.toContain("Gil Varga");
    admin = false;
  });

  it("records who agreed and when, newest first, and leaves the reverted draft out", async () => {
    const { body } = await read("c-garden");
    const adoption = section(body.card, "adoption") as Extract<CircleSection, { kind: "adoption" }>;
    expect(adoption.slot).toEqual({
      kind: "shown",
      value: {
        latest: "Adopted by a direct decision on 1 Oct 2026",
        summary: "2 changes adopted since 4 Sep 2026",
        lines: [
          { day: "1 Oct 2026", what: "New words for the circle", how: "Adopted by a direct decision on 1 Oct 2026" },
          { day: "4 Sep 2026", what: "The circle was created", how: "Adopted by a village vote on 4 Sep 2026" },
        ],
      },
    });
    expect(adoption.term).toBe("CCOS: Signatures");
  });

  it("an unwritten circle reads its empty words, and the terms can be turned off", async () => {
    terms = false;
    const { body } = await read("c-new");
    const card: CircleCard = body.card;
    expect(card.header.status).toBe("Forming");
    expect(card.header.existsWhile).toEqual({ kind: "empty", words: "not written yet" });
    expect(card.header.termsKey).toBeNull();
    expect(section(card, "purpose").slot).toEqual({ kind: "empty", words: "No purpose written yet" });
    expect(section(card, "roles").slot).toEqual({ kind: "empty", words: "No roles in this circle yet" });
    expect(section(card, "adoption").slot).toEqual({ kind: "empty", words: "No words for this circle have been adopted by consent yet." });
    expect(card.sections.every((s) => s.term === null)).toBe(true);
    terms = true;
  });

  it("answers 404 for a circle that does not exist", async () => {
    const { status } = await read("c-nowhere");
    expect(status).toBe(404);
  });
});

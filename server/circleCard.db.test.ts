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
 *   - no holder's name reaches a visitor, and no surname reaches anybody;
 *   - a signed-in member whose account is live reads each holder's FIRST name
 *     (lead, 12 Nov 2026); an erased holder is never named, a holder who left
 *     only by the name their seating kept, and a reader who left, an erased
 *     reader or a signed-up account not yet let in reads none;
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
  { id: "c-orchard", name: "Orchard circle", purpose: "Tend the fruit trees.", status: "active", parentCircleId: "c-root" },
];

describe.skipIf(!configured)("the circle card, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handler: Handler;
  let admin = false;
  let terms = true;
  /** The signed-in reader when set; otherwise the admin flag decides, as before. */
  let reader: any = null;
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
      authedUser: async () => reader ?? (admin ? { id: "m-ana", name: "Ana Reyes" } : null),
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
    // The orchard: a live holder, an erased one, a leaver whose seating kept their name and one whose did not.
    await q(
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`, `membership_granted`) VALUES " +
        "('m-ivy', 'Ivy Lindqvist', 'ivy@example.test', 'x', 'ivy', 1), " +
        "('m-eve', 'A departed member', 'deleted-m-eve@anonymized.invalid', 'x', NULL, 0), " +
        "('m-fay', 'Fay Lund', 'fay@example.test', 'x', 'fay', 0), " +
        "('m-hal', 'Hal Oduya', 'hal@example.test', 'x', 'hal', 0)",
    );
    await q(
      "INSERT INTO `exits` (`id`, `user_id`, `status`, `opened_by`) VALUES ('x-fay', 'm-fay', 'resolved', 'm-fay'), ('x-hal', 'm-hal', 'resolved', 'm-hal')",
    );
    await q(
      "INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `seats`, `active`, `is_example`, `sort_order`) VALUES " +
        "('seat-pick', 'c-orchard', 'Harvest Keeper', 5, 1, 0, 1), ('seat-prune', 'c-orchard', 'Pruner', 1, 1, 0, 2)",
    );
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `display_name`) VALUES " +
        "('ora-ivy', 'seat-pick', 'member', 'm-ivy', 'm-ivy', NULL), ('ora-eve', 'seat-pick', 'member', 'm-eve', 'm-eve', NULL), " +
        "('ora-fay', 'seat-pick', 'member', 'm-fay', 'm-fay', 'Fay Lund'), ('ora-hal', 'seat-pick', 'member', 'm-hal', 'm-hal', NULL)",
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
    // QA2-06: a visitor sees only the headings that have words; an unwritten list draws nothing.
    expect(section(card, "authorities").slot).toEqual({ kind: "unread" });
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
      expect(memberRows.find((r) => r.id === "seat-seed")?.applyHref).toBe("/propose?type=role_application&seat=seat-seed&from=%2Fcircles%2Fc-garden");
    } finally {
      admin = false;
    }
    const text = JSON.stringify(body);
    expect(text).not.toContain("Cai");
    expect(text).not.toContain("Gil");
  });

  it("links each member holder's card for a reader who sees the holder rows, and names no surname", async () => {
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

  it("QA2-06: a visitor reads an unwritten circle with no empty headings, and keeps the facts that are true", async () => {
    admin = false;
    const { body } = await read("c-new");
    const card: CircleCard = body.card;
    expect(card.header.existsWhile).toEqual({ kind: "unread" });
    expect(card.sections.find((s) => s.key === "purpose")).toBeUndefined();
    for (const s of card.sections) if (s.kind === "list" || s.kind === "values") expect(s.slot, s.key).toEqual({ kind: "unread" });
    expect(JSON.stringify(card)).not.toMatch(/not written yet|No purpose written yet/i);
    expect(section(card, "roles").slot).toEqual({ kind: "empty", words: "No roles in this circle yet" });
  });

  it("an unwritten circle reads its empty words to those who may propose them, and the terms can be turned off", async () => {
    terms = false;
    admin = true;
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
    admin = false;
  });

  describe("holders' first names (lead, 12 Nov 2026)", () => {
    const rowsOf = async (id: string) => {
      const roles = section((await read(id)).body.card, "roles") as Extract<CircleSection, { kind: "roles" }>;
      return roles.slot.kind === "shown" ? roles.slot.value : [];
    };
    const live = { id: "m-ivy", name: "Ivy Lindqvist", email: "ivy@example.test", membershipGranted: true };
    const withReader = async <T,>(who: any, fn: () => Promise<T>): Promise<T> => {
      reader = who;
      try {
        return await fn();
      } finally {
        reader = null;
      }
    };

    it("a signed-in member whose account is live reads each holder by first name, and no surname", async () => {
      const garden = await withReader(live, () => rowsOf("c-garden"));
      expect(garden.map((r) => [r.id, r.holderLine])).toEqual([
        ["seat-water", "Held by Cai"],
        ["seat-bees", "Held by Gil"],
        ["seat-seed", null],
      ]);
      const orchard = await withReader(live, () => read("c-orchard"));
      const rows = (section(orchard.body.card, "roles") as any).slot.value as { id: string; holderLine: string | null }[];
      // Ivy is live; Fay left and her seating kept her name; Eve was erased and Hal left with no kept name.
      expect(rows.find((r) => r.id === "seat-pick")?.holderLine).toBe("Held by Fay and Ivy");
      expect(rows.find((r) => r.id === "seat-prune")?.holderLine).toBeNull();
      const text = JSON.stringify(orchard.body);
      for (const never of ["Lindqvist", "Lund", "Moreno", "Hal", "Oduya", "departed", "anonymized", "@example.test"]) expect(text).not.toContain(never);
    });

    it("a visitor reads roles only, with no name anywhere", async () => {
      for (const id of ["c-garden", "c-orchard"]) {
        const { body } = await withReader(null, () => read(id));
        const rows = (section(body.card, "roles") as any).slot.value as { holderLine: string | null }[];
        expect(rows.every((r) => r.holderLine === null)).toBe(true);
        const text = JSON.stringify(body);
        for (const name of ["Cai", "Gil", "Ivy", "Fay", "Hal", "departed"]) expect(text).not.toContain(name);
      }
    });

    it("a reader whose account is not live reads no names: erased, left, or never let in", async () => {
      const notLive = [
        { id: "m-eve", name: "A departed member", email: "deleted-m-eve@anonymized.invalid", membershipGranted: true },
        { id: "m-fay", name: "Fay Lund", email: "fay@example.test", membershipGranted: false },
        { id: "m-new", name: "Nia Park", email: "nia@example.test", membershipGranted: false },
        { id: "m-ex", name: "Example", email: "ex@example.test", membershipGranted: true, isExample: true },
      ];
      for (const who of notLive) {
        const rows = await withReader(who, () => rowsOf("c-orchard"));
        expect(rows.every((r) => r.holderLine === null), who.id).toBe(true);
      }
    });
  });

  it("answers 404 for a circle that does not exist", async () => {
    const { status } = await read("c-nowhere");
    expect(status).toBe(404);
  });
});

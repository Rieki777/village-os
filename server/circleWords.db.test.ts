/**
 * A CIRCLE'S WORDS CHANGE BY CONSENT, on a real schema (circle cards PR 2).
 *
 * What is pinned:
 *
 *   - who may propose from the card (Rye, 2026-10-22): a live holder of a role
 *     in the circle, or an admin. A visitor is asked to sign in; a member who
 *     holds no role in it is refused; words the parser refuses come back as
 *     the field's heading and the sentence; an example circle is refused;
 *   - a proposal opens an org draft with one `update_circle` change and writes
 *     nothing on the circle; the card says which words wait for consent;
 *   - the preview line and the ballot line name the fields by their plain
 *     headings, never the words;
 *   - publishing writes the purpose on `circles` (and bumps the circles
 *     version) and the charter words in `circle_charters`, the card reads them
 *     back, and the adoption record gains the change;
 *   - a revert puts back exactly what stood, and refuses when a later draft
 *     has changed the same words since.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register } from "./routes/circleCard";
import { getDraft, previewDraft, publishDraft, revertDraft } from "./lib/orgDrafts";
import { publicDraftLines } from "./lib/orgDraftDecide";
import { loadPreviewContext } from "./lib/orgDrafts";
import type { CircleCard, CircleSection } from "../shared/circleCard";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const configured = testDbConfigured();
if (!configured) console.warn("[circleWords.db] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const CIRCLES = [
  { id: "c-garden", name: "Garden circle", purpose: "Grow food together.", status: "active", parentCircleId: null, isExample: false },
  { id: "c-example", name: "Example circle", purpose: null, status: "active", parentCircleId: null, isExample: true },
];
const PEOPLE: Record<string, any> = {
  "m-cai": { id: "m-cai", name: "Cai Moreno" },
  "m-dee": { id: "m-dee", name: "Dee Lund" },
  "m-ana": { id: "m-ana", name: "Ana Reyes" },
};

describe.skipIf(!configured)("a circle's words change by consent, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const handlers = new Map<string, Handler>();
  let whoami: string | null = null;
  let limited = false;
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  async function as(who: string | null, route: string, id: string, body?: unknown): Promise<{ status: number; body: any }> {
    whoami = who;
    const out: { status: number; body: any } = { status: 200, body: undefined };
    const res: any = {
      status(code: number) {
        out.status = code;
        return res;
      },
      json(b: unknown) {
        out.body = b;
        return res;
      },
    };
    await handlers.get(route)!({ params: { id }, headers: {}, body }, res);
    return out;
  }
  const propose = (who: string | null, id: string, body: unknown) => as(who, "POST /api/org/circles/:id/card/propose", id, body);
  const card = async (who: string | null): Promise<{ card: CircleCard; viewer: any }> => (await as(who, "GET /api/org/circles/:id/card", "c-garden")).body;
  const section = (c: CircleCard, key: string): CircleSection => c.sections.find((s) => s.key === key)!;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const app: any = {
      get: (p: string, h: Handler) => handlers.set(`GET ${p}`, h),
      post: (p: string, h: Handler) => handlers.set(`POST ${p}`, h),
    };
    register(app, {
      authedUser: async () => (whoami ? PEOPLE[whoami] ?? null : null),
      // Ana is the admin here, and holds no role in the circle.
      isAdmin: async () => whoami === "m-ana",
      capabilityCtx: async () => ({ stageIndex: 0, stageIndexOf: () => 0, roleCapabilities: [], isAdmin: whoami === "m-ana" }) as any,
      getPool: () => pool as any,
      overLimit: async () => limited,
      circles: () => CIRCLES,
      seasonState: () => ({ timezone: "UTC" }),
      lapse: () => ({ currentSeasonId: null, cadence: "never" }) as any,
      mapLifecycle: () => "public",
      sessionsLifecycle: () => "off",
      boolVar: (key: string) => key !== "org.public_people",
    });
    await q(
      "INSERT INTO `circles` (`id`, `name`, `purpose`, `aliases`, `is_example`) VALUES ('c-garden', 'Garden circle', 'Grow food together.', '[]', 0), " +
        "('c-example', 'Example circle', NULL, '[]', 1)",
    );
    // The circles store makes this row on its first write; a fresh scratch schema has none.
    await q("INSERT IGNORE INTO `collection_versions` (`collection`, `version`) VALUES ('circles', 1)");
    await q("INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES ('seat-water', 'c-garden', 'Water Keeper', 1, 0)");
    await q("INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`) VALUES ('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai')");
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("asks a visitor to sign in, and refuses a member who holds no role in the circle", async () => {
    expect(await propose(null, "c-garden", { domains: "The food forest" })).toEqual({
      status: 401,
      body: { error: "auth_required", message: "Sign in to propose new words for a circle." },
    });
    expect(await propose("m-dee", "c-garden", { domains: "The food forest" })).toEqual({
      status: 403,
      body: { error: "not_holder", message: "Only someone who holds a role in this circle can propose its words from the card." },
    });
    // Live Sessions is off in this village, so the card tells the page not to ask it.
    expect((await card("m-dee")).viewer).toEqual({ signedIn: true, mayPropose: false, sessionsOn: false });
    expect((await card("m-cai")).viewer).toEqual({ signedIn: true, mayPropose: true, sessionsOn: false });
    expect((await card("m-ana")).viewer).toEqual({ signedIn: true, mayPropose: true, sessionsOn: false });
  });

  it("refuses words the parser refuses, an example circle and the bound, before anything is written", async () => {
    expect(await propose("m-cai", "c-garden", { accountabilities: "Only one" })).toEqual({
      status: 400,
      body: { error: "refused", message: "What you can count on us for: Write 3 to 6 lines, or leave it empty for now." },
    });
    expect(await propose("m-cai", "c-garden", { name: "Renamed" })).toEqual({
      status: 400,
      body: { error: "refused", message: "This names no word this village can change on a circle." },
    });
    expect((await propose("m-ana", "c-example", { domains: "X" })).status).toBe(409);
    limited = true;
    expect((await propose("m-cai", "c-garden", { domains: "X" })).status).toBe(429);
    limited = false;
    expect(await q("SELECT COUNT(*) AS n FROM org_drafts")).toEqual([{ n: 0 }]);
  });

  let first = "";
  it("a holder's proposal opens a one-change draft, writes nothing, and the card says it waits for consent", async () => {
    const r = await propose("m-cai", "c-garden", {
      purpose: "Grow food together for every household.",
      domains: "The food forest\nThe seed library",
      values: "Reciprocity: We share every harvest first.",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    first = r.body.draftId;
    const draft = await getDraft(pool as any, first);
    expect(draft?.changes.map((c) => [c.op, c.orgRoleId])).toEqual([["update_circle", "circle:c-garden"]]);
    expect(await q("SELECT COUNT(*) AS n FROM circle_charters")).toEqual([{ n: 0 }]);
    expect((await q("SELECT purpose FROM circles WHERE id = 'c-garden'"))[0].purpose).toBe("Grow food together.");
    const read = await card("m-ana");
    expect(read.card.pending).toEqual(["purpose", "domains", "values"]);
    // The proposal itself, with the words it would put live, for whoever decides it.
    expect(read.card.proposals).toEqual([
      {
        draftId: first,
        proposedOn: expect.stringMatching(/^Proposed on \d{1,2} \w{3} \d{4}$/),
        fields: [
          { key: "purpose", label: "Why this circle exists", lines: ["Grow food together for every household."] },
          { key: "domains", label: "What we look after", lines: ["The food forest", "The seed library"] },
          { key: "values", label: "What we value", lines: ["Reciprocity: We share every harvest first."] },
        ],
      },
    ]);
    // Below the member holder rows, nothing about an open proposal is read.
    expect((await card(null)).card.proposals).toEqual([]);
    expect(section(read.card, "domains").slot).toEqual({ kind: "empty", words: "Not written yet" });
  });

  it("previews and puts to the village by the plain headings, never the words", async () => {
    const preview = await previewDraft(pool as any, first);
    expect(preview.blocked).toBe(0);
    expect(preview.lines[0]!.reads).toBe('New words for the circle "Garden circle": why this circle exists, what we look after, what we value');
    const draft = (await getDraft(pool as any, first))!;
    const lines = publicDraftLines(draft, await loadPreviewContext(pool as any));
    expect(lines).toEqual(['New words for the circle "Garden circle": why this circle exists, what we look after, what we value']);
    expect(lines.join(" ")).not.toContain("food forest");
  });

  it("publishing writes the purpose and the charter words, and the card reads them back with the adoption", async () => {
    const [v0] = await q("SELECT version FROM collection_versions WHERE collection = 'circles'");
    const published = await publishDraft(pool as any, first, "m-ana");
    expect(published.ok, JSON.stringify(published)).toBe(true);
    expect((await q("SELECT purpose FROM circles WHERE id = 'c-garden'"))[0].purpose).toBe("Grow food together for every household.");
    const [v1] = await q("SELECT version FROM collection_versions WHERE collection = 'circles'");
    expect(Number(v1?.version)).toBeGreaterThan(Number(v0?.version ?? 0));
    const row = (await q("SELECT domains, circle_values, last_draft_id FROM circle_charters WHERE circle_id = 'c-garden'"))[0];
    expect(row.last_draft_id).toBe(first);
    // The card reads `circles` from the store, which the publish route reloads after commit; here the
    // charter words, which no cache holds, are the part read back.
    const read = await card("m-cai");
    expect(section(read.card, "domains").slot).toEqual({ kind: "shown", value: ["The food forest", "The seed library"] });
    expect(section(read.card, "values").slot).toEqual({ kind: "shown", value: [{ value: "Reciprocity", practice: "We share every harvest first." }] });
    expect(read.card.pending).toEqual([]);
    const adoption = section(read.card, "adoption") as Extract<CircleSection, { kind: "adoption" }>;
    expect(adoption.slot.kind === "shown" && adoption.slot.value.lines.map((l) => l.what)).toEqual(["New words for the circle"]);
  });

  it("a revert refuses while a later draft has changed the same words, and puts back exactly what stood once it may", async () => {
    const later = await propose("m-cai", "c-garden", { domains: "The food forest\nThe seed library\nThe orchard" });
    expect((await publishDraft(pool as any, later.body.draftId, "m-ana")).ok).toBe(true);
    const refused = await revertDraft(pool as any, first);
    expect(refused).toEqual({
      ok: false,
      error: 'These words cannot be undone as things stand. "What we look after" has changed again since, and undoing this would throw that later change away.',
    });
    expect((await revertDraft(pool as any, later.body.draftId)).ok).toBe(true);
    expect(section((await card("m-cai")).card, "domains").slot).toEqual({ kind: "shown", value: ["The food forest", "The seed library"] });
    expect((await revertDraft(pool as any, first)).ok).toBe(true);
    expect((await q("SELECT purpose FROM circles WHERE id = 'c-garden'"))[0].purpose).toBe("Grow food together.");
    const back = await card("m-cai");
    expect(section(back.card, "domains").slot).toEqual({ kind: "empty", words: "Not written yet" });
    expect(section(back.card, "values").slot).toEqual({ kind: "empty", words: "Not written yet" });
  });
});

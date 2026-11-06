/**
 * GET /api/me/season-summary, through the real registration and the real read
 * on a scratch schema.
 *
 * The ledger is written the honest way, through `mint` and `reverse`, and then
 * backdated (the circleBurn.test.ts shape: only the timestamp moves, so every
 * balance still sums to zero). Everything else is a fixture row in the table
 * the platform's own writer fills.
 *
 * CONTROL: every kind of record also gets a twin dated in the NEXT season, and
 * another member gets a twin in the same season, so a total that leaked across
 * the window or across members shows up as a wrong number here.
 *
 * Every name is fake, and every figure is in XTS.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { CREDITS, VILLAGE_VOICE, ensureVoiceToken, faucetFor, mint, reverse, toLedgerUnits } from "../lib/economy";
import { loadTokenRegistry, memberAccount } from "../lib/ledger";
import { register } from "./seasonSummary";
import { pickSummarySeason, seasonWindows, topContributions, type SummaryContribution } from "../../shared/seasonSummary";

const configured = testDbConfigured();
if (!configured) console.warn("[seasonSummary] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const SEASONS = [
  { id: "s-dry", name: "Dry", startsOn: "2026-06-01", endsOn: "2026-09-01" },
  // Open-ended: it turns when the next one starts.
  { id: "s-green", name: "Green", startsOn: "2026-09-01", endsOn: "" },
  { id: "s-later", name: "Later", startsOn: "2026-12-01", endsOn: "" },
];
const TODAY = "2026-10-30";
const IN_DRY = new Date("2026-07-15T12:00:00Z");
const IN_GREEN = new Date("2026-09-20T12:00:00Z");

describe("which season a summary is for", () => {
  it("reads an open-ended season as ending when the next starts, and skips one not yet begun", () => {
    const w = seasonWindows(SEASONS, TODAY);
    expect(w.map((s) => [s.id, s.endedOn, s.closed])).toEqual([
      ["s-dry", "2026-09-01", true],
      ["s-green", "2026-12-01", false],
    ]);
    expect(pickSummarySeason(w, null)?.id).toBe("s-dry");
    expect(pickSummarySeason(w, "s-green")?.id).toBe("s-green");
    expect(pickSummarySeason(w, "s-later")).toBeNull();
    expect(pickSummarySeason(seasonWindows(SEASONS, "2026-07-01"), null)).toBeNull();
  });

  it("orders a member's own work by what it paid them, then by the most recent", () => {
    const c = (id: string, at: string, amount: number): SummaryContribution => ({
      kind: "quest", id, title: id, at, paid: amount ? [{ token: "t", name: "T", amount }] : [],
    });
    const top = topContributions([c("a", "2026-07-01", 5), c("b", "2026-07-02", 0), c("c", "2026-07-03", 5), c("d", "2026-07-04", 9)]);
    expect(top.map((x) => x.id)).toEqual(["d", "c", "a"]);
  });
});

describe.skipIf(!configured)("GET /api/me/season-summary", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const handlers = new Map<string, Handler>();
  let seq = 0;
  const ME = "usr-ss-wren";
  const OTHER = "usr-ss-other";

  const call = async (user: any, query: Record<string, string> = {}) => {
    const out: { status: number; body: any } = { status: 200, body: undefined };
    const res: any = {
      status(code: number) { out.status = code; return res; },
      json(body: unknown) { out.body = body; return res; },
    };
    await handlers.get("GET /api/me/season-summary")!({ query, headers: {} }, res);
    return out;
  };

  const backdate = async (key: string, at: Date) => {
    await pool.query("UPDATE token_ledger SET at = ? WHERE idempotency_key = ?", [at, key]); // module-review-ok: the test-only backdate, the circleBurn.test.ts shape; it moves no value and touches no balance
  };

  /** Pay `human` of a token for a piece of work, the way the work's own writer does. */
  const pay = async (userId: string, slug: string, human: number, source: string, ref: string, at: Date): Promise<string> => {
    const key = `ss:${source}:${ref}:${slug}:${++seq}`;
    const r = await mint(pool, {
      toUserId: userId, tokenSlug: slug, amount: toLedgerUnits(slug, human), from: faucetFor(slug)!,
      source, sourceRef: ref, description: "fixture", idempotencyKey: key,
    });
    if (!r.ok) throw new Error(`could not pay ${slug}: ${r.error}`);
    await backdate(key, at);
    return key;
  };

  const fixture = async (sql: string, params: unknown[]) => {
    await pool.query(sql, params); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  };

  const claim = async (id: string, userId: string, title: string, at: Date) => {
    await fixture(
      "INSERT INTO quest_claims (id, quest_id, quest_title, user_id, user_name, status, claimed_at, consented_at) VALUES (?,?,?,?,?, 'consented', ?, ?)",
      [id, `q-${id}`, title, userId, "fixture", at, at],
    );
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the ledger.test.ts shape
    await loadTokenRegistry(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await loadTokenRegistry(pool);
    for (const id of [ME, OTHER]) {
      await fixture("INSERT IGNORE INTO ledger_accounts (id, kind, user_id, label, faucet) VALUES (?, 'member', ?, ?, 0)", [memberAccount(id), id, id]);
    }

    // Quests: two in Dry, one in Green, one for somebody else.
    await claim("c-well", ME, "Dig the well", IN_DRY);
    await claim("c-fence", ME, "Mend the fence", new Date("2026-08-20T12:00:00Z"));
    await claim("c-later", ME, "Green work", IN_GREEN);
    await claim("c-other", OTHER, "Not mine", IN_DRY);
    await pay(ME, CREDITS, 40, "quest_consent", "c-well", IN_DRY);
    await pay(ME, CREDITS, 10, "quest_consent", "c-fence", IN_DRY);
    await pay(ME, VILLAGE_VOICE, 5, "quest_consent", "c-well", IN_DRY);
    await pay(ME, CREDITS, 999, "quest_consent", "c-later", IN_GREEN);
    await pay(OTHER, CREDITS, 777, "quest_consent", "c-other", IN_DRY);
    // A payment that was reversed counts for nothing.
    const undone = await pay(ME, CREDITS, 500, "quest_consent", "c-fence", IN_DRY);
    const rev = await reverse(pool, undone, { note: "fixture" });
    expect(rev.ok).toBe(true);
    // A purchase or a swap is no earning.
    await pay(ME, CREDITS, 300, "exchange_purchase", "buy-1", IN_DRY);

    // A role held across the turn, paid each cycle.
    await fixture("INSERT INTO org_roles (id, name, aim) VALUES ('r-keeper', 'Water Keeper', 'Keep the water')", []);
    await fixture(
      "INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, started_at, term_ends_at) VALUES ('as-1', 'r-keeper', 'member', ?, ?, ?, ?)",
      [ME, `member:${ME}`, new Date("2026-05-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z")],
    );
    await pay(ME, CREDITS, 60, "role_cycle", "as-1", IN_DRY);

    // A proposal adopted, one vetoed, one adopted in Green.
    const ballot = async (id: string, title: string, landing: string | null, at: Date) =>
      fixture(
        "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, weight_mode, unity_pct, quorum_pct, total_weight, electorate_count, opened_by, opens_at, closes_at, status, closed_at, created_at, landing_status) " +
          "VALUES (?, 'proposal', ?, ?, ?, '', 'consent', 'equal', 50, 0, 1, 1, ?, ?, ?, 'passed', ?, ?, ?)",
        [id, id, `k-${id}`, title, ME, at, at, at, at, landing],
      );
    await ballot("b-kitchen", "Open a shared kitchen", "applied", IN_DRY);
    await ballot("b-vetoed", "Vetoed plan", "vetoed", IN_DRY);
    await ballot("b-green", "Green plan", "applied", IN_GREEN);

    // Gratitude both ways, an example that never counts, and Green's.
    const thanks = async (id: string, from: string, to: string, amount: number, at: Date, example = 0) =>
      fixture(
        "INSERT INTO gratitude_log (id, kind, from_id, to_id, amount, cycle_id, at, is_example) VALUES (?, 'gratitude', ?, ?, ?, 'c1', ?, ?)",
        [id, from, to, amount, at, example],
      );
    await thanks("g1", ME, OTHER, 3, IN_DRY);
    await thanks("g2", ME, "usr-ss-third", 2, IN_DRY);
    await thanks("g3", OTHER, ME, 4, IN_DRY);
    await thanks("g4", OTHER, ME, 50, IN_DRY, 1);
    await thanks("g5", ME, OTHER, 9, IN_GREEN);

    // Cash: one paid, one still owed, one in Green, one somebody else's.
    const owe = async (id: string, userId: string, amount: number, state: string, at: Date) =>
      fixture(
        "INSERT INTO cash_owed (id, occurrence_key, user_id, work_kind, work_ref, work_title, amount_minor, currency, state, owed_at) VALUES (?, ?, ?, 'quest', 'c-well', 'Dig the well', ?, 'XTS', ?, ?)",
        [id, `occ-${id}`, userId, amount, state, at],
      );
    await owe("co-1", ME, 2500, "paid", IN_DRY);
    await owe("co-2", ME, 1000, "owed", IN_DRY);
    await owe("co-3", ME, 9900, "owed", IN_GREEN);
    await owe("co-4", OTHER, 7700, "paid", IN_DRY);

    // Badges: one earned, a warning and a self-declared skill that never show.
    for (const [id, name, kind] of [["bd-water", "Water Bearer", "earned"], ["bd-warn", "Warned", "warning"], ["bd-self", "Can Juggle", "self"]]) {
      await fixture("INSERT INTO badges (id, name, kind, active) VALUES (?, ?, ?, 1)", [id, name, kind]);
      await fixture("INSERT INTO badge_awards (id, badge_id, user_id, count, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)", [`aw-${id}`, id, ME, IN_DRY, IN_DRY]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }

    const app = { get: (p: string, h: Handler) => handlers.set(`GET ${p}`, h) } as any;
    register(app, {
      authedUser: async (req: any) => req.user ?? currentUser,
      getPool: () => pool as any,
      seasonState: () => ({ seasons: SEASONS, timezone: "UTC", today: TODAY }),
    } as any);
  }, 180_000);

  let currentUser: any = null;

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("refuses a visitor", async () => {
    currentUser = null;
    expect((await call(null)).status).toBe(401);
  });

  it("sums up the most recently closed season, for the asker alone", async () => {
    currentUser = { id: ME, name: "Wren Alder", handle: "wren" };
    const { status, body } = await call(currentUser);
    expect(status).toBe(200);
    const s = body.summary;
    expect(s.season).toMatchObject({ id: "s-dry", closed: true, endedOn: "2026-09-01" });
    expect(s.member).toEqual({ name: "Wren Alder", handle: "wren" });

    // 40 + 10 + 60, the reversed 500, the purchase and Green's 999 left out.
    expect(s.tokens).toEqual([{ token: CREDITS, name: "Village Credits", kind: "credit", amount: 110 }]);
    expect(s.voice).toEqual([expect.objectContaining({ token: VILLAGE_VOICE, kind: "voice", amount: 5 })]);
    expect(s.cash).toEqual([{ currency: "XTS", earnedMinor: 3500, paidMinor: 2500 }]);
    expect(s.gratitude).toEqual({ sent: 5, sentNotes: 2, people: 2, received: 4, receivedNotes: 1 });
    expect(s.counts).toEqual({ quests: 2, roles: 1, proposals: 1 });

    // Ordered by what each paid: the role's 60, the well's 40 + 5 Voice, then the fence's 10.
    expect(s.top.map((c: any) => [c.kind, c.title])).toEqual([
      ["role", "Water Keeper"],
      ["quest", "Dig the well"],
      ["quest", "Mend the fence"],
    ]);
    expect(s.top[0].term).toEqual({ from: "2026-05-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" });
    expect(s.badges.map((b: any) => b.name)).toEqual(["Water Bearer"]);
    expect(s.seasons).toEqual([
      { id: "s-green", name: "Green", closed: false },
      { id: "s-dry", name: "Dry", closed: true },
    ]);
    // No ranking against anybody, anywhere in the payload.
    expect(JSON.stringify(body)).not.toMatch(/rank|percent|percentile/i);
  });

  it("opens a named season, and refuses one that has not begun", async () => {
    currentUser = { id: ME, name: "Wren Alder", handle: "wren" };
    const green = (await call(currentUser, { season: "s-green" })).body.summary;
    expect(green.season).toMatchObject({ id: "s-green", closed: false });
    expect(green.tokens[0].amount).toBe(999);
    expect(green.counts.proposals).toBe(1);
    expect(green.cash).toEqual([{ currency: "XTS", earnedMinor: 9900, paidMinor: 0 }]);
    expect((await call(currentUser, { season: "s-later" })).status).toBe(404);
    expect((await call(currentUser, { season: "x".repeat(65) })).status).toBe(400);
  });

  it("reads another member's own numbers and none of the first member's", async () => {
    currentUser = { id: OTHER, name: "Other Fixture", handle: null };
    const s = (await call(currentUser)).body.summary;
    expect(s.tokens).toEqual([expect.objectContaining({ amount: 777 })]);
    expect(s.cash).toEqual([{ currency: "XTS", earnedMinor: 7700, paidMinor: 7700 }]);
    expect(s.gratitude.received).toBe(3);
    expect(s.top.map((c: any) => c.title)).toEqual(["Not mine"]);
  });
});

/**
 * Standing examples: the two promises, and the trap that broke them once.
 *
 * The promises are that examples cannot become economic state, and that
 * publishing something real clears that module for good. The trap is that
 * three of these tables are served by memory-cached collections, so a raw
 * DELETE empties the database and the page keeps rendering — found by running
 * the flow end-to-end, not by reading the code.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { dbCollection } from "../repos/store-db";
import {
  EXAMPLE_TABLES,
  exampleState,
  hasRealContent,
  isRetired,
  isSeeded,
  loadExampleSeed,
  loadExampleState,
  modulesWithExamples,
  retireExamples,
  retireExamplesWithPair,
  seedExamples,
  wireExampleCaches,
} from "./examples";
import { loadTokenRegistry } from "./ledger";
import { ensureStayToken, listAccommodations } from "./stays";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[examples.test] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const SEEDS_DIR = new URL("../seeds", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * No database, so it runs everywhere — which matters, because the badge
 * definitions had no validation at all: badgeProblem was never run against
 * them, and assertBadgeInvariants skips examples on purpose (it runs BEFORE
 * the seeder, so a row it rejected would land quietly on one boot and brick
 * the next). A definition the platform would refuse to create must not ship
 * as the thing teaching a founder what a badge is.
 */
describe("example badge definitions", () => {
  it("would every one of them be accepted by the badge write path", async () => {
    const { badgeProblem } = await import("./badges");
    const seed = loadExampleSeed(SEEDS_DIR);
    expect(seed, "examples-seed.json must be readable").toBeTruthy();
    const badges = seed?.badges?.badges ?? [];
    expect(badges.length, "the badges block must carry definitions").toBeGreaterThan(0);
    for (const b of badges) {
      const problem = badgeProblem({
        kind: String(b.kind),
        capabilities: (b.capabilities ?? []).map(String),
        denies: (b.denies ?? []).map(String),
        rule: b.rule ?? null,
      });
      expect(problem, `badge "${b.id}": ${problem}`).toBeNull();
    }
  });

  it("puts an award on no warning badge, where it would be open state", () => {
    const seed = loadExampleSeed(SEEDS_DIR);
    for (const b of seed?.badges?.badges ?? []) {
      if (b.kind !== "warning") continue;
      expect((b.awards ?? []).length, `"${b.id}" is a warning and may hold no award`).toBe(0);
    }
  });
});

describe.skipIf(!configured)("standing examples", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let seed: any;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
    seed = loadExampleSeed(new URL("../seeds", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    expect(seed, "examples-seed.json must be readable").toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  // Full isolation: the bookkeeping AND the rows. Clearing only example_state
  // leaves rows behind, and the next INSERT IGNORE writes nothing — which
  // reads as a seeding bug rather than the leftover state it actually is.
  beforeEach(async () => {
    await pool.query("DELETE FROM example_state");
    for (const tables of Object.values(EXAMPLE_TABLES)) {
      for (const table of tables) {
        try { await pool.query(`DELETE FROM \`${table}\` WHERE is_example = 1`); } catch { /* no such column */ }
      }
    }
    await pool.query("DELETE FROM users WHERE is_example = 1");
    await pool.query("DELETE FROM tools WHERE id = 'real-1'");
    await loadExampleState(pool);
  });

  it("seeds a module and marks it as showing examples", async () => {
    const n = await seedExamples(pool, "library", seed, { force: true });
    expect(n).toBeGreaterThan(0);
    expect(isSeeded("library")).toBe(true);
    expect(modulesWithExamples()).toContain("library");

    const [[row]] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM library_items WHERE is_example = 1",
    );
    expect(Number(row.n)).toBe(3);
  });

  it("creates no economic state — the whole premise", async () => {
    for (const id of Object.keys(EXAMPLE_TABLES)) {
      await seedExamples(pool, id, seed, { force: true });
    }
    // If any of these is non-zero, an example has become real value.
    // (badge_awards is asserted separately: example awards exist by design,
    // and their invariant is WHO holds them, never whether they exist.)
    for (const table of [
      "token_ledger", "library_loans", "stays", "stay_purchases",
      "exchange_orders", "product_purchases", "fiat_charges",
    ]) {
      const [[r]] = await pool.query<any[]>(`SELECT COUNT(*) n FROM \`${table}\``);
      expect(Number(r.n), `${table} must stay empty`).toBe(0);
    }
  });

  it("gives example awards only to example identities, and none on warnings", async () => {
    // Capabilities on example badges are the demonstration (Rye, 2026-08-02).
    // What keeps them harmless: badgeGrantsFor() reads awards per
    // authenticated user, example identities never authenticate, and every
    // route that could hand an award to a real member refuses examples. So
    // the load-bearing assertions are about the AWARDS.
    await seedExamples(pool, "badges", seed, { force: true });
    const [awards] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM badge_awards WHERE is_example = 1",
    );
    expect(Number(awards[0].n), "the seed demonstrates held badges").toBeGreaterThan(0);
    // LEFT JOIN, not JOIN. An inner join can only ever see awards whose holder
    // EXISTS, so with badges missing from NEEDS_IDENTITIES the awards pointed
    // at users nobody had created, the holders demo rendered empty, and this
    // assertion passed over zero rows. Both failures now fail: a real holder,
    // and a holder who is not there at all.
    const [bad] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM badge_awards a LEFT JOIN users u ON u.id = a.user_id " +
        "WHERE a.is_example = 1 AND NOT (u.id IS NOT NULL AND u.is_example = 1)",
    );
    expect(Number(bad[0].n), "every example award must be held by an example identity that exists").toBe(0);
    const [onWarning] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM badge_awards a JOIN badges b ON b.id = a.badge_id " +
        "WHERE a.is_example = 1 AND b.kind = 'warning'",
    );
    expect(Number(onWarning[0].n), "a warning award is open state").toBe(0);
    // And every capability key on an example badge is a real registry key —
    // the gate silently ignores unknowns, which would demo nothing.
    const [defs] = await pool.query<any[]>(
      "SELECT capabilities FROM badges WHERE is_example = 1",
    );
    const { ALL_CAPABILITIES } = await import("../../shared/capabilities");
    const valid = new Set<string>(ALL_CAPABILITIES);
    for (const r of defs) {
      const caps = typeof r.capabilities === "string" ? JSON.parse(r.capabilities) : r.capabilities;
      for (const key of caps ?? []) {
        expect(valid.has(key), `"${key}" must be a registered capability`).toBe(true);
      }
    }
  });

  it("retires a module's examples and leaves every other module alone", async () => {
    await seedExamples(pool, "library", seed, { force: true });
    await seedExamples(pool, "tools", seed, { force: true });

    await retireExamples(pool, "tools", "first_real_item");

    expect(isRetired("tools")).toBe(true);
    expect(isRetired("library")).toBe(false);
    expect(modulesWithExamples()).toContain("library");
    expect(modulesWithExamples()).not.toContain("tools");

    const [[tools]] = await pool.query<any[]>("SELECT COUNT(*) n FROM tools WHERE is_example = 1");
    expect(Number(tools.n)).toBe(0);
    const [[lib]] = await pool.query<any[]>("SELECT COUNT(*) n FROM library_items WHERE is_example = 1");
    expect(Number(lib.n)).toBe(3);
  });

  it("reloads the caches that a raw DELETE cannot reach", async () => {
    // The bug this exists for: tools/circles/roles are memory-cached, so
    // retirement emptied MySQL and the API served the deleted rows anyway.
    const reloaded: string[][] = [];
    wireExampleCaches(async (tables) => { reloaded.push(tables); });
    await seedExamples(pool, "tools", seed, { force: true });
    await retireExamples(pool, "tools", "admin_cleared");
    wireExampleCaches(async () => {});

    expect(reloaded.length).toBeGreaterThanOrEqual(2); // once seeding, once retiring
    expect(reloaded.every((t) => t.includes("tools"))).toBe(true);
  });

  it("refuses to come back once retired", async () => {
    await seedExamples(pool, "tools", seed, { force: true });
    await retireExamples(pool, "tools", "first_real_item");

    // Not with a plain call, and not with force either: retired is permanent.
    expect(await seedExamples(pool, "tools", seed)).toBe(0);
    expect(await seedExamples(pool, "tools", seed, { force: true })).toBe(0);
    const [[r]] = await pool.query<any[]>("SELECT COUNT(*) n FROM tools WHERE is_example = 1");
    expect(Number(r.n)).toBe(0);
  });

  it("never layers examples over content the village made itself", async () => {
    await pool.query(
      "INSERT INTO tools (id, name, purpose, url, cta_label, category, visibility) " +
        "VALUES ('real-1','A real tool','Made by the village','https://example.net','Open','communication','public')",
    );
    expect(await hasRealContent(pool, "tools")).toBe(true);

    const n = await seedExamples(pool, "tools", seed);
    expect(n).toBe(0);
    const [[r]] = await pool.query<any[]>("SELECT COUNT(*) n FROM tools WHERE is_example = 1");
    expect(Number(r.n)).toBe(0);
  });

  it("is idempotent — a second seed writes nothing", async () => {
    const first = await seedExamples(pool, "library", seed, { force: true });
    expect(first).toBeGreaterThan(0);
    // force skips the bookkeeping guards, so this proves the INSERT IGNOREs
    // hold on their own rather than the state map hiding a double-write.
    await seedExamples(pool, "library", seed, { force: true });
    const [[r]] = await pool.query<any[]>("SELECT COUNT(*) n FROM library_items WHERE is_example = 1");
    expect(Number(r.n)).toBe(3);
  });

  it("survives replaceAll — the laundering trap", async () => {
    // dbCollection.replaceAll is DELETE-all + re-INSERT of the SPEC'd columns
    // only. With is_example missing from the spec it came back as DEFAULT 0,
    // so the daily tools-link-check job quietly turned every example tool into
    // permanent "real" content that retirement could never find again.
    const tools = dbCollection(pool, {
      table: "tools",
      orderBy: "`sort_order`, `name`",
      columns: [
        { js: "id", db: "id" }, { js: "name", db: "name" },
        { js: "purpose", db: "purpose" }, { js: "url", db: "url" },
        { js: "ctaLabel", db: "cta_label" }, { js: "category", db: "category" },
        { js: "visibility", db: "visibility" },
        { js: "order", db: "sort_order", kind: "int" },
        { js: "enabled", db: "enabled", kind: "bool" },
        { js: "isExample", db: "is_example", kind: "bool" },
      ],
    });
    await seedExamples(pool, "tools", seed, { force: true });
    await tools.load();
    await tools.replaceAll(tools.all());

    const [[r]] = await pool.query<any[]>("SELECT COUNT(*) n FROM tools WHERE is_example = 1");
    expect(Number(r.n), "replaceAll must not strip the flag").toBe(3);
    // And retirement can still find them afterwards.
    await retireExamples(pool, "tools", "admin_cleared");
    const [[after]] = await pool.query<any[]>("SELECT COUNT(*) n FROM tools WHERE is_example = 1");
    expect(Number(after.n)).toBe(0);
  });

  it("retires forum and feed separately though they share one table", async () => {
    await seedExamples(pool, "forum", seed, { force: true });
    await seedExamples(pool, "feed", seed, { force: true });

    await retireExamples(pool, "forum", "first_real_item");

    // Feed's posts are untouched and it is still honestly labelled…
    const [[feedRows]] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM forum_threads WHERE is_example = 1 AND id LIKE 'ex-feed-%'",
    );
    expect(Number(feedRows.n), "the first real forum thread must not delete feed examples").toBe(3);
    expect(modulesWithExamples()).toContain("feed");

    // …while forum's threads AND its replies are gone, leaving no orphans.
    const [[forumRows]] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM forum_threads WHERE is_example = 1 AND id LIKE 'ex-thread-%'",
    );
    expect(Number(forumRows.n)).toBe(0);
    const [[replies]] = await pool.query<any[]>("SELECT COUNT(*) n FROM forum_replies WHERE is_example = 1");
    expect(Number(replies.n), "orphan replies would keep forum falsely labelled").toBe(0);
    expect(modulesWithExamples()).not.toContain("forum");
  });

  it("clears forum and feed together, so neither is left unlabelled", async () => {
    // The pair share forum_threads AND the feed's category, and the forum's
    // "All" tab sends no category at all. Retiring one alone therefore dropped
    // its banner and left the OTHER module's rows rendering on the same page
    // with no label: platform fiction presented as village content. The admin
    // clear button used to call retireExamples directly and reproduce exactly
    // that, which is what this helper closes.
    await seedExamples(pool, "forum", seed, { force: true });
    await seedExamples(pool, "feed", seed, { force: true });

    const outcome = await retireExamplesWithPair(pool, "forum", "admin_cleared");
    expect(outcome.retired, "both passes must succeed before it reports success").toBe(true);

    const [[left]] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM forum_threads WHERE is_example = 1",
    );
    expect(Number(left.n), "no example thread of either module may survive").toBe(0);
    expect(isRetired("forum")).toBe(true);
    expect(isRetired("feed"), "the twin's tombstone is stamped too").toBe(true);
    expect(modulesWithExamples()).not.toContain("forum");
    expect(modulesWithExamples()).not.toContain("feed");
  });

  it("counts a failed admin clear against nothing, so the escape hatch stays open", async () => {
    // RETIRE_CEILING governs the AUTOMATIC trigger only: the clear button IS
    // the person, and it is the only way back once the automatic path has
    // given up. Counting its failures let five unlucky presses switch off
    // first_real_item retirement for that module for good.
    await seedExamples(pool, "exchange", seed, { force: true });
    await pool.query(
      "INSERT INTO token_ledger (id, from_account, to_account, token_type, amount, source, idempotency_key) " +
        "VALUES ('tl-ex-ceiling','sys:mint','sys:treasury','ex-credits',5,'exchange_stock','tl-ex-ceiling')",
    );
    try {
      for (let i = 0; i < 6; i++) {
        const outcome = await retireExamples(pool, "exchange", "admin_cleared");
        expect(outcome.retired, "the ledger row keeps every pass from finishing").toBe(false);
      }
      expect(
        exampleState("exchange")?.retireAttempts,
        "an admin_cleared failure must not spend the automatic path's budget",
      ).toBe(0);

      // And the automatic path is still willing to try, which is the fact the
      // counter would otherwise have destroyed.
      await retireExamples(pool, "exchange", "first_real_item");
      expect(exampleState("exchange")?.retireAttempts).toBe(1);
    } finally {
      await pool.query("DELETE FROM token_ledger WHERE id = 'tl-ex-ceiling'");
    }
  });

  it("reads health's real content from the land's ledger, not the snapshot spine", async () => {
    // snapshotCycle writes health_snapshots on every cycle close whether or
    // not the module is on, so counting those rows meant a village that had
    // settled one lunation could never see the health examples.
    await pool.query(
      "INSERT INTO health_snapshots (id, cycle_number, metric_key, value) VALUES ('snap-1-members_total', 1, 'members_total', 7)",
    );
    expect(await hasRealContent(pool, "health")).toBe(false);

    const n = await seedExamples(pool, "health", seed);
    expect(n, "an infrastructure-written snapshot must not suppress seeding").toBeGreaterThan(0);
  });

  it("gives the example identities no way to sign in", async () => {
    await seedExamples(pool, "forum", seed, { force: true });
    const [rows] = await pool.query<any[]>(
      "SELECT id, password_hash, email FROM users WHERE is_example = 1",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.password_hash ?? "").toBe("");
      expect(String(r.email)).toContain("@examples.invalid");
    }
  });

  it("brings the identities into existence when badges is the only module on", async () => {
    // badges carries AWARDS, and an award names a holder. Enabling badges
    // alone used to seed award rows pointing at users that did not exist:
    // the holders list rendered empty and every JOIN-based leak check passed
    // over nothing. beforeEach deletes the example users, so this is the
    // badges-alone path exactly.
    await seedExamples(pool, "badges", seed, { force: true });

    const [users] = await pool.query<any[]>("SELECT COUNT(*) n FROM users WHERE is_example = 1");
    expect(Number(users[0].n), "the awards need holders").toBeGreaterThan(0);
    const [orphans] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM badge_awards a LEFT JOIN users u ON u.id = a.user_id " +
        "WHERE a.is_example = 1 AND u.id IS NULL",
    );
    expect(Number(orphans[0].n), "an award whose holder does not exist demonstrates nothing").toBe(0);
  });

  it("takes the exchange's listings and prices with the token, however they are flagged", async () => {
    await seedExamples(pool, "exchange", seed, { force: true });
    // What one click on the purchasable toggle used to do: upsertSettings
    // writes is_example = 0 on every write, which is right for a real slug
    // sharing the key with an example listing and wrong for an example TOKEN.
    // Retirement then deleted the token and left the listing, and the next
    // boot's assertExchangeFirewalls refused to serve on an unregistered one.
    await pool.query("UPDATE token_exchange_settings SET is_example = 0 WHERE token_slug = 'ex-credits'");
    await pool.query("UPDATE currency_prices SET is_example = 0 WHERE token_slug = 'ex-credits'");

    const outcome = await retireExamples(pool, "exchange", "first_real_item");
    expect(outcome.retired).toBe(true);

    const [tokens] = await pool.query<any[]>("SELECT COUNT(*) n FROM tokens WHERE is_example = 1");
    expect(Number(tokens[0].n)).toBe(0);
    const [orphanListings] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM token_exchange_settings s LEFT JOIN tokens t ON t.slug = s.token_slug WHERE t.slug IS NULL",
    );
    expect(Number(orphanListings[0].n), "a listing may never outlive its token").toBe(0);
    const [orphanPrices] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM currency_prices c LEFT JOIN tokens t ON t.slug = c.token_slug WHERE t.slug IS NULL",
    );
    expect(Number(orphanPrices[0].n), "a price may never outlive its token").toBe(0);
  });

  it("keeps an example token that has ledger rows, and says it did not retire", async () => {
    // Belt and braces for the boot gate: checkLedgerInvariants fails loud on
    // "ledger rows exist for unregistered token", so deleting a registry row
    // with transfers behind it turns the founder's first real listing into a
    // deployment that will not start. Every write door refuses example tokens;
    // this is what holds if one is ever missed or a row is hand-edited.
    await seedExamples(pool, "exchange", seed, { force: true });
    await pool.query(
      "INSERT INTO token_ledger (id, from_account, to_account, token_type, amount, source, idempotency_key) " +
        "VALUES ('tl-ex-guard','sys:mint','sys:treasury','ex-credits',5,'exchange_stock','tl-ex-guard')",
    );
    try {
      const outcome = await retireExamples(pool, "exchange", "first_real_item");
      expect(outcome.retired, "a failed sweep must not stamp the permanent tombstone").toBe(false);
      expect(isRetired("exchange")).toBe(false);
      const [kept] = await pool.query<any[]>("SELECT COUNT(*) n FROM tokens WHERE slug = 'ex-credits'");
      expect(Number(kept[0].n), "the ledger would have nothing to point at").toBe(1);
      const [orphaned] = await pool.query<any[]>(
        "SELECT COUNT(*) n FROM token_ledger l LEFT JOIN tokens t ON t.slug = l.token_type WHERE t.slug IS NULL",
      );
      expect(Number(orphaned[0].n), "this is the count that refuses the next boot").toBe(0);
    } finally {
      await pool.query("DELETE FROM token_ledger WHERE id = 'tl-ex-guard'");
    }
  });

  it("seeds forum and feed together or not at all", async () => {
    // Retirement pairs them (RETIRE_TOGETHER) because they share a table AND a
    // category. Seeding did not: forum's check was the whole of forum_threads
    // and feed's was one category, so one real thread in `governance` marked
    // forum decided-without-seeding while the feed happily seeded ex-feed-*
    // into the shared category — unlabelled platform fiction on the forum's
    // "All" tab, which is the failure RETIRE_TOGETHER exists to prevent.
    await pool.query(
      "INSERT INTO forum_threads (id, category, author_id, title, body, kind) " +
        "VALUES ('real-thread-1','governance','usr-real','A real decision','The village decided.','decision')",
    );
    try {
      expect(await hasRealContent(pool, "forum")).toBe(true);
      expect(await hasRealContent(pool, "feed"), "the pair answers as one").toBe(true);

      expect(await seedExamples(pool, "forum", seed)).toBe(0);
      expect(await seedExamples(pool, "feed", seed)).toBe(0);
      const [rows] = await pool.query<any[]>("SELECT COUNT(*) n FROM forum_threads WHERE is_example = 1");
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await pool.query("DELETE FROM forum_threads WHERE id = 'real-thread-1'");
    }
  });

  /**
   * A FRESH VILLAGE IS BORN AT TWO DECIMALS, SO THE SEED MUST NOT BE A STORED NUMBER.
   *
   * `ensureStayToken` registers stay-credit at the currency scale on a village
   * that never ran a pre-ruling build. The seed used to hand `3` straight to the
   * column, and at two decimals a stored 3 is three hundredths, so the example
   * cabin advertised a night for 0.03 credits. The assertion reads the stored
   * minor number AND the figure a member sees, and takes the expected human
   * price from the seed file itself so the two cannot drift.
   */
  it("seeds an example room at the price the seed states, on a village born at two decimals", async () => {
    await ensureStayToken(pool);
    await loadTokenRegistry(pool);
    const [[tok]] = await pool.query<any[]>("SELECT decimals FROM tokens WHERE slug = 'stay-credit'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(tok.decimals), "the fixture is a fresh village, so stay-credit is born at two").toBe(2);

    expect(await seedExamples(pool, "stays", seed, { force: true })).toBeGreaterThan(0);

    const [stored] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT id, amount_minor FROM accommodation_prices WHERE id IN ('ex-stay-cabin-price-1','ex-stay-cabin-price-3')",
    );
    const byId = Object.fromEntries(stored.map((r: any) => [String(r.id), Number(r.amount_minor)]));
    expect(byId["ex-stay-cabin-price-1"], "three whole credits, stored in hundredths").toBe(300);
    expect(byId["ex-stay-cabin-price-3"], "a usd price is already cents and never scaled").toBe(4500);

    const rooms = Object.fromEntries((await listAccommodations(pool)).map((a) => [a.id, a.prices]));
    for (const a of seed.stays.accommodations) {
      for (const p of a.prices) {
        const want = p.tokenType === "usd" ? p.amountMinor : p.amount;
        expect(`${a.id} ${p.tokenType} ${p.audience} = ${rooms[a.id]?.[p.tokenType]?.[p.audience as "guest" | "member"]}`)
          .toBe(`${a.id} ${p.tokenType} ${p.audience} = ${want}`);
      }
    }

    // The example credit tokens carry the currency scale from birth too.
    expect(await seedExamples(pool, "exchange", seed, { force: true })).toBeGreaterThan(0);
    const [scales] = await pool.query<any[]>("SELECT slug, decimals FROM tokens WHERE is_example = 1 ORDER BY slug"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(scales.map((r: any) => `${r.slug}=${r.decimals}`)).toEqual(["ex-credits=2", "ex-workshop=2"]);
  });
});

/**
 * docs/TOKENS.md is checked against a real database and against the real code.
 *
 * `scripts/generate-token-doc.mjs` builds the document out of two kinds of
 * reading, and each one can be wrong in its own way:
 *
 *   1. It EVALUATES the token statements in `drizzle/` with a small SQL
 *      interpreter, because reading the INSERTs alone gets `transferable`
 *      wrong for the recognition token. An interpreter is a second
 *      implementation of MySQL's semantics, and a second implementation is a
 *      thing that disagrees with the first one eventually. So the first suite
 *      below runs every migration through the production engine and asserts
 *      the interpreter's rows are the database's rows, column by column. That
 *      is also what makes the `-- token-doc: as-if` escape hatch safe: a
 *      migration can tell the reader what it does, and a lie fails here.
 *
 *   2. It re-states, in the document's own words, what `faucetFor`,
 *      `spendSinkFor`, `sendRefusal` and `isPriceableToken` decide. Those
 *      restatements are read out of the source, so they cannot drift by
 *      accident, but they are still a paraphrase. The second suite calls the
 *      real functions with the real registry loaded and asserts the answers
 *      match, per token, so the paraphrase is checked rather than trusted.
 *
 * The third suite is the guard itself, run under `pnpm test` as well as in CI,
 * so a developer who never runs the check scripts by hand still hears about a
 * document that has come apart from the code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { faucetFor } from "../lib/economy";
import { loadTokenRegistry } from "../lib/ledger";
import { isPriceableToken, sendRefusal, spendSinkFor } from "../lib/spending";
import { provisionTestDb, testDbConfigured, type TestDb } from "./testDb";
// The generator is plain ESM with no types. It is the subject of this file, so
// it is imported for real rather than re-implemented here.
// @ts-expect-error - scripts/ is untyped JavaScript, deliberately outside tsconfig
import { collectFacts, generate, seededRegistry } from "../../scripts/generate-token-doc.mjs";
import { docsMode } from "../../scripts/lib/generatedDocs.mjs";
import fs from "node:fs";
import path from "node:path";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[tokenDoc.test] TEST_DATABASE_URL not set — the migration comparison is SKIPPED.");
}

const ROOT = path.resolve(import.meta.dirname, "..", "..");

interface SeededRow {
  slug: string;
  name: string;
  kind: string;
  governance: string;
  decimals: number;
  transferable: boolean;
  active: boolean;
  is_example: boolean;
  sort_order: number;
}

describe.skipIf(!configured)("the token doc's SQL reader agrees with MySQL", () => {
  let db: TestDb;
  let fromMysql: Record<string, SeededRow>;

  beforeAll(async () => {
    db = await provisionTestDb();
    const [rows] = await db.conn.query<any[]>(
      "SELECT `slug`, `name`, `kind`, `governance`, `decimals`, `transferable`, `active`, `is_example`, `sort_order` " +
        "FROM `tokens` ORDER BY `slug`",
    );
    fromMysql = Object.fromEntries(
      rows.map((r) => [
        String(r.slug),
        {
          slug: String(r.slug),
          name: String(r.name),
          kind: String(r.kind),
          governance: String(r.governance),
          decimals: Number(r.decimals),
          transferable: Number(r.transferable) === 1,
          active: Number(r.active) === 1,
          is_example: Number(r.is_example) === 1,
          sort_order: Number(r.sort_order),
        },
      ]),
    );
  }, 180_000);

  afterAll(async () => {
    await db?.drop();
  });

  const fromReader = (): Record<string, SeededRow> =>
    Object.fromEntries(
      seededRegistry(ROOT).rows.map((r: any) => [
        r.slug,
        {
          slug: r.slug,
          name: r.name,
          kind: r.kind,
          governance: r.governance,
          decimals: Number(r.decimals),
          transferable: !!r.transferable,
          active: !!r.active,
          is_example: !!r.is_example,
          sort_order: Number(r.sort_order),
        },
      ]),
    );

  it("computes the same rows the migrations actually produce", () => {
    // Slugs first and as their own assertion: a missing token makes every
    // per-column comparison below pass over a row that is simply absent, which
    // is how a comparison test goes green while proving nothing.
    expect(Object.keys(fromReader()).sort()).toEqual(Object.keys(fromMysql).sort());
    expect(fromReader()).toEqual(fromMysql);
  });

  it("carries the UPDATE sweeps, not only the INSERTs", () => {
    // The specific fact the interpreter exists for. 0006 seeded the
    // recognition token transferable = 1 and 0092 swept it to 0; a reader of
    // INSERTs alone would tell a founder members can hand recognition around.
    const recognition = Object.values(fromMysql).filter((r) => r.kind === "recognition");
    expect(recognition.length).toBeGreaterThan(0);
    for (const r of recognition) {
      expect(r.transferable).toBe(false);
      expect(fromReader()[r.slug].transferable).toBe(false);
    }
  });

  it("describes every token a fresh village actually holds, boot rows included", async () => {
    // The document's list is the migrated rows PLUS the ones the server
    // registers at first start. The migrated half is checked above; this
    // asserts the whole list is a superset of it and that nothing invented
    // crept in on the boot side.
    await loadTokenRegistry(db.conn as any);
    const documented = collectFacts(ROOT).tokens.map((t: any) => t.slug);
    for (const slug of Object.keys(fromMysql)) {
      expect(documented).toContain(slug);
    }
    expect(new Set(documented).size).toBe(documented.length);
  });
});

describe.skipIf(!configured)("the token doc's words match the functions they describe", () => {
  let db: TestDb;
  let facts: any;

  beforeAll(async () => {
    db = await provisionTestDb();
    // The boot registrations, applied the way the server applies them, so the
    // registry under test holds every token the document describes rather than
    // only the four a migration seeds.
    for (const t of (facts = collectFacts(ROOT)).tokens) {
      await db.conn.query(
        "INSERT INTO `tokens` (`slug`, `name`, `kind`, `governance`, `transferable`, `decimals`, `active`) " +
          "VALUES (?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE `slug` = `slug`",
        [t.slug, t.name, t.kind, t.governance, t.transferable ? 1 : 0, t.decimals],
      );
    }
    await loadTokenRegistry(db.conn as any);
  }, 180_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("says the right thing about who may send each token", () => {
    for (const t of facts.tokens) {
      expect({ slug: t.slug, sendable: t.sendable }).toEqual({
        slug: t.slug,
        sendable: sendRefusal(t.slug) === null,
      });
    }
  });

  it("names each token's faucet, and reports honestly when there is none", () => {
    for (const t of facts.tokens) {
      expect({ slug: t.slug, faucet: t.faucet }).toEqual({ slug: t.slug, faucet: faucetFor(t.slug) });
      expect(t.ruleEngineCanPay).toBe(faucetFor(t.slug) !== null);
    }
  });

  it("names where a spend lands, for exactly the tokens that can carry a price", () => {
    for (const t of facts.tokens) {
      expect({ slug: t.slug, priceable: t.priceable }).toEqual({
        slug: t.slug,
        priceable: isPriceableToken(t.slug),
      });
      expect(t.spendSink).toBe(t.priceable ? spendSinkFor(t.slug) : null);
    }
  });

  it("reports a Base mirror as issued nowhere here", () => {
    const mirrors = facts.tokens.filter((t: any) => t.governance !== "platform");
    expect(mirrors.length).toBeGreaterThan(0);
    for (const t of mirrors) {
      expect(t.faucet).toBeNull();
      expect(t.sendable).toBe(false);
      expect(t.issuedFrom).toEqual([]);
    }
  });
});

describe("the committed document", () => {
  it("is what the generator writes today", () => {
    const wanted = generate(ROOT) as string;
    // PR mode (scripts/lib/generatedDocs.mjs): main regenerates this file, so a pull request is not
    // asked to commit it. The generator has just run without throwing, which is the part that binds.
    if (docsMode() === "pr") {
      expect(wanted.length).toBeGreaterThan(0);
      return;
    }
    const found = fs.readFileSync(path.join(ROOT, "docs", "TOKENS.md"), "utf8");
    // Carriage returns are normalised for the same reason check-token-doc.mjs
    // normalises them: git hands this file back CRLF on the Windows checkouts
    // this repository is developed on, and a raw comparison would fail there
    // and pass in CI.
    expect(found.replace(/\r\n/g, "\n")).toBe(wanted.replace(/\r\n/g, "\n"));
  });
});

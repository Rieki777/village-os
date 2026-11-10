/**
 * The generator's own guard.
 *
 * docs/TOKENS.md is only worth trusting because a build step regenerates it
 * and compares. That step is worth exactly as much as the reader behind it, so
 * this file tests the reader on the cases that would let it be wrong QUIETLY:
 *
 *   - an UPDATE sweep whose WHERE decides which rows it touches. This is not
 *     hypothetical. `gratitude` shipped from 0006 saying transferable = 1 and
 *     0092 swept it to 0, so a reader that looked at the INSERTs alone would
 *     print "members may send recognition" and be wrong about the one column
 *     the recognition firewall turns on.
 *   - a statement shape the reader does not understand. It must throw, never
 *     skip. A skipped statement leaves a document that renders perfectly and
 *     describes a registry nobody has.
 *   - the two escape-hatch directives, which exist so a lane whose migration
 *     reads data this reader cannot see is not blocked.
 *   - a token with no sentence, and a sentence with no token.
 *   - determinism, because a byte comparison is the whole mechanism and a
 *     timestamp anywhere in the output would make every run a false failure.
 *
 * The fixtures use invented token slugs, never a real village's, because this
 * file lives under scripts/ where the brand guard scans.
 *
 * Run: node scripts/generate-token-doc.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ceilingCell,
  generate,
  ruleLine,
  seededRegistry,
  sentenceCoverageProblem,
  splitSql,
  workPayTriggers,
} from "./generate-token-doc.mjs";

let run = 0;
const check = (name, fn) => { fn(); run += 1; console.log(`  PASS  ${name}`); };

/** A throwaway repository root holding only the migrations a case needs. */
function withMigrations(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-doc-"));
  try {
    fs.mkdirSync(path.join(dir, "drizzle"));
    for (const [name, sql] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, "drizzle", name), sql, "utf8");
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CREATE = `
CREATE TABLE IF NOT EXISTS \`tokens\` (
  \`slug\` varchar(32) NOT NULL,
  \`name\` varchar(120) NOT NULL,
  \`kind\` varchar(32) NOT NULL,
  \`governance\` varchar(16) NOT NULL DEFAULT 'platform',
  \`decimals\` int NOT NULL DEFAULT 0,
  \`transferable\` tinyint(1) NOT NULL DEFAULT 0,
  \`active\` tinyint(1) NOT NULL DEFAULT 1,
  \`sort_order\` int NOT NULL DEFAULT 0,
  PRIMARY KEY (\`slug\`)
);
INSERT IGNORE INTO \`tokens\` (\`slug\`, \`name\`, \`kind\`, \`governance\`, \`transferable\`, \`sort_order\`) VALUES
  ('thanks', 'Thanks', 'recognition', 'platform', 1, 1),
  ('coin', 'Coin', 'credit', 'platform', 0, 2);
`;

const bySlug = (root) => Object.fromEntries(seededRegistry(root).rows.map((r) => [r.slug, r]));

console.log("\ngenerate-token-doc: reading the registry out of the migrations\n");

check("splits statements and ignores comment lines", () => {
  const parts = splitSql("-- a note\nSELECT 1;\nSELECT 2;\n");
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[0].sql, "SELECT 1");
  assert.strictEqual(parts[1].sql, "SELECT 2");
});

check("a semicolon inside a quoted string does not end a statement", () => {
  const parts = splitSql("INSERT INTO t VALUES ('a;b');\n");
  assert.strictEqual(parts.length, 1);
  assert.ok(parts[0].sql.includes("'a;b'"));
});

check("a double dash inside a quoted string is not a comment", () => {
  const parts = splitSql("INSERT INTO t VALUES ('a -- b');\n");
  assert.strictEqual(parts.length, 1);
  assert.ok(parts[0].sql.includes("-- b"), "the string contents must survive");
});

check("carries a token-doc directive onto the statement below it", () => {
  const parts = splitSql("-- token-doc: ignore\nUPDATE `tokens` SET `name` = 'x';\n");
  assert.deepStrictEqual(parts[0].directives, ["ignore"]);
});

check("reads the seeded rows, with the CREATE TABLE defaults applied", () => {
  withMigrations({ "0001_a.sql": CREATE }, (root) => {
    const rows = bySlug(root);
    assert.deepStrictEqual(Object.keys(rows).sort(), ["coin", "thanks"]);
    assert.strictEqual(rows.thanks.name, "Thanks");
    assert.strictEqual(rows.thanks.decimals, 0, "the CREATE TABLE default must reach a row that omitted the column");
    assert.strictEqual(rows.thanks.active, true);
    assert.strictEqual(rows.coin.sortOrder, undefined, "raw rows carry SQL column names");
    assert.strictEqual(rows.coin.sort_order, 2);
  });
});

check("APPLIES AN UPDATE SWEEP, which is the case a reader of INSERTs gets wrong", () => {
  withMigrations({
    "0001_a.sql": CREATE,
    "0002_b.sql": "UPDATE `tokens` SET `transferable` = 0 WHERE `kind` IN ('recognition', 'voice');",
  }, (root) => {
    const rows = bySlug(root);
    assert.strictEqual(rows.thanks.transferable, false, "0092's real sweep is exactly this shape");
    assert.strictEqual(rows.coin.transferable, false, "coin was seeded 0 and stays 0");
  });
});

check("honours NOT IN and a multi-clause WHERE", () => {
  withMigrations({
    "0001_a.sql": CREATE,
    "0002_b.sql":
      "UPDATE `tokens` SET `transferable` = 1 WHERE `kind` = 'credit' AND `governance` = 'platform' " +
      "AND `slug` NOT IN ('held-back');",
  }, (root) => {
    assert.strictEqual(bySlug(root).coin.transferable, true);
    assert.strictEqual(bySlug(root).thanks.transferable, true, "the seed said 1 and the sweep did not touch it");
  });
});

check("an ALTER carries its default onto rows that already exist", () => {
  withMigrations({
    "0001_a.sql": CREATE,
    "0002_b.sql": "ALTER TABLE `tokens` ADD COLUMN `is_example` TINYINT(1) NOT NULL DEFAULT 0;",
  }, (root) => {
    assert.strictEqual(bySlug(root).thanks.is_example, false);
  });
});

check("INSERT IGNORE leaves an existing row alone", () => {
  withMigrations({
    "0001_a.sql": CREATE,
    "0002_b.sql": "INSERT IGNORE INTO `tokens` (`slug`, `name`, `kind`) VALUES ('coin', 'Renamed', 'credit');",
  }, (root) => {
    assert.strictEqual(bySlug(root).coin.name, "Coin", "IGNORE means the second write is a no-op");
  });
});

check("THROWS on a statement shape it cannot evaluate, and says what to do", () => {
  withMigrations({
    "0001_a.sql": CREATE,
    "0002_b.sql": "UPDATE `tokens` SET `name` = 'x' WHERE `name` LIKE '%y%';",
  }, (root) => {
    assert.throws(
      () => seededRegistry(root),
      (err) => {
        assert.ok(/cannot evaluate the WHERE clause/.test(err.message), err.message);
        assert.ok(/token-doc: ignore/.test(err.message), "the message must carry the escape hatch");
        assert.ok(/0002_b\.sql/.test(err.message), "the message must name the file");
        return true;
      },
    );
  });
});

check("`-- token-doc: ignore` skips a statement with no fresh-install effect", () => {
  withMigrations({
    "0001_a.sql": CREATE,
    "0002_b.sql": "-- token-doc: ignore\nUPDATE `tokens` SET `name` = 'x' WHERE `name` LIKE '%y%';",
  }, (root) => {
    assert.strictEqual(bySlug(root).thanks.name, "Thanks");
  });
});

check("`-- token-doc: as-if` evaluates the stated effect instead", () => {
  withMigrations({
    "0001_a.sql": CREATE,
    "0002_b.sql":
      "-- token-doc: as-if UPDATE `tokens` SET `name` = 'Village Thanks' WHERE `kind` = 'recognition'\n" +
      "UPDATE `tokens` SET `name` = 'Village Thanks' WHERE `kind` = 'recognition' " +
      "AND `name` <> (SELECT `value` FROM `app_config` WHERE `config_key` = 'brand');",
  }, (root) => {
    assert.strictEqual(bySlug(root).thanks.name, "Village Thanks");
    assert.strictEqual(bySlug(root).coin.name, "Coin", "the as-if WHERE still has to be honoured");
  });
});

check("the word tokens inside a quoted string is not a statement about the table", () => {
  withMigrations({
    "0001_a.sql": CREATE,
    "0002_b.sql": "INSERT IGNORE INTO `app_config` (`k`, `v`) VALUES ('note', 'this village issued tokens early');",
  }, (root) => {
    assert.strictEqual(Object.keys(bySlug(root)).length, 2, "0112 carries exactly this sentence");
  });
});

check("THROWS when the CREATE TABLE went unread rather than reporting hollow rows", () => {
  withMigrations({
    "0001_a.sql":
      "INSERT IGNORE INTO `tokens` (`slug`, `name`, `kind`) VALUES ('thanks', 'Thanks', 'recognition');",
  }, (root) => {
    assert.throws(() => seededRegistry(root), /has no `slug` column|TOKENS_MENTION/);
  });
});

console.log("\ngenerate-token-doc: every token has a sentence, and every sentence a token\n");

check("a token with no sentence stops the build", () => {
  const problem = sentenceCoverageProblem(
    [{ slug: "newcoin", kind: "credit", governance: "platform" }],
    { other: "..." },
  );
  assert.ok(problem && /newcoin/.test(problem) && /SENTENCES/.test(problem), problem);
});

check("a sentence whose token is gone stops the build", () => {
  const problem = sentenceCoverageProblem(
    [{ slug: "coin", kind: "credit", governance: "platform" }],
    { coin: "...", vanished: "..." },
  );
  assert.ok(problem && /vanished/.test(problem), problem);
});

check("a Base mirror is described by kind, so no village name enters the generator", () => {
  const problem = sentenceCoverageProblem(
    [{ slug: "whatever-this-village-called-it", kind: "equity", governance: "hypha" }],
    { "hypha:equity": "..." },
  );
  assert.strictEqual(problem, null);
});

console.log("\ngenerate-token-doc: the document itself\n");

check("the real repository generates, and generates the same bytes twice", () => {
  const once = generate();
  const twice = generate();
  assert.strictEqual(once, twice, "a timestamp or any other clock reading would break the byte comparison");
  assert.ok(once.startsWith("# Tokens\n"), "the document must open with its own title");
  assert.ok(once.endsWith("\n"), "a text file ends with a newline");
});

check("the document carries a machine-readable block that parses", () => {
  const text = generate();
  const m = /```json\n([\s\S]+?)\n```/.exec(text);
  assert.ok(m, "the JSON block is the machine-readable half of the brief");
  const parsed = JSON.parse(m[1]);
  assert.ok(Array.isArray(parsed.tokens) && parsed.tokens.length > 0);
  for (const t of parsed.tokens) {
    for (const field of ["slug", "kind", "governance", "decimals", "description"]) {
      assert.ok(field in t, `every machine-readable token needs ${field}; ${t.slug} has no ${field}`);
    }
  }
});

check("every token in the JSON has a heading of its own in the prose", () => {
  const text = generate();
  const parsed = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(text)[1]);
  for (const t of parsed.tokens) {
    assert.ok(text.includes(`### ${t.name}\n`), `${t.slug} has no section of its own`);
    assert.ok(text.includes(`| Slug | \`${t.slug}\` |`), `${t.slug}'s slug is not stated in its section`);
  }
});

check("THE GENERATOR STILL HAS NO SHEBANG", () => {
  // A shebang and CRLF line endings TOGETHER make Vite's transform throw
  // `SyntaxError: Invalid or unexpected token`, and server/db/tokenDoc.test.ts
  // imports this file through Vite. Either one alone is fine, which is how it
  // ran green half a dozen times on an LF working copy and went red the moment
  // a rebase checked it out with CRLF on a machine where core.autocrlf is true.
  // scripts/check-identity-keys.mjs carries the same line for the same reason.
  const src = fs.readFileSync(new URL("./generate-token-doc.mjs", import.meta.url), "utf8");
  assert.ok(!src.startsWith("#!"), "generate-token-doc.mjs must not open with a shebang");
});

check("the prose keeps the house writing rules", () => {
  const text = generate();
  assert.ok(!text.includes("—"), "no em-dashes");
  assert.ok(!text.includes("–"), "no en-dashes");
  assert.ok(!/\bnot (?:just|only) [a-z]+,? but\b/i.test(text), "no not-X-but-Y framing");
});

check("a blank amount reads as what the work names, never as null", () => {
  // A rule whose amount is blank pays what the quest, role or proposal names
  // (since #776 a seat is paid only its role's own list). The prose printed the
  // raw value, so Village Voice "paid everyone holding a seat null of it".
  const text = generate();
  const prose = text.replace(/```json\n[\s\S]+?\n```/, "");
  assert.ok(!/\bnull on `/.test(prose), "a seeded rule's amount printed as null");
  assert.ok(!/\bnull of it\b/.test(prose), "a cycle payment printed as null of it");
  assert.ok(!/^\| `[a-z.]+` \| `[a-z-]+` \| null \|/m.test(prose), "the seeded-rules table printed null");
  const parsed = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(text)[1]);
  const blankSeat = parsed.tokens.some((t) => (t.seededRules ?? []).some((r) => r.trigger === "role.cycle" && r.enabled && r.amount === null));
  if (blankSeat) assert.ok(prose.includes("what its role names of it"), "a blank seat rule must say the role decides");
});

check("a ceiling is stated only where one binds, because work is paid in full (Rye, 2026-10-22)", () => {
  // `ceilingBinds` in shared/workValue.ts is false on quest, role and proposal
  // pay, so the stored ceiling caps nothing there. The prose said "up to 100 a
  // moon" on every one of them, a cap the no-caps ruling removed.
  const triggers = workPayTriggers();
  assert.deepStrictEqual([...triggers].sort(), ["proposal.accepted", "quest.completed", "role.cycle"]);
  assert.strictEqual(
    ruleLine({ trigger: "quest.completed", amount: 10, ceiling: 100, recipient: "claimant", ceilingBinds: false }),
    "10 on `quest.completed` to the claimant",
  );
  assert.strictEqual(
    ruleLine({ trigger: "gift.sent", amount: 5, ceiling: 50, recipient: "sender", ceilingBinds: true }),
    "5 on `gift.sent` to the sender, up to 50 a moon",
    "control: a rule a ceiling does bind still says so",
  );
  assert.strictEqual(ceilingCell({ ceiling: 100, ceilingBinds: false }), "none, work is paid in full");
  assert.strictEqual(ceilingCell({ ceiling: 50, ceilingBinds: true }), "50");

  const text = generate();
  const prose = text.replace(/```json\n[\s\S]+?\n```/, "");
  for (const t of triggers) {
    const capped = new RegExp("`" + t.replace(".", "\\.") + "` to the [a-z]+, up to \\d+ a moon");
    assert.ok(!capped.test(prose), `the prose states a cap on ${t}, which binds nothing`);
    const tableRow = new RegExp("^\\| `" + t.replace(".", "\\.") + "` \\| `[a-z-]+` \\| [^|]+ \\| \\d+ \\|", "m");
    assert.ok(!tableRow.test(prose), `the seeded-rules table prints a ceiling number on ${t}`);
  }
  const parsed = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(text)[1]);
  const rules = parsed.tokens.flatMap((t) => t.seededRules ?? []);
  assert.ok(rules.length > 0, "the seed carries rules to check");
  for (const r of rules) assert.strictEqual(r.ceilingBinds, !triggers.includes(r.trigger), `${r.trigger} carries the wrong ceilingBinds`);
});

check("THROWS when the work triggers move, never guessing which ceilings bind", () => {
  // One directory per case: the reader caches a parsed file by its path.
  const withWorkValue = (src, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-doc-work-"));
    try {
      fs.mkdirSync(path.join(dir, "shared"));
      fs.writeFileSync(path.join(dir, "shared", "workValue.ts"), src, "utf8");
      return fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const list = 'export const WORK_PAY_TRIGGERS: readonly string[] = ["quest.completed"];\n';
  withWorkValue('export function ceilingBinds(trigger: string): boolean {\n  return true;\n}\n', (dir) =>
    assert.throws(() => workPayTriggers(dir), /WORK_PAY_TRIGGERS/, "a missing list must throw"));
  withWorkValue(list + 'export function ceilingBinds(trigger: string): boolean {\n  return trigger.length > 0;\n}\n', (dir) =>
    assert.throws(() => workPayTriggers(dir), /ceilingBinds/, "a ceilingBinds that stopped reading the list must throw"));
  withWorkValue(list + 'export function ceilingBinds(trigger: string): boolean {\n  return !WORK_PAY_TRIGGERS.includes(trigger);\n}\n', (dir) =>
    assert.deepStrictEqual(workPayTriggers(dir), ["quest.completed"], "control: the shape it reads today"));
});

console.log(`\n${run} check(s) passed\n`);

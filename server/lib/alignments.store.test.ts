/**
 * THE ALIGNMENT STORE'S STANDING RULES, READ OFF THE TREE (seat settings PR5).
 *
 *   1. INSERT ONLY. No file in the repository names one of the four tables
 *      beside an UPDATE, a DELETE, a TRUNCATE, a REPLACE or an upsert, except
 *      server/lib/alignmentErasure.ts. With controls: the scan finds the one
 *      site it exempts, and finds a planted statement in a fixture.
 *   2. THE RETENTION SWEEP NEVER TOUCHES THEM. The daily sweep in
 *      server/index.ts calls nothing from the alignment modules, and no
 *      production file outside the store names the tables. Control: the same
 *      reader finds the submissions the sweep does read.
 *   3. NO PUBLIC EVENT. No file this feature adds calls `recordEvent` or
 *      `addActivity`. Control: the scan finds one where one exists.
 *   4. IN FORCE, AS A TABLE: `deriveAlignmentState` over every case the spec names.
 *   5. MONEY: which terms ask the re-confirm.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { carriesMoney, deriveAlignmentState, intentSentence, renderSeatTermsText, type StateInput } from "../../shared/alignments";

const ROOT = path.resolve(__dirname, "..", "..");
const TABLES = ["alignment_texts", "alignment_parties", "alignments", "alignment_seals"];
const EXEMPT = "server/lib/alignmentErasure.ts";

/** Every source file under the folders that could hold a statement. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|mjs|js|sql)$/.test(e.name)) out.push(rel);
    }
  };
  for (const d of ["server", "shared", "client/src", "scripts", "drizzle"]) walk(d);
  return out;
}

/**
 * A mutation of one of the four tables, in text. Built from parts so this
 * file does not match itself. `alignments` is matched as a whole word, so
 * `alignment_texts` is not counted twice and `alignmentsOf` is not a table.
 */
function mutationSites(text: string): string[] {
  const t = TABLES.map((x) => `\`?${x}\`?(?![A-Za-z0-9_])`).join("|");
  const verbs = [
    `UPD${"ATE"}\\s+(?:IGNORE\\s+)?(?:${t})`,
    `DEL${"ETE"}\\s+(?:\\w+\\s+)?FROM\\s+(?:${t})`,
    `TRUN${"CATE"}\\s+(?:TABLE\\s+)?(?:${t})`,
    `REPL${"ACE"}\\s+INTO\\s+(?:${t})`,
    `INSERT\\s+(?:IGNORE\\s+)?INTO\\s+(?:${t})[^;]*?ON\\s+DUPLICATE\\s+KEY\\s+UPD${"ATE"}`,
    `DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:${t})`,
  ];
  const re = new RegExp(verbs.join("|"), "gi");
  return Array.from(text.matchAll(re), (m) => m[0]);
}

describe("insert only: the four tables are mutated in one file", () => {
  const files = sources();

  it("no file but alignmentErasure.ts updates, deletes, truncates, replaces or upserts the four tables", () => {
    const offenders = files
      .filter((f) => f !== EXEMPT)
      .flatMap((f) => mutationSites(fs.readFileSync(path.join(ROOT, f), "utf8")).map((m) => `${f}: ${m}`));
    expect(offenders).toEqual([]);
  });

  it("CONTROL: the scan sees the one site it exempts, and a planted statement", () => {
    expect(files).toContain(EXEMPT);
    expect(mutationSites(fs.readFileSync(path.join(ROOT, EXEMPT), "utf8")).length).toBeGreaterThan(0);
    expect(mutationSites("UPD" + "ATE alignments SET method = ?")).toHaveLength(1);
    expect(mutationSites("DEL" + "ETE FROM `alignment_seals` WHERE 1")).toHaveLength(1);
    expect(mutationSites("INSERT INTO alignment_parties (a) VALUES (1) ON DUPLICATE KEY UPD" + "ATE a = 2")).toHaveLength(1);
    // Reads and plain inserts are not mutations.
    expect(mutationSites("SELECT * FROM alignments; INSERT IGNORE INTO alignments (id) VALUES (?)")).toEqual([]);
  });
});

describe("the retention sweep never touches the alignment store", () => {
  const index = fs.readFileSync(path.join(ROOT, "server/index.ts"), "utf8");
  const start = index.indexOf("async function runRetentionSweep");
  const body = index.slice(start, index.indexOf("\n}\n", start));

  it("the sweep's body names no table and calls nothing from the alignment modules", () => {
    expect(start).toBeGreaterThan(0);
    for (const t of TABLES) expect(body, t).not.toMatch(new RegExp(`\\b${t}\\b`));
    for (const name of ["alignmentErasure", "alignmentSubjects", "eraseFromAlignments", "settleAll", "repos/alignments", "alignmentsFor"]) {
      expect(body, name).not.toContain(name);
    }
    // CONTROL: the same slice is the sweep, reading the submissions it ages out.
    expect(body).toContain("submissionsRepo");
  });

  it("no production file outside the store names the four tables", () => {
    const allowed = new Set(["server/repos/alignments.ts", EXEMPT, "drizzle/0250_a_member_aligns_with_seat_terms.sql"]);
    const re = new RegExp(`\\b(?:${TABLES.join("|")})\\b(?=[\\s\\x60(,;]|$)`, "m");
    const named = sources()
      .filter((f) => !/\.test\.tsx?$/.test(f) && !allowed.has(f) && !f.startsWith("client/"))
      .filter((f) => {
        // Comments may talk about the tables; code may not reach them.
        const code = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$|^\s*--.*$/gm, "");
        return /(?:FROM|INTO|JOIN|UPDATE|TABLE)\s+`?(?:alignment_texts|alignment_parties|alignments|alignment_seals)\b/i.test(code) && re.test(code);
      });
    expect(named).toEqual([]);
  });
});

describe("no public event anywhere in the alignment store", () => {
  const ADDED = [
    "shared/alignments.ts",
    "server/repos/alignments.ts",
    "server/lib/alignmentSubjects.ts",
    "server/lib/alignmentErasure.ts",
    "server/routes/alignments.ts",
    "server/routes/seatApplications.ts",
    "server/lib/seatApplicationCloser.ts",
  ];
  const code = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("names neither recordEvent nor addActivity", () => {
    for (const f of ADDED) {
      expect(code(f), f).not.toMatch(/\brecordEvent\s*\(/);
      expect(code(f), f).not.toMatch(/\baddActivity\s*\(/);
    }
  });

  it("CONTROL: the scan finds a call where one exists", () => {
    expect(code("server/routes/powerHands.ts")).toMatch(/\brecordEvent\s*\(/);
  });
});

describe("in force is derived: the table", () => {
  const base: StateInput = {
    contentHash: "h1",
    parties: [
      { partyKey: "user:u-ana", required: true },
      { partyKey: "village", required: true },
    ],
    alignments: [
      { partyKey: "user:u-ana", contentHash: "h1" },
      { partyKey: "village", contentHash: "h1" },
    ],
    effectiveFrom: null,
    effectiveTo: "2029-06-29",
    today: "2027-01-01",
    seatings: { open: 1, total: 1 },
    closed: null,
  };
  const cases: Array<[string, Partial<StateInput>, string, boolean]> = [
    ["both aligned, seating open", {}, "in-force", true],
    ["the village has not aligned", { alignments: [{ partyKey: "user:u-ana", contentHash: "h1" }] }, "pending", false],
    ["an alignment with another hash does not count", { alignments: [{ partyKey: "user:u-ana", contentHash: "h1" }, { partyKey: "village", contentHash: "h0" }] }, "pending", false],
    ["a non-required party need not align", { parties: [...base.parties, { partyKey: "user:u-ivo", required: false }] }, "in-force", true],
    ["aligned, the first day still to come", { effectiveFrom: "2027-02-01" }, "pending", true],
    ["aligned, on the first day", { effectiveFrom: "2027-01-01" }, "in-force", true],
    ["aligned, no seating taken up yet", { seatings: { open: 0, total: 0 } }, "pending", true],
    ["the seating ended, by any door", { seatings: { open: 0, total: 1 } }, "ended", true],
    ["one of three seatings still open", { seatings: { open: 1, total: 3 } }, "in-force", true],
    ["on the last day of the term", { today: "2029-06-29" }, "in-force", true],
    ["the day after the term", { today: "2029-06-30" }, "ended", true],
    ["the application was withdrawn", { closed: "Withdrawn.", alignments: [{ partyKey: "user:u-ana", contentHash: "h1" }] }, "ended", false],
    ["a subject with no seating behind it", { seatings: null }, "in-force", true],
  ];
  for (const [name, change, state, all] of cases) {
    it(name, () => {
      const d = deriveAlignmentState({ ...base, ...change });
      expect(d.state).toBe(state);
      expect(d.allAligned).toBe(all);
    });
  }
});

describe("money, words and the sentence", () => {
  it("money means pay, allowance or bonus of a kind other than none or honorary", () => {
    expect(carriesMoney({ v: 1 })).toBe(false);
    expect(carriesMoney({ v: 1, pay: { kind: "none" } })).toBe(false);
    expect(carriesMoney({ v: 1, pay: { kind: "honorary" } })).toBe(false);
    expect(carriesMoney({ v: 1, allowance: { kind: "none" }, bonus: { kind: "none" } })).toBe(false);
    expect(carriesMoney({ v: 1, quests: { perMoonMin: 3, doneWhenRequired: true } })).toBe(false);
    expect(carriesMoney({ v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 100, per: "month" } })).toBe(true);
    expect(carriesMoney({ v: 1, pay: { kind: "in-kind" } })).toBe(true);
    expect(carriesMoney({ v: 1, allowance: { kind: "reimbursed" } })).toBe(true);
    expect(carriesMoney({ v: 1, bonus: { kind: "equity", capWords: "a small share" } })).toBe(true);
  });

  it("the words carry the seats and the terms, the same every time, and never say sign", () => {
    const settings = { v: 1 as const, pay: { kind: "fixed" as const, currency: "XTS", amountMinor: 4321000, per: "month" as const } };
    const a = renderSeatTermsText(["Orchard steward", "Ledger keeper"], settings);
    expect(renderSeatTermsText(["Orchard steward", "Ledger keeper"], settings)).toEqual(a);
    expect(a.title).toBe("Terms for Orchard steward and Ledger keeper");
    expect(a.body).toContain("THE SEATS\n  Orchard steward\n  Ledger keeper");
    expect(a.body).toContain("Recorded here. Paid outside the platform.");
    expect(a.body).not.toMatch(/\bsign/i);
    expect(intentSentence(["Orchard steward"])).toBe("I align with these terms for Orchard steward.");
    expect(intentSentence(["Orchard steward"], true)).toBe("The village aligns with these terms for Orchard steward.");
  });
});

/**
 * The TOKEN doc guard's own guard.
 *
 * `scripts/check-token-doc.mjs` is the gate that makes docs/TOKENS.md worth
 * reading, and until this file it had no self-test at all: nine other guards
 * in this directory have one, that one did not, and a guard nobody has watched
 * go red is a guard that reports green either way. Note the asymmetry it was
 * living with. `scripts/generate-token-doc.test.mjs` proves the GENERATOR (its
 * SQL interpreter, its refusals, its directives) and `server/db/tokenDoc.test.ts`
 * proves that interpreter against a real MySQL. Nothing proved the CHECK: that
 * a drifted document actually fails, that a matching one actually passes, and
 * what either of them prints.
 *
 * THIS FILE DOES NOT EDIT check-token-doc.mjs. It asserts what that script
 * ACTUALLY does today, including where what it does is weaker than it could
 * be. Two of the cases below are written as records of a gap rather than as
 * approval of it; see THE GAP.
 *
 * ── THE GAP, ASSERTED RATHER THAN FIXED ────────────────────────────────────
 *
 * check-token-doc.mjs uses EXIT 1 FOR EVERYTHING that is not a pass:
 *
 *   - the document drifted from the code             exit 1
 *   - docs/TOKENS.md is not there at all             exit 1
 *   - the generator threw, so nothing was compared   exit 1
 *
 * It never exits 2. That is NOT a false green: every one of those is a red
 * build and none is reported as success, which is the property that actually
 * matters and which the cases below pin. What it costs is that a person
 * reading a red CI run cannot tell "I looked and the document is wrong" from
 * "I could not look", and the printed message is the only thing carrying that
 * difference. `scripts/check-economics-doc.mjs`, written later against the
 * same pattern, splits them (1 for drift, 2 for could-not-run) and its own
 * header says why.
 *
 * Changing check-token-doc.mjs is out of scope here and is left as a decision
 * for whoever owns that script. These tests assert TODAY'S behaviour, so if
 * somebody does split the codes, THIS FILE goes red and tells them to update
 * it, which is the correct way for a pinned behaviour to change.
 *
 * ── THE FIXTURE, AND WHY IT IS SHAPED THIS WAY ─────────────────────────────
 *
 * check-token-doc.mjs imports DOC_PATH and ROOT from generate-token-doc.mjs,
 * which derives ROOT from ITS OWN location on disk. So the only way to point
 * the real guard at a document this test is allowed to break is to build a
 * tree with a copy of both scripts in it and let ROOT land there:
 *
 *     <fixture>/scripts/generate-token-doc.mjs   copied
 *     <fixture>/scripts/check-token-doc.mjs      copied
 *     <fixture>/drizzle       -> real, junctioned
 *     <fixture>/server        -> real, junctioned
 *     <fixture>/shared        -> real, junctioned
 *     <fixture>/node_modules  -> real, junctioned  (the generator imports typescript)
 *     <fixture>/docs/TOKENS.md                    WRITTEN BY THIS TEST, and the
 *                                                 only file any case ever edits
 *
 * THE REAL docs/TOKENS.md IS NEVER WRITTEN. Its expected content comes from
 * `generate(REPO_ROOT)`, which returns a string and writes nothing. One case
 * below asserts the fixture renders byte-identically to that, which is what
 * makes the junctioned tree a faithful stand-in rather than a hopeful one, and
 * a case at the end asserts the real file is unchanged after everything ran.
 *
 * THE JUNCTIONS POINT AT THE REAL REPOSITORY, so cleanup is the dangerous part
 * of this file. `fs.rmSync(dir, { recursive: true })` unlinks a junction rather
 * than recursing through it (verified on this platform before this file was
 * written, against a throwaway target holding a file that had to survive), and
 * cleanup additionally unlinks every junction BY NAME first so the recursive
 * delete never even meets one. No case writes inside a junctioned directory.
 *
 * Run: node scripts/check-token-doc.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generate, setConst } from "./generate-token-doc.mjs";
import { constInitializerText } from "./generate-economics-doc.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const GUARD = path.join(HERE, "check-token-doc.mjs");
const GENERATOR = path.join(HERE, "generate-token-doc.mjs");

/** Everything the generator reads, and nothing this test ever writes into. */
const LINKED = ["drizzle", "server", "shared", "node_modules"];

let run = 0;
const check = (name, fn) => {
  fn();
  run += 1;
  console.log(`  PASS  ${name}`);
};

console.log("\ncheck-token-doc: the guard that makes docs/TOKENS.md worth reading\n");

// ── The expected text, from the REAL tree, written nowhere ─────────────────

const EXPECTED = generate(REPO_ROOT);

check("the generator returns a document without writing one", () => {
  assert.ok(EXPECTED.length > 1000, "the generated token document should not be nearly empty");
  assert.match(EXPECTED, /gratitude/, "the generated document must still describe the registry");
});

// ── The fixture ────────────────────────────────────────────────────────────

const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), "token-doc-test-"));

/**
 * Junction where the platform allows it, copy where it does not.
 *
 * A junction is instant and server/ alone is 7.5 MB, but a CI runner or a
 * locked-down machine may refuse to create one, and a self-test that only runs
 * on the machine it was written on proves nothing about CI.
 */
function linkOrCopy(target, dest) {
  try {
    fs.symlinkSync(target, dest, "junction");
    return "junction";
  } catch {
    fs.cpSync(target, dest, { recursive: true });
    return "copy";
  }
}

/**
 * A tree with both real scripts in it and a docs/TOKENS.md this test owns.
 *
 * `omit` leaves one of the linked source directories out, which is how the
 * "the generator could not read the code" case is built WITHOUT deleting
 * anything from the real repository.
 */
function newTree(label, { doc = EXPECTED, omit = [], ledger = null } = {}) {
  const root = path.join(FIXTURES, label);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(GENERATOR, path.join(root, "scripts", "generate-token-doc.mjs"));
  fs.copyFileSync(GUARD, path.join(root, "scripts", "check-token-doc.mjs"));
  for (const name of LINKED) {
    if (omit.includes(name)) continue;
    // A case that rewrites the keystone declaration needs a REAL COPY of
    // server/, never the junction: writing through the junction would edit the
    // repository this test is measuring.
    if (name === "server" && ledger) {
      fs.cpSync(path.join(REPO_ROOT, "server"), path.join(root, "server"), { recursive: true });
      const target = path.join(root, "server", "lib", "ledger.ts");
      const src = fs.readFileSync(target, "utf8");
      // The declaration moved from `new Set([...])` to `frozenSet([...])` when
      // the keystone lane closed W3 F14: the set was mutable at runtime behind
      // a `ReadonlySet` type, which is a claim and not a property. Only the
      // TEXT this fixture rewrites changed; the list it holds did not, and the
      // reader accepts both shapes.
      const ORIGINAL = 'export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = frozenSet(["stay_night", "payment_reversal", "reversal"]);';
      assert.ok(src.includes(ORIGINAL), "the keystone declaration this fixture rewrites has moved");
      fs.writeFileSync(target, src.replace(ORIGINAL, ledger));
      continue;
    }
    linkOrCopy(path.join(REPO_ROOT, name), path.join(root, name));
  }
  if (doc !== null) {
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "TOKENS.md"), doc);
  }
  return root;
}

/**
 * spawnSync, not execFileSync: execFileSync discards stderr on a SUCCESSFUL
 * run, and a passing case here has to be readable too.
 */
function runGuard(root, args = []) {
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "check-token-doc.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

// ── The harness itself is honest ───────────────────────────────────────────

check("HARNESS: the fixture tree renders the SAME document as the real tree", () => {
  // Without this, every case below could be passing against a fixture whose
  // generator quietly saw different sources, and the whole file would be
  // measuring itself.
  const root = newTree("fidelity");
  const r = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "generate-token-doc.mjs"), "--stdout"],
    { cwd: root, encoding: "utf8" },
  );
  assert.strictEqual(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.strictEqual(
    r.stdout.replace(/\r\n/g, "\n"),
    EXPECTED.replace(/\r\n/g, "\n"),
    "the junctioned fixture must render byte-identically to the real tree, or it is not a stand-in",
  );
});

// ── Direction one: it passes when it should ────────────────────────────────

check("MATCHING fixture exits 0 and says what it compared", () => {
  const { code, out } = runGuard(newTree("match"));
  assert.strictEqual(code, 0, out);
  assert.match(out, /Token doc guard passed/);
  assert.match(out, /docs\/TOKENS\.md matches the code/);
  // The count is part of the pass: "found nothing" must never read as success.
  assert.match(out, /\d+ tokens \(\d+ minted here, \d+ read from Base\)/);
});

check("MATCHING fixture with CRLF line endings still exits 0", () => {
  // core.autocrlf is true on the Windows checkouts this repository is
  // developed on, so git stores LF and hands back CRLF. A byte comparison
  // would fail on one developer's machine and pass in CI, and the same
  // carriage-return class has produced a per-machine answer in this
  // repository's guards twice before (see check-brand-refs.test.mjs).
  const { code, out } = runGuard(newTree("crlf", { doc: EXPECTED.replace(/\n/g, "\r\n") }));
  assert.strictEqual(code, 0, `a Windows checkout must read the same as a Linux one:\n${out}`);
});

// ── Direction two: it fails when it should, and prints both sides ──────────

check("DRIFTED fixture exits non-zero and prints BOTH sides", () => {
  const lines = EXPECTED.split("\n");
  const i = lines.findIndex((l) => l.includes("Gratitude"));
  assert.notStrictEqual(i, -1, "the fixture needs a real line to corrupt");
  const before = lines[i];
  lines[i] = before.replace("Gratitude", "Bananas");
  assert.notStrictEqual(lines[i], before, "the drift must actually change the text, or this proves nothing");

  const { code, out } = runGuard(newTree("drift", { doc: lines.join("\n") }));
  assert.strictEqual(code, 1, `a drifted document must fail. Got ${code}:\n${out}`);
  assert.match(out, /have come apart/);
  assert.match(out, /the code says:.*Gratitude/, "the GENERATED side must be printed");
  assert.match(out, /the file says:.*Bananas/, "the COMMITTED side must be printed");
  assert.match(out, new RegExp(`line ${i + 1}\\b`), "the line number must be the one that differs");
  assert.match(out, /node scripts\/generate-token-doc\.mjs/, "the way out must be printed");
});

check("DRIFT anywhere is caught, including past the end of the generated text", () => {
  // A guard that only compared a prefix, or a header, would pass this.
  const { code, out } = runGuard(newTree("drift-tail", { doc: `${EXPECTED}\nA line somebody typed by hand.\n` }));
  assert.strictEqual(code, 1, out);
  assert.match(out, /the generated document ends here/, "running off the end of the generated side must be reported");
});

check("DRIFT of a single character is caught", () => {
  const drifted = EXPECTED.replace("| 0 |", "| 8 |");
  assert.notStrictEqual(drifted, EXPECTED, "the fixture needs a decimals cell to corrupt");
  const { code } = runGuard(newTree("drift-char", { doc: drifted }));
  assert.strictEqual(code, 1, "a one-character change to a decimals column must fail");
});

check("it reports the TOTAL number of differing lines, not just the one it prints", () => {
  // Today it prints only the FIRST difference, with a count of how many there
  // are. Pinned because the count is the only signal that more is wrong than
  // what is on screen: fixing the printed line does not necessarily make the
  // guard green, and a reader has to know that.
  const lines = EXPECTED.split("\n");
  const hits = [];
  for (let n = 0; n < lines.length && hits.length < 3; n += 1) {
    if (lines[n].includes("|")) hits.push(n);
  }
  assert.strictEqual(hits.length, 3, "the fixture needs three table lines to corrupt");
  for (const n of hits) lines[n] = `${lines[n]} EDITED`;

  const { code, out } = runGuard(newTree("drift-count", { doc: lines.join("\n") }));
  assert.strictEqual(code, 1, out);
  assert.match(out, /3 line\(s\) differ/, "the count of differing lines must be reported");
  const printed = (out.match(/the code says:/g) || []).length;
  assert.strictEqual(printed, 1, "today it prints only the FIRST difference; if that changes, update this test");
});

// ── THE GAP: could-not-run is exit 1, the same as drift ────────────────────

check("a MISSING docs/TOKENS.md exits 2: could not compare, not drifted", () => {
  // This was the recorded GAP: the guard used exit 1 for everything, so a red
  // build could not distinguish "I looked and it is wrong" from "I could not
  // look". Closed now, and pinned here so it stays closed.
  const { code, out } = runGuard(newTree("nodoc", { doc: null }));
  assert.strictEqual(code, 2, `an absent document is could-not-compare. Got ${code}:\n${out}`);
  assert.match(out, /docs\/TOKENS\.md is missing/);
  assert.match(out, /Exit 2, not 1/);
  assert.ok(!/have come apart/.test(out), "a missing file must not be described as drift");
});

check("sources the generator cannot read exit 2, and blame the CODE", () => {
  // Built by omitting the drizzle junction, so nothing is deleted from the
  // real repository. The document in this fixture is perfectly correct and the
  // guard still fails, which is right: nothing was compared.
  const { code, out } = runGuard(newTree("nosources", { omit: ["drizzle"] }));
  assert.strictEqual(code, 2, `an unreadable source tree is could-not-compare. Got ${code}:\n${out}`);
  assert.match(out, /could not be generated, so it cannot be checked/);
  assert.match(out, /drizzle/, "the message must name the source that moved");
  assert.match(out, /Exit 2: nothing was compared/);
});

// ── --list ─────────────────────────────────────────────────────────────────

check("--list prints the sources AND still runs the check", () => {
  // It has no early return, so --list on a drifted tree still fails. Worth
  // pinning: somebody reaching for --list to inspect the source list gets a
  // verdict as well, and would otherwise be surprised by the exit code.
  const drifted = EXPECTED.replace("Gratitude", "Bananas");
  const { code, out } = runGuard(newTree("list-drift", { doc: drifted }), ["--list"]);
  assert.match(out, /docs\/TOKENS\.md is generated from:/);
  assert.match(out, /drizzle/);
  assert.match(out, /server\/lib\/economy\.ts/);
  assert.strictEqual(code, 1, `--list does not suppress the check. Got ${code}:\n${out}`);
});

// ── F7: the keystone sets, read for their VALUE ────────────────────────────

const KEYSTONE_SETS = [
  ["server/lib/ledger.ts", "ALLOW_NEGATIVE_SOURCES"],
  ["server/lib/spending.ts", "SENDABLE_KINDS"],
  ["server/lib/spending.ts", "MODULE_VOUCHERS"],
];

check("F7: the three widenings that walked past this guard are now REFUSED", () => {
  // setConst used to take the first array literal in the initialiser, which
  // reads the source text rather than the value. All three of these produced
  // a clean RC=0 from this guard AND from check-economics-doc, and the third
  // also walks past server/payments.test.ts, which compares the set inside a
  // process that says NODE_ENV=test.
  const attacks = {
    concat: 'export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = new Set(["stay_night", "payment_reversal", "reversal"].concat(["spend"]));',
    ternary: 'export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = new Set(process.env.NODE_ENV === "test" ? ["stay_night", "payment_reversal", "reversal"] : ["stay_night", "payment_reversal", "reversal", "spend"]);',
    filter: 'export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = new Set(["stay_night", "payment_reversal", "reversal"].filter((s) => s !== "reversal"));',
  };
  for (const [label, ledger] of Object.entries(attacks)) {
    const { code, out } = runGuard(newTree(`widen-${label}`, { ledger }));
    assert.strictEqual(code, 2, `${label} must be refused as could-not-read. Got ${code}:\n${out}`);
    assert.match(out, /accepts exactly two shapes/, `${label} must name the shapes it accepts`);
    assert.match(out, /It found:/, `${label} must print the shape it saw`);
    assert.match(out, /ALLOW_NEGATIVE_SOURCES/);
  }
});

check("F7: frozenSet([...]) is ACCEPTED, because it is the second documented shape", () => {
  // The keystone lane closes F14 by sealing these sets: frozenSet returns a
  // Set whose add, delete and clear throw. It changes what the value can DO,
  // not what it IS, so both documents must keep reading the same list across
  // that change rather than going red on it.
  const ledger = 'export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = frozenSet(["stay_night", "payment_reversal", "reversal"]);';
  const { code, out } = runGuard(newTree("frozenset", { ledger }));
  assert.strictEqual(code, 0, `frozenSet with a literal array must read exactly like new Set:\n${out}`);
  assert.match(out, /Token doc guard passed/);
});

check("F7: frozenSet wrapping anything but a literal array is still REFUSED", () => {
  // The wrapper is not a licence. `frozenSet([...].concat([...]))` hides the
  // same widening behind an accepted name.
  const ledger = 'export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = frozenSet(["stay_night", "payment_reversal", "reversal"].concat(["spend"]));';
  const { code, out } = runGuard(newTree("frozenset-concat", { ledger }));
  assert.strictEqual(code, 2, `frozenSet around a .concat must be refused. Got ${code}:\n${out}`);
  assert.match(out, /accepts exactly two shapes/);
});

check("F7: an HONEST edit to the list is still exit 1, drift, with both sides printed", () => {
  // The control that proves the cases above measure the SHAPE and not merely
  // "the set changed". A village that really does edit the keystone gets the
  // ordinary drift failure, which is regenerated and reviewed.
  //
  // IT NARROWS RATHER THAN WIDENS, and the reason is the case directly below:
  // the generator now REFUSES a source it has no sentence for, so a widening to
  // an invented slug is exit 2 by design and would no longer measure drift at
  // all. Dropping a member changes the list without changing the shape, which
  // is exactly the control this case was written to be.
  const ledger = 'export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = new Set(["stay_night", "payment_reversal"]);';
  const { code, out } = runGuard(newTree("narrow-honest", { ledger }));
  assert.strictEqual(code, 1, `an honest edit is drift, not could-not-read. Got ${code}:
${out}`);
  assert.match(out, /have come apart/);
  assert.match(out, /the code says:/);
  assert.match(out, /the file says:/);
});

check("F7: a NEW source with no plain sentence stops the build and names it", () => {
  // The other half of the same rule, and the reason the case above narrows.
  // The count and the list read themselves out of the code; the one part a
  // human has to write is the sentence saying what the exception is FOR. A
  // source that arrives without one would otherwise reach a village as a bare
  // slug in a paragraph about their own money, so the generator refuses.
  const ledger = 'export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = new Set(["stay_night", "payment_reversal", "reversal", "spend"]);';
  const { code, out } = runGuard(newTree("widen-unglossed", { ledger }));
  assert.strictEqual(code, 2, `an unglossed source must stop the build. Got ${code}:
${out}`);
  assert.match(out, /with no plain sentence/);
  assert.match(out, /spend/, "the refusal names the source it cannot describe");
});

check("F7 RUNTIME: every keystone set's value under NODE_ENV=production matches the document", () => {
  // The half no static reader can cover, and the half payments.test.ts cannot
  // reach: it compares the same set inside a process that identifies itself as
  // the test environment, where an environment-keyed set is identical to the
  // honest one. This evaluates the declaration where it matters.
  for (const [file, name] of KEYSTONE_SETS) {
    const src = constInitializerText(REPO_ROOT, file, name);
    const documented = setConst(REPO_ROOT, file, name).sort();
    const probe =
      "const frozenSet = (a) => new Set(a);\n" +
      `process.stdout.write(JSON.stringify(Array.from(${src}).sort()));`;
    const r = spawnSync(process.execPath, ["-e", probe], {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production", VITEST: "" },
    });
    assert.strictEqual(r.status, 0, `evaluating ${name} failed:\n${r.stdout}${r.stderr}`);
    assert.deepStrictEqual(
      JSON.parse(r.stdout),
      documented,
      `${name} holds a different value at runtime under NODE_ENV=production than docs/TOKENS.md prints`,
    );
  }
});

// ── The positive control for the whole file ────────────────────────────────

check("REAL TREE: the committed docs/TOKENS.md matches the committed code", () => {
  // Every case above builds its own fixture, so all of them could pass against
  // a repository whose actual document had drifted.
  const r = spawnSync(process.execPath, [GUARD], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.strictEqual(r.status, 0, `docs/TOKENS.md has drifted from the code:\n${r.stdout}${r.stderr}`);
});

check("REAL TREE: docs/TOKENS.md was not modified by this test", () => {
  // The junctions point at the real repository. This is the assertion that
  // says so out loud rather than trusting that no case wrote through one.
  const onDisk = fs.readFileSync(path.join(REPO_ROOT, "docs", "TOKENS.md"), "utf8");
  assert.strictEqual(
    onDisk.replace(/\r\n/g, "\n"),
    EXPECTED.replace(/\r\n/g, "\n"),
    "the real docs/TOKENS.md changed while this test ran, which it must never do",
  );
});

// ── Cleanup, which is the dangerous part ───────────────────────────────────

/*
 * Unlink every junction BY NAME first, so the recursive delete below never
 * meets one. `fs.rmSync` was verified on this platform to unlink a junction
 * rather than recurse through it, and this belt-and-braces pass means that
 * behaviour is not the only thing standing between a self-test and the real
 * drizzle/ and server/ directories.
 */
for (const label of fs.readdirSync(FIXTURES)) {
  for (const name of LINKED) {
    const p = path.join(FIXTURES, label, name);
    let st;
    try {
      st = fs.lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) fs.unlinkSync(p);
  }
}
assert.ok(
  fs.existsSync(path.join(REPO_ROOT, "drizzle", "0006_token_registry.sql")),
  "the real drizzle/ must still be there after unlinking the fixtures",
);
fs.rmSync(FIXTURES, { recursive: true, force: true });
assert.ok(fs.existsSync(path.join(REPO_ROOT, "server", "lib", "economy.ts")), "the real server/ must survive cleanup");
assert.ok(fs.existsSync(path.join(REPO_ROOT, "docs", "TOKENS.md")), "the real docs/TOKENS.md must survive cleanup");

console.log(`\n${run} check(s) passed\n`);

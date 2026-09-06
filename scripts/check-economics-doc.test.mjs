/**
 * The economics doc guard's own guard.
 *
 * Two things are being proved, and the second matters more than the first.
 *
 * IT REFUSES. A drifted region fails with BOTH sides printed, a missing marker
 * fails with a DIFFERENT code, a missing document fails, and a tree whose
 * sources are gone fails. Each is run as a child process against real files on
 * disk, reading the real exit code.
 *
 * IT CAN STILL SEE. Every reader in the generator is text-based, so it can
 * lose sight of a fact without losing its green: a reader that returned an
 * empty list would pass every refusal case in this file by finding nothing to
 * object to, and the document would quietly shed a faucet or an invariant.
 * So every refusal case is paired with a positive control that asserts the
 * reader still finds the thing it is supposed to find, by name and by value.
 *
 * THE THIRD EXIT CODE IS THE POINT OF HALF THIS FILE. `check-economics-doc.mjs`
 * exits 2, never 0 and never 1, whenever it could not run: 1 means "I looked
 * and the answer is bad" and 2 means "I could not look", and a red build has to
 * say which. Four separate cases below assert 2 rather than merely non-zero,
 * because "non-zero" is exactly the assertion that would let 2 rot into 1.
 *
 * Run: node scripts/check-economics-doc.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  REGION_NAMES,
  constInitializerText,
  frozenStringSet,
  verifyKeystoneSets,
  ROOT,
  endMarker,
  findRegion,
  invariantChecks,
  occurrenceKeys,
  postingKeys,
  refusalsFrom,
  renderAll,
  seededSystemAccounts,
  startMarker,
} from "./generate-economics-doc.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, "check-economics-doc.mjs");
const GENERATOR = path.join(HERE, "generate-economics-doc.mjs");

let run = 0;
const check = (name, fn) => {
  fn();
  run += 1;
  console.log(`  PASS  ${name}`);
};

console.log("\ncheck-economics-doc: the generated regions still say what the code does\n");

// ── The file itself ─────────────────────────────────────────────────────────

check("the generator carries NO shebang, which a CRLF checkout would break", () => {
  // Same rule and same reason as scripts/generate-token-doc.mjs: this file is
  // imported as well as executed, and a shebang plus CRLF makes a bundler's
  // transform throw. Asserted rather than trusted to a comment.
  const first = fs.readFileSync(GENERATOR, "utf8").split("\n")[0];
  assert.ok(!first.startsWith("#!"), `generate-economics-doc.mjs must not start with a shebang, got: ${first}`);
});

// ── The readers can still see ───────────────────────────────────────────────

check("READER: occurrenceKeys finds the quest key and renders its real shape", () => {
  const keys = occurrenceKeys(ROOT);
  const quest = keys.find((k) => k.name === "questCompleted");
  assert.ok(quest, `keys.questCompleted is gone from the reader's view; it found: ${keys.map((k) => k.name).join(", ")}`);
  // Both segments of this pin moved on 2026-09-03 and the reason is in each
  // half. `esc(...)` because a colon in an id used to move the boundary
  // between two segments and collapse two occurrences into one key (W3 F18,
  // ECONOMICS.md 10.16); `:<esc(tokenSlug)>` because the two mint sites used
  // to append the slug AFTER the builder returned, unescaped, so the shape
  // this reader printed was one the ledger never held (W3 F10).
  assert.strictEqual(
    quest.shape,
    "quest.completed:<esc(v)>:<esc(questId)>:<esc(claimId)>:<esc(userId)>:<esc(tokenSlug)>",
  );
  // The seat key's spelling is load-bearing (renaming it repays every seat), so
  // it is pinned here as well as described in the document.
  const seat = keys.find((k) => k.name === "roleCycle");
  assert.ok(seat, "keys.roleCycle is gone from the reader's view");
  assert.strictEqual(
    seat.shape,
    "role.cycle:<esc(v)>:<esc(cycleKey)>:<esc(seatId)>:<esc(userId)>:<esc(tokenSlug)>",
  );
  assert.ok(keys.length >= 8, `expected at least 8 occurrence keys, read ${keys.length}`);
});

check("READER: invariantChecks pairs every boot read with the refusal it produces", () => {
  const checks = invariantChecks(ROOT);
  assert.ok(checks.length >= 6, `expected at least 6 boot invariants, read ${checks.length}`);
  const all = checks.map((c) => c.message).join("\n");
  // Conservation itself, by name. If this sentence stops being found, the
  // document's central claim is being printed by a reader that cannot see it.
  assert.match(all, /conservation broken for/, "the conservation refusal is no longer being read");
  assert.match(all, /cache drift/, "the cache-drift refusal is no longer being read");
  assert.match(all, /this platform must never move it/, "the hypha refusal is no longer being read");
  // Every entry must carry the SQL it came from, or the "reads" column is a guess.
  for (const c of checks) {
    assert.ok(/select/i.test(c.sql), `an invariant was paired with something that is not a read: ${c.sql.slice(0, 80)}`);
  }
});

check("READER: invariantChecks separates a boot REFUSAL from a reported FINDING", () => {
  // The seventh read, added by the gratitude charge-without-delivery fix,
  // pushes into `uncredited` rather than `problems` and is deliberately not
  // part of `ok`. The reader must carry that difference into the document:
  // calling a loss a boot refusal, or a boot refusal a loss, are both worse
  // than not rendering.
  const checks = invariantChecks(ROOT);
  const refusing = checks.filter((c) => c.refusesBoot);
  const reporting = checks.filter((c) => !c.refusesBoot);
  assert.ok(refusing.length >= 6, `expected at least 6 boot refusals, read ${refusing.length}`);
  assert.ok(reporting.length >= 1, "the uncredited finding must be read as NOT refusing boot");
  assert.match(reporting.map((c) => c.message).join("\n"), /charged .* and delivered nothing/);
  // Every finding names the accumulator it lands in, which is what the
  // refusesBoot flag is derived from.
  for (const c of checks) assert.ok(c.into, "every finding must name the accumulator it was pushed into");
  assert.ok(refusing.every((c) => c.into === "problems"), "boot refusals come from `problems`");
});

check("READER: the seventh read's placeholders name the COLUMN, not the coercion", () => {
  // `${Number(lost[0].units)}` must render as <units>, not as
  // <Number(lost[0].units)>, and `${new Date(lost[0].last_at).toISOString()}`
  // as <last_at>, not <toISOString>. A founder reads this table.
  const lost = invariantChecks(ROOT).find((c) => !c.refusesBoot);
  assert.ok(lost, "the reported finding is gone from the reader's view");
  assert.match(lost.message, /<units>/, "the summed column must be named");
  assert.match(lost.message, /<last_at>/, "the date column must be named, not the method reading it");
  assert.ok(!/toISOString/.test(lost.message), "the coercion must not reach the document");
  assert.ok(!/Number\(/.test(lost.message), "the coercion must not reach the document");
});

/*
 * Synthetic ledger.ts trees, so the reader's REFUSALS can be exercised without
 * touching server/lib/ledger.ts. The widening that let it read `uncredited`
 * had to not become a licence to guess, and these are the cases that hold that
 * line: a read whose finding cannot be found is still a throw, and so is an
 * `ok` expression the reader cannot follow.
 */
const READER_FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), "economics-reader-"));
let readerSeq = 0;

function ledgerTree(body) {
  readerSeq += 1;
  const root = path.join(READER_FIXTURES, `t${readerSeq}`);
  fs.mkdirSync(path.join(root, "server", "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "server", "lib", "ledger.ts"), body);
  return root;
}

const TWO_READS = `
export async function checkLedgerInvariants(pool: any) {
  const problems: string[] = [];
  const [a] = await pool.query("SELECT slug FROM tokens WHERE bad = 1");
  for (const r of a) problems.push(\`token "\${r.slug}" is bad\`);
  const [b] = await pool.query("SELECT id FROM token_ledger WHERE worse = 1");
  for (const r of b) problems.push(\`row \${r.id} is worse\`);
  return { ok: problems.length === 0, problems };
}
`;

check("READER FIXTURE: a plain two-read function reads as two boot refusals", () => {
  const checks = invariantChecks(ledgerTree(TWO_READS));
  assert.strictEqual(checks.length, 2);
  assert.ok(checks.every((c) => c.refusesBoot), "both come from the accumulator that gates ok");
  assert.strictEqual(checks[0].message, 'token "<slug>" is bad');
  assert.deepStrictEqual(checks.map((c) => c.into), ["problems", "problems"]);
});

check("READER FIXTURE: a read whose finding is missing still THROWS", () => {
  // The anchor rule, unchanged by the widening. This is the exact shape that
  // caught the seventh read before it could print six invariants over seven.
  const body = TWO_READS.replace("for (const r of b) problems.push(`row ${r.id} is worse`);", "");
  assert.throws(
    () => invariantChecks(ledgerTree(body)),
    /runs 2 read\(s\) and produced 1 finding\(s\)/,
    "a read with no finding must refuse, never render the shorter list",
  );
});

check("READER FIXTURE: a second accumulator outside `ok` is read as reported-only", () => {
  const body = TWO_READS
    .replace("const problems: string[] = [];", "const problems: string[] = [];\n  const notes: string[] = [];")
    .replace("for (const r of b) problems.push", "for (const r of b) notes.push")
    .replace("return { ok: problems.length === 0, problems };", "return { ok: problems.length === 0, problems, notes };");
  const checks = invariantChecks(ledgerTree(body));
  assert.strictEqual(checks.length, 2);
  assert.strictEqual(checks[0].refusesBoot, true, "problems gates ok");
  assert.strictEqual(checks[1].refusesBoot, false, "notes does not gate ok");
  assert.strictEqual(checks[1].into, "notes");
});

check("READER FIXTURE: an `ok` the reader cannot follow THROWS rather than guessing", () => {
  // Reporting a loss as a boot refusal, or a refusal as a loss, are both worse
  // than not rendering. So the gating set is derived, and an undecipherable
  // `ok` is a refusal to render rather than a default.
  const body = TWO_READS.replace("return { ok: problems.length === 0, problems };", "return { ok: someFlag, problems };");
  assert.throws(
    () => invariantChecks(ledgerTree(body)),
    /cannot tell which findings refuse boot/,
  );
});

check("READER FIXTURE: no `ok` property at all THROWS", () => {
  const body = TWO_READS.replace("return { ok: problems.length === 0, problems };", "return { problems };");
  assert.throws(() => invariantChecks(ledgerTree(body)), /no longer returns an object literal with an `ok` property/);
});

check("READER FIXTURE: a finding built from a variable THROWS, not half a sentence", () => {
  const body = TWO_READS.replace("problems.push(`row ${r.id} is worse`)", "problems.push(someMessage)");
  assert.throws(() => invariantChecks(ledgerTree(body)), /the reader cannot print what it found/);
});

fs.rmSync(READER_FIXTURES, { recursive: true, force: true });

/*
 * ── F7: the keystone sets are read for their VALUE, not their source shape ──
 *
 * generate-token-doc.mjs's `setConst` takes the FIRST array literal in the
 * initialiser, so a `.concat`, a `.filter`, or an environment-keyed ternary
 * passes it unchanged while the program holds a different set. The adversary
 * pass drove all three past both doc guards and past the payments.test.ts pin,
 * which compares the set inside a process that identifies itself as the test
 * environment and so cannot see the ternary at all.
 */
const KEYSTONE_SETS = [
  ["server/lib/ledger.ts", "ALLOW_NEGATIVE_SOURCES"],
  ["server/lib/spending.ts", "SENDABLE_KINDS"],
  ["server/lib/spending.ts", "MODULE_VOUCHERS"],
];

function setFixture(label, initializer) {
  const root = path.join(READER_FIXTURES, `set-${label}`);
  fs.mkdirSync(path.join(root, "server", "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "server", "lib", "ledger.ts"),
    `export const ALLOW_NEGATIVE_SOURCES: ReadonlySet<string> = ${initializer};\n`,
  );
  return root;
}

check("F7 READER: the plain documented shape is accepted, and its values read", () => {
  for (const [file, name] of KEYSTONE_SETS) {
    const v = frozenStringSet(ROOT, file, name);
    assert.ok(Array.isArray(v) && v.length > 0, `${name} must read as a non-empty list`);
    assert.ok(v.every((x) => typeof x === "string"), `${name} must read as strings`);
  }
  assert.deepStrictEqual(
    frozenStringSet(ROOT, "server/lib/ledger.ts", "ALLOW_NEGATIVE_SOURCES").sort(),
    ["payment_reversal", "reversal", "stay_night"],
  );
});

check("F7 READER: .concat, an env ternary, and .filter are all REFUSED", () => {
  // The three shapes from the report, each of which passed both doc guards.
  const attacks = {
    concat: 'new Set(["a", "b"].concat(["spend"]))',
    ternary: 'new Set(process.env.NODE_ENV === "test" ? ["a", "b"] : ["a", "b", "spend"])',
    filter: 'new Set(["a", "b"].filter((s) => s !== "b"))',
  };
  for (const [label, init] of Object.entries(attacks)) {
    assert.throws(
      () => frozenStringSet(setFixture(label, init), "server/lib/ledger.ts", "ALLOW_NEGATIVE_SOURCES"),
      (err) => {
        assert.match(String(err.message), /accepts exactly two shapes/);
        assert.match(String(err.message), /It found:/, "the refusal must print the shape it saw");
        return true;
      },
      `${label} must be refused`,
    );
  }
});

check("F7 READER: a spread, a non-literal element, a second argument, and an empty set are REFUSED", () => {
  const attacks = {
    spread: 'new Set([...BASE, "spend"])',
    identifier: 'new Set(["a", SOME_CONST])',
    notaset: '["a", "b"]',
    objectfreeze: 'Object.freeze(new Set(["a", "b"]))',
    frozenConcat: 'frozenSet(["a", "b"].concat(["spend"]))',
    frozenSpread: "frozenSet([...BASE])",
    empty: "new Set([])",
    frozenEmpty: "frozenSet([])",
  };
  for (const [label, init] of Object.entries(attacks)) {
    assert.throws(
      () => frozenStringSet(setFixture(label, init), "server/lib/ledger.ts", "ALLOW_NEGATIVE_SOURCES"),
      /accepts exactly two shapes/,
      `${label} must be refused`,
    );
  }
  // `Object.freeze(new Set([...]))` is refused DELIBERATELY. The keystone lane
  // seals these sets with `frozenSet`, which is accepted below; a different
  // wrapper is a different decision and gets a reviewed one-line addition
  // rather than being inferred.
});

check("F7 READER: frozenSet([...]) is ACCEPTED and reads the same list as new Set", () => {
  // The keystone lane closes F14 by making these sets refuse mutation:
  // frozenSet returns a Set whose add, delete and clear throw. It changes what
  // the value can DO, not what it IS, so moving to it must not change a single
  // line of either document.
  const plain = frozenStringSet(setFixture("ok-plain", 'new Set(["a", "b"])'), "server/lib/ledger.ts", "ALLOW_NEGATIVE_SOURCES");
  const sealed = frozenStringSet(setFixture("ok-frozen", 'frozenSet(["a", "b"])'), "server/lib/ledger.ts", "ALLOW_NEGATIVE_SOURCES");
  assert.deepStrictEqual(sealed, ["a", "b"]);
  assert.deepStrictEqual(sealed, plain, "sealing a set must not change the list either document prints");
});

check("F7 RUNTIME: the value under NODE_ENV=production equals the documented list", () => {
  // The half a static reader cannot cover. The declaration is evaluated in a
  // subprocess that identifies itself as PRODUCTION, because payments.test.ts
  // compares the same set inside a process that says NODE_ENV=test, and an
  // environment-keyed set is identical in the two and different in the one
  // that matters.
  for (const [file, name] of KEYSTONE_SETS) {
    const src = constInitializerText(ROOT, file, name);
    // `frozenSet` is the keystone lane's sealing wrapper, and this subprocess
    // is a bare node with none of the module around it, so the name has to be
    // supplied or the probe fails to evaluate rather than reporting a value.
    // A shim is honest here for the same reason the reader above accepts the
    // real one: sealing changes what the value can DO, not what it IS, and
    // this case measures the VALUE. The shim cannot widen the gate either,
    // because `frozenStringSet` has already refused every initialiser shape
    // but the two literal ones before this line runs. That `add` throws is
    // measured where it belongs, in server/ledger.test.ts.
    const shim = "const frozenSet = (values) => new Set(values);";
    const probe = `${shim}process.stdout.write(JSON.stringify(Array.from(${src}).sort()));`;
    const r = spawnSync(process.execPath, ["-e", probe], {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production", VITEST: "" },
    });
    assert.strictEqual(r.status, 0, `evaluating ${name} failed:\n${r.stdout}${r.stderr}`);
    assert.deepStrictEqual(
      JSON.parse(r.stdout),
      frozenStringSet(ROOT, file, name).sort(),
      `${name} holds a different value at runtime under NODE_ENV=production than the document prints`,
    );
  }
});

check("F7: verifyKeystoneSets throws when the two readers disagree", () => {
  // The cross-check itself. If setConst and the strict reader ever report
  // different lists for a shape neither refused, the document cannot be
  // written from either without choosing, and this refuses to choose.
  assert.throws(
    () => verifyKeystoneSets(ROOT, { allowNegative: ["stay_night"], sendableKinds: ["credit"], moduleVouchers: [] }),
    /the two readers disagree about ALLOW_NEGATIVE_SOURCES/,
  );
});

/*
 * ── F10: the key table is read from the CALL SITES, not from `keys` ────────
 */
check("F10 READER: the two mint keys carry the :<tokenSlug>, now from the builder", () => {
  // The exact defect: the document printed the builder's output for the two
  // highest-volume mints, and the ledger held that string plus the slug,
  // which the call sites appended after the builder returned.
  //
  // THE SLUG IS A BUILDER PARAMETER NOW (keystone lane, W3 F18): appending it
  // outside also meant it went in unescaped, so a colon in a token slug moved
  // the boundary between two segments. What this case pins is unchanged, and
  // it is the thing that matters: the slug is IN the key the ledger holds.
  // Both readers agree on that string today, which is what closed F10.
  const shapes = new Set(postingKeys(ROOT).sites.map((s) => s.shape));
  assert.ok(
    shapes.has("quest.completed:<esc(v)>:<esc(questId)>:<esc(claimId)>:<esc(userId)>:<esc(tokenSlug)>"),
    "the quest mint key must carry the token slug",
  );
  assert.ok(
    shapes.has("role.cycle:<esc(v)>:<esc(cycleKey)>:<esc(seatId)>:<esc(userId)>:<esc(tokenSlug)>"),
    "the settlement key must carry the token slug",
  );
  // And the bare builder output must NOT be presented as a key the ledger holds.
  assert.ok(!shapes.has("quest.completed:<v>:<questId>:<claimId>:<userId>"), "the bare builder shape is not a key");
  assert.ok(!shapes.has("role.cycle:<v>:<cycleKey>:<seatId>:<userId>"), "the bare builder shape is not a key");
});

check("F10 READER: the hand-written keys the old table omitted are all present", () => {
  const shapes = new Set(postingKeys(ROOT).sites.map((s) => s.shape));
  for (const wanted of [
    "voice-claim-settled:<villageId()>:<claimId>",
    "voice-claim-debit:<villageId()>:<claimId>",
    "ord:<orderId>:reversal-leg1",
    "exit:<exitId>:sweep:<token>",
    // `gratitude_received:<id>` was on this list until 0160. It was the key
    // `server/lib/gratitude.ts` built by hand, and the allowance's refund arm
    // could never find it, so a gift made through the acknowledgement door was
    // reversible and refunded the giver nothing. That door posts under
    // `keys.gratitudeGiven` now and the shape is gone from the ledger. The
    // entry is removed rather than replaced: this list exists to prove the
    // reader sees keys that no builder produces, and there is no longer a
    // hand-written one in that file to name.
    "loan:<loanId>:settle:release",
    "seat:<eventId>:<occurrenceKey>:<userId>:<chargeSeq>:pay",
    "stay:<id>:night:<night>",
  ]) {
    assert.ok(shapes.has(wanted), `${wanted} is written by the code and missing from the key table`);
  }
  assert.ok(shapes.size >= 40, `expected the ledger to hold at least 40 shapes, read ${shapes.size}`);
});

check("F10 READER: a forwarded key is counted, not printed as a shape", () => {
  // `mint()` hands on `input.idempotencyKey`. That is the caller's key, and
  // every caller is read separately, so printing it as a shape would invent one.
  const { forwarded, sites } = postingKeys(ROOT);
  assert.ok(forwarded >= 1, "the forwarding sites must be recognised rather than refused");
  assert.ok(!sites.some((s) => /idempotencyKey/.test(s.shape)), "a forwarded key must not reach the table");
});

check("F10 READER: a key it cannot resolve is a THROW naming the site", () => {
  // The whole point. A key table missing a key is the defect this replaces, so
  // an unreadable site refuses rather than being skipped.
  const root = path.join(READER_FIXTURES, "unreadable-key");
  fs.mkdirSync(path.join(root, "server", "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "server", "lib", "economy.ts"),
    "export const keys = { a: (v: string) => `a:${v}` };\n" +
      "export async function pay(pool: any, secret: string) {\n" +
      "  return postTransfer(pool, { idempotencyKey: someImportedThing(secret) });\n" +
      "}\n",
  );
  assert.throws(
    () => postingKeys(root),
    (err) => {
      assert.match(String(err.message), /writes an idempotency key this reader cannot resolve/);
      assert.match(String(err.message), /server\/lib\/economy\.ts:3/, "the refusal must name file and line");
      assert.match(String(err.message), /someImportedThing/, "the refusal must print the expression");
      return true;
    },
  );
});

check("F10 READER: a builder that is not in `keys` is a THROW, not a silent gap", () => {
  const root = path.join(READER_FIXTURES, "unknown-builder");
  fs.mkdirSync(path.join(root, "server", "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "server", "lib", "economy.ts"),
    "export const keys = { a: (v: string) => `a:${v}` };\n" +
      "export async function pay(pool: any) {\n" +
      "  return postTransfer(pool, { idempotencyKey: keys.notARealBuilder('x') });\n" +
      "}\n",
  );
  assert.throws(() => postingKeys(root), /is not in the\s+`keys` object this reader read/);
});

check("F10 READER: the tokenSlug suffix is found wherever it is written", () => {
  // The keystone lane may move the `:${slug}` inside the builders. Both
  // arrangements must produce the same final shape, or this reader would go
  // red on a change that alters nothing the ledger sees.
  const mk = (label, keysDecl, callSite) => {
    const root = path.join(READER_FIXTURES, label);
    fs.mkdirSync(path.join(root, "server", "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "server", "lib", "economy.ts"),
      `export const keys = { q: ${keysDecl} };\n` +
        "export async function pay(pool: any, r: any) {\n" +
        `  return postTransfer(pool, { idempotencyKey: ${callSite} });\n` +
        "}\n",
    );
    return postingKeys(root).sites.map((s) => s.shape);
  };
  const atCallSite = mk("suffix-callsite", "(v: string, q: string) => `quest:${v}:${q}`", "`${keys.q(villageId(), r.questId)}:${r.tokenSlug}`");
  const inBuilder = mk("suffix-builder", "(v: string, q: string, tokenSlug: string) => `quest:${v}:${q}:${tokenSlug}`", "keys.q(villageId(), r.questId, r.tokenSlug)");
  assert.deepStrictEqual(atCallSite, ["quest:<v>:<q>:<tokenSlug>"]);
  assert.deepStrictEqual(inBuilder, ["quest:<v>:<q>:<tokenSlug>"]);
  assert.deepStrictEqual(atCallSite, inBuilder, "moving the suffix into the builder must not change the shape");
});

check("READER: refusalsFrom reads BOTH branches of a ternary refusal", () => {
  // This is the case that caught the first draft of the reader: sendRefusal
  // returns two of its sentences out of a ternary, and a reader that skipped
  // what it could not resolve dropped the recognition refusal, which is the
  // single most load-bearing sentence in the send path, while still printing a
  // list that looked complete.
  const send = refusalsFrom(ROOT, "server/lib/spending.ts", "sendRefusal");
  const joined = send.join("\n");
  assert.match(joined, /recognition is a record of what happened/, "the ternary's TRUE branch was dropped");
  assert.match(joined, /is not a token members send to each other/, "the ternary's FALSE branch was dropped");
  assert.ok(send.length >= 8, `sendRefusal has at least 8 sentences, the reader found ${send.length}`);
});

check("READER: refusalsFrom joins a refusal wrapped across a + concatenation", () => {
  // checkGive's share refusal is one sentence written across two template
  // literals to fit the line. Half a sentence in the document is worse than
  // none, so the join is asserted on its real text.
  const give = refusalsFrom(ROOT, "server/lib/economy.ts", "checkGive");
  const share = give.find((s) => s.includes("is the most you can give one person"));
  assert.ok(share, `the share refusal is gone from the reader's view; it found: ${give.join(" | ")}`);
  assert.match(share, /That leaves <left> for them$/, "the second half of the concatenated refusal was lost");
});

check("READER: pointed at a function that yields no sentence, it THROWS", () => {
  // `sendableTokens` returns a filtered list, not a refusal. Whichever guard
  // fires first (the unreadable-return one or the found-nothing one), the
  // requirement is the same and it is the whole reason the readers are
  // written this way: a reader that found nothing must say so rather than
  // report an empty list, which would render as a section that lost its
  // contents while still looking deliberate.
  assert.throws(
    () => refusalsFrom(ROOT, "server/lib/spending.ts", "sendableTokens"),
    (err) => {
      assert.match(String(err.message), /economics-doc:/);
      assert.match(String(err.message), /sendableTokens/, "the error must name the function it could not read");
      return true;
    },
  );
});

check("READER: a reader whose anchor is gone throws, naming what it wanted", () => {
  assert.throws(
    () => refusalsFrom(ROOT, "server/lib/spending.ts", "aFunctionThatDoesNotExist"),
    /no longer declares function aFunctionThatDoesNotExist/,
  );
});

// ── findRegion ──────────────────────────────────────────────────────────────

const wrap = (name, body) => `${startMarker(name)}\n${body}\n${endMarker(name)}`;

check("findRegion reads the body between the markers", () => {
  const r = findRegion(`before\n${wrap("tokens", "the body")}\nafter`, "tokens");
  assert.strictEqual(r.body, "the body");
});

check("findRegion calls a MISSING marker a problem, never an empty region", () => {
  // The whole pipeline turns on this. An empty region would compare equal to
  // nothing, so deleting the markers would delete a table the code still
  // guarantees and the guard would call it a pass.
  const r = findRegion("a document with no markers at all", "tokens");
  assert.ok(r.problem, "a missing marker must be a problem");
  assert.match(r.problem, /is not in the document/);
  assert.strictEqual(r.body, undefined);
});

check("findRegion refuses a start marker with no end", () => {
  const r = findRegion(`${startMarker("tokens")}\nbody but no close`, "tokens");
  assert.match(r.problem, /is there but .* is not/);
});

check("findRegion refuses a DUPLICATED marker", () => {
  // Two copies of a region is two answers to one question, and the splice
  // would silently write only the first.
  const twice = `${wrap("tokens", "a")}\n${wrap("tokens", "b")}`;
  assert.match(findRegion(twice, "tokens").problem, /appears more than once/);
});

// ── The gate, against real documents, reading the exit code ─────────────────

const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), "economics-doc-test-"));

/**
 * spawnSync, not execFileSync: execFileSync throws away stderr on a SUCCESSFUL
 * run, and both streams matter here because the guard prints its verdict on
 * stdout and any escape on either.
 */
function runGuard(args) {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

/** A whole document with every region rendered from the REAL code. */
const rendered = renderAll(ROOT);
const goodDoc = [
  "# a fixture document",
  "",
  "Prose the guard must not care about.",
  "",
  ...REGION_NAMES.map((n) => `${wrap(n, rendered[n])}\n`),
  "More prose.",
].join("\n");

function docAt(label, text) {
  const dir = path.join(FIXTURES, label);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "ECONOMICS.md");
  if (text !== null) fs.writeFileSync(p, text);
  return p;
}

check("FIXTURE: a document matching the code exits 0 and says how many regions", () => {
  const { code, out } = runGuard(["--doc", docAt("match", goodDoc)]);
  assert.strictEqual(code, 0, out);
  assert.match(out, /Economics doc guard passed/);
  // "none found" must never read as success, so the count is part of the pass.
  assert.match(out, new RegExp(`${REGION_NAMES.length} generated region\\(s\\) match`));
});

check("FIXTURE: a DRIFTED region exits 1 and prints BOTH sides", () => {
  const drifted = goodDoc.replace("| `credits` |", "| `credits-renamed-by-hand` |");
  assert.notStrictEqual(drifted, goodDoc, "the fixture must actually differ, or this proves nothing");
  const { code, out } = runGuard(["--doc", docAt("drift", drifted)]);
  assert.strictEqual(code, 1, out);
  assert.match(out, /have come apart/);
  assert.match(out, /the code says:.*`credits`/, "the generated side must be printed");
  assert.match(out, /the file says:.*credits-renamed-by-hand/, "the committed side must be printed");
  assert.match(out, /generated:tokens/, "the failing region must be named");
  assert.match(out, /node scripts\/generate-economics-doc\.mjs/, "the way out must be printed");
});

check("FIXTURE: drift in a LATER region is found too, not just the first", () => {
  // A guard that stopped at the first region would pass a document whose last
  // table was rewritten by hand, and the last table is the one nobody rereads.
  const last = REGION_NAMES[REGION_NAMES.length - 1];
  const drifted = goodDoc.replace(rendered[last], `${rendered[last]}\n\nA line somebody typed.`);
  const { code, out } = runGuard(["--doc", docAt("drift-last", drifted)]);
  assert.strictEqual(code, 1, out);
  assert.match(out, new RegExp(`generated:${last}`));
});

check("FIXTURE: a MISSING marker exits 2, not 1, and names every missing region", () => {
  const stripped = goodDoc.replace(startMarker("faucets"), "").replace(endMarker("faucets"), "");
  const { code, out } = runGuard(["--doc", docAt("nomarker", stripped)]);
  assert.strictEqual(code, 2, `a missing marker must be 2 (could not look), not 1 (looked and it was bad). Got ${code}:\n${out}`);
  assert.match(out, /cannot be found, so the check did not run/);
  assert.match(out, /generated:faucets/);
  assert.match(out, /Exit 2: nothing was compared/);
});

check("FIXTURE: a DUPLICATED marker exits 2", () => {
  const doubled = goodDoc.replace(endMarker("tokens"), `${endMarker("tokens")}\n${startMarker("tokens")}`);
  const { code, out } = runGuard(["--doc", docAt("dupmarker", doubled)]);
  assert.strictEqual(code, 2, out);
  assert.match(out, /appears more than once/);
});

check("FIXTURE: a MISSING document exits 2, not 1", () => {
  const gone = path.join(FIXTURES, "absent", "ECONOMICS.md");
  fs.mkdirSync(path.dirname(gone), { recursive: true });
  const { code, out } = runGuard(["--doc", gone]);
  assert.strictEqual(code, 2, out);
  assert.match(out, /is not there/);
  assert.match(out, /has not "drifted"/);
});

check("FIXTURE: sources it cannot read exit 2, and the DOCUMENT is not blamed", () => {
  // The failure mode this pins: a rename in server/lib/ making the guard red
  // with a message telling somebody to regenerate a document that was never
  // the problem. The sources are read BEFORE the document is opened, so the
  // message names the code.
  const emptyTree = path.join(FIXTURES, "empty-root");
  fs.mkdirSync(emptyTree, { recursive: true });
  const { code, out } = runGuard(["--root", emptyTree, "--doc", docAt("orphan", goodDoc)]);
  assert.strictEqual(code, 2, out);
  assert.match(out, /could not be regenerated, so it cannot be checked/);
  assert.match(out, /is gone; the generator reads it/, "the missing SOURCE must be named");
  assert.match(out, /nothing was compared/);
});

check("FIXTURE: CRLF line endings compare equal to LF", () => {
  // core.autocrlf is true on the Windows checkouts this repository is
  // developed on, and the same carriage-return class has produced a
  // per-machine answer in this repository's guards twice before.
  const crlf = goodDoc.replace(/\n/g, "\r\n");
  const { code, out } = runGuard(["--doc", docAt("crlf", crlf)]);
  assert.strictEqual(code, 0, `a Windows checkout must read the same as a Linux one:\n${out}`);
});

check("READER: the vault list is DERIVED from the migrations, not kept in the generator", () => {
  // THE SECOND FORM OF THE SAME BLIND SPOT. The faucets region named four vault
  // accounts one at a time inside the generator while `drizzle/` seeded eleven,
  // so a table a reader trusts BECAUSE it is generated described four of the
  // eleven places value can sit. `sys:voice-decay` had been missing since 0165;
  // `sys:redemption-hold` and `sys:redeemed` arrived in 0161 and did not reach
  // it either. A hand-kept list inside a generator is identical on both sides of
  // the guard's comparison however incomplete it is.
  //
  // The positive control is the point: this asserts the reader still FINDS the
  // accounts, by name and by flag, so a reader that silently returned nothing
  // would fail here instead of quietly emptying the table.
  const accounts = seededSystemAccounts(ROOT);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const id of ["sys:gratitude-pool", "sys:cycle-pool", "sys:mint", "sys:library-mint", "sys:voice-mint"]) {
    assert.strictEqual(byId.get(id)?.faucet, true, `${id} must read as a faucet`);
  }
  for (const id of ["sys:treasury", "sys:exit-settlement", "sys:voice-decay", "sys:event-escrow"]) {
    assert.strictEqual(byId.get(id)?.faucet, false, `${id} must read as a vault and never as a faucet`);
  }
  // Every non-faucet seed reaches the rendered table. This is the assertion the
  // old hand-kept list could not have made about itself.
  const body = rendered.faucets;
  for (const a of accounts.filter((x) => !x.faucet)) {
    assert.ok(body.includes(`\`${a.id}\``), `${a.id} is seeded by ${a.from} and is missing from the vault table`);
  }
  // And nothing that IS a faucet is listed as one that never goes below zero,
  // which would be the same defect pointing the other way and is the dangerous
  // direction: a faucet's negative balance is its issued supply.
  const vaultBlock = body.slice(body.indexOf("never go below zero"));
  for (const a of accounts.filter((x) => x.faucet)) {
    assert.ok(!vaultBlock.includes(`\`${a.id}\``), `${a.id} is a faucet and must not be in the vault table`);
  }
});

check("PROSE: every count a region states equals the table it prints", () => {
  // THE ONE FAILURE THIS GUARD IS STRUCTURALLY BLIND TO, and it shipped.
  //
  // The guard compares a GENERATED region to a COMMITTED one, so a sentence
  // hardcoded inside the generator is identical on both sides and passes
  // forever however wrong it is. The triggers region said `keys` "builds eight
  // of them" over a table it derives, and that table has printed NINE rows
  // since `voiceClaim` was added: the count was a string literal beside a
  // derived list. Nothing above could see it. The reader check for the same
  // region asserts `keys.length >= 8`, which is a lower bound and so cannot
  // notice the sentence and the table disagreeing either.
  //
  // The rule this pins is general and cheap: a region that STATES a number
  // must state the number of the rows it went on to print.
  const body = rendered.triggers;
  const stated = body.match(/builds (\d+) of them/);
  assert.ok(stated, `the triggers region must state its builder count as a NUMERAL it derived, not a word:\n${body.slice(0, 400)}`);
  // The builder table is the first one in the region: header, separator, rows.
  const lines = body.split("\n");
  const head = lines.findIndex((l) => l.startsWith("| Builder |"));
  assert.ok(head > 0, "the builder table is gone from the triggers region");
  let rows = 0;
  for (let i = head + 2; i < lines.length && lines[i].startsWith("|"); i++) rows++;
  assert.strictEqual(
    Number(stated[1]),
    rows,
    `the triggers region says it builds ${stated[1]} keys and prints ${rows} rows`,
  );
});

check("FIXTURE: the real committed document matches the real code", () => {
  // The positive control for the whole file. Every case above builds its own
  // fixture, so all of them could pass against a repository whose actual
  // document had drifted.
  const { code, out } = runGuard([]);
  assert.strictEqual(code, 0, `docs/ECONOMICS.md has drifted from the code:\n${out}`);
});

fs.rmSync(FIXTURES, { recursive: true, force: true });

console.log(`\n${run} check(s) passed\n`);

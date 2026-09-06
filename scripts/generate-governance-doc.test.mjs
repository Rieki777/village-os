/**
 * The governance generator's own guard.
 *
 * docs/GOVERNANCE.md is only worth trusting because a build step regenerates
 * it and compares. That step is worth exactly as much as the readers behind
 * it, so this file tests them on the cases that would let the document be
 * wrong QUIETLY:
 *
 *   - a subject type the close dispatcher executes and nothing describes. The
 *     dispatcher is the one table that says whether a member's vote binds, and
 *     a row rendering with a blank meaning is a village told nothing about the
 *     most consequential thing on the page.
 *   - a description left behind by a subject type that went away, which is the
 *     quieter half and the one a coverage check in one direction misses.
 *   - a Governance dial this document has never been written against. Most of
 *     the staged rulings arrive as a dial, so a new key is the first sign a
 *     status line here has gone stale.
 *   - a route whose door the reader cannot classify. It must SAY so and never
 *     guess, because a guessed door on a public route is the failure the
 *     document exists to prevent.
 *   - human prose that breaks the house writing rules, run through the same
 *     `checkSpan` the voice guard uses. The founder's quotes are exempt and
 *     the exemption is asserted, so the exemption cannot quietly widen.
 *   - determinism, because a byte comparison is the whole mechanism and a
 *     timestamp anywhere in the output would make every run a false failure.
 *
 * No village's name appears here: this file lives under scripts/, where the
 * brand guard scans.
 *
 * Run: node scripts/generate-governance-doc.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import {
  KNOWN_DIALS,
  LINEAGE_SOURCES,
  PROSE,
  RULINGS,
  SUBJECT_WORDS,
  WITHDRAWN,
  classifyDoor,
  collectFacts,
  dialCoverageProblem,
  generate,
  namedDialProblem,
  proseCoverageProblem,
  quorumSentence,
  renderLineage,
  schemaFacts,
  subjectCoverageProblem,
} from "./generate-governance-doc.mjs";
import { checkSpan } from "./check-voice.mjs";

let run = 0;
const check = (name, fn) => { fn(); run += 1; console.log(`  PASS  ${name}`); };

console.log("\ngenerate-governance-doc: the coverage refusals\n");

check("a subject type the dispatcher executes and nothing describes stops the build", () => {
  const problem = subjectCoverageProblem(["mechanics", "changeset"], { mechanics: "..." });
  assert.ok(problem, "an undescribed subject type must refuse");
  assert.ok(/changeset/.test(problem), problem);
  assert.ok(/SUBJECT_WORDS/.test(problem), "the message must name where to fix it");
});

check("a description whose subject type is gone stops the build", () => {
  const problem = subjectCoverageProblem(["mechanics"], { mechanics: "...", vanished: "..." });
  assert.ok(problem && /vanished/.test(problem), problem);
});

check("the real dispatcher is fully described in both directions", () => {
  const f = collectFacts();
  assert.strictEqual(subjectCoverageProblem(f.dispatcher.all), null);
});

check("a Governance dial this document has never seen stops the build", () => {
  const problem = dialCoverageProblem(["governance.unity_pct", "governance.criticality_tier"], ["governance.unity_pct"]);
  assert.ok(problem, "an unknown dial must refuse");
  assert.ok(/criticality_tier/.test(problem), problem);
  assert.ok(/KNOWN_DIALS/.test(problem), "the message must name where to fix it");
});

check("a dial this document described and the registry dropped stops the build", () => {
  const problem = dialCoverageProblem(["governance.unity_pct"], ["governance.unity_pct", "governance.gone"]);
  assert.ok(problem && /governance\.gone/.test(problem), problem);
});

check("the real Governance category matches KNOWN_DIALS", () => {
  const f = collectFacts();
  assert.strictEqual(dialCoverageProblem(f.dials.all.map((d) => d.key)), null);
  assert.ok(KNOWN_DIALS.length > 0);
});

console.log("\ngenerate-governance-doc: reading a route's door\n");

check("a handler that reads nobody answers a stranger", () => {
  assert.deepStrictEqual(classifyDoor("async (req, res) => { res.json(await rows()); }"), {
    door: "anyone, including a stranger",
    capability: null,
  });
});

check("a handler that refuses without a session asks for a signed-in member", () => {
  const body = 'async (req, res) => { const user = await authedUser(req); if (!user) return res.status(401).json({}); }';
  assert.strictEqual(classifyDoor(body).door, "signed in");
});

check("a handler that reads a viewer and refuses nobody still answers a stranger", () => {
  const body = "async (req, res) => { const viewer = await authedUser(req); res.json(serve(viewer?.id)); }";
  assert.strictEqual(classifyDoor(body).door, "anyone, including a stranger");
});

check("a capability gate is reported with the key it names", () => {
  const body = 'async (req, res) => { const verdict = await mayAct(req, "proposal.decide"); }';
  assert.deepStrictEqual(classifyDoor(body), { door: "capability", capability: "proposal.decide" });
});

check("an administrator gate outranks the rest", () => {
  const body = 'async (req, res) => { if (!(await isAdmin(req))) return res.status(403).json({}); const v = await mayAct(req, "dial.set"); }';
  assert.strictEqual(classifyDoor(body).door, "administrator");
});

check("a capability held in a constant is reported, resolved through the resolver", () => {
  // `mayAct(req, STEWARD_VETO)` is the shape the veto routes use. A pattern
  // matching only the string literal read them as ungated.
  const body = "async (req, res) => { const verdict = await mayAct(req, STEWARD_VETO); }";
  assert.deepStrictEqual(classifyDoor(body, "req, res", (n) => (n === "STEWARD_VETO" ? "steward.veto" : null)), {
    door: "capability",
    capability: "steward.veto",
  });
  // With nothing able to resolve it, the constant's own name is reported. That
  // is a true statement about the code; a guessed key would not be.
  assert.strictEqual(classifyDoor(body).capability, "STEWARD_VETO");
});

check("a gate extracted into a helper is still a gate", () => {
  // The failure this pins: a route module whose handlers all call one local
  // `gate(req, res)` leaves each handler's own text mentioning nobody, and the
  // veto route was published in this document as open to the internet.
  const handlerAlone = "async (req, res) => { const ok = await gate(req, res); if (!ok) return; }";
  assert.strictEqual(classifyDoor(handlerAlone).door, "anyone, including a stranger");

  const withHelper =
    handlerAlone +
    "\nasync function gate(req, res) { const user = await authedUser(req); if (!user) { res.status(401).json({}); return null; } " +
    'const verdict = await mayAct(req, "steward.veto"); }';
  assert.deepStrictEqual(classifyDoor(withHelper), { door: "capability", capability: "steward.veto" });
});

check("THE REAL VETO ROUTES ARE NOT PUBLISHED AS OPEN TO A STRANGER", () => {
  const f = collectFacts();
  for (const path of ["/api/governance/ballots/:id/veto", "/api/governance/ballots/:id/no-objection"]) {
    const row = f.routes.rows.find((r) => r.path === path);
    assert.ok(row, `${path} is not in the routes the document publishes`);
    assert.notStrictEqual(
      row.door,
      "anyone, including a stranger",
      `${path} keeps a session and a capability, and the document must not say otherwise`,
    );
    assert.strictEqual(row.capability, "steward.veto", `${path} asks for the veto power by name`);
  }
});

check("A DOOR THIS READER CANNOT CLASSIFY SAYS SO AND NEVER GUESSES", () => {
  // The failure this whole classifier exists to avoid: a route that clearly
  // consults who is asking, in a shape none of the rules match. Reporting it
  // as public would put a wrong sentence about who can read a village's votes
  // into a document people trust.
  const body = "async (req, res) => { const who = await capabilityCtx(req); res.json(who); }";
  assert.strictEqual(classifyDoor(body).door, "could not derive");
});

check("the real routes are all classified, and the count is stated", () => {
  const f = collectFacts();
  assert.ok(f.routes.total > 0, "the walk must find routes, not report a clean zero");
  for (const r of f.routes.rows) {
    assert.ok(r.method && r.path.startsWith("/api/"), `a route row is malformed: ${JSON.stringify(r)}`);
  }
});

check("THE WALK READS EVERY ROUTE MODULE ON DISK, NEVER A LIST OF THEM", () => {
  // The failure this replaces: `routeFacts` named three files, four more route
  // modules landed, and the document went on saying delegation was not built
  // while seven delegation routes were serving members. A directory walk cannot
  // go stale that way, so the test is that the walk actually reached files the
  // old list never named.
  const f = collectFacts();
  const files = new Set(f.routes.rows.map((r) => r.file));
  assert.ok(files.size > 2, `the walk read ${files.size} file(s); it should read every module under server/routes`);
  for (const rel of files) {
    assert.ok(
      rel === "server/index.ts" || rel.startsWith("server/routes/"),
      `the walk read something outside the route modules: ${rel}`,
    );
    assert.ok(!/\.(test|spec)\.ts$/.test(rel), `the walk read a test file: ${rel}`);
  }
  assert.ok(
    !f.staged.delegation,
    "delegation has routes on this tree, so the staged flag that reads the walk must be false",
  );
});

console.log("\ngenerate-governance-doc: the schema the document rests on\n");

check("the tables and columns the document states are all present", () => {
  const facts = schemaFacts();
  assert.ok(facts.migrationCount > 0, "the schema reader must read migrations, not report a clean zero");
  assert.ok(facts.shapes.length > 0);
  for (const shape of facts.shapes) {
    assert.ok(shape.name && shape.what, `a schema shape is malformed: ${JSON.stringify(shape)}`);
  }
});

check("a setting the document names by hand and the registry dropped stops the build", () => {
  const problem = namedDialProblem(["governance.veto_hours"], [["governance.gone", "something"]]);
  assert.ok(problem && /governance\.gone/.test(problem), problem);
  assert.strictEqual(namedDialProblem(["governance.here"], [["governance.here", "something"]]), null);
});

console.log("\ngenerate-governance-doc: what quorum counts\n");

check("THE QUORUM SENTENCE IS THE ENGINE'S OWN ARITHMETIC, NOT THE RULING'S WORDS", () => {
  // 19F rules that quorum is pure token weight and 20.8's head-count quorum is
  // withdrawn. `check-governance-doc.mjs` compares the generator to the file and
  // never the prose to the code, so without this the document could go on
  // reciting the ruling for as long as somebody kept regenerating it, whatever
  // `quorumPctOf` had come to do.
  const f = collectFacts();
  const sentence = quorumSentence(f);
  const text = generate();
  assert.ok(text.includes(sentence), "the sentence the reader sees is the sentence this test checks");

  if (f.quorumFormula.weightOnly) {
    assert.ok(/Quorum is weight\./.test(sentence), `the weight-only reading must say so: ${sentence}`);
    for (const field of f.quorumFormula.weightFields) {
      assert.ok(sentence.includes(field), `the sentence must name the weight it adds: ${field}`);
    }
    assert.ok(!/head count[^ ]* [a-z]/.test(sentence.replace("reads no head count at all", "")),
      "a weight-only formula names no head count as a thing it reads");
    assert.strictEqual(f.quorumFormula.headFields.length, 0);
  } else {
    assert.ok(/disagree about quorum/.test(sentence), `a head count in the formula must be stated loudly: ${sentence}`);
  }
});

check("the concentration 19F accepted is stated in the document, not implied", () => {
  const text = generate();
  assert.ok(
    /97 percent of the Voice carries a constitutional change alone/.test(text),
    "19F obliges this document to say plainly what pure weight allows one holder to do",
  );
  assert.ok(/This platform counts accounts/.test(text), "the accounts-are-not-people sentence has to be on the page");
});

console.log("\ngenerate-governance-doc: the lineage\n");

check("the lineage renders into both files from one place", () => {
  const f = collectFacts();
  const doc = generate();
  const shelf = renderLineage(f);
  assert.ok(doc.includes("## Where this comes from"), "the document carries the section");
  assert.ok(shelf.includes("## Where this comes from"), "the shelf carries the same section");
  assert.ok(LINEAGE_SOURCES.length === 3, "the founder named three sources");
  for (const source of LINEAGE_SOURCES) {
    for (const where of [doc, shelf]) {
      assert.ok(where.includes(source.url), `the link to ${source.title} is missing`);
      assert.ok(where.includes(source.copy), `the local copy of ${source.title} is not named`);
    }
    assert.ok(
      fs.existsSync(new URL(`../${source.copy}`, import.meta.url)),
      `${source.copy} is named as a copy a fork can open and does not exist`,
    );
  }
  assert.ok(
    doc.includes("docs/GOVERNANCE_EVOLUTION_PROMPT.md") && shelf.includes("docs/GOVERNANCE_EVOLUTION_PROMPT.md"),
    "the record of the rulings is pointed at from both",
  );
});

check("every withdrawn sentence carries the date it was struck", () => {
  const text = generate();
  assert.ok(WITHDRAWN.length > 0, "the struck history is the point of keeping it");
  for (const w of WITHDRAWN) {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(w.on), `a withdrawal with no date: ${w.what}`);
    assert.ok(w.by && w.now, `a withdrawal with no author or no replacement: ${w.what}`);
    assert.ok(text.includes(`~~${w.what}~~`), `a withdrawn sentence is not struck on the page: ${w.what}`);
    assert.ok(text.includes(`Withdrawn ${w.on} by ${w.by}.`), `a withdrawal does not name when and who: ${w.what}`);
  }
});

console.log("\ngenerate-governance-doc: the written half\n");

check("every entry in PROSE renders, and every marker names an entry", () => {
  assert.strictEqual(proseCoverageProblem(generate()), null);
});

check("a paragraph that renders nowhere stops the build", () => {
  const problem = proseCoverageProblem("# nothing here", { orphan: "..." }, []);
  assert.ok(problem && /orphan/.test(problem), problem);
});

check("a marker naming no entry stops the build", () => {
  const problem = proseCoverageProblem("<!-- written by a person: ghost -->", {}, []);
  assert.ok(problem && /ghost/.test(problem), problem);
});

check("EVERY HUMAN SENTENCE KEEPS THE HOUSE WRITING RULES", () => {
  // The same checkSpan the voice guard runs, applied to the prose store rather
  // than to the rendered file, because the rendered file also carries the
  // founder's own words and those are quoted verbatim.
  const complaints = [];
  const span = (label, text) => {
    for (const hit of checkSpan(text)) complaints.push(`${label}: ${hit[0]} (${hit[1]})`);
  };
  for (const [key, text] of Object.entries(PROSE)) span(`PROSE.${key}`, text);
  for (const [key, text] of Object.entries(SUBJECT_WORDS)) span(`SUBJECT_WORDS.${key}`, text);
  // The struck sentences are somebody's words too, and they render on the page
  // like any other paragraph.
  for (const [i, w] of WITHDRAWN.entries()) {
    span(`WITHDRAWN[${i}].what`, w.what);
    span(`WITHDRAWN[${i}].now`, w.now);
  }
  const facts = collectFacts();
  for (const r of RULINGS) {
    span(`ruling ${r.id} title`, r.title);
    span(`ruling ${r.id} note`, r.note(facts));
  }
  assert.strictEqual(complaints.length, 0, `\n    ${complaints.join("\n    ")}\n`);
});

check("the founder's words are quoted verbatim and marked as his", () => {
  const text = generate();
  for (const r of RULINGS) {
    assert.ok(r.quotes.length > 0, `ruling ${r.id} carries no quote`);
    for (const q of r.quotes) {
      assert.ok(text.includes(`> ${q.replace(/\n/g, " ")}`), `ruling ${r.id}'s quote is not reproduced exactly`);
    }
  }
  const marked = text.match(/<!-- the founder's own words -->/g) ?? [];
  const quoted = RULINGS.reduce((n, r) => n + r.quotes.length, 0);
  assert.strictEqual(marked.length, quoted, "every quote carries its own marker and nothing else does");
});

check("every ruling states a status, a date and where the status came from", () => {
  const facts = collectFacts();
  const text = generate();
  for (const r of RULINGS) {
    const label = r.status(facts);
    assert.ok(
      /\*\*(Built|Half built|Staged|Withdrawn)/.test(label),
      `ruling ${r.id} has no recognisable status: ${label}`,
    );
    assert.ok(r.dates.length > 0 && r.dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), `ruling ${r.id} has no date`);
    const heading = `### ${r.id}. ${r.title}`;
    assert.ok(text.includes(heading), `ruling ${r.id} has no section of its own`);
    // The status line is the line after the heading's blank line, and it has
    // to say where the status came from IN THAT SECTION. Asserting the phrase
    // appears anywhere in the file would pass on the first ruling's line and
    // prove nothing about the other twenty-two.
    const statusLine = text.slice(text.indexOf(heading) + heading.length).split("\n").filter(Boolean)[0];
    assert.ok(statusLine.startsWith(label), `ruling ${r.id}'s section does not open with its status: ${statusLine}`);
    const basis = r.status.length === 0 ? "Status stated by a person" : "Status computed from the code";
    assert.ok(statusLine.includes(basis), `ruling ${r.id} does not say where its status came from: ${statusLine}`);
    for (const d of r.dates) assert.ok(statusLine.includes(d), `ruling ${r.id}'s status line omits ${d}`);
  }
});

console.log("\ngenerate-governance-doc: the document itself\n");

check("the real repository generates, and generates the same bytes twice", () => {
  const once = generate();
  const twice = generate();
  assert.strictEqual(once, twice, "a timestamp or any other clock reading would break the byte comparison");
  assert.ok(once.startsWith("# Governance\n"), "the document must open with its own title");
  assert.ok(once.endsWith("\n"), "a text file ends with a newline");
});

check("it names the commit whose sources it describes", () => {
  const text = generate();
  assert.ok(/It describes the code at commit `[0-9a-f]{40}`\./.test(text), "the commit line is how a reader checks everything else");
});

check("the constitution comes before the long tables", () => {
  const text = generate();
  const constitution = text.indexOf("## The constitution in one screen");
  const dials = text.indexOf("## The dials a village holds");
  const rulings = text.indexOf("## The founder's rulings");
  const json = text.indexOf("## Machine-readable");
  const madeFrom = text.indexOf("## What this file is made from");
  assert.ok(constitution > 0 && constitution < dials, "the one-screen constitution opens the document");
  assert.ok(dials < rulings && rulings < json && json < madeFrom, "the order is tables, rulings, JSON, sources");
});

check("the document carries a machine-readable block that parses", () => {
  const text = generate();
  const m = /```json\n([\s\S]+?)\n```/.exec(text);
  assert.ok(m, "the JSON block is the machine-readable half of the brief");
  const parsed = JSON.parse(m[1]);
  assert.ok(Array.isArray(parsed.subjects) && parsed.subjects.length > 0);
  assert.ok(Array.isArray(parsed.dials) && parsed.dials.length > 0);
  assert.ok(Array.isArray(parsed.routes) && parsed.routes.length > 0);
  assert.ok(Array.isArray(parsed.rulings) && parsed.rulings.length === RULINGS.length);
  assert.ok(/^[0-9a-f]{40}$/.test(parsed.commit));
  for (const s of parsed.subjects) {
    for (const field of ["subjectType", "minUnityPct", "minQuorumPct", "executesAtClose"]) {
      assert.ok(field in s, `every machine-readable subject needs ${field}`);
    }
    // Both floors are numbers, however the subject spells them. `governance_mode`
    // takes its pair from `...tierFloors("constitutional")`, and a reader that
    // walked past the spread reported no floor at all, which rendered as
    // `undefined%` in the subject table. A missing floor is a defect in the
    // reader every time, so it fails here rather than shipping in a document.
    for (const field of ["minUnityPct", "minQuorumPct"]) {
      assert.equal(
        typeof s[field],
        "number",
        `${s.subjectType} has no readable ${field}; the reader lost it on the way out of the code`,
      );
    }
  }
});

check("A VILLAGE'S FOUNDERS ARE CALLED CATALYSTS IN PROSE", () => {
  // The word a player reads is Catalyst. `founder` survives as the stored role
  // value, because a slug is history's identity, so it appears in this
  // document inside backticks, inside a quote, or in a table read out of the
  // code. "The founder" singular is the person whose rulings this document
  // carries, which is a different party from a village's own founders, so it
  // is allowed and the plural is not.
  const text = generate();
  for (const [i, line] of text.split("\n").entries()) {
    if (!/\bfounders?\b/i.test(line)) continue;
    if (line.startsWith(">")) continue; // his own words, verbatim
    if (/`[^`]*founder[^`]*`/.test(line)) continue; // a stored value or a ring, shown as code
    if (/^\s*"/.test(line) || /^\s*\|/.test(line)) continue; // the JSON block and the read tables
    const villageRole = /\bfounders\b/i.test(line) || /\ba founder\b/i.test(line) || /\bfounder-(held|ring)\b/i.test(line);
    if (!villageRole) continue;
    assert.fail(`line ${i + 1} names a village's founders where a player would read Catalyst:\n    ${line}`);
  }
});

check("THE GENERATOR STILL HAS NO SHEBANG", () => {
  // A shebang and CRLF line endings TOGETHER make Vite's transform throw
  // `SyntaxError: Invalid or unexpected token`, and server/db/governanceDoc.test.ts
  // imports this file through Vite. Either one alone is fine, which is how the
  // sibling generator ran green half a dozen times on an LF working copy and
  // went red the moment a rebase checked it out with CRLF.
  const src = fs.readFileSync(new URL("./generate-governance-doc.mjs", import.meta.url), "utf8");
  assert.ok(!src.startsWith("#!"), "generate-governance-doc.mjs must not open with a shebang");
});

console.log(`\n${run} check(s) passed\n`);

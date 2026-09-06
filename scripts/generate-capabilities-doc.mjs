/**
 * NO SHEBANG, and it has to stay that way.
 *
 * Every other script in this directory opens with `#!/usr/bin/env node`. This
 * one is IMPORTED, by `scripts/check-capabilities-doc.mjs` and by
 * `scripts/generate-capabilities-doc.test.mjs`, and a shebang together with
 * CRLF line endings makes a transform throw `SyntaxError: Invalid or
 * unexpected token`. `core.autocrlf` is true on the Windows checkouts this
 * repository is developed on, so that pair arrives by rebase and not by edit.
 * `scripts/generate-token-doc.mjs` carries the same note, having found it the
 * hard way. Every caller runs this as `node scripts/generate-capabilities-doc.mjs`,
 * so the shebang buys nothing.
 */
/**
 * docs/CAPABILITIES.md, written from the permission model itself.
 *
 * WHY THIS IS A GENERATOR AND NOT A DOCUMENT. This repository has ONE
 * capability gate, and the order it resolves in decides who can do what in a
 * village: whether a warning badge's deny beats an appointed role, whether an
 * administrator outranks the village on a power the village has taken over.
 * That is a governance fact, and a hand-written table of it is wrong the week
 * after a key lands, with nothing to say so. Worse than wrong: a capability
 * document that quietly lists twenty of the keys tells a founder that eleven
 * powers do not exist.
 *
 * So this file reads the code, derives the model, and emits the document.
 * `scripts/check-capabilities-doc.mjs` regenerates it and fails the build when
 * the emitted text and the committed text differ. The check is what makes the
 * document trustworthy. Without it this is a beautiful thing that lies.
 *
 * WHAT IT READS, AND THE RULE FOR EACH READER. Every reader is ANCHORED and
 * FAILS LOUD. If the shape it expects is gone, it throws with the file and the
 * text it could not read, and the build stops. A reader that silently returns
 * a shorter list when the code moves is worse than no reader, because the
 * document keeps rendering and quietly loses a power.
 *
 *   shared/capabilities.ts   the keys, their labels, the deny map, the
 *                            transfer map, the stage rungs, and THE GATE
 *   shared/modules.ts        which module declares which key
 *   shared/gameConfig.ts     the stage ladder the rungs are named against
 *
 * VALUES COME FROM TRANSPILING AND IMPORTING THE REAL FILE, the way
 * `scripts/module-facts.mjs` does in `loadShared`, so the keys in this
 * document are the keys the running product holds. Nothing here is matched out
 * of the text with a regex.
 *
 * THE ORDER IS PARSED OUT OF THE FUNCTION, NOT RESTATED. `capabilityDecision`
 * is walked statement by statement with the TypeScript compiler's own parser,
 * and each step of the ladder is read off the return it produces. A statement
 * shape this reader does not recognise stops the build, because a step it
 * skipped in silence would be a step missing from a document whose whole
 * subject is which step wins. The set of steps it finds is then checked
 * against the `CapabilitySource` union: a source the union declares and the
 * function never produces, or a source the function produces and the union
 * never declares, is a failure either way.
 *
 * THE GATE IS ALSO RUN. The worked decisions in the document are produced by
 * calling the real `capabilityDecision` at generation time with contexts this
 * file builds. They are answers, never claims about answers.
 *
 * Usage:
 *   node scripts/generate-capabilities-doc.mjs            write docs/CAPABILITIES.md
 *   node scripts/generate-capabilities-doc.mjs --stdout   print it, write nothing
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

export const DOC_PATH = path.join(ROOT, "docs", "CAPABILITIES.md");

/**
 * Every file this document is derived from. Existence is checked before
 * anything is parsed, so a rename fails with the path it wanted instead of
 * with a parse error twenty frames deep.
 */
export const SOURCES = ["shared/capabilities.ts", "shared/modules.ts", "shared/gameConfig.ts"];

export class ReadError extends Error {}

function fail(message) {
  throw new ReadError(message);
}

const HELP =
  "The generator reads the permission model and refuses to guess. Fix what it names, or teach it the new shape.";

// ── Reading the files ───────────────────────────────────────────────────────

function sourceText(root, rel) {
  const abs = path.join(root, ...rel.split("/"));
  if (!fs.existsSync(abs)) fail(`capabilities-doc: ${rel} is gone; the generator reads it. ${HELP}`);
  return fs.readFileSync(abs, "utf8");
}

/**
 * Transpile `shared/<entry>.ts` into a scratch directory and import it, which
 * is how `scripts/module-facts.mjs` gets values out of this same directory.
 * Type-only imports erase, so each of the three files below comes out
 * self-contained; a relative specifier gains an extension because Node's ESM
 * resolver requires one.
 */
export async function loadShared(root, entry) {
  const src = sourceText(root, `shared/${entry}.ts`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capabilities-doc-"));
  try {
    const js = ts
      .transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/(from\s+")(\.\/[A-Za-z0-9_-]+)(")/g, "$1$2.mjs$3");
    const file = path.join(dir, `${entry}.mjs`);
    fs.writeFileSync(file, js, "utf8");
    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Parse one shared source, with parent pointers, so several readers can walk it. */
function parseShared(root, entry) {
  return ts.createSourceFile(`${entry}.ts`, sourceText(root, `shared/${entry}.ts`), ts.ScriptTarget.ES2022, true);
}

// ── Shape guards. Each one names what it wanted and where it looked ─────────

const plainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** A list of distinct non-empty strings, or a refusal naming what came back. */
export function requireKeyList(value, name, where) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      `capabilities-doc: ${where} no longer exports ${name} as a non-empty array. ` +
        `It came back as ${Array.isArray(value) ? "an empty array" : typeof value}. ${HELP}`,
    );
  }
  const seen = new Set();
  for (const key of value) {
    if (typeof key !== "string" || key.length === 0) {
      fail(`capabilities-doc: ${name} in ${where} holds ${JSON.stringify(key)}, which is not a capability key. ${HELP}`);
    }
    if (seen.has(key)) fail(`capabilities-doc: ${name} in ${where} lists "${key}" twice. ${HELP}`);
    seen.add(key);
  }
  return [...value];
}

/**
 * A map whose keys are EXACTLY the capability keys, checked in both
 * directions. A missing key is a row this document would have dropped, and an
 * extra key is a row describing a permission nobody holds.
 */
export function requireExactMap(value, keys, name, where, valueType) {
  if (!plainObject(value)) {
    fail(`capabilities-doc: ${where} no longer exports ${name} as an object. ${HELP}`);
  }
  const missing = keys.filter((k) => !Object.prototype.hasOwnProperty.call(value, k));
  const extra = Object.keys(value).filter((k) => !keys.includes(k));
  if (missing.length) {
    fail(
      `capabilities-doc: ${name} in ${where} has no entry for ${missing.map((k) => `"${k}"`).join(", ")}. ` +
        `Every capability key needs one, and a document missing eleven of them tells a founder those powers do not exist. ${HELP}`,
    );
  }
  if (extra.length) {
    fail(
      `capabilities-doc: ${name} in ${where} describes ${extra.map((k) => `"${k}"`).join(", ")}, ` +
        `which ALL_CAPABILITIES does not list. Delete the entry or add the key. ${HELP}`,
    );
  }
  for (const k of keys) {
    if (typeof value[k] !== valueType) {
      fail(
        `capabilities-doc: ${name}["${k}"] in ${where} is a ${typeof value[k]} and this reader wants a ${valueType}. ${HELP}`,
      );
    }
  }
  return Object.fromEntries(keys.map((k) => [k, value[k]]));
}

/** A map allowed to cover only some keys, and allowed to cover no key it does not know. */
export function requireSubsetMap(value, keys, name, where, valueType) {
  if (!plainObject(value)) fail(`capabilities-doc: ${where} no longer exports ${name} as an object. ${HELP}`);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!keys.includes(k)) {
      fail(
        `capabilities-doc: ${name} in ${where} names "${k}", which is not a capability key. ` +
          `A rung on a key nobody holds unlocks nothing. ${HELP}`,
      );
    }
    if (typeof v !== valueType) {
      fail(`capabilities-doc: ${name}["${k}"] in ${where} is a ${typeof v} and this reader wants a ${valueType}. ${HELP}`);
    }
    out[k] = v;
  }
  return out;
}

/** The string members of a union type alias, or a refusal saying which shape defeated it. */
export function unionStrings(sf, aliasName, where) {
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== aliasName) continue;
    const parts = ts.isUnionTypeNode(stmt.type) ? stmt.type.types : [stmt.type];
    const out = [];
    for (const part of parts) {
      if (!ts.isLiteralTypeNode(part) || !ts.isStringLiteral(part.literal)) {
        fail(
          `capabilities-doc: the ${aliasName} union in ${where} carries ` +
            `"${part.getText().replace(/\s+/g, " ").slice(0, 60)}", which is not a string literal. ${HELP}`,
        );
      }
      out.push(part.literal.text);
    }
    if (!out.length) fail(`capabilities-doc: the ${aliasName} union in ${where} is empty. ${HELP}`);
    return out;
  }
  return fail(`capabilities-doc: ${where} no longer declares the ${aliasName} type. ${HELP}`);
}

// ── THE GATE, parsed out of the function that is the gate ───────────────────

const GATE_FN = "capabilityDecision";

function literalOf(node, where) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return fail(
    `capabilities-doc: ${GATE_FN}() in ${where} returns ` +
      `"${node.getText().replace(/\s+/g, " ").slice(0, 60)}", which this reader cannot read as a literal. ${HELP}`,
  );
}

/**
 * The decision one `return` produces, in either shape the gate uses: a plain
 * object literal, or a call to the local `decided(allowed, source)` helper.
 */
function returnedDecision(node, where) {
  let expr = node.expression;
  if (!expr) {
    fail(`capabilities-doc: ${GATE_FN}() in ${where} holds a bare return, so this reader cannot say what it decided. ${HELP}`);
  }
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;

  if (ts.isCallExpression(expr)) {
    if (expr.arguments.length !== 2) {
      fail(
        `capabilities-doc: ${GATE_FN}() in ${where} returns ` +
          `${expr.getText().replace(/\s+/g, " ").slice(0, 60)}, and this reader wants (allowed, source). ${HELP}`,
      );
    }
    return { allowed: literalOf(expr.arguments[0], where), source: literalOf(expr.arguments[1], where) };
  }

  if (ts.isObjectLiteralExpression(expr)) {
    const out = {};
    for (const prop of expr.properties) {
      if (!ts.isPropertyAssignment(prop) || !(ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) continue;
      if (prop.name.text === "allowed" || prop.name.text === "source") {
        out[prop.name.text] = literalOf(prop.initializer, where);
      }
    }
    if (typeof out.allowed !== "boolean" || typeof out.source !== "string") {
      fail(
        `capabilities-doc: a return in ${GATE_FN}() in ${where} carries no readable allowed/source pair: ` +
          `${expr.getText().replace(/\s+/g, " ").slice(0, 80)}. ${HELP}`,
      );
    }
    return out;
  }

  return fail(
    `capabilities-doc: ${GATE_FN}() in ${where} returns ` +
      `${expr.getText().replace(/\s+/g, " ").slice(0, 80)}, which is a shape this reader does not understand. ${HELP}`,
  );
}

const conditionText = (node) => node.getText().replace(/\s+/g, " ").trim();

/** Every step an `if` ladder produces, carrying the conditions that reach it. */
function collectFromIf(node, conditions, steps, where) {
  if (node.elseStatement) {
    fail(
      `capabilities-doc: ${GATE_FN}() in ${where} grew an else branch on ` +
        `"${conditionText(node.expression).slice(0, 60)}". This reader follows a straight ladder of ifs, and it would ` +
        `report the other branch as unreachable. ${HELP}`,
    );
  }
  const reached = [...conditions, conditionText(node.expression)];
  const body = ts.isBlock(node.thenStatement) ? node.thenStatement.statements : [node.thenStatement];
  let found = 0;
  for (const stmt of body) {
    if (ts.isVariableStatement(stmt)) continue;
    if (ts.isReturnStatement(stmt)) {
      steps.push({ conditions: reached, ...returnedDecision(stmt, where) });
      found += 1;
      continue;
    }
    if (ts.isIfStatement(stmt)) {
      found += collectFromIf(stmt, reached, steps, where);
      continue;
    }
    fail(
      `capabilities-doc: ${GATE_FN}() in ${where} holds a statement this reader does not understand inside ` +
        `"${conditionText(node.expression).slice(0, 60)}": ` +
        `${stmt.getText().replace(/\s+/g, " ").slice(0, 80)}. ${HELP}`,
    );
  }
  if (found === 0) {
    fail(
      `capabilities-doc: the branch on "${conditionText(node.expression).slice(0, 60)}" in ${GATE_FN}() ` +
        `decides nothing this reader can see. ${HELP}`,
    );
  }
  return found;
}

/**
 * The gate's order of authority, in the order the function tests it.
 *
 * Read from `capabilityDecision` itself, so the document cannot restate an
 * order the code has moved on from. This is the whole reason the file exists.
 */
export function resolutionSteps(sf, where = "shared/capabilities.ts") {
  let fn;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === GATE_FN) fn = node;
    node.forEachChild(visit);
  };
  visit(sf);
  if (!fn?.body) fail(`capabilities-doc: ${where} no longer declares ${GATE_FN}(). ${HELP}`);

  const steps = [];
  for (const stmt of fn.body.statements) {
    if (ts.isVariableStatement(stmt)) continue;
    if (ts.isIfStatement(stmt)) {
      collectFromIf(stmt, [], steps, where);
      continue;
    }
    if (ts.isReturnStatement(stmt)) {
      steps.push({ conditions: [], ...returnedDecision(stmt, where) });
      continue;
    }
    fail(
      `capabilities-doc: ${GATE_FN}() in ${where} holds a statement this reader does not understand: ` +
        `${stmt.getText().replace(/\s+/g, " ").slice(0, 80)}. A step read wrongly is a step this document would ` +
        `put in the wrong place, and the order IS the policy. ${HELP}`,
    );
  }

  if (steps.length < 2) fail(`capabilities-doc: ${GATE_FN}() in ${where} yielded ${steps.length} step(s). ${HELP}`);
  const unconditional = steps.filter((s) => s.conditions.length === 0);
  if (unconditional.length !== 1 || steps[steps.length - 1].conditions.length !== 0) {
    fail(
      `capabilities-doc: ${GATE_FN}() in ${where} has ${unconditional.length} unconditional return(s), and this ` +
        `reader wants exactly one, last, as the fall-through. ${HELP}`,
    );
  }
  return steps;
}

// ── The prose a person writes, kept here so the file stays generated ────────

/**
 * One plain sentence per step of the gate, keyed by the source the step
 * reports. A step with no sentence and a sentence with no step both stop the
 * build, so a new step cannot ship unexplained and a retired one cannot leave
 * an orphan paragraph describing an authority nobody has.
 */
const STEP_MEANINGS = {
  admin: {
    beats:
      "The deployment operator, on a key the village does NOT hold. It is the first thing the gate reads, so on those " +
      "keys an admin passes whatever any badge, role or rung says.",
    detail:
      "Admin is scaffolding, and R54 is the ruling that says so: these villages are meant to be taken over by their " +
      "electorate. This step is the operator acting on the parts they are still responsible for.",
  },
  "admin-override": {
    beats:
      "The same operator on a key the village DOES hold, having said in the request that they mean to reach past the " +
      "village. Everything below it is skipped.",
    detail:
      "The break-glass, for exactly one act. It never persists and it is never inferred. The gate reports " +
      "`reachedPastVillage` so the caller cannot forget that it owes the village a record and a notification. It ships " +
      "in the same commit as the ceiling above it, because a gate that can lock an operator out of a live village must " +
      "never exist without its escape hatch.",
  },
  "denied by warning badge": {
    beats:
      "An active warning badge naming this key. It sits ABOVE role, badge and stage, so an appointment does not " +
      "override it. On a key the village holds it also reaches an admin who did not break the glass.",
    detail:
      "A warning a role trivially overrides is not a warning. The deny reaches only the keys `DENIABLE` marks as " +
      "deniable, and it can never reach a voice: a badge naming one of those is ignored here, refused at save time, and " +
      "cleared out of storage by migration.",
  },
  role: {
    beats: "An appointment. It beats badges and the ladder, and it loses to a deny on a deniable key.",
    detail:
      "The member holds a role whose `capabilities` list carries this key. A treasurer is a treasurer however many " +
      "quests they have done, which is why this path exists beside the ladder.",
  },
  badge: {
    beats: "A badge the member earned or was granted. It beats the ladder, and it loses to a role and to a deny.",
    detail:
      "The grant half of the badge system. It is how a founder hands out a power that nobody should reach by climbing, " +
      "the Cartographer badge over the village map being the worked example.",
  },
  stage: {
    beats: "The ladder everyone climbs. It is the last thing consulted, so every path above it can open a door earlier.",
    detail:
      "The member's computed stage is at or past the rung `STAGE_UNLOCKS` names. A village moves any rung with the " +
      "`progression.unlock.*` variables, and the value `none` closes the stage path for that key entirely, leaving " +
      "roles and badges as the way in.",
  },
  "not granted": {
    beats: "Nothing granted it. The gate refuses, and the refusal is the answer callers act on.",
    detail:
      "This is the honest default. A key absent from `STAGE_UNLOCKS`, held by no role and carried by no badge, lands " +
      "here for everybody who is not an admin.",
  },
};

export function stepCoverageProblem(steps, meanings = STEP_MEANINGS) {
  for (const step of steps) {
    if (meanings[step.source]) continue;
    return (
      `capabilities-doc: the gate has a step reporting "${step.source}" and no sentence describes it. ` +
      `Add one to STEP_MEANINGS in scripts/generate-capabilities-doc.mjs. A step nobody can explain in one line is a ` +
      `step nobody can explain to a founder.`
    );
  }
  const used = new Set(steps.map((s) => s.source));
  for (const source of Object.keys(meanings)) {
    if (used.has(source)) continue;
    return (
      `capabilities-doc: STEP_MEANINGS in scripts/generate-capabilities-doc.mjs describes "${source}", ` +
      `which the gate no longer produces. Delete the sentence or fix the key.`
    );
  }
  return null;
}

// ── Facts ───────────────────────────────────────────────────────────────────

export async function collectFacts(root = ROOT) {
  for (const rel of SOURCES) sourceText(root, rel);

  const capsWhere = "shared/capabilities.ts";
  const caps = await loadShared(root, "capabilities");
  const modulesMod = await loadShared(root, "modules");
  const configMod = await loadShared(root, "gameConfig");

  const keys = requireKeyList(caps.ALL_CAPABILITIES, "ALL_CAPABILITIES", capsWhere);

  if (typeof caps.capabilityDecision !== "function") {
    fail(`capabilities-doc: ${capsWhere} no longer exports ${GATE_FN}() as a function. ${HELP}`);
  }

  /*
   * THE UNION AND THE LIST, CHECKED AGAINST EACH OTHER, AND CHECKED FIRST.
   * `Capability` is a type and erases, so the transpiled import cannot see it;
   * the list is a value and the compiler cannot check it against the union it
   * is annotated with in any way that survives to here. A key added to one and
   * left out of the other is exactly the drift that makes a key ungrantable by
   * badges while every surface still offers it.
   *
   * It runs ahead of the three maps on purpose. A key dropped from the list
   * makes the maps look like they carry an entry too many, and the message a
   * person then gets sends them to fix the wrong file.
   */
  const capsSource = parseShared(root, "capabilities");
  const union = unionStrings(capsSource, "Capability", capsWhere);
  const notListed = union.filter((k) => !keys.includes(k));
  const notInUnion = keys.filter((k) => !union.includes(k));
  if (notListed.length || notInUnion.length) {
    fail(
      `capabilities-doc: the Capability union and ALL_CAPABILITIES in ${capsWhere} disagree. ` +
        (notListed.length ? `The union declares ${notListed.map((k) => `"${k}"`).join(", ")} with no entry in the list. ` : "") +
        (notInUnion.length ? `The list holds ${notInUnion.map((k) => `"${k}"`).join(", ")} with no member in the union. ` : "") +
        `Keep them in lockstep. ${HELP}`,
    );
  }

  const labels = requireExactMap(caps.CAPABILITY_LABELS, keys, "CAPABILITY_LABELS", capsWhere, "string");
  const deniable = requireExactMap(caps.DENIABLE, keys, "DENIABLE", capsWhere, "boolean");
  const transferable = requireExactMap(caps.TRANSFERABLE, keys, "TRANSFERABLE", capsWhere, "boolean");
  const stageUnlocks = requireSubsetMap(caps.STAGE_UNLOCKS, keys, "STAGE_UNLOCKS", capsWhere, "string");

  const sources = unionStrings(capsSource, "CapabilitySource", capsWhere);
  const steps = resolutionSteps(capsSource, capsWhere);
  const produced = [...new Set(steps.map((s) => s.source))];
  const undeclared = produced.filter((s) => !sources.includes(s));
  const unreachable = sources.filter((s) => !produced.includes(s));
  if (undeclared.length || unreachable.length) {
    fail(
      `capabilities-doc: ${GATE_FN}() and the CapabilitySource union in ${capsWhere} disagree. ` +
        (undeclared.length ? `The gate reports ${undeclared.map((s) => `"${s}"`).join(", ")}, which the union does not declare. ` : "") +
        (unreachable.length ? `The union declares ${unreachable.map((s) => `"${s}"`).join(", ")}, which the gate never returns. ` : "") +
        `${HELP}`,
    );
  }
  const coverage = stepCoverageProblem(steps);
  if (coverage) fail(coverage);

  // ── The stage ladder the rungs are named against ─────────────────────────
  const stages = configMod.GAME_CONFIG?.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    fail("capabilities-doc: shared/gameConfig.ts no longer carries GAME_CONFIG.stages as a non-empty array. " + HELP);
  }
  const ladder = stages.map((s, i) => {
    if (!plainObject(s) || typeof s.id !== "string" || typeof s.name !== "string") {
      fail(`capabilities-doc: stage ${i} in shared/gameConfig.ts has no string id and name. ${HELP}`);
    }
    return { id: s.id, name: s.name };
  });
  const ladderIds = ladder.map((s) => s.id);
  for (const [key, stageId] of Object.entries(stageUnlocks)) {
    if (stageId === "none" || ladderIds.includes(stageId)) continue;
    fail(
      `capabilities-doc: STAGE_UNLOCKS puts "${key}" at the stage "${stageId}", which is not a stage in ` +
        `shared/gameConfig.ts (${ladderIds.join(", ")}). A rung nobody can reach grants nothing. ${HELP}`,
    );
  }

  // ── Which module declares which key ──────────────────────────────────────
  const modules = modulesMod.MODULES;
  if (!Array.isArray(modules) || modules.length === 0) {
    fail("capabilities-doc: shared/modules.ts no longer exports MODULES as a non-empty array. " + HELP);
  }
  const declaredBy = Object.fromEntries(keys.map((k) => [k, []]));
  for (const mod of modules) {
    if (!plainObject(mod) || typeof mod.id !== "string" || typeof mod.name !== "string") {
      fail(`capabilities-doc: a module entry in shared/modules.ts has no string id and name. ${HELP}`);
    }
    if (!Array.isArray(mod.capabilities)) {
      fail(`capabilities-doc: the module "${mod.id}" in shared/modules.ts has no capabilities array. ${HELP}`);
    }
    for (const cap of mod.capabilities) {
      if (!keys.includes(cap)) {
        fail(
          `capabilities-doc: the module "${mod.id}" declares the capability ${JSON.stringify(cap)}, which ` +
            `ALL_CAPABILITIES does not list. A module cannot add a key to a gate that has never heard of it. ${HELP}`,
        );
      }
      if (!declaredBy[cap].some((m) => m.id === mod.id)) declaredBy[cap].push({ id: mod.id, name: mod.name });
    }
  }

  const rows = keys.map((key) => {
    const stageId = stageUnlocks[key] ?? null;
    return {
      key,
      namespace: key.includes(".") ? key.slice(0, key.indexOf(".")) : key,
      label: labels[key],
      deniable: deniable[key],
      transferable: transferable[key],
      stage: stageId,
      stageRung: stageId && stageId !== "none" ? ladderIds.indexOf(stageId) + 1 : null,
      modules: declaredBy[key],
    };
  });

  const namespaces = [];
  for (const row of rows) if (!namespaces.includes(row.namespace)) namespaces.push(row.namespace);

  const facts = {
    keys,
    rows,
    namespaces,
    steps,
    sources,
    ladder,
    modules: modules.map((m) => ({ id: m.id, name: m.name, capabilities: [...m.capabilities] })),
    counts: {
      keys: keys.length,
      steps: steps.length,
      voices: rows.filter((r) => !r.deniable).length,
      villageHoldable: rows.filter((r) => r.transferable).length,
      climbable: rows.filter((r) => r.stage && r.stage !== "none").length,
      undeclared: rows.filter((r) => r.modules.length === 0).length,
    },
  };
  facts.decisions = workedDecisions(caps.capabilityDecision, facts);
  return facts;
}

// ── The gate, run ───────────────────────────────────────────────────────────

/**
 * Worked decisions, produced by CALLING the real gate at generation time.
 *
 * The keys are picked out of the data by rule and never typed in, so this
 * survives a key being renamed and reports the new one. Each scenario says
 * what the member is; the answer and the deciding step are whatever the gate
 * returned.
 */
function workedDecisions(decide, facts) {
  const rowFor = (key) => facts.rows.find((r) => r.key === key);
  const idx = (stageId) => facts.ladder.findIndex((s) => s.id === stageId);
  const base = {
    stageIndex: 0,
    stageIndexOf: idx,
    roleCapabilities: [],
    badgeCapabilities: [],
    badgeDenies: [],
    villageHeld: [],
  };

  // A key that is climbable, deniable, and whose rung is not the first, so
  // "one rung below" is a real position on the ladder.
  const climbing = facts.rows.find((r) => r.deniable && r.stage && r.stage !== "none" && r.stageRung > 1);
  const voice = facts.rows.find((r) => !r.deniable);
  const held = facts.rows.find((r) => r.transferable && r.deniable);

  const out = [];
  const run = (who, key, ctx) => {
    const decision = decide(key, { ...base, ...ctx });
    if (!plainObject(decision) || typeof decision.allowed !== "boolean" || typeof decision.source !== "string") {
      fail(
        `capabilities-doc: ${GATE_FN}() returned something this reader cannot read for "${key}": ` +
          `${JSON.stringify(decision)}. ${HELP}`,
      );
    }
    out.push({ who, key, allowed: decision.allowed, source: decision.source, reachedPastVillage: !!decision.reachedPastVillage });
  };

  if (climbing) {
    const rung = idx(climbing.stage);
    run(`A member standing at the \`${climbing.stage}\` rung, holding no role and no badge`, climbing.key, { stageIndex: rung });
    run("The same member one rung lower", climbing.key, { stageIndex: rung - 1 });
    run("A member below the rung, holding a role that carries the key", climbing.key, {
      stageIndex: rung - 1,
      roleCapabilities: [climbing.key],
    });
    run("A member below the rung, carrying a badge that grants the key", climbing.key, {
      stageIndex: rung - 1,
      badgeCapabilities: [climbing.key],
    });
    run("A member at the rung AND holding the role, with a warning badge that denies the key", climbing.key, {
      stageIndex: rung,
      roleCapabilities: [climbing.key],
      badgeDenies: [climbing.key],
    });
  }
  if (voice) {
    run("A member holding the role, with a warning badge that denies a key no badge may deny", voice.key, {
      roleCapabilities: [voice.key],
      badgeDenies: [voice.key],
    });
  }
  if (held) {
    run("An admin, on a key the village does not hold", held.key, { isAdmin: true });
    run("An admin on a key the village HOLDS, with a warning badge denying it and no break-glass", held.key, {
      isAdmin: true,
      villageHeld: [held.key],
      badgeDenies: [held.key],
    });
    run("The same admin, having broken the glass in the request", held.key, {
      isAdmin: true,
      villageHeld: [held.key],
      badgeDenies: [held.key],
      adminOverride: true,
    });
  }
  if (!out.length) {
    fail(
      "capabilities-doc: no worked decision could be built, so the document would state the order without ever " +
        `running the gate. ${HELP}`,
    );
  }
  return out;
}

// ── Rendering ───────────────────────────────────────────────────────────────

const yes = (b) => (b ? "yes" : "no");
const cell = (s) => String(s).replace(/\|/g, "\\|");

function table(headers, rows) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.map(cell).join(" | ")} |`);
  return lines.join("\n");
}

const listWords = (parts) =>
  parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");

export function render(f) {
  const L = [];
  const p = (s = "") => L.push(s);
  const order = f.steps.map((s) => `\`${s.source}\``);

  p("# Capabilities");
  p();
  p(
    `Every capability key the platform knows about, what each one lets a member do, and the order the one gate ` +
      `resolves them in. ${f.counts.keys} keys, ${f.counts.steps} steps.`,
  );
  p();
  p(
    "There is ONE capability gate, `capabilityDecision()` in `shared/capabilities.ts`, and every permission answer in " +
      "the product comes through it. The order it resolves in IS the policy: it decides whether a warning badge's deny " +
      "survives an appointment, and whether an administrator still outranks a village on a power that village has " +
      "taken over.",
  );
  p();

  p("## How to read this file");
  p();
  p(
    "This file is generated. `scripts/generate-capabilities-doc.mjs` reads `shared/capabilities.ts`, " +
      "`shared/modules.ts` and `shared/gameConfig.ts`, derives the model, and writes the whole document. " +
      "`scripts/check-capabilities-doc.mjs` regenerates it and fails the build when the committed text and the code " +
      "have come apart.",
  );
  p();
  p("Editing this file by hand does not hold. Change the code, then run:");
  p();
  p("```bash");
  p("node scripts/generate-capabilities-doc.mjs");
  p("```");
  p();
  p("Two kinds of line live here, and the difference matters:");
  p();
  p(
    "- **Read from the code.** Every key, every label, every rung, every table, the order of the gate, the worked " +
      "decisions, and the JSON block at the end. If one of these is wrong, the code is what is wrong.\n" +
      "- **Written by a person.** The one-sentence gloss on each step of the gate. It is stored inside the generator " +
      "so this whole file stays generated, and a step with no gloss stops the build.",
  );
  p();
  p(
    "There is no timestamp and no author line, on purpose. Both would change on every run and turn an honest diff " +
      "into noise. The git history is the record of when this changed.",
  );
  p();

  p("## The order of authority");
  p();
  p(
    `The gate takes a capability key and a member's context, and returns an answer with the step that decided it. ` +
      `The steps below are read out of \`${GATE_FN}()\` in the order that function tests them. The FIRST step whose ` +
      `condition holds is the answer, and nothing below it is consulted.`,
  );
  p();
  p(`In one line: ${order.join(" then ")}.`);
  p();
  p(
    table(
      ["Step", "Decides", "Answer", "The condition, as the code writes it"],
      f.steps.map((s, i) => [
        String(i + 1),
        `\`${s.source}\``,
        s.allowed ? "allowed" : "refused",
        s.conditions.length ? s.conditions.map((c) => `\`${c}\``).join(" and ") : "nothing above it decided",
      ]),
    ),
  );
  p();
  for (const [i, step] of f.steps.entries()) {
    const meaning = STEP_MEANINGS[step.source];
    p(`**${i + 1}. \`${step.source}\`.** ${meaning.beats}`);
    p();
    p(meaning.detail);
    p();
  }
  p(
    "The consequence worth holding onto: a deny beats an appointment. A village that hands somebody a role and then " +
      "has to ask them to stop for a while has a remedy short of unseating them, and a warning that the next role " +
      "grant would quietly cancel would be no warning at all.",
  );
  p();

  p("## The gate, run");
  p();
  p(
    "These rows are not a description of the order. They are answers: the generator calls the real " +
      `\`${GATE_FN}()\` with each context below and records what came back. A change to the gate changes this table, ` +
      "and the guard then fails until the document is regenerated.",
  );
  p();
  p(
    table(
      ["The member, and what they hold", "Key", "Allowed", "Decided at"],
      f.decisions.map((d) => [
        d.who,
        `\`${d.key}\``,
        d.allowed ? "yes" : "no",
        `\`${d.source}\`${d.reachedPastVillage ? " (owes the village a record)" : ""}`,
      ]),
    ),
  );
  p();

  p("## Every capability key");
  p();
  p(
    `${f.counts.keys} keys. \`ALL_CAPABILITIES\` is a flat list, so they are grouped here by the prefix each key ` +
      `carries in its own name, in the order the list gives them: ${f.namespaces.map((n) => `\`${n}\``).join(", ")}.`,
  );
  p();
  p("Three columns need a word before the tables:");
  p();
  p(
    "- **A warning badge may deny it.** `DENIABLE` in `shared/capabilities.ts`. A `no` marks a VOICE: a member's own " +
      "say in a decision the village makes, which nothing may take away.\n" +
      "- **The village may hold it.** `TRANSFERABLE`. A `yes` means this key can leave the admin panel: once the " +
      "village records a holder, an admin stops passing the gate by being an admin and has to reach past the village " +
      "in the open.\n" +
      "- **Stage that unlocks it.** `STAGE_UNLOCKS`, against the ladder in `shared/gameConfig.ts`. A key with no rung " +
      "is an appointment, reached by a role or a badge and never by climbing.",
  );
  p();
  for (const ns of f.namespaces) {
    const group = f.rows.filter((r) => r.namespace === ns);
    p(`### \`${ns}\``);
    p();
    p(
      table(
        ["Key", "What it lets a member do", "A warning badge may deny it", "The village may hold it", "Stage that unlocks it", "Declared by"],
        group.map((r) => [
          `\`${r.key}\``,
          r.label,
          yes(r.deniable),
          yes(r.transferable),
          r.stageRung ? `\`${r.stage}\` (rung ${r.stageRung} of ${f.ladder.length})` : r.stage === "none" ? "the stage path is closed" : "no rung",
          r.modules.length ? r.modules.map((m) => m.name).join(", ") : "no module",
        ]),
      ),
    );
    p();
  }

  p("## The voices");
  p();
  const voices = f.rows.filter((r) => !r.deniable);
  p(
    voices.length
      ? `${voices.length} of the ${f.counts.keys} keys may never be taken away by a warning badge: ` +
          `${listWords(voices.map((r) => `\`${r.key}\``))}. Each is a member's own say in a decision the village ` +
          "makes. The gate ignores a deny naming one of them, the badge validator refuses to save one, and a " +
          "migration cleared the ones already stored. Three locks on the same door, because a hand-written UPDATE is " +
          "invisible to code review by definition and a stored row outlives the admin who wrote it."
      : "Every key can be denied by a warning badge today. Nothing is marked as a voice.",
  );
  p();
  p(
    "The rule underneath: waning is not removal. A rule under which unused voice decays over time is legitimate. An " +
      "act by which one party strips another's earned voice is not, at any tier, held by anybody.",
  );
  p();

  p("## The keys a village can take off the admin panel");
  p();
  const holdable = f.rows.filter((r) => r.transferable);
  p(
    holdable.length
      ? `${holdable.length} of the ${f.counts.keys} keys are marked transferable: ` +
          `${listWords(holdable.map((r) => `\`${r.key}\``))}.`
      : "No key is marked transferable today, so the village holds nothing and step 1 of the gate always applies.",
  );
  p();
  p(
    "A key is only marked transferable once every route that REFUSES on it asks the gate in a shape that can carry " +
      "the break-glass and write the public record. A ceiling an operator cannot climb over is not a ceiling, it is " +
      "an outage. The keys left out are of two kinds: personal acts, where there is nobody for the key to move to, " +
      "and keys nothing refuses on yet, where a promise that an admin must reach past the village in the open would " +
      "have nothing under it.",
  );
  p();

  p("## Which module declares which key");
  p();
  p(
    "A module's `capabilities` array in `shared/modules.ts` is what that module ADDS to the one gate. It is never a " +
      "second permission mechanism: the keys land in the same gate as everything else.",
  );
  p();
  const declaring = f.modules.filter((m) => m.capabilities.length);
  p(
    table(
      ["Module", "Id", "Keys it declares"],
      declaring.map((m) => [m.name, `\`${m.id}\``, m.capabilities.map((c) => `\`${c}\``).join(", ")]),
    ),
  );
  p();
  const orphans = f.rows.filter((r) => r.modules.length === 0);
  p(
    orphans.length
      ? `${orphans.length} keys are declared by no module: ${listWords(orphans.map((r) => `\`${r.key}\``))}. ` +
          "That is a fact about the registry and never a sign the key is dead. A key reaches the gate from any route " +
          "that asks for it, and the admin surfaces the handover keys cover sit outside every module."
      : "Every key is declared by at least one module.",
  );
  p();

  p("## Machine-readable");
  p();
  p(
    "The same facts, in a shape a script can read. Regenerated with the rest of the file, so it " +
      "cannot drift from the prose above it.",
  );
  p();
  p("```json");
  p(
    JSON.stringify(
      {
        counts: f.counts,
        resolutionOrder: f.steps.map((s, i) => ({
          step: i + 1,
          source: s.source,
          allowed: s.allowed,
          conditions: s.conditions,
        })),
        capabilities: f.rows.map((r) => ({
          key: r.key,
          label: r.label,
          deniable: r.deniable,
          transferable: r.transferable,
          stageUnlock: r.stage,
          stageRung: r.stageRung,
          modules: r.modules.map((m) => m.id),
        })),
        workedDecisions: f.decisions,
        stageLadder: f.ladder.map((s) => s.id),
      },
      null,
      2,
    ),
  );
  p("```");
  p();

  p("## What this file is made from");
  p();
  p("The generator reads these and fails loudly if any of them moves:");
  p();
  for (const rel of SOURCES) p(`- \`${rel}\``);
  p();
  p(
    "The keys, the labels and the three maps are read by transpiling `shared/capabilities.ts` and importing it, so " +
      "they are the values the running product holds. The order of authority is parsed out of " +
      `\`${GATE_FN}()\` statement by statement: a shape the reader does not recognise stops the build, because a step ` +
      "skipped in silence would be a step missing from a document whose subject is which step wins.",
  );
  p();
  p(
    "Four disagreements fail the build on their own, and each one has shipped somewhere as a quiet bug: a key in the " +
      "`Capability` union with no entry in `ALL_CAPABILITIES` (ungrantable by badges while every surface offers it), " +
      "a key with no line in `DENIABLE` or `TRANSFERABLE`, a step the gate returns that `CapabilitySource` does not " +
      "declare, and a rung naming a stage the ladder does not have.",
  );
  p();
  p(
    "`shared/capabilities.test.ts` holds the same agreements as running assertions, so the compiler, the suite and " +
      "this document all read the one model.",
  );
  p();

  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export async function generate(root = ROOT) {
  return render(await collectFacts(root));
}

/** The document and the facts behind it, for callers that want to report on both. */
export async function generateDetailed(root = ROOT) {
  const facts = await collectFacts(root);
  return { text: render(facts), facts };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

if (invokedDirectly) {
  try {
    const text = await generate();
    if (process.argv.includes("--stdout")) {
      process.stdout.write(text);
    } else {
      fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
      fs.writeFileSync(DOC_PATH, text, "utf8");
      process.stdout.write(`wrote docs/CAPABILITIES.md (${text.split("\n").length} lines)\n`);
    }
  } catch (err) {
    process.stderr.write(`\n${err instanceof ReadError ? err.message : (err?.stack ?? String(err))}\n\n`);
    process.exit(1);
  }
}

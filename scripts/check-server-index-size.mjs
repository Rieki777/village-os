#!/usr/bin/env node
/**
 * The server/index.ts ratchet: one file should not be the only place a
 * contributor can put a route.
 *
 * THE HARM THIS MEASURES. `server/index.ts` was 33,245 lines carrying 560
 * route registrations on the day this guard was written, with zero
 * `express.Router()` uses and 248 direct `.query()` call sites against tables
 * other modules own. `scripts/server-index-size-baseline.json` carries where
 * the two ratcheted numbers stand today, and is the figure to quote: a
 * hand-typed count in a comment goes stale on the next extraction, which is
 * how four documents came to state three different route totals, none of them
 * right. Nearly all of the file is the body of one `async function
 * startServer()` (grep for it; line 5357 at the time of writing) that runs to
 * EOF, so every route closes over one scope of roughly 27,500 lines instead
 * of receiving what it needs. A contributor who wants to change one domain's
 * routes has no smaller unit to read than the whole file, and
 * `docs/ARCHITECTURE.md`'s add-a-module recipe has been telling every new
 * contributor to add their routes here, which is why the number kept going
 * up. Nothing in the repository has ever measured it.
 *
 * WHAT THIS GUARD IS FOR, AND WHAT IT IS NOT FOR. It does not make the file
 * smaller. It makes the file's size a one-way street: extraction work by any
 * lane, this one or a later one, lowers the recorded number, and nothing can
 * raise it back. That property is worth more than any single extraction,
 * because an extraction is one commit and a ratchet is every commit after it.
 *
 * WHAT IS MEASURED, and both numbers only ever fall:
 *
 *   lines   Newline count of server/index.ts MINUS the lines `exemptLines`
 *           forgives: route-module imports, and calls to the `register as
 *           NAME` bindings those imports declare. The blunt instrument, and
 *           the one that catches ordinary growth.
 *
 *           SO A HAND `wc -l` READS HIGHER THAN THIS GUARD, and the gap is
 *           the exemption rather than a discrepancy. This block claimed the
 *           opposite until 2026-09-23: it said the number was "the same
 *           number `wc -l` gives, so anyone checking this guard by hand gets
 *           the same answer", which stopped being true the day the exemption
 *           was added and read as a 103-line mystery to anyone who checked.
 *           A guard whose own header warns that hand-typed numbers go stale
 *           had a stale claim in its header.
 *
 *           The gap is not quoted here on purpose. It is the count of
 *           extracted route modules and moves with every extraction, so a
 *           figure written into this comment would be wrong by the next one.
 *           Run the script: it prints its own number, and `wc -l` prints the
 *           other.
 *   routes  `app.get/post/put/patch/delete(` registrations, counted in code
 *           only. Lines alone are not enough: a commit can delete a long
 *           comment block and add a route in the same breath and still come
 *           out net-shorter. Routes are the unit of the actual harm, so they
 *           get their own ratchet.
 *
 * THE THIRD RULE, so the debt cannot simply move house: a file under
 * `server/routes/` is capped at NEW_ROUTE_FILE_MAX_LINES. Extraction is the
 * point of this guard, but extraction into one new 20,000-line file is not
 * extraction, it is a rename. New files are born clean, same discipline as
 * scripts/check-theme-literals.mjs and scripts/check-tailwind-gray.mjs.
 *
 * THE LOOPHOLE, NAMED. Nothing here stops someone moving 5,000 lines into a
 * new `server/index-part-two.ts` and importing it back. That is deliberate: a
 * second file with a name and a boundary IS the improvement this guard exists
 * to push toward, and a guard that tried to forbid every possible relocation
 * would have to model the whole module graph to say anything at all. This one
 * says one specific true thing instead.
 *
 * THE RATCHET DISCIPLINE, copied exactly from
 * scripts/check-theme-literals.mjs and scripts/check-tailwind-gray.mjs:
 * `--update-baseline` REFUSES to write any number above the one already
 * committed, and says so on stderr with a non-zero exit. Lowering is the only
 * legal direction. There is no waiver marker, on purpose: a waiver makes
 * sense for a guard that can produce a false positive about a line of code,
 * and "this file has N lines" cannot be a false positive.
 *
 * Usage:
 *   node scripts/check-server-index-size.mjs                    # the gate
 *   node scripts/check-server-index-size.mjs --json             # machine readable
 *   node scripts/check-server-index-size.mjs --update-baseline  # only ever downward
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.join(ROOT, "server", "index.ts");
const ROUTES_DIR = path.join(ROOT, "server", "routes");
const BASELINE_PATH = path.join(ROOT, "scripts", "server-index-size-baseline.json");

/**
 * A new route file over this is a monolith with a different name. Chosen as
 * roughly a long-but-readable domain module: big enough that a genuinely
 * large domain does not have to be split for the sake of it, small enough
 * that no single one of them can become the next server/index.ts. A fixed cap
 * rather than a ratchet, because it governs files that do not exist yet.
 */
const NEW_ROUTE_FILE_MAX_LINES = 2000;

const ROUTE_CALL = /\bapp\.(get|post|put|patch|delete)\s*\(/g;

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

const lineCount = (text) => (text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length);

/**
 * Blank out comments, string literals, template literals and regex literals,
 * preserving every newline so line numbers survive, and return code-only text.
 *
 * WHY THIS IS A REAL SCANNER AND NOT THE PER-LINE `stripComments` THE OTHER
 * GUARDS USE. That helper is per line, so a caller has to track multi-line
 * block-comment state itself, and the obvious way to track it (does this line
 * open a block and not close one) is wrong on this specific file. Two of
 * index.ts's own route registrations take the path `"/assets/*"` and
 * `"/org/*"`, and the last two characters inside those PATH STRINGS read as a
 * block-comment opener that never closes. Every route after them vanishes.
 * The first version of this guard did exactly that and cheerfully reported
 * 557 registrations where there were 560, which is the worst thing a ratchet
 * can do: report success while the number it protects goes up. Getting that
 * right means tracking strings, which means tracking all of them.
 *
 * Template literals get an interpolation stack rather than a scan-to-the-next
 * backtick, for the same class of reason. index.ts embeds multi-line assistant
 * prompts that interpolate values, and a nested backtick inside one `${...}`
 * ends the outer template early for a naive scanner, flipping code and string
 * for thousands of lines afterwards. That bug cost another 19 routes.
 *
 * Regex literals are tracked with the standard "could a regex start here"
 * heuristic (a slash begins one unless the previous significant character
 * could have ended an expression), because a pattern such as a character
 * class holding a quote would otherwise open a string that never closes.
 */
function blankNonCode(text) {
  const KEEP = (ch) => (ch === "\n" ? "\n" : " ");
  let out = "";
  let i = 0;
  let prevSig = "";
  /**
   * Open template literals, innermost last. Each entry records the brace
   * depth at which its current interpolation began, so the matching close
   * brace can be told apart from every other closing brace inside it and hand
   * control back to template TEXT rather than to code.
   */
  const templates = [];
  let depth = 0;
  let inTemplateText = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (inTemplateText) {
      if (ch === "\\") {
        out += KEEP(ch);
        i += 1;
        if (i < text.length) out += KEEP(text[i++]);
        continue;
      }
      if (ch === "`") {
        out += " ";
        i += 1;
        inTemplateText = false;
        templates.pop();
        prevSig = "x";
        continue;
      }
      if (ch === "$" && next === "{") {
        out += "  ";
        i += 2;
        templates[templates.length - 1].depth = depth;
        depth += 1;
        inTemplateText = false;
        continue;
      }
      out += KEEP(ch);
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") out += KEEP(text[i++]);
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) out += KEEP(text[i++]);
      if (i < text.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      out += " ";
      i += 1;
      while (i < text.length && text[i] !== ch && text[i] !== "\n") {
        if (text[i] === "\\") {
          out += KEEP(text[i]);
          i += 1;
          if (i < text.length) out += KEEP(text[i++]);
          continue;
        }
        out += KEEP(text[i++]);
      }
      if (i < text.length && text[i] === ch) {
        out += " ";
        i += 1;
      }
      prevSig = "x";
      continue;
    }
    if (ch === "`") {
      out += " ";
      i += 1;
      templates.push({ depth });
      inTemplateText = true;
      continue;
    }
    if (ch === "/" && !/[\w)\]$]/.test(prevSig)) {
      out += " ";
      i += 1;
      let inClass = false;
      while (i < text.length && text[i] !== "\n") {
        const c = text[i];
        if (c === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        out += " ";
        i += 1;
      }
      if (i < text.length && text[i] === "/") {
        out += " ";
        i += 1;
      }
      prevSig = "x";
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (templates.length && depth === templates[templates.length - 1].depth) {
        out += " ";
        i += 1;
        inTemplateText = true;
        continue;
      }
    }
    if (!/\s/.test(ch)) prevSig = ch;
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * The two lines a route module costs server/index.ts do not count against it.
 *
 * WHY THIS EXISTS. A ratchet at zero slack deadlocked the recipe it exists to
 * promote. A founder following docs/ARCHITECTURE.md exactly, putting three new
 * routes in server/routes/founderDemo.ts and adding NOTHING to the monolith,
 * still failed CI:
 *
 *   server/index.ts is 31121 lines, baseline allows 31119 (+2).
 *
 * The import and the register() call are those two lines, and
 * --update-baseline refused to rescue them while its own error told the
 * founder to do what they had just done.
 *
 * Padding the baseline was the other option and it is worse. A number that
 * records headroom nobody earned is exactly the failure this programme spent a
 * day proving would let two parallel lanes gift each other hundreds of phantom
 * lines. So the count changes rather than the number.
 *
 * The exemption is narrow on purpose: an import of ./routes/<name>, and a call
 * to a register function. Both are the COST OF SHRINKING this file. Counting
 * them as growth punishes the one move that makes the monolith smaller, which
 * is the opposite of what a ratchet is for. Handler code is still counted to
 * the line.
 */
const ROUTE_IMPORT = /^\s*import\s[^;]*\bfrom\s*["']\.\/routes\/[^"']+["'];?\s*$/;

/**
 * The register names are DERIVED from the route-module imports, never guessed.
 *
 * The first version of this matched /^\s*register[A-Z]\w*\s*\(/ and quietly
 * swallowed every registerJob("stay-nightly", ...) line as well, because a
 * scheduled job registration looks exactly like a route registration to a
 * pattern. It exempted 60 lines where about 30 were real, and the only reason
 * it was caught is that the number was twice what the module count could
 * explain. A guard that over-exempts is a guard that hides the growth it exists
 * to catch, so this reads the actual `register as NAME` bindings and exempts
 * calls to those names alone.
 */
function exemptLines(text) {
  const lines = text.split("\n");
  const names = new Set();
  for (const l of lines) {
    if (!ROUTE_IMPORT.test(l)) continue;
    for (const m of l.matchAll(/\bregister\s+as\s+(\w+)/g)) names.add(m[1]);
  }
  const callsOne = (l) => {
    const m = l.match(/^\s*(\w+)\s*\(/);
    return m ? names.has(m[1]) : false;
  };
  return lines.filter((l) => ROUTE_IMPORT.test(l) || callsOne(l)).length;
}

function measure(file) {
  const text = fs.readFileSync(file, "utf8");
  return {
    lines: lineCount(text) - exemptLines(text),
    routes: (blankNonCode(text).match(ROUTE_CALL) ?? []).length,
  };
}

function routeFileSizes() {
  if (!fs.existsSync(ROUTES_DIR)) return {};
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        out[rel(full)] = lineCount(fs.readFileSync(full, "utf8"));
      }
    }
  };
  walk(ROUTES_DIR);
  return out;
}

const current = measure(TARGET);
const routeFiles = routeFileSizes();

if (process.argv.includes("--update-baseline")) {
  const prior = fs.existsSync(BASELINE_PATH)
    ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
    : { lines: Infinity, routes: Infinity };
  const risen = [];
  if (current.lines > prior.lines) risen.push(`lines ${current.lines} is above the recorded ${prior.lines}`);
  if (current.routes > prior.routes) risen.push(`routes ${current.routes} is above the recorded ${prior.routes}`);
  if (risen.length) {
    console.error(
      `::error::refusing to raise the server/index.ts baseline: ${risen.join("; ")}. ` +
        "These numbers only ever fall. Put the new routes in a server/routes/<domain>.ts module that " +
        "exports register(app, deps), and register it from startServer, instead of adding to the one file.",
    );
    process.exit(1);
  }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`server/index.ts baseline lowered to ${current.lines} line(s) and ${current.routes} route(s).`);
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE_PATH)
  ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
  : { lines: 0, routes: 0 };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ current, baseline, routeFiles, cap: NEW_ROUTE_FILE_MAX_LINES }));
}

const failures = [];
if (current.lines > baseline.lines) {
  failures.push(
    `server/index.ts is ${current.lines} lines, baseline allows ${baseline.lines} ` +
      `(+${current.lines - baseline.lines}). The ratchet only turns down.`,
  );
}
if (current.routes > baseline.routes) {
  failures.push(
    `server/index.ts registers ${current.routes} routes, baseline allows ${baseline.routes} ` +
      `(+${current.routes - baseline.routes}). The ratchet only turns down.`,
  );
}
for (const [file, lines] of Object.entries(routeFiles)) {
  if (lines > NEW_ROUTE_FILE_MAX_LINES) {
    failures.push(
      `${file} is ${lines} lines, over the ${NEW_ROUTE_FILE_MAX_LINES}-line cap for a route module. ` +
        "Split the domain rather than relocating the monolith.",
    );
  }
}

if (failures.length) {
  console.error("\nSERVER INDEX RATCHET FAILED: the one big file may only ever get smaller.\n");
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    "\nTo add routes: create server/routes/<domain>.ts exporting " +
      "`export function register(app: Express, deps: AppDeps): void`, and call it from startServer.\n" +
      'See docs/ARCHITECTURE.md, "Adding a module".\n' +
      "If you REMOVED lines or routes, lower the baseline: node scripts/check-server-index-size.mjs --update-baseline\n",
  );
  process.exit(1);
}

console.log(
  `server/index.ts ratchet passed. ${current.lines} line(s) (baseline ${baseline.lines}), ` +
    `${current.routes} route registration(s) (baseline ${baseline.routes}), ` +
    `${Object.keys(routeFiles).length} route module(s) all under ${NEW_ROUTE_FILE_MAX_LINES} lines.`,
);

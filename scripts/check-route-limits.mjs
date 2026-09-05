#!/usr/bin/env node
/**
 * A route anybody can reach, that a stranger can turn into cost the village
 * cannot refuse, has to be bounded.
 *
 * ── WHY THIS EXISTS, AND WHAT IT REPLACES ────────────────────────────────
 *
 * CodeQL's `js/missing-rate-limiting` asked a version of this question and
 * produced 98 open alerts against this repository. Every one was read on
 * 2026-09-04. Not one was an unauthenticated write:
 *
 *     82  behind an auth guard (19 of those admin-only)
 *      8  already bounded by overLimit(), which the query cannot see
 *      9  genuinely public, of which 4 are static file serves, 1 is the SPA
 *         catch-all, 1 was already bounded, and 2 were real and are now fixed
 *
 * The query looks for express-rate-limit middleware. This codebase bounds
 * requests with `overLimit(bucket, max, windowMs)` called inside the handler,
 * against a `rate_hits` table, so 38 deliberate limits are invisible to it and
 * every new route adds another alert. `.github/workflows/codeql.yml` already
 * states the rule that follows: "a gate which is red for a reason nobody can
 * fix gets deleted", and "a red one that always was red teaches people to
 * ignore red". So that one query is filtered out in
 * `.github/codeql/codeql-config.yml` and this script asks the question in a
 * form that fits the code. Every other CodeQL rule stays on.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 *
 * A route fails when all three are true:
 *
 *   1. Nothing it calls can answer 401 or 403, so a stranger reaches the work.
 *   2. It CREATES something, encodes an image, writes a file, or makes an
 *      outbound call on the village's behalf.
 *   3. It never calls overLimit().
 *
 * ── WHY NOT "READS THE DATABASE" ─────────────────────────────────────────
 *
 * Because a public GET that reads a row and returns JSON is what a village
 * website IS. Bounding every one of those is writing a reverse proxy inside
 * the application, and the first thing it breaks is the village's own front
 * page under a burst of real visitors. Measured on this tree, that rule
 * flagged 111 routes and about forty of them were the public site working
 * correctly. What a stranger can turn into UNREFUSABLE cost is narrower:
 * rows, CPU, or somebody else's rate limit spent under our name.
 *
 * ── WHY A GUARD IS DERIVED AND NEVER A LIST OF NAMES ─────────────────────
 *
 * A list of names is wrong the moment somebody writes a new helper, and it was
 * wrong twice while this rule was being worked out. A detector keyed on
 * `authedUser|standing|requireUser` reported that `DELETE /api/places/photo/:id`
 * had no guard. It has `photoHand()`, which answers 401. It said the same of
 * `/api/admin/call-tasks/:id/:action`, which uses `isAdmin()`.
 *
 * So the guard set is READ OUT OF THE TREE in a first pass: any function whose
 * own body can answer 401 or 403 is a guard, whatever it is called. A handler
 * is guarded if it answers 401 or 403 itself, or calls one of those. That
 * covers both shapes this codebase uses, `authedUser()` returning null and the
 * handler refusing, and `standing(req, res)` refusing on the handler's behalf.
 *
 * ── WHAT IT DELIBERATELY DOES NOT SEE ────────────────────────────────────
 *
 * A refusal that lives in middleware mounted somewhere else reads as unguarded
 * and needs a waiver. That is the intended direction of the error: this guard
 * over-reports and never under-reports, because a missed bound is a village
 * paying for a stranger's traffic and a false alarm is one line.
 *
 * It also cannot see a bound that is not a rate limit. The portrait forge is
 * the standing example: it spends a per-member grant taken atomically before
 * the image provider is called, a harder bound than any counter, and it is
 * behind auth so this script never asks.
 *
 * ── WAIVERS ──────────────────────────────────────────────────────────────
 *
 * `limit-ok: <reason>` on the route's own line, same spelling convention as
 * check-brand-refs.mjs's `brand-ok:`. Waivers are counted and printed, so a
 * growing number is visible rather than quiet.
 *
 * Usage:
 *   node scripts/check-route-limits.mjs           # the gate
 *   node scripts/check-route-limits.mjs --table   # every public route, with why
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLE = process.argv.includes("--table");

function serverFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(full);
    }
  };
  walk(path.join(ROOT, "server"));
  return out.sort();
}

const ROUTE = /^\s*(?:app|r|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)/;

/**
 * Where a handler actually ends: the line on which `app.get(` closes.
 *
 * "Runs to the next route registration" was tried first and it is why an early
 * version of this script passed a route with its limit deleted. Between two
 * registrations sit helper functions, module setup and sometimes a second
 * handler's worth of code, so the span for `GET /api/og/quest/:id` came out at
 * 158 lines and swallowed somebody else's `overLimit`. The route then read as
 * bounded no matter what its own body said.
 *
 * Parens are counted with string and comment content blanked first, so a `(`
 * inside a message or a regex cannot unbalance the count. If the depth never
 * returns to zero the span falls back to the next registration, which is the
 * old behaviour and only ever over-reaches.
 */
function handlerSpan(src, start, fallbackEnd) {
  const blank = (line) =>
    line
      .replace(/\\./g, "__")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      .replace(/\/\/.*$/, "");
  let depth = 0;
  let seen = false;
  for (let i = start; i < src.length; i++) {
    for (const ch of blank(src[i])) {
      if (ch === "(") { depth++; seen = true; }
      else if (ch === ")") depth--;
    }
    if (seen && depth <= 0) return i + 1;
  }
  return fallbackEnd;
}
const REFUSES = /\b(?:status\(\s*40[13]\s*\)|sendStatus\(\s*40[13]\s*\)|status:\s*40[13]\b)/;
/*
 * A bound is `overLimit`, or ANYTHING THAT CAN ANSWER 429, which is the same
 * move the guard rule makes with 401 and 403 and for the same reason: the
 * mechanism gets renamed, the status code does not.
 *
 * Both webhook routes forced this. They are bounded, and not by `overLimit`:
 * they keep a per-address in-memory bucket and answer 429 over it, because a
 * webhook flood must be refused before it reaches the database rather than
 * counted in it. A rule that only knew one helper's name would have demanded a
 * waiver on two routes that already do the right thing, and a waiver on
 * correct code is how a guard starts being ignored.
 */
const BOUNDED = /\b(?:overLimit|rateLimited)\s*\(|\bstatus\(\s*429\s*\)/;
const WAIVER = /limit-ok:\s*(\S.*)$/;

/** Anything a stranger can turn into rows, CPU, or somebody else's quota. */
const WRITE_VERBS = new Set(["post", "put", "patch", "delete"]);
const COSTLY = [
  /\bimport\("sharp"\)/,
  /\bsharp\(/,
  /\bfs\.(?:writeFile|writeFileSync|createWriteStream|copyFileSync|renameSync)\b/,
  /\bawait fetch\(/,
  /\bsendMail\b/,
];

/**
 * Static serving is not the subject: these answer with a file the build
 * produced, take no parameter that reaches a query, and bounding them would
 * bound the site itself.
 */
const STATIC = [/^\/\{\*splat\}$/, /^\/grounds\//, /^\/assets\//, /^\/favicon/, /^\/sw\.js$/];

const files = serverFiles();

// ── PASS ONE: which functions can turn a stranger away, whatever they are called
/*
 * A named function, in the two shapes this codebase writes them.
 *
 * THE ARROW FORM INSISTS ON THE ARROW. Without `=>` the second alternative
 * also matched `const permitted = (await something)`, so `permitted`, `me`,
 * `role`, `name`, `body`, `that` and `of` all entered the guard set as if they
 * were functions. A two-letter name matches somewhere in nearly every handler,
 * and a junk name in this set makes a real route read as guarded, which is a
 * false negative in a script whose whole value is not having any.
 *
 * Short names stay in. `me` is two characters and is the real guard on ten
 * `/api/agent/*` routes, so a minimum-length rule was tried and dropped: it
 * removed the junk AND that guard, and reported ten routes that are correct.
 * The word boundary is what makes a short name safe to match on, since `me\(`
 * does not fire inside `name(` or `resume(`.
 */
const GUARD_DECL =
  /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:^|\s)(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/;
/*
 * PER FILE, NOT REPO-WIDE, and this was proved the expensive way.
 *
 * A single global set of names is a collision waiting to happen: some helper
 * called `byId` refuses 401 in one module, and every route anywhere that calls
 * any `byId(` then reads as guarded. That is not hypothetical. With one global
 * set, deleting the bound from `GET /api/og/quest/:id` -- a public route that
 * runs `sharp` per uncached request -- left this script reporting PASSED. The
 * control caught it; nothing else would have.
 *
 * So a route may only be excused by a helper its own file declares or imports.
 * That is also what a reader of that file can see, which is the right standard
 * for a guard somebody has to maintain.
 */
const guards = new Set();
/*
 * And the same, symmetrically, for the bound. `/api/assistant/proposal` is the
 * case that forced it: its own comment says "every guard (key, per-IP burst,
 * this mode's day) lives in callAssistant below", and it does. A rule that can
 * follow a refusal into a helper but not a limit into one would report that
 * route forever, and the fix would be a waiver pinned to working code.
 */
const bounders = new Set();
/** file -> the names IT declares that refuse, and that bound. */
const guardsIn = new Map();
const boundersIn = new Map();
/** file -> every name it imports, so an imported helper still counts. */
const importsIn = new Map();
const IMPORT = /^\s*import\s+(?:type\s+)?\{([^}]*)\}/;

for (const file of files) {
  const src = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const g = new Set();
  const b = new Set();
  const imported = new Set();
  for (const line of src) {
    const im = IMPORT.exec(line);
    if (im) for (const raw of im[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }
  /*
   * `const { isAdmin, authedUser, ... } = deps;` is how every extracted route
   * module receives its guards, so a name arriving that way is as reachable as
   * an imported one. Without this the admin routes in faqs.ts, land.ts,
   * milestones.ts, org.ts and orgSeatings.ts all read as public, because
   * `isAdmin` is neither declared nor imported there.
   */
  for (const m of fs.readFileSync(file, "utf8").matchAll(/const\s*\{([^}]*)\}\s*=\s*deps\b/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(":").pop().trim();
      if (name) imported.add(name);
    }
  }
  const decls = [];
  for (let i = 0; i < src.length; i++) {
    const m = GUARD_DECL.exec(src[i]);
    if (m) decls.push({ name: m[1] || m[2], line: i });
  }
  for (let k = 0; k < decls.length; k++) {
    const end = k + 1 < decls.length ? decls[k + 1].line : src.length;
    const body = src.slice(decls[k].line, end).join("\n");
    // A route registration inside the span means this is not a small helper,
    // it is the register() function, and its 401s belong to its routes.
    if (ROUTE.test(body)) continue;
    if (REFUSES.test(body)) { g.add(decls[k].name); guards.add(decls[k].name); }
    if (BOUNDED.test(body)) { b.add(decls[k].name); bounders.add(decls[k].name); }
  }
  guardsIn.set(file, g);
  boundersIn.set(file, b);
  importsIn.set(file, imported);
}

/*
 * ONE HOP, AND NOT A TRANSITIVE CLOSURE. This was tried both ways.
 *
 * Chasing the call graph to a fixed point looks like the rigorous answer and
 * is the opposite. `GUARD_DECL` has to be generous to catch the several shapes
 * a helper is written in here, so it also catches short names (`me`, `role`,
 * `body`, `of`, `that`), and a short name matches somewhere in almost any
 * function. Measured on this tree the closure grew to 1040 "refusing" and 1039
 * "bounding" functions out of about 1100, which is every function in the
 * server, and the gate then reported ONE finding while quietly dropping
 * `POST /api/map/walk-log` -- a genuinely unbounded public row writer, the
 * exact thing this script exists to catch.
 *
 * A gate that under-reports is worse than no gate, because it is believed. One
 * hop keeps the error pointing the way the header promises: over-report, and
 * let a waiver carry the reason in writing.
 */
const alternation = (set) =>
  set.size
    ? new RegExp(`\\b(?:${[...set].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*\\(`)
    : /$^/;

/** What one file is allowed to be excused by: what it declares, plus what it imports. */
const reachable = (file, own, all) => {
  const set = new Set(own.get(file));
  for (const n of importsIn.get(file) ?? []) if (all.has(n)) set.add(n);
  return alternation(set);
};

// ── PASS TWO: the routes
const routes = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const GUARD_CALL = reachable(file, guardsIn, guards);
  const BOUND_CALL = reachable(file, boundersIn, bounders);
  const src = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const opens = [];
  for (let i = 0; i < src.length; i++) {
    const m = ROUTE.exec(src[i]);
    if (m) opens.push({ line: i, verb: m[1], url: m[2] });
  }
  for (let k = 0; k < opens.length; k++) {
    const { line, verb, url } = opens[k];
    const end = handlerSpan(src, line, k + 1 < opens.length ? opens[k + 1].line : src.length);
    const body = src.slice(line, end).join("\n");
    const waiver = WAIVER.exec(src[line]);
    routes.push({
      file: rel,
      line: line + 1,
      verb,
      url,
      guarded: REFUSES.test(body) || GUARD_CALL.test(body),
      costly: WRITE_VERBS.has(verb) || COSTLY.some((re) => re.test(body)),
      bounded: BOUNDED.test(body) || BOUND_CALL.test(body),
      staticServe: STATIC.some((re) => re.test(url)),
      waiver: waiver ? waiver[1].trim() : null,
    });
  }
}

const public_ = routes.filter((r) => !r.guarded && !r.staticServe);
const failing = public_.filter((r) => r.costly && !r.bounded && !r.waiver);
const waived = public_.filter((r) => r.costly && !r.bounded && r.waiver);

if (TABLE) {
  console.log(
    `${routes.length} route(s) across ${new Set(routes.map((r) => r.file)).size} file(s); ` +
      `${guards.size} function(s) read out of the tree as able to refuse a stranger\n`,
  );
  console.log("PUBLIC ROUTES (nothing they call can answer 401 or 403):\n");
  for (const r of public_.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    const state = !r.costly ? "read" : r.bounded ? "bounded" : r.waiver ? "waived" : "UNBOUNDED";
    console.log(
      `  ${state.padEnd(10)} ${r.verb.toUpperCase().padEnd(7)} ${r.url.padEnd(42)} ${r.file}:${r.line}`,
    );
  }
  process.exit(0);
}

if (failing.length > 0) {
  console.error(
    `::error::${failing.length} route(s) answer anybody, cost the village something a stranger chooses, and are not bounded.`,
  );
  for (const r of failing) {
    console.error(`    ${r.verb.toUpperCase()} ${r.url}  (${r.file}:${r.line})`);
  }
  console.error(
    "  Nothing these handlers call can answer 401 or 403, so a stranger reaches the work.\n" +
      "  Either turn strangers away, or bound it:\n" +
      "      if (await overLimit(`<bucket>:${clientIp(req)}`, <max>, <windowMs>)) {\n" +
      '        return res.status(429).set("Retry-After", "600").json({ error: "..." });\n' +
      "      }\n" +
      "  A genuine false positive takes `limit-ok: <reason>` on the route's own line.\n" +
      "  `--table` prints every public route and what this script decided about it.",
  );
  process.exit(1);
}

console.log(
  `Route-limit guard passed. ${routes.length} route(s) read against ${guards.size} refusing ` +
    `and ${bounders.size} bounding function(s) found in the tree; ` +
    `${public_.length} answer anybody, ${public_.filter((r) => r.costly).length} of ` +
    `those spend something a stranger chooses and every one is bounded or waived; ` +
    `${waived.length} waiver(s) in force.`,
);

#!/usr/bin/env node
/**
 * The auth guard: a client call to a route that REFUSES strangers carries a token.
 *
 * ── THE BUG THIS EXISTS FOR ──────────────────────────────────────────────
 * The Living Map's promise relay was written with a plain `fetch` and a
 * Content-Type header. It shipped through ten passing route tests, because
 * every one of them set `Authorization` itself, and it would have told every
 * signed-in member on the map that they were anonymous: this deployment
 * authenticates by `Authorization: Bearer` ALONE (`authedUser` in
 * server/index.ts), with no cookie fallback, so a request without the header
 * is not a member's request. Nothing threw. Nothing logged. The map simply
 * offered people a way in they did not need.
 *
 * A server test proves the route. It does not prove the client reaches it.
 * This is the static half of that gap, so it costs nothing and cannot flake.
 *
 * ── WHY IT READS THE SERVER INSTEAD OF HOLDING A LIST ────────────────────
 * The first draft flagged every client `fetch` to `/api/...` without a token
 * and found 84, nearly all of them correct: `/api/season` and `/api/quests`
 * answer a stranger on purpose, and `/api/library` reads the viewer only to
 * decide how much to show. A guard that cries at correct code gets waived,
 * and a waived guard is worse than none.
 *
 * So the rule is derived from the routes themselves. A route that says
 *
 *     const user = await authedUser(req);
 *     if (!user) return res.status(401).json(...)
 *
 * has DECLARED that a stranger gets nothing, and a client call to it without
 * a token is always a bug. Everything else is left alone. When a route starts
 * or stops refusing strangers, this guard follows on its own, with no list to
 * update and no chance of the list going stale in the direction that hides a
 * problem.
 *
 * Usage: node scripts/check-auth-fetch.mjs [--json]
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

const ROOT = process.cwd();
const CLIENT = path.join(ROOT, "client", "src");

/** Every .ts under server/routes, which is where route modules now live. */
function routeModules(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeModules(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out.sort();
}

/**
 * Every file that registers routes, not just the big one.
 *
 * This was the single path `server/index.ts`. Route handlers are now moving
 * out into `server/routes/<domain>.ts` modules, and the first three that moved
 * took their routes out of this guard's sight with them: the count it reports
 * fell from 348 route prefixes to 342 and it still said "clean". A guard that
 * quietly checks fewer things than it did yesterday is the same class of
 * failure this file was written to catch, one level up. So the source is a
 * LIST, and a new route module joins it by existing.
 */
const SERVER_FILES = [path.join(ROOT, "server", "index.ts"), ...routeModules(path.join(ROOT, "server", "routes"))];
const METHODS = new Set(["get", "post", "put", "delete", "patch"]);

/**
 * Files whose calls are exempt, with the reason.
 *
 * `gameApi.ts` is the helper that attaches the token, so the fetch inside it
 * is the implementation of the rule rather than a violation of it.
 */
const EXEMPT_FILES = ["lib/gameApi.ts"];

/**
 * A declared route as a pattern that matches a WHOLE path.
 *
 * `/api/x/:id/passed` becomes `^/api/x/[^/]+/passed$`. The first draft cut the
 * route at its first parameter and prefix-matched, which made
 * `/api/x/:id/passed` swallow `/api/x/${id}/document` and report a sibling
 * route as a violation. A route is a path, so it is matched as one.
 */
const patternOf = (route) =>
  new RegExp("^" + route.split("/").map((seg) =>
    seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("/") + "$");

/**
 * Every route that answers a stranger with 401.
 *
 * `isAdmin` and `mayManage*` count as well as `authedUser`: all three end in
 * the same refusal, and an admin surface reached without credentials fails
 * exactly the way the map did.
 */
function refusingRoutes() {
  const routes = new Map();
  for (const SERVER of SERVER_FILES) {
  const src = fs.readFileSync(SERVER, "utf8");
  const sf = ts.createSourceFile(SERVER, src, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      METHODS.has(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const route = node.arguments[0].text;
      if (route.startsWith("/api/")) {
        const body = node.getText(sf);
        /*
         * Two ways a route refuses a stranger, and the second one nearly made
         * this guard useless.
         *
         * Most answer `status(401)`. But `/api/map/promise` answers 200 with
         * `reason: "anonymous"` in the body, on purpose: it talks to a map
         * inside an iframe that needs words rather than a status code. Keying
         * only on 401 meant the guard came back clean against the very bug it
         * was written for, which was proven by putting the bug back and
         * watching it pass. A refusal is a refusal whatever its status line.
         */
        const refusesStranger =
          /status\(401\)/.test(body) || /reason:\s*["']anonymous["']/.test(body);
        if (/\b(authedUser|isAdmin|mayManage\w*)\b/.test(body) && refusesStranger) {
          const method = node.expression.name.text.toUpperCase();
          routes.set(`${method} ${route}`, {
            method,
            declared: route,
            pattern: patternOf(route),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  }
  return [...routes.values()];
}

/**
 * The path a call is aimed at, with interpolations as `*`, or null.
 *
 * `/api/admin/events/${g.id}/rsvps` yields the path with a star where the id
 * goes. The
 * first draft read the template HEAD only and lost everything after the first
 * interpolation, which is how a call to `.../document` was matched against the
 * handler for `.../passed`.
 */
function routeOf(arg) {
  if (!arg) return null;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (ts.isTemplateExpression(arg)) {
    return arg.head.text + arg.templateSpans.map((sp) => "*" + sp.literal.text).join("");
  }
  return null;
}

/** The method a call uses. Absent means GET, as fetch itself defines it. */
function methodOf(call, sf) {
  const opts = call.arguments[1];
  if (!opts) return "GET";
  const m = /\bmethod\s*:\s*["'`]([A-Za-z]+)["'`]/.exec(opts.getText(sf));
  return m ? m[1].toUpperCase() : "GET";
}

/**
 * Every named thing declared in a file, so a call that hands its headers to a
 * helper can be read through that helper.
 *
 * Without this the guard is wrong about correct code. `Stay.tsx` writes
 * `headers: headers()`, and the helper two dozen lines up returns
 * `{ Authorization: ... }` when a token exists. Reading only the call text
 * calls that a violation, and a guard that flags correct code gets waived.
 */
function declarationsIn(sf) {
  const map = new Map();
  const visit = (node) => {
    // Every declaration of a name, joined. A file with two `headers` helpers
    // passes if EITHER attaches a token: a gate that guesses wrong should err
    // toward silence, because a false alarm is what gets a gate switched off.
    const add = (name, text) => map.set(name, (map.get(name) ?? "") + "\n" + text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      add(node.name.text, node.getText(sf));
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      add(node.name.text, node.getText(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return map;
}

/**
 * Does this call carry a token, directly or through a helper it names?
 *
 * ONE level of indirection, deliberately. It covers the real pattern (a local
 * `headers()` or a `withAuth` object) without becoming a reachability
 * analysis that nobody can predict. A second level would buy little and make
 * a failure hard to argue with, which is the property a gate most needs.
 */
function carriesToken(call, sf, helpers) {
  if (/Authorization/i.test(call.getText(sf))) return true;

  const opts = call.arguments[1];
  // No options at all is a bare GET with no headers, which is the clearest
  // possible case of no token.
  if (!opts || !ts.isObjectLiteralExpression(opts)) return false;

  const headers = opts.properties.find(
    (p) => p.name && ts.isIdentifier(p.name) && p.name.text === "headers",
  );
  if (!headers || !ts.isPropertyAssignment(headers)) return false;

  /*
   * A name the headers come from: resolve it if this file declares it, and
   * otherwise STAY SILENT.
   *
   * `ProjectHistory.tsx` takes `headers` as a PROP, so the token is attached
   * by a parent this script never opens. Flagging that is a false alarm, and
   * a gate that raises false alarms is a gate somebody switches off. The
   * guard speaks only about calls it can see all of, which still covers the
   * bug it exists for: headers written inline with no token among them.
   */
  const viaName = (name) => {
    const decl = helpers.get(name);
    return decl === undefined ? true : /Authorization/i.test(decl);
  };

  /**
   * The name behind a value, whether it is handed over plain or called.
   *
   * `...headers` and `...headers()` mean the same thing to a reader and have
   * to mean the same thing here. Handling only the bare identifier reported
   * `Events.tsx` as tokenless when it spreads `headers()`, which does attach
   * the token.
   */
  const nameOf = (expr) =>
    ts.isIdentifier(expr) ? expr.text
      : ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) ? expr.expression.text
      : null;

  const value = headers.initializer;

  if (ts.isObjectLiteralExpression(value)) {
    if (/Authorization/i.test(value.getText(sf))) return true;
    /*
     * A spread carries whatever it carries. `WalkEditorPanel` writes
     * `{ ...auth, "Content-Type": ... }`, where `auth` holds the admin
     * token, so reading the literal's own text alone calls correct code a
     * violation.
     */
    return value.properties.some((p) => {
      if (!ts.isSpreadAssignment(p)) return false;
      const n = nameOf(p.expression);
      // A spread of something this file does not declare is unreadable, and
      // unreadable means silent.
      return n === null ? true : viaName(n);
    });
  }

  const name = nameOf(value);
  return name ? viaName(name) : true;
}

function walkDir(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const REFUSING = refusingRoutes();

// A FLOOR ON WHAT WAS READ (R206). Reading no refusing routes would check no
// client call and pass. 536 prefixes were read on 2026-11-05; the floor is half
// that, and AUTH_FETCH_MIN moves it.
const REFUSING_FLOOR = Number(process.env.AUTH_FETCH_MIN ?? 250);
if (REFUSING.length < REFUSING_FLOOR) {
  console.error(`::error::the auth guard read only ${REFUSING.length} refusing route prefix(es), under its floor of ${REFUSING_FLOOR}. It has stopped reading the server, so nothing was checked.`);
  process.exit(1);
}
/** A client `*` stands for one path segment, exactly like an Express param. */
const refuses = (route, method) =>
  REFUSING.find((r) => r.method === method && r.pattern.test(route.replace(/\*/g, "x")));

const findings = [];

for (const file of walkDir(CLIENT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (EXEMPT_FILES.some((e) => rel.endsWith(e))) continue;
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helpers = declarationsIn(sf);

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      const route = routeOf(node.arguments[0]);
      const hit = route && route.startsWith("/api/")
        ? refuses(route, methodOf(node, sf))
        : null;
      if (process.env.AUTH_GUARD_DEBUG && route) {
        console.log("DEBUG", rel, route, methodOf(node, sf), "hit:", !!hit,
          "carries:", carriesToken(node, sf, helpers));
      }
      if (hit && !carriesToken(node, sf, helpers)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        findings.push({ file: rel, line: line + 1, route, refusedBy: hit.declared });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ refusingRoutes: REFUSING.length, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

if (!findings.length) {
  console.log(
    `Auth guard: clean. ${REFUSING.length} route prefixes refuse strangers with 401, ` +
      `and every client call to one of them carries a token.`,
  );
  process.exit(0);
}

console.log(`\nAUTH GUARD FAILED — a client call sends no token to a route that refuses strangers.`);
console.log(`These routes answer 401 without an Authorization header, so the server will read`);
console.log(`each of these calls as a signed-out stranger and answer accordingly.\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`      calls ${f.route}   (refused by the handler for ${f.refusedBy})`);
}
console.log(`\nFix the CALL, never this script: use gameFetch (client/src/lib/gameApi.ts), or`);
console.log(`pass Authorization yourself when it authenticates another way, such as an admin`);
console.log(`password. If the route should answer a stranger, that belongs in the route.`);
process.exit(1);

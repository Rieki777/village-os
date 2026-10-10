#!/usr/bin/env node
/**
 * A route with one door is a route nobody finds.
 *
 * /campaigns shipped mounted, titled, module-gated and correct, and the only
 * link to it in the entire client sat on /campaign/:slug, which is itself only
 * reachable from /campaigns. A closed loop: the list linked to the detail page
 * and the detail page linked back, and nothing outside the pair pointed in. No
 * gate saw it, because every gate the repo had asks whether a page WORKS. This
 * one asks whether a page can be REACHED.
 *
 * TWO, not one, and the second one is the whole point. A single entrance is an
 * entrance that a nav reshuffle deletes silently: the page keeps rendering, the
 * tests keep passing, and the route becomes address-bar-only. Two independent
 * doors mean a link can be moved without a page falling off the site.
 *
 * WHAT COUNTS AS A DOOR. A link a member can click that lands on the route:
 * a wouter `<Link href>`, a plain `<a href>` with a site-relative target, an
 * `href`/`to` value in a nav config, a `navigate()` / `setLocation()` call, and
 * `window.location.href = "..."`. Dynamic targets count: a `<Link
 * href={`/campaign/${slug}`}>` is a real door onto /campaign/:slug and is
 * resolved by shape, one wildcard per interpolation.
 *
 * WHAT DOES NOT COUNT, and each of these was a deliberate call:
 *  - The router itself (client/src/App.tsx). Mounting a route is not linking it.
 *  - Tests. A door in a test is a door for developers.
 *  - `location.startsWith("/quests")` and friends. A route string used to ASK
 *    where you are is not a link, so only link-shaped positions are counted;
 *    everything else route-shaped is reported as NOT CLASSIFIED rather than
 *    silently dropped, because a scanner's blind spot announces itself as a
 *    result (scripts/qa/README.md).
 *
 * The route list is DERIVED from the router by scripts/qa/routes.mjs, the same
 * deriver the map's door sweep uses. A checked-in route list goes stale the
 * first time somebody adds a page, and a reachability report that silently
 * misses a route reports the site as reachable.
 *
 * Usage:
 *   node scripts/check-route-reachability.mjs           # the gate
 *   node scripts/check-route-reachability.mjs --table   # every route and its doors
 *   node scripts/check-route-reachability.mjs --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { routes } from "./qa/routes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "client", "src");

/** How many independent doors a route needs. */
const REQUIRED = 2;

/**
 * Routes that legitimately have fewer than two doors, each with the reason it
 * is legitimate. Nothing lands here because it is inconvenient to link; a line
 * here is a claim that a second door would be WORSE than one, and the reason
 * has to say why.
 *
 * Adding a line is a decision. Read the reason above it before you add another.
 */
const ALLOWLIST = {
  // The router's own catch-all. Not a destination: it is what a bad URL lands
  // on, so linking to it from anywhere would be pointing at a dead end on
  // purpose. Excluded from the route list by the deriver too; belt and braces.
  "/404": "the not-found page, reached by failing to reach something else",

  // Password flows arrive from an EMAIL, not from the site. The set-password
  // link carries a one-time token and is useless without it, so a nav entry
  // would be a link to an error message. /forgot-password keeps its one door
  // on the sign-in page, which is the only place a person wants it.
  "/set-password": "entered from a one-time email link; a site link has no token",
  // The founder's way in on day one, and the way back in after a lockout. It
  // is handed over out of band, the way a reset link is: FORK_RUNBOOK and the
  // provisioning docs name it, and the person who needs it has been told to go
  // there. A public nav entry saying "claim this village" would invite every
  // visitor to try, and the page's whole job is to be useless to all of them.
  // It refuses anyone without the deployment's own ADMIN_PASSWORD, and refuses
  // everyone once a village has a founder.
  "/claim": "handed over in the runbook, like a reset link; a public door would invite the wrong people",

  "/forgot-password": "one door, on the sign-in page, which is where a locked-out person already is",

  // One page per arrival from an outside service, and meaningless without the
  // arrival's id. Its door is that arrival's card on /review, which is where a
  // steward already is when there is something to read; a nav entry could only
  // point at no batch at all.
  "/review/structure/:batchId": "one page per arrival, opened from that arrival's card on /review",

  // The alias. /tokens is what the nav links to and what a member sees;
  // /wallet stays mounted only because Stripe return URLs and order
  // notifications already carry it (server/index.ts). A second door would be
  // advertising the spelling that is being retired.
  "/wallet": "a compatibility alias for /tokens; kept for URLs already issued",

  // Admin-only surfaces, reached from inside Village Settings by an admin who
  // is already there. The account menu carries /admin behind a role check;
  // /admin/mint is one tool inside it and belongs to that page alone.
  "/admin/mint": "one tool inside Village Settings, reached from the page that owns it",

  // The class select lives on the profile page and nowhere else on purpose: it
  // is part of who you are here, and a second entrance would put an identity
  // choice in a menu next to unrelated links.
  "/profile/characters": "the class select, reached from the profile page that owns it",
};

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".vite"]);
const isTest = (rel) => /\.(test|spec)\.tsx?$/.test(rel) || rel.includes("__tests__");

/**
 * The router file. Excluded from the scan because a `path=` there is the route
 * being mounted, never a door onto it, and `component={Crowdpool}` is not a
 * link either.
 */
const ROUTER_REL = "client/src/App.tsx";

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(path.join(dir, entry.name), out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

/**
 * Attribute and property names whose value is somewhere a browser navigates TO.
 * `to` is here for any router component that spells it that way; wouter uses
 * `href`, and both cost nothing to accept.
 */
const LINK_KEYS = new Set(["href", "to"]);

/**
 * The same, for object properties in a nav config. `path` is here and NOT in
 * the JSX set: `path` on a JSX element is the router mounting a route, which is
 * the one thing that is never a door, and the mobile tab bar spells its slots
 * `{ path: "/quests" }`.
 */
const CONFIG_LINK_KEYS = new Set(["href", "to", "path"]);

/**
 * Functions that navigate. `navigate` and `setLocation` are the two names this
 * client destructures out of wouter's `useLocation()`; the rest are the shapes
 * a future page is likely to reach for.
 */
const NAV_FNS = new Set(["navigate", "setLocation", "setLoc", "redirect", "push", "replace"]);

/**
 * Surfaces only an admin or founder ever sees.
 *
 * The Command Centre and Village Settings are full of links to public pages,
 * and counting those as doors would certify a page as reachable on the strength
 * of a link behind a sign-in wall. So a door here satisfies the rule only for a
 * route that is ITSELF admin-only: an admin reaching an admin page from an admin
 * page is a real journey; a member reaching a public page from a page they
 * cannot open is not.
 *
 * The role check that makes these admin-only lives in client/src/config/nav.ts
 * (roles: ["admin", "founder"]) and in each page's own gate.
 */
const ADMIN_SURFACES = new Set([
  "client/src/pages/Admin.tsx",
  "client/src/pages/ProjectHistory.tsx",
  "client/src/pages/Mint.tsx",
]);

/** Routes an ordinary member never opens, so an admin-only door is the right door. */
const ADMIN_ROUTES = new Set(["/admin", "/admin/mint", "/journey-to-launch", "/project-history"]);

/**
 * The literal, and the shape it can navigate to.
 *
 * A plain string is itself. A template literal becomes a pattern with one `*`
 * per interpolation, so `/campaign/${slug}` is `/campaign/*` and resolves onto
 * `/campaign/:slug` by shape. Anything else (a bare identifier, a concatenation,
 * a ternary) is unresolvable and is counted as NOT CLASSIFIED.
 */
function targetOf(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [{ kind: "literal", value: node.text, node }];
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) value += "*" + span.literal.text;
    return [{ kind: "template", value, node }];
  }
  if (ts.isParenthesizedExpression(node)) return targetOf(node.expression);
  // `href={admin ? "/admin" : "/profile"}` is two doors, and the first draft
  // read it as none.
  if (ts.isConditionalExpression(node)) {
    return [...(targetOf(node.whenTrue) ?? []), ...(targetOf(node.whenFalse) ?? [])];
  }
  // `href={n.link ?? "/profile"}` is a door onto /profile every time the
  // notification carries no link of its own, which is most of them.
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...(targetOf(node.left) ?? []), ...(targetOf(node.right) ?? [])];
  }
  return null;
}

/**
 * The property name behind a dynamic link: `href={step.link}` yields "link".
 *
 * Journey pages hold their steps in a const array and render `href={step.link}`
 * over it, so the door is a `link:` field in an object literal a hundred lines
 * up. That is still a door a member clicks, and reading only the JSX position
 * missed twenty of them, including the only entrance to /reserve. The name is
 * collected per FILE and applied only within that file, so "url" meaning a
 * route on one page cannot make "url" mean a route on another.
 */
function tracedFieldOf(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) return tracedFieldOf(node.expression);
  if (ts.isConditionalExpression(node)) return tracedFieldOf(node.whenTrue) ?? tracedFieldOf(node.whenFalse);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return tracedFieldOf(node.left) ?? tracedFieldOf(node.right);
  }
  return null;
}

/** Site-relative, not an API call, not an external URL, not a bare anchor. */
function isRouteShaped(v) {
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/api/") && !v.startsWith("/assets/");
}

/**
 * Everything a file offers as a door, plus everything route-shaped that it
 * could not classify as one.
 */
function scanFile(abs) {
  const src = fs.readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const doors = [];
  const unclassified = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  /**
   * Literals already counted as a door.
   *
   * The walk descends into every node it has just classified, so without this
   * the string inside `<Link href="/investor">` is met a second time as a bare
   * literal and lands in the NOT CLASSIFIED pile. The first draft double-counted
   * 30 of the footer's own links that way and reported them as unreadable.
   */
  const claimed = new Set();

  // PASS ONE: which object fields, and which local functions, does this file
  // render as a link target?
  const traced = new Set();
  const tracedFns = new Set();
  const noteTarget = (expr) => {
    if (!expr) return;
    // `href={reserveHref(type.key)}` — the route is built inside a helper, and
    // that helper's `/reserve?...` was the ONLY door onto that page.
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
      tracedFns.add(expr.expression.text);
      return;
    }
    const field = tracedFieldOf(expr);
    if (field) traced.add(field);
  };
  const findTraced = (node) => {
    if (ts.isJsxAttribute(node) && LINK_KEYS.has(node.name.getText())) {
      const init = node.initializer;
      if (init && ts.isJsxExpression(init)) noteTarget(init.expression);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (NAV_FNS.has(name) && node.arguments.length > 0) noteTarget(node.arguments[0]);
    }
    ts.forEachChild(node, findTraced);
  };
  findTraced(sf);

  const record = (node, why) => {
    const targets = targetOf(node);
    if (!targets || targets.length === 0) return false;
    let any = false;
    for (const t of targets) {
      claimed.add(t.node);
      if (ts.isTemplateExpression(t.node)) claimed.add(t.node.head);
      if (!isRouteShaped(t.value)) continue;
      doors.push({ target: t.value, kind: t.kind, line: lineOf(t.node), why });
      any = true;
    }
    return any;
  };

  // PASS TWO: the doors themselves.
  const visit = (node) => {
    // <Link href="/x">, <a href="/x">, <Redirect to="/x">
    if (ts.isJsxAttribute(node) && LINK_KEYS.has(node.name.getText())) {
      const init = node.initializer;
      const expr = init && ts.isJsxExpression(init) ? init.expression : init;
      if (expr) record(expr, "jsx");
    }
    // { href: "/x" } in a nav config, and { link: "/x" } where this file
    // renders that field as a link.
    else if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText().replace(/['"]/g, "");
      if (CONFIG_LINK_KEYS.has(key) || traced.has(key)) record(node.initializer, "config");
    }
    // A helper this file uses to BUILD a link target: everything route-shaped
    // inside it is a door.
    else if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.name && ts.isIdentifier(node.name) && tracedFns.has(node.name.text)
    ) {
      const harvest = (inner) => {
        record(inner, "helper");
        ts.forEachChild(inner, harvest);
      };
      ts.forEachChild(node, harvest);
    }
    // navigate("/x"), setLocation("/x")
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      if (NAV_FNS.has(name) && node.arguments.length > 0) record(node.arguments[0], "navigate");
    }
    // window.location.href = "/x"
    else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      /\blocation\b/.test(node.left.expression.getText()) &&
      node.left.name.text === "href"
    ) {
      record(node.right, "location");
    }
    // Everything route-shaped that reached none of the above. Reported, never
    // dropped: a scanner that skips in silence reports its blind spot as a pass.
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!claimed.has(node) && isRouteShaped(node.text) && !ts.isImportDeclaration(node.parent)) {
        unclassified.push({ target: node.text, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { doors, unclassified };
}

/**
 * Does this door land on this route?
 *
 * Segment by segment. A `*` (an interpolation) matches a `:param` segment and
 * only that: `/profile/${handle}` is a door onto /profile/:handle and is NOT a
 * door onto /profile/characters, which is a different page with a fixed name.
 */
function lands(target, route) {
  const clean = target.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/";
  const t = clean === "/" ? [""] : clean.split("/");
  const r = route === "/" ? [""] : route.split("/");
  if (t.length !== r.length) return false;
  for (let i = 0; i < r.length; i++) {
    const rs = r[i];
    const tsg = t[i];
    if (rs.startsWith(":")) {
      if (!tsg) return false; // a param segment needs something in it
      continue; // a literal or a wildcard both fill a parameter
    }
    if (tsg === "*") return false; // an interpolation is not a fixed segment
    if (tsg !== rs) return false;
  }
  return true;
}

function audit() {
  const { concrete, parameterised } = routes();
  const all = [...concrete, ...parameterised].sort();

  const files = walkFiles(CLIENT).filter((f) => !isTest(rel(f)) && rel(f) !== ROUTER_REL);
  const inbound = new Map(all.map((r) => [r, []]));
  let notClassified = 0;
  const notClassifiedSamples = [];

  for (const abs of files) {
    const { doors, unclassified } = scanFile(abs);
    for (const d of doors) {
      let landed = false;
      for (const r of all) {
        if (lands(d.target, r)) {
          inbound.get(r).push({ file: rel(abs), line: d.line, target: d.target, why: d.why });
          landed = true;
          break;
        }
      }
      // A door to nowhere is a different defect and check-doc-links owns docs,
      // so it is reported rather than failed on here.
      if (!landed) notClassifiedSamples.push(`${rel(abs)}:${d.line} -> ${d.target} (matches no route)`);
      if (!landed) notClassified++;
    }
    for (const u of unclassified) {
      // Only route-shaped strings that ACTUALLY name a route are interesting;
      // the rest are storage keys, event names and API paths.
      if (all.some((r) => lands(u.target, r))) {
        notClassified++;
        notClassifiedSamples.push(`${rel(abs)}:${u.line} -> ${u.target} (route-shaped, not a link position)`);
      }
    }
  }

  // A door counts once per FILE. Six links to /quests from one page are one
  // way in: what the rule is buying is independence, and two links in one
  // component die together when that component is edited.
  const rows = all.map((route) => {
    const hits = inbound.get(route);
    const sources = [...new Set(hits.map((h) => h.file))];
    // Admin-only doors count only toward admin-only routes; see ADMIN_SURFACES.
    const counted = ADMIN_ROUTES.has(route) ? sources : sources.filter((f) => !ADMIN_SURFACES.has(f));
    const adminOnly = sources.filter((f) => !counted.includes(f));
    return { route, count: counted.length, sources: counted, adminOnly, hits, allowed: route in ALLOWLIST };
  });

  return { rows, files: files.length, notClassified, notClassifiedSamples };
}

const { rows, files, notClassified, notClassifiedSamples } = audit();
const failing = rows.filter((r) => !r.allowed && r.count < REQUIRED);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ required: REQUIRED, files, notClassified, rows, failing: failing.map((f) => f.route) }, null, 2));
  process.exit(failing.length > 0 ? 1 : 0);
}

if (process.argv.includes("--table")) {
  const width = Math.max(...rows.map((r) => r.route.length));
  for (const r of rows) {
    const mark = r.allowed ? "allowed" : r.count >= REQUIRED ? "ok" : "THIN";
    const admin = r.adminOnly.length ? `  [admin-only: ${r.adminOnly.join(", ")}]` : "";
    console.log(`${r.route.padEnd(width)}  ${String(r.count).padStart(2)}  ${mark.padEnd(7)}  ${r.sources.join(", ")}${admin}`);
  }
  console.log("");
}

console.log(`  ${rows.length} route(s) read from client/src/App.tsx, ${files} client file(s) scanned`);
console.log(`  ${Object.keys(ALLOWLIST).length} route(s) allowlisted for a single entrance`);
console.log(`  ${notClassified} route-shaped string(s) NOT CLASSIFIED as a door`);
if (notClassified > 0 && process.argv.includes("--table")) {
  for (const s of notClassifiedSamples) console.log(`    ${s}`);
}

if (failing.length > 0) {
  console.log("");
  console.log(`  ${failing.length} route(s) reachable from fewer than ${REQUIRED} places:`);
  for (const f of failing) {
    const where = f.sources.length ? f.sources.join(", ") : "nothing in client/src links here";
    console.log(`    ${f.route}  (${f.count})  ${where}`);
  }
  console.log("");
  console.log("  A route with one door loses it the next time a nav is reshuffled, and the page");
  console.log("  stays mounted, tested and invisible. Give each of these a second way in: a nav");
  console.log("  group in client/src/config/nav.ts, the footer in client/src/components/Layout.tsx,");
  console.log("  or a contextual link from the page a member is on when they want it. If one");
  console.log("  entrance is genuinely right, add it to ALLOWLIST here with the reason.");
  process.exit(1);
}

console.log(`  every route has ${REQUIRED} or more ways in`);

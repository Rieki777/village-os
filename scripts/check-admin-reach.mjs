#!/usr/bin/env node
/**
 * THE ORPHAN GUARD: an admin write route that nothing in the browser calls.
 *
 * ── THE CLASS THIS EXISTS FOR ────────────────────────────────────────────
 * An audit of this codebase found twenty-seven dead or partial admin surfaces
 * with one root cause: the write and the read had drifted apart, and NOTHING
 * IN THE ADMIN UI COULD TELL. Same Save button, same green toast, same promise
 * that changes go live immediately, whether the value landed in the table a
 * renderer selects from or in a document nobody reads.
 *
 * That drift has two shapes, and this guard catches the second one:
 *
 *   1. A form that writes a field no renderer reads.
 *   2. A ROUTE WITH NO DOOR: a working, tested, audited admin route that no
 *      client code ever calls.
 *
 * Shape 2 shipped twice in this repo and both were found by a person reading
 * files rather than by anything mechanical. `DELETE /api/admin/org/seatings/:id`
 * and `POST /api/admin/org/seatings/:id/forget` had their own test suite
 * (`server/lib/orgForget.test.ts`), their own e2e coverage, a line in
 * FORK_RUNBOOK.md, and no caller anywhere in `client/src`: a village could seat
 * somebody and never unseat them, and the right-to-be-forgotten path was
 * reachable only by curl. `PUT /api/admin/map/vocabulary` was the same story
 * with a CLI script as its only writer.
 *
 * A green test suite says a route WORKS. It never says a founder can reach it.
 *
 * ── WHY A ROUTE-SHAPED RULE, AND WHY MUTATIONS ONLY ──────────────────────
 * Reads are excluded on purpose. An admin GET with no caller is a diagnostic
 * endpoint or a curl affordance, and flagging those would fill the allowlist
 * with correct code until nobody read it. A POST, PUT, PATCH or DELETE under
 * `/api/admin` is different: it exists to let a founder CHANGE something, and a
 * change nobody can make from the product is not a feature the product has.
 *
 * ── THE ALLOWLIST IS THE POINT ───────────────────────────────────────────
 * Every entry carries a sentence saying why this one route is deliberately
 * unreachable from the browser. That is the whole mechanism: adding a route
 * with no door is still allowed, and it now costs one line that a reviewer
 * reads. Silence is what this ends.
 *
 * Usage: node scripts/check-admin-reach.mjs [--json] [--table]
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();

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
 * took their routes out of this guard's sight with them: the admin write
 * routes it checks fell from 170 to 161 and it still reported 0 orphans. A
 * guard that quietly checks fewer things than it did yesterday is the same
 * class of failure this file was written to catch. So the source is a LIST,
 * and a new route module joins it by existing.
 */
const SERVER_FILES = [path.join(ROOT, "server", "index.ts"), ...routeModules(path.join(ROOT, "server", "routes"))];
const CLIENT = path.join(ROOT, "client", "src");
const WRITE_METHODS = new Set(["post", "put", "delete", "patch"]);

/**
 * Admin write routes with no browser caller, and why that is right.
 *
 * ADD A LINE HERE ONLY WITH A REASON A REVIEWER WOULD ACCEPT. "Not built yet"
 * is one; so is "an operator command, run by hand". "I could not find the
 * caller" is not: if you cannot find it, neither can a founder.
 */
/*
 * Emptied 2026-08-31. The single entry here was POST /api/admin/bootstrap,
 * waived on the grounds that first-boot founder creation "runs before any
 * admin UI can exist, from the runbook". That reason expired the moment
 * client/src/pages/Bootstrap.tsx shipped: the route now has a real browser
 * caller at /claim, so the waiver was claiming something untrue and this guard
 * said so on the next run.
 *
 * Worth keeping the shape of that: the waiver was honest when it was written
 * and became a lie without anyone editing it. That is what this check is for.
 *
 * ── REFILLED THE SAME DAY, BY THE LAND LANE ────────────────────────────────
 *
 * The two entries below are waiting on a SCREEN, not on a decision. The land
 * routes (server/routes/land.ts, migration 0123) were built in a lane that was
 * explicitly forbidden to edit client/src/pages/Admin.tsx, because another wave
 * holds that file. The screen they need is specified field by field in
 * docs/VILLAGE_LAND.md, down to the request bodies and the error copy, so
 * wiring it is a small job for whoever owns Admin.tsx next.
 *
 * BOTH LINES COME OUT THE DAY THAT SCREEN LANDS. They keep a known, documented
 * gap visible. They are not a claim that a founder should never reach these
 * routes: a founder cannot set the village's location from the product at all
 * until the screen exists, and that is the thing being recorded.
 */
const ALLOWED = {
  "PUT /api/admin/land":
    "Waiting on the admin screen specified in docs/VILLAGE_LAND.md. The lane that built the route could not edit Admin.tsx, which another wave holds. Delete this line when the screen lands.",
  "POST /api/admin/land/imagery":
    "Waiting on the same screen as PUT /api/admin/land. Delete this line when the screen lands.",
  "POST /api/admin/site-pull":
    "The fetch half of 'paste your site address' shipped on its own, deliberately: it is the security surface and it was built and reviewed apart from the screen that calls it. The setup screen and the brand extractor are separate lanes. Delete this line when the screen lands.",
  "POST /api/admin/site-pull/assets":
    "Waiting on the same screen as POST /api/admin/site-pull, and on the rights checkbox that screen has to render. Delete this line when the screen lands.",
  "POST /api/admin/resources/budgets/:id/bonus":
    "The unspent-cap bonus. It cannot succeed on this build and a control for it would be a button that can only ever refuse: a bonus needs the village to have voted a circle's work complete, that vote's subject is a COMMITMENT RECORD, and no table in this schema stores one (measured across a migrated schema, server/lib/circleBonusGate.ts). The reading beside it, GET on the same path, is reachable and says exactly that. Delete this line when a village has somewhere to write down what a circle takes on.",
};

/**
 * THE STANDING DEBT, and the reason this list is separate from `ALLOWED`.
 *
 * Blurring "deliberately has no door" together with "shipped without one and
 * nobody noticed" is the exact confusion this guard exists to end, so they are
 * two lists. `ALLOWED` is a design decision. Everything below is a defect that
 * predates the guard, recorded on the day it landed so the count can only fall.
 *
 * A RATCHET, like `scripts/brand-refs-baseline.json`. Each line names a route a
 * founder cannot reach from the product. Wire it or delete it; either way the
 * line comes out, and the run fails if a line stays here after the route
 * becomes reachable. Nothing new joins this list: a route added from here on
 * gets a door or an `ALLOWED` entry with a reason.
 */
const STANDING_ORPHANS = {
  "POST /api/admin/assistant/studio":
    "The Setup Studio assistant. It is the only prompt that reads the village brief and nothing calls it.",
  /*
   * `PUT /api/admin/season` came off this list by DELETION, not by wiring.
   * It was the pre-multi-season single write and the Season tab has used
   * `PUT /api/admin/seasons` since. Same for `DELETE /api/admin/activity/:id`
   * further down, which offered a founder no way to remove a pulse line that
   * did not start with curl.
   */
  /*
   * `PUT /api/admin/governance/weights/:userId` and
   * `POST /api/admin/governance/weights/bulk` came off this list by WIRING.
   * The screen the variable promised by name is Admin, The Game, Voting
   * Weights (`client/src/components/admin/VotingWeightsPanel.tsx`): the
   * member table, the bulk pass, the required reason, the standing count of
   * members holding no weight, and the append-only trail. `openBallot`'s
   * refusal already said "Allocate weight before opening a ballot"; there is
   * now somewhere to do it.
   */
  "POST /api/admin/org/drafts": "The assistant's org-draft flow has no admin surface.",
  "POST /api/admin/org/drafts/:id/changes": "The assistant's org-draft flow has no admin surface.",
  "PUT /api/admin/org/drafts/:id/vision": "The assistant's org-draft flow has no admin surface.",
  "POST /api/admin/org/drafts/:id/publish": "The assistant's org-draft flow has no admin surface.",
  "POST /api/admin/org/drafts/:id/revert": "The assistant's org-draft flow has no admin surface.",
  /*
   * `POST /api/admin/org/relations` and `DELETE /api/admin/org/relations/:id`
   * came off this list by WIRING too. The door the entries called owed is
   * `client/src/components/admin/RelationsEditor.tsx`, mounted at the foot of
   * the Org Chart tab beside the circles and seats a link joins, so
   * `RelationLines.tsx` now draws rows a founder wrote.
   */
  "POST /api/admin/exchange/reconcile":
    "An operator command for a stuck settlement. The scheduler runs it hourly and this is the manual override, so it may well belong in ALLOWED. Decide, then move it.",
  "POST /api/admin/library/sweep": "Scheduler-owned, with a by-hand override. Same decision as the reconcile above.",
  "POST /api/admin/library/adjust": "A ledger correction from the runbook. Same decision.",
  "PUT /api/admin/recordings/:id/transcript": "The by-hand repair path for a pasted transcript. Same decision.",
  "POST /api/admin/users/:id/send-password-link":
    "Verified orphan: the only mentions anywhere are the handler and a curl line in FORK_RUNBOOK.md. Sending a member their set-password link is an ordinary support act and belongs on the player row.",
};

const WAIVED = { ...ALLOWED, ...STANDING_ORPHANS };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every `.tsx?` file under client/src that a person can actually reach.
 *
 * TESTS ARE NOT DOORS, and this exclusion is the whole guard.
 * `DELETE /api/admin/org/seatings/:id` and its `/forget` sibling had a unit
 * suite, e2e coverage and a runbook line, and no button: counting a test file
 * as a caller would let exactly that ship again while the gate reported clean.
 * A green test says a route works; only a control says a founder can reach it.
 */
function clientFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      clientFiles(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Every admin write route the server declares, keyed `METHOD /route`.
 */
function adminWriteRoutes() {
  const routes = new Map();
  for (const SERVER of SERVER_FILES) {
  const src = fs.readFileSync(SERVER, "utf8");
  const sf = ts.createSourceFile(SERVER, src, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITE_METHODS.has(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const route = node.arguments[0].text;
      if (route.startsWith("/api/admin/")) {
        const method = node.expression.name.text.toUpperCase();
        routes.set(`${method} ${route}`, { method, route });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  }
  return [...routes.values()];
}

/**
 * The path a client call aims at, with every interpolation as `*`.
 *
 * `${API_BASE}/admin/drafts/${id}/${accept ? "accept" : "reject"}` becomes
 * `*​/admin/drafts/*​/*`. Reading only the template head, which the first draft
 * of the auth guard did, loses everything after the first interpolation and
 * turns half the admin UI into an orphan report.
 */
function targetsOf(arg) {
  if (!arg) return [];
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return [arg.text];
  if (ts.isTemplateExpression(arg)) {
    return [arg.head.text + arg.templateSpans.map((sp) => "*" + sp.literal.text).join("")];
  }
  /*
   * `fetch(mode === "launch" ? "/api/admin/assistant/launch" : "...")` is one
   * call reaching two routes, and reading it as reaching neither reported the
   * launch assistant and the organize assistant as having no door while
   * JourneyToLaunch.tsx was calling both. A branch is a caller.
   */
  if (ts.isConditionalExpression(arg)) {
    return [...targetsOf(arg.whenTrue), ...targetsOf(arg.whenFalse)];
  }
  if (ts.isParenthesizedExpression(arg)) return targetsOf(arg.expression);
  return [];
}

/** Every path any client call names, query strings removed. */
function clientTargets() {
  const targets = new Set();
  for (const file of clientFiles(CLIENT)) {
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        // Any call whose first argument looks like a path. `fetch`, `gameFetch`,
        // a tab's local `call`, `act`, `api` and whatever the next one is
        // called: naming the functions would make this guard wrong the day
        // somebody writes a new helper, which is the failure mode a gate can
        // least afford.
        for (const t of targetsOf(node.arguments[0])) {
          if (/(^|\*)\/(api\/)?[a-z]/i.test(t)) {
            targets.add(t.split("?")[0].replace(/\/+$/, ""));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...targets];
}

/**
 * Does any client target address this route?
 *
 * Matched segment by segment, and a `*` on EITHER side matches anything. Both
 * directions are load-bearing and the first draft only had one of them:
 *
 *  - a route's `:id` must match a client interpolation, obviously;
 *  - a client interpolation must match a route's LITERAL segment, because
 *    `/admin/drafts/${id}/${accept ? "accept" : "reject"}` is one call that
 *    reaches two routes, and reading it as reaching neither reported the
 *    draft queue, the whole org-draft flow and half the module tabs as dead.
 *
 * The leading `/api` is optional because every admin tab builds its paths from
 * an `API_BASE` constant, which arrives here as a leading `*`.
 */
function segmentsOf(pathname) {
  return pathname.replace(/^(?:\/api|\*)/, "").split("/").filter((s) => s !== "");
}

/**
 * A client segment as a matcher. A `*` is an interpolation and matches
 * anything; the LITERAL text around it still has to line up.
 *
 * That detail is the difference between a gate and a rubber stamp. One call
 * writes `/admin/tools${query}`, whose second segment arrives as `tools*`.
 * Treating any starred segment as a free wildcard made that one call match
 * every two-segment admin route in the server, `/admin/bootstrap` included,
 * and the guard reported a route with no door as reachable.
 */
function segmentMatcher(seg) {
  return new RegExp("^" + seg.split("*").map(esc).join(".*") + "$");
}

function reached(route, targets) {
  const want = segmentsOf(route);
  return targets.some((t) => {
    const got = segmentsOf(t);
    if (got.length !== want.length) return false;
    return want.every((seg, i) => {
      if (seg.startsWith(":")) return true;
      return segmentMatcher(got[i]).test(seg);
    });
  });
}

const targets = clientTargets();
const routes = adminWriteRoutes();
const orphans = [];
const staleWaivers = [];

for (const { method, route } of routes) {
  const key = `${method} ${route}`;
  const isReached = reached(route, targets);
  if (isReached && WAIVED[key]) staleWaivers.push(key);
  if (!isReached && !WAIVED[key]) orphans.push(key);
}

const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({
    routes: routes.length,
    orphans,
    staleWaivers,
    allowed: Object.keys(ALLOWED).length,
    standingOrphans: Object.keys(STANDING_ORPHANS).length,
  }, null, 2));
} else {
  if (process.argv.includes("--table")) {
    for (const { method, route } of routes) {
      const key = `${method} ${route}`;
      const state = ALLOWED[key] ? "waived" : STANDING_ORPHANS[key] ? "standing" : reached(route, targets) ? "reachable" : "ORPHAN";
      console.log(`  ${state.padEnd(10)} ${key}`);
    }
    console.log("");
  }
  console.log(
    `admin write routes: ${routes.length}, ` +
    `deliberately doorless: ${Object.keys(ALLOWED).length}, ` +
    `standing debt: ${Object.keys(STANDING_ORPHANS).length} route(s) a founder cannot reach`,
  );
  for (const key of staleWaivers) {
    console.log(`  waiver no longer needed, delete the line: ${key}`);
  }
  for (const key of orphans) {
    console.log(`  no client caller: ${key}`);
  }
  if (orphans.length) {
    console.log("");
    console.log("An admin write route with no door is not a feature a founder has.");
    console.log("Add the control that calls it, or add a line to ALLOWED in this");
    console.log("script saying why this one is deliberately unreachable.");
  }
  console.log(`  ${orphans.length} orphan admin write route(s)`);
}

// A waiver that is no longer needed fails too. A stale allowlist is how a guard
// stops describing the code it guards.
process.exit(orphans.length + staleWaivers.length > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * THE SEASON TWO TEST VILLAGE, step 2 of 3: seed it through the REAL routes, the way a fork does.
 *
 *   node scripts/qa/season-village/seed.mjs            seed the village boot.mjs is running
 *   node scripts/qa/season-village/seed.mjs --fresh    ask boot.mjs to rebuild the village from nothing, then seed it
 *
 * Every write goes through an HTTP route a founder or a member would use. No SQL,
 * no fixture rows, and nothing the test harness does to its scratch schemas: in
 * particular invite-only stays at the platform default, which is ON, so every
 * account here arrives by an invitation link exactly as it would on a real fork.
 *
 * What it builds (a Season Two project around its first canvas reading):
 *
 *   - founder 1 through POST /api/admin/bootstrap, then its set-password link;
 *   - the village's name, through the admin brand overlay;
 *   - founders 2 and 3 and four members, each by an invitation founder 1 sent,
 *     founders 2 and 3 then appointed to the founder role;
 *   - admission by vouching: founders 2 and 3 vouch for each member (with the
 *     arrival vouch the invitation carried, that is the three the platform asks
 *     for), and the founders admit each other with a steward's super vouch;
 *   - a care holder: a member seated in the Trained Practitioners role, with a
 *     term to the March equinox, named as the exit policy's restorative intake
 *     role, and the restorative steps written in the village's own words;
 *   - governance switched on for members;
 *   - a governing purpose statement, when the route exists;
 *   - canvas readings, when the route exists: at least one block at each level
 *     from 1 to 5, one block read twice, and five blocks left empty.
 *
 * Tokens, the generated passwords and the facts the walk checks for are written
 * to <QA_OUT_DIR>/state/tokens.json, outside the repository. Seeding is
 * idempotent with --fresh: the same command always yields the same village.
 * Without it, a village already seeded on this boot is verified and left alone,
 * and a village somebody else seeded is refused.
 */
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import {
  api,
  baseUrl,
  controlDir,
  fail,
  health,
  isAlive,
  readJson,
  serverState,
  sleep,
  stateDir,
  Stop,
  stop,
  tokensFile,
  writeJson,
} from "./shared.mjs";

const FRESH = process.argv.includes("--fresh");

// ── the village, as data ───────────────────────────────────────────────────

const VILLAGE = "Fernhollow";

/** Who lives here. `key` is how the walk and a later wave refer to a person. */
const PEOPLE = [
  { key: "founder", name: "Ada Linden", founder: true, note: "founder 1, made by bootstrap; holds the canvas pen" },
  { key: "founder2", name: "Bram Okafor", founder: true, note: "founder 2, invited then appointed" },
  { key: "founder3", name: "Cleo Marsh", founder: true, note: "founder 3, invited then appointed" },
  { key: "care", name: "Rowan Vale", founder: false, note: "member; the care holder (restorative intake role)" },
  { key: "member", name: "Sage Ito", founder: false, note: "member; the one the walk signs in as" },
  { key: "member3", name: "Tomas Reyes", founder: false, note: "member" },
  { key: "member4", name: "Uma Hart", founder: false, note: "member" },
];

/** The seeded capability role that holds care here, and how long the seat runs. */
const CARE_ROLE = "practitioners";
const CARE_TERM_ENDS_ON = "2027-03-20";

const RESTORATIVE_STEPS = [
  "Ask the care holder for a quiet first conversation; nothing is written down yet.",
  "The care holder meets each person alone, then brings them together over tea.",
  "What the two of you agree goes on one page, with a date to look at it again.",
];

const PURPOSE =
  `${VILLAGE} exists to help the families, growers, carers and makers of our valley who are tired of carrying ` +
  "their lives alone and far from the land, move from private struggle inside systems that take more than they " +
  "return, to a shared place held in common, by building homes people can afford, growing food where it is " +
  "eaten, keeping a room for care and repair, teaching skills in the open, and deciding together where everyone " +
  "can see, so that children grow up among neighbours, the soil recovers, and what we build here outlives the " +
  "people who began it.";

/**
 * Seven blocks read and five left empty. The newest level of each read block
 * covers every level from 1 to 5, and Purpose is read twice so a block with a
 * history is part of the village. The 1 is a named decline, which the ruling
 * says counts as a block on record.
 */
const READINGS = [
  { blockId: "purpose", level: 2, moment: "baseline", sentence: "The three founders drafted a purpose line and nobody else has read it yet." },
  { blockId: "purpose", level: 3, moment: "canvas-moon", sentence: "The draft went to the first gathering and came back with two changes everyone could live with." },
  { blockId: "team", level: 4, moment: "baseline", sentence: "Seven people know who is in, and the next person arrives by an invitation and three vouches." },
  { blockId: "roles", level: 3, moment: "baseline", sentence: "The care seat is filled and has a term; most other work still happens by whoever notices." },
  { blockId: "meetings", level: 5, moment: "baseline", sentence: "The Saturday circle has met every week since spring and everyone knows its shape." },
  { blockId: "power", level: 1, moment: "baseline", sentence: "Absent: we have not decided how decisions are made, because we want one season of practice first." },
  { blockId: "conflict", level: 2, moment: "baseline", sentence: "The restorative steps are written in our words, and nobody has walked them yet." },
  { blockId: "resourcing", level: 3, moment: "baseline", sentence: "Dues cover the land costs this year; nothing beyond that is planned." },
];
const EMPTY_BLOCKS = ["stakeholders", "coordination", "learning", "legal", "impact"];
const LEVEL_WORD = { 1: "Absent", 2: "Forming", 3: "Emerging", 4: "Growing", 5: "Thriving" };

// ── plumbing ───────────────────────────────────────────────────────────────

const email = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${VILLAGE.toLowerCase()}.test`;
const password = () => `Sv-${crypto.randomBytes(12).toString("base64url")}`;

let BASE = "";

/** A route that must answer one of `ok`, or the seed stops with what it said. */
async function must(what, method, route, body, token, ok = [200, 201]) {
  const r = await api(BASE, method, route, body, token);
  if (!ok.includes(r.status)) {
    throw new Error(`${what}: ${method} ${route} answered ${r.status}: ${(r.text || "").slice(0, 400)}`);
  }
  return r;
}

const log = (line) => console.log(`  ${line}`);

/** Ask the supervisor for a fresh village and wait for it to come back under a new boot id. */
async function freshVillage(state) {
  if (!state || !isAlive(state.supervisorPid)) {
    fail("--fresh needs boot.mjs running as the supervisor: it is the process that can drop the schema and restart the server. Start it with `node scripts/qa/season-village/boot.mjs --fresh` instead.");
  }
  fs.writeFileSync(path.join(controlDir(), "restart-fresh"), new Date().toISOString());
  log(`asked the supervisor (pid ${state.supervisorPid}) for a fresh village; waiting for it to boot`);
  const started = Date.now();
  let said = 0;
  for (;;) {
    await sleep(2000);
    const now = serverState();
    if (now && now.villageId !== state.villageId && !fs.existsSync(path.join(controlDir(), "restart-fresh"))) return now;
    if (!now && !isAlive(state.supervisorPid)) fail("the supervisor stopped while rebuilding the village; read its output.");
    const waited = Math.floor((Date.now() - started) / 1000);
    if (waited - said >= 30) {
      said = waited;
      log(`still waiting for the fresh boot (${waited}s)`);
    }
    if (waited > 900) fail("the fresh village did not come up within 15 minutes.");
  }
}

// ── the seed ───────────────────────────────────────────────────────────────

let state = serverState();
if (FRESH) state = await freshVillage(state);
BASE = baseUrl();

const h = await health(BASE);
if (!h.ok) fail(`${BASE}/health did not answer ok (${h.status} ${h.error ?? ""}). Is boot.mjs running?`);
if (state && !process.env.QA_BASE_URL && h.build !== state.build) {
  fail(`${BASE} answers with build ${h.build}, and boot.mjs started build ${state.build}. Something else holds the port.`);
}

const prior = readJson(tokensFile());
if (prior && state && prior.villageId === state.villageId) {
  log(`this village (${state.villageId}) is already seeded; checking its sessions and leaving it alone`);
  let bad = 0;
  for (const p of prior.people) {
    const r = await api(BASE, "GET", "/api/profile", undefined, p.token);
    if (r.status !== 200) bad++;
    log(`${r.status === 200 ? "ok  " : "FAIL"} ${p.name}: GET /api/profile ${r.status}`);
  }
  if (bad) fail(`${bad} stored session(s) no longer work. Run seed.mjs --fresh to rebuild the village.`);
  printSummary(prior);
  stop(0);
}

const adminPassword = (process.env.QA_ADMIN_PASSWORD ?? "").trim() || readJson(path.join(stateDir(), "secrets.json"))?.adminPassword;
if (!adminPassword) fail("No bootstrap password: boot.mjs writes one to the state dir, or set QA_ADMIN_PASSWORD for a server it did not start.");

const people = PEOPLE.map((p) => ({ ...p, email: email(p.name), password: password(), userId: "", token: "", admitted: false }));
const byKey = Object.fromEntries(people.map((p) => [p.key, p]));
const founder = byKey.founder;
const skipped = [];
let canvasRecorded = false;

try {
  console.log(`\nseeding ${VILLAGE} on ${BASE} (build ${h.build})`);

  // 1. The founder, by bootstrap and the set-password link it returns.
  const boot = await api(BASE, "POST", "/api/admin/bootstrap", { password: adminPassword, email: founder.email, name: founder.name });
  if (boot.status === 403) {
    fail("This village has already been bootstrapped by somebody else's run, and this seed has no tokens for it. Run seed.mjs --fresh.");
  }
  if (boot.status !== 200 || !boot.json?.claimUrl) throw new Error(`bootstrap answered ${boot.status}: ${boot.text.slice(0, 300)}`);
  const claim = new URL(boot.json.claimUrl, BASE).searchParams.get("token");
  const set = await must("set-password", "POST", "/api/auth/set-password", { token: claim, password: founder.password });
  founder.token = set.json.token;
  founder.userId = set.json.user.id;
  log(`founder 1 ${founder.name}: bootstrap, then set-password (emailed: ${boot.json.emailed})`);

  // 2. The village's name.
  await must("brand", "PUT", "/api/admin/brand", { project: { name: VILLAGE } }, founder.token);
  log(`village named ${VILLAGE}`);

  // 3. Invite-only is ON: prove it before relying on it.
  const door = await api(BASE, "POST", "/api/auth/register", {
    name: "Nobody Invited", email: `uninvited@${VILLAGE.toLowerCase()}.test`, password: password(), paths: ["resident"],
  });
  if (door.status !== 403 || door.json?.code !== "invitation_required") {
    throw new Error(`a register with no invitation answered ${door.status} ${door.text.slice(0, 200)}; invite-only should be on by default`);
  }
  log("invite-only is on: a register with no invitation was refused (403 invitation_required)");

  // 4. Everybody else, each by an invitation founder 1 made.
  for (const p of people.filter((x) => x !== founder)) {
    const inv = await must(`invite for ${p.name}`, "POST", "/api/invites", {}, founder.token);
    const invite = new URL(inv.json.path, BASE).searchParams.get("invite");
    const reg = await must(`register ${p.name}`, "POST", "/api/auth/register", {
      name: p.name, email: p.email, password: p.password, paths: ["resident"], invite,
    });
    p.token = reg.json.token;
    p.userId = reg.json.user.id;
  }
  log(`${people.length - 1} people registered, each through an invitation link`);

  // 5. Founders 2 and 3, appointed.
  for (const p of people.filter((x) => x.founder && x !== founder)) {
    await must(`appoint ${p.name}`, "PUT", `/api/admin/users/${p.userId}/role`, { role: "founder" }, founder.token);
  }
  log("founders 2 and 3 appointed to the founder role");

  // 6. Admission, by vouching.
  const record = (p, r) => { p.admitted = r.json?.admitted === true; };
  for (const p of people.filter((x) => !x.founder)) {
    await must(`${byKey.founder2.name} vouches for ${p.name}`, "POST", `/api/members/${p.userId}/vouch`, { note: "I know them from the valley." }, byKey.founder2.token);
    record(p, await must(`${byKey.founder3.name} vouches for ${p.name}`, "POST", `/api/members/${p.userId}/vouch`, { note: "We have worked side by side." }, byKey.founder3.token));
  }
  for (const p of [byKey.founder2, byKey.founder3]) {
    record(p, await must(`super vouch for ${p.name}`, "POST", `/api/members/${p.userId}/super-vouch`, { note: "A founder of this village." }, founder.token));
  }
  record(founder, await must(`super vouch for ${founder.name}`, "POST", `/api/members/${founder.userId}/super-vouch`, { note: "A founder of this village." }, byKey.founder2.token));
  const notIn = people.filter((p) => !p.admitted);
  if (notIn.length) throw new Error(`not admitted after vouching: ${notIn.map((p) => p.name).join(", ")}`);
  log("all seven admitted: members by three vouches each, founders by a steward's super vouch");

  // 7. The care holder.
  const care = byKey.care;
  await must(`seat ${care.name}`, "POST", `/api/admin/roles/${CARE_ROLE}/holders`, { userId: care.userId, action: "add", termEndsOn: CARE_TERM_ENDS_ON }, founder.token);
  const roles = await must("read roles", "GET", "/api/roles", undefined, founder.token);
  const careRole = (roles.json ?? []).find((r) => r.id === CARE_ROLE);
  if (!careRole) throw new Error(`the role ${CARE_ROLE} is not in GET /api/roles`);
  log(`${care.name} seated in ${careRole.name} until ${CARE_TERM_ENDS_ON}`);

  // 8. The exit policy's restorative path, in the village's own words, reaching the care holder.
  const pol = await must("read exit policy", "GET", "/api/exit-policy");
  const p0 = pol.json.policy;
  await must("write exit policy", "PUT", "/api/admin/exit-policy", {
    placeholder: p0.placeholder,
    voluntary: p0.voluntary,
    involuntary: {
      decidingDomainId: p0.involuntary?.decidingDomainId ?? "",
      appealDomainId: p0.involuntary?.appealDomainId ?? "",
      process: p0.involuntary?.process ?? "",
      grounds: p0.involuntary?.grounds ?? [],
    },
    restorative: { intakeContactRole: CARE_ROLE, steps: RESTORATIVE_STEPS },
  }, founder.token);
  const pol2 = await must("re-read exit policy", "GET", "/api/exit-policy");
  const wording = pol2.json.platformWording ?? [];
  if (pol2.json.policy?.restorative?.intakeContactRole !== CARE_ROLE) throw new Error("the exit policy did not keep the intake role");
  if (wording.includes("restorativeSteps")) throw new Error("the restorative steps still read as the platform's words");
  log(`restorative steps written in the village's words; intake reaches ${careRole.name} (terms still in the platform's words: ${wording.join(", ") || "none"})`);

  // 9. Governance on for members.
  const gov = await must("governance on", "PUT", "/api/admin/modules/governance/lifecycle", { lifecycle: "members" }, founder.token);
  if (gov.json?.served !== "members") throw new Error(`governance is served as ${gov.json?.served}`);
  log("governance switched on for members");

  // 10. The governing purpose statement, if this build has the route.
  const gpsRead = await api(BASE, "GET", "/api/admin/purpose", undefined, founder.token);
  if (gpsRead.status === 404) {
    skipped.push("purpose statement: GET /api/admin/purpose is 404 on this build");
    log("SKIPPED purpose statement: the route does not exist on this build");
  } else {
    await must("purpose statement", "PUT", "/api/admin/purpose", { statement: PURPOSE }, founder.token);
    log(`purpose statement written (${PURPOSE.split(/\s+/).length} words)`);
  }

  // 11. Canvas readings, if this build has the route.
  const canvasRead = await api(BASE, "GET", "/api/canvas", undefined, founder.token);
  if (canvasRead.status === 404) {
    skipped.push("canvas readings: GET /api/canvas is 404 on this build");
    log("SKIPPED canvas readings: the route does not exist on this build");
  } else {
    for (const r of READINGS) await must(`reading ${r.blockId}`, "POST", "/api/canvas/readings", r, founder.token);
    canvasRecorded = true;
    const after = await must("re-read canvas", "GET", "/api/canvas", undefined, byKey.member.token);
    const latest = Object.fromEntries((after.json.blocks ?? []).map((b) => [b.id, b.latest?.level ?? null]));
    const want = {};
    for (const r of READINGS) want[r.blockId] = r.level;
    for (const b of EMPTY_BLOCKS) want[b] = null;
    const wrong = Object.entries(want).filter(([id, lvl]) => latest[id] !== lvl);
    if (wrong.length) throw new Error(`the canvas reads back differently: ${wrong.map(([id, l]) => `${id} wanted ${l}, got ${latest[id]}`).join("; ")}`);
    const history = (after.json.blocks ?? []).find((b) => b.id === "purpose")?.history?.length ?? 0;
    log(`${READINGS.length} readings recorded; read back by a member: levels as written, purpose history ${history}, ${EMPTY_BLOCKS.length} blocks empty`);
  }

  // 12. Every session works, and says who it is.
  for (const p of people) {
    const r = await must(`profile of ${p.name}`, "GET", "/api/profile", undefined, p.token);
    p.role = r.json?.role ?? "member";
  }
  const roleOf = Object.fromEntries(people.map((p) => [p.key, p.role]));
  if (roleOf.founder !== "founder" || roleOf.founder2 !== "founder" || roleOf.founder3 !== "founder" || roleOf.member !== "member") {
    throw new Error(`roles read back as ${JSON.stringify(roleOf)}`);
  }

  const out = {
    bootId: state?.bootId ?? null,
    villageId: state?.villageId ?? null,
    base: BASE,
    build: h.build,
    seededAt: new Date().toISOString(),
    villageName: VILLAGE,
    // What the walk substitutes for $placeholders in surfaces.json.
    facts: {
      villageName: VILLAGE,
      restorativeStep: RESTORATIVE_STEPS[0],
      careRoleName: careRole.name,
      careHolderName: care.name,
    },
    // Which person the walk signs in as, per walk role.
    walkAs: { member: "member", founder: "founder" },
    readings: canvasRecorded ? READINGS.map((r) => ({ blockId: r.blockId, level: r.level, moment: r.moment })) : [],
    emptyBlocks: canvasRecorded ? EMPTY_BLOCKS : [],
    skipped,
    people: people.map(({ key, name, email: e, password: pw, userId, token, role, admitted, note }) => ({
      key, name, email: e, password: pw, userId, token, role, admitted, note,
    })),
  };
  writeJson(tokensFile(), out);
  printSummary(out);
} catch (e) {
  if (e instanceof Stop) throw e;
  console.error(`\nSEED FAILED: ${e?.message ?? e}`);
  process.exitCode = 1;
}

function printSummary(s) {
  console.log(`\n  ${s.villageName} on ${s.base} (build ${s.build}, boot ${s.bootId ?? "not started by boot.mjs"})`);
  console.log("  people:");
  for (const p of s.people) console.log(`    ${p.name.padEnd(12)} ${String(p.role).padEnd(8)} ${p.admitted ? "admitted" : "NOT ADMITTED"}  ${p.email}  (${p.note})`);
  const latest = {};
  for (const r of s.readings) latest[r.blockId] = r;
  console.log("  canvas, newest reading per block:");
  for (const [id, r] of Object.entries(latest)) console.log(`    ${id.padEnd(13)} ${r.level} ${LEVEL_WORD[r.level]} (${r.moment})`);
  console.log(`    empty: ${s.emptyBlocks.join(", ")}`);
  console.log(`  care holder: ${s.facts.careHolderName} in ${s.facts.careRoleName}`);
  console.log(`  skipped: ${s.skipped.length ? s.skipped.join("; ") : "nothing"}`);
  console.log(`  tokens and passwords (test values, outside the repository): ${tokensFile()}`);
}

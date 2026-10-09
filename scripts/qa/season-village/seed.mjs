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
 *   - the conflict door's promise: a reply time in hours and a named contact
 *     outside the village, both on the exit policy;
 *   - governance switched on for members;
 *   - a governing purpose statement, when the route exists;
 *   - canvas readings, when the route exists: at least one block at each level
 *     from 1 to 5, one block read twice, and five blocks left empty;
 *   - the season file, when the route exists: the template the platform ships
 *     (docs/seasons/season-two-2026.json), loaded by the pen and read back as a
 *     member;
 *   - one open canvas suggestion, when the five frames' routes exist: a member
 *     who is not the one the walk signs in as suggests words for the Power
 *     block, with a line on how they serve the purpose, and the walk's member
 *     reads it back with no pen of their own.
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
  ROOT,
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

/**
 * The conflict door's promise and its outside contact (Wave 2, the launch
 * checklist's `conflict-door` row). The platform supplies neither, so the
 * village names both, and /exit-policy prints them.
 */
const REPLY_HOURS = 48;
const OUTSIDE_CONTACT = { name: "Hazel Quinn", organisation: "Valley Mediation Network", howToReach: "hazel@valley-mediation.test" };

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

/**
 * The canvas suggestion (Wave 3b, the five frames): words for the Power block's
 * "Who decides what" section, from a member the walk does not sign in as, so the
 * walk's member reads somebody else's suggestion and the founder holds the pen.
 * Power changes how the village works, so the suggestion carries a purpose line
 * of at least twelve words once the statement above is written.
 */
const SUGGESTER = "member3";
const SUGGESTION = "We decide by consent at the Saturday circle, and write each decision in the village record the same day.";
const SUGGESTION_PURPOSE = "Deciding together where everyone can see is part of what this village says it exists to do.";
/**
 * A second suggestion from the same member, which the walk's founder declines
 * with a note: a decided suggestion and its note stay readable under "Decided
 * lately", and its author is told (audit of Wave 3b, 2026-09-28).
 */
const DECLINED_SUGGESTION = "Every decision waits for a full moon, so nobody decides in a hurry.";
const DECLINE_NOTE = "A month is too long for small things; we keep the Saturday circle.";

/** The season template the platform ships (docs/FORK_RUNBOOK.md), loaded as a founder would load it. */
/*
 * Wave 4 (2026-10-01). The key moments: two of this seed's own acts are moments,
 * the bootstrap (collaboration, all twelve blocks) and governance reaching members
 * (funding, the four blocks below), and before the handover the administrators
 * hear them. The titles are revisitTitle's in shared/canvasRevisit.ts, word for word.
 */
const FUNDING_BLOCKS = ["power", "resourcing", "legal", "impact"];
const FUNDING_TITLE = "Before you raise: look at Power again.";
const CLAIMED_TITLE = "Something new is starting. Look at Power again.";
/*
 * The companion. Resourcing's one brief section, written at the administrators'
 * audience, which is the default an answer adopted on the canvas keeps: the shape
 * that once made the companion tell members the village had adopted nothing.
 */
const KEPT_SECTION = { id: "economy", title: "How value moves", block: "resourcing", blockName: "Resourcing" };
const KEPT_WORDS = "Each cycle the treasury pays every circle its agreed share first, and the Saturday circle decides the rest.";
const KEPT_QUESTION = "What did we adopt for Resourcing?";

const SEASON_TEMPLATE = "docs/seasons/season-two-2026.json";
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
/** Set when the season file loads: { name, lastWeekTitle, weeks }. */
let seasonLoaded = null;
/** Set when the exit policy keeps the conflict door's reply time and outside contact. */
let conflictDoor = false;
/** Set when the canvas suggestion is open and reads back: { body, by }. */
let canvasSuggested = null;
/** Set when the key moments reach the bell and the canvas moon names their blocks (Wave 4). */
let keyMoments = null;
/** Set when the companion answers both askers truthfully about a section closed to members (Wave 4). */
let companionAsked = null;

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
    restorative: { intakeContactRole: CARE_ROLE, steps: RESTORATIVE_STEPS, replyHours: REPLY_HOURS, outsideContact: OUTSIDE_CONTACT },
  }, founder.token);
  // Read back as the founder: since the conflict agreement (Wave 3a) the public
  // read names the outside contact by organisation only, and a member reads it whole.
  const pol2 = await must("re-read exit policy", "GET", "/api/exit-policy", undefined, founder.token);
  const wording = pol2.json.platformWording ?? [];
  if (pol2.json.policy?.restorative?.intakeContactRole !== CARE_ROLE) throw new Error("the exit policy did not keep the intake role");
  if (wording.includes("restorativeSteps")) throw new Error("the restorative steps still read as the platform's words");
  log(`restorative steps written in the village's words; intake reaches ${careRole.name} (terms still in the platform's words: ${wording.join(", ") || "none"})`);
  // A build before the conflict door's fields drops them on save, so the walk's lines about them go unmeasured there.
  const kept = pol2.json.policy?.restorative;
  conflictDoor = kept?.replyHours === REPLY_HOURS && kept?.outsideContact?.name === OUTSIDE_CONTACT.name;
  if (conflictDoor) log(`conflict door: a reply within ${REPLY_HOURS} hours, and ${OUTSIDE_CONTACT.name} outside the village`);
  else {
    skipped.push("conflict door: this build does not keep a reply time or an outside contact");
    log("SKIPPED conflict door: the exit policy did not keep a reply time or an outside contact on this build");
  }

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

  // 12. The season file, if this build has the route (Wave 1, 2026-09-26): the template the
  // platform ships, loaded by the pen through the same PUT a founder's "Save this season" makes,
  // then read back as a member. The walk requires its name and its last week's title on the
  // Canvas view, which render only from /api/canvas/season data.
  const seasonRead = await api(BASE, "GET", "/api/canvas/season", undefined, founder.token);
  if (seasonRead.status === 404) {
    skipped.push("season file: GET /api/canvas/season is 404 on this build");
    log("SKIPPED season file: the route does not exist on this build");
  } else {
    const file = JSON.parse(fs.readFileSync(path.join(ROOT, SEASON_TEMPLATE), "utf8"));
    await must("load the season", "PUT", "/api/canvas/season", file, founder.token);
    const back = await must("re-read season", "GET", "/api/canvas/season", undefined, byKey.member.token);
    const s = back.json?.season;
    if (!s || s.name !== file.name || s.weeks?.length !== file.weeks.length) {
      throw new Error(`the season reads back differently: ${JSON.stringify(back.json).slice(0, 300)}`);
    }
    if (back.json.mayEdit !== false) throw new Error("a member reads the season with mayEdit not false");
    seasonLoaded = { name: s.name, lastWeekTitle: s.weeks[s.weeks.length - 1].title, weeks: s.weeks.length };
    log(`season "${s.name}" loaded from ${SEASON_TEMPLATE} (${s.weeks.length} weeks); read back by a member, who may not edit it`);
  }

  // 12b. A canvas suggestion, if this build has the five frames' routes (Wave 3b, 2026-09-28):
  // POST /api/canvas/proposals as a member, the door every member has, then the Power block
  // read back as the walk's member, who must see it open, first-named, and hold no pen for it.
  const framesRead = await api(BASE, "GET", "/api/canvas/blocks/power", undefined, byKey.member.token);
  if (framesRead.status === 404) {
    skipped.push("canvas suggestion: GET /api/canvas/blocks/power is 404 on this build");
    log("SKIPPED canvas suggestion: the five frames' routes do not exist on this build");
  } else {
    const by = byKey[SUGGESTER];
    const sent = await must("canvas suggestion", "POST", "/api/canvas/proposals", {
      blockId: "power", target: "words", sectionId: "decisions", body: SUGGESTION, servesPurpose: SUGGESTION_PURPOSE,
    }, by.token);
    const id = sent.json?.proposal?.id;
    const back = await must("re-read the Power block", "GET", "/api/canvas/blocks/power", undefined, byKey.member.token);
    const listed = (back.json?.proposals ?? []).find((p) => p.id === id);
    const first = by.name.split(" ")[0];
    if (!listed || listed.status !== "open" || listed.body !== SUGGESTION || listed.proposedBy?.name !== first) {
      throw new Error(`the canvas suggestion reads back differently: ${JSON.stringify(listed ?? back.json?.proposals ?? null).slice(0, 300)}`);
    }
    if (listed.pen?.youMayAdopt !== false || listed.youProposedIt !== false) throw new Error("the walk's member reads the suggestion as one they may adopt or made");
    canvasSuggested = { body: SUGGESTION, by: first };
    log(`${by.name} suggested words for the Power block (open); read back by ${byKey.member.name}, who holds no pen for it`);

    // 12c. A decided suggestion: the founder declines a second one with a note, which every
    // reader of the block reads back under "Decided lately", and its author is told.
    const second = await must("second canvas suggestion", "POST", "/api/canvas/proposals", {
      blockId: "power", target: "words", sectionId: "decisions", body: DECLINED_SUGGESTION, servesPurpose: SUGGESTION_PURPOSE,
    }, by.token);
    const secondId = second.json?.proposal?.id;
    await must("decline the second canvas suggestion", "POST", `/api/canvas/proposals/${secondId}/decline`, { note: DECLINE_NOTE }, byKey.founder.token);
    const after = await must("re-read the Power block after the decline", "GET", "/api/canvas/blocks/power", undefined, byKey.member.token);
    const decided = (after.json?.decided ?? []).find((p) => p.id === secondId);
    const decider = byKey.founder.name.split(" ")[0];
    if (!decided || decided.status !== "declined" || decided.decisionNote !== DECLINE_NOTE || decided.decidedBy?.name !== decider) {
      throw new Error(`the declined suggestion reads back differently: ${JSON.stringify(decided ?? after.json?.decided ?? null).slice(0, 300)}`);
    }
    if ((after.json?.proposals ?? []).some((p) => p.id === secondId)) throw new Error("the declined suggestion is still listed as open");
    const bell = await must("the suggester's notifications", "GET", "/api/notifications", undefined, by.token);
    const rows = Array.isArray(bell.json) ? bell.json : bell.json?.notifications ?? bell.json?.items ?? [];
    if (!rows.some((n) => String(n.title ?? "").includes("Power block was declined"))) {
      throw new Error(`the suggester was not told of the decline: ${JSON.stringify(rows).slice(0, 300)}`);
    }
    canvasSuggested.declineNote = DECLINE_NOTE;
    canvasSuggested.decider = decider;
    log(`${byKey.founder.name} declined a second suggestion with a note; ${byKey.member.name} reads it under Decided lately, and ${by.name} was told`);
  }

  // 12d. The key moments and the canvas moon, if this build has them (Wave 4,
  // triggers-agreements). Nothing is written here: the moments were raised by step 1
  // (the bootstrap claims the instance) and step 9 (governance reaches members). A
  // moment is delivered after the act that raised it has answered, so the founder's
  // bell is read until the funding notice is there, for ten seconds at most.
  const moonFirst = await api(BASE, "GET", "/api/canvas/moon", undefined, byKey.member.token);
  if (moonFirst.status === 404) {
    skipped.push("key moments and the canvas moon: GET /api/canvas/moon is 404 on this build");
    log("SKIPPED key moments and the canvas moon: the routes do not exist on this build");
  } else {
    if (moonFirst.status !== 200) throw new Error(`the walk's member reads GET /api/canvas/moon as ${moonFirst.status}: ${moonFirst.text.slice(0, 300)}`);
    const revisits = async (p) => {
      const bell = await must(`${p.name}'s notifications`, "GET", "/api/notifications", undefined, p.token);
      const rows = Array.isArray(bell.json) ? bell.json : bell.json?.notifications ?? [];
      return rows.filter((n) => n.type === "canvas_revisit").map((n) => String(n.title ?? ""));
    };
    let heard = [];
    for (let i = 0; i < 20; i++) {
      heard = await revisits(founder);
      if (heard.includes(FUNDING_TITLE)) break;
      await sleep(500);
    }
    if (!heard.includes(FUNDING_TITLE)) {
      throw new Error(`governance reaching members raised no funding notice for ${founder.name}: ${JSON.stringify(heard).slice(0, 300)}`);
    }
    if (!heard.includes(CLAIMED_TITLE)) {
      throw new Error(`the bootstrap raised no collaboration notice for ${founder.name}: ${JSON.stringify(heard).slice(0, 300)}`);
    }
    const memberHeard = await revisits(byKey.member);
    const moon = await must("re-read the canvas moon", "GET", "/api/canvas/moon", undefined, byKey.member.token);
    const next = moon.json?.next;
    const named = (next?.blocks ?? []).map((b) => b.id);
    const unnamed = FUNDING_BLOCKS.filter((b) => !named.includes(b));
    if (!next || unnamed.length) {
      throw new Error(`the canvas moon does not name the blocks this moon's moments flagged (${unnamed.join(", ")}): ${JSON.stringify(moon.json).slice(0, 300)}`);
    }
    if (moon.json.mayOffer !== false) throw new Error("the walk's member is offered the canvas moon gathering");
    keyMoments = { founderNotices: heard.length, memberNotices: memberHeard.length, newMoonAt: String(next.newMoonAt ?? ""), blocks: next.blocks.map((b) => b.name) };
    log(`key moments: ${founder.name}'s bell holds ${heard.length} canvas notices (the claim and governance reaching members), ${byKey.member.name}'s holds ${memberHeard.length}; the canvas moon of ${keyMoments.newMoonAt.slice(0, 10)} names ${keyMoments.blocks.join(", ")}`);
  }

  // 12e. The companion, if this build has it (Wave 4). The founder writes Resourcing's
  // one brief section at the administrators' audience, then the walk's member and the
  // founder each ask about Resourcing from its card, with no model connected. The member
  // is told the section is written and closed to members, the founder that it is adopted,
  // neither that the village adopted nothing, and neither reads its words.
  const companionRead = await api(BASE, "GET", "/api/agent/companion", undefined, byKey.member.token);
  if (companionRead.status === 404) {
    skipped.push("the companion: GET /api/agent/companion is 404 on this build");
    log("SKIPPED the companion: its routes do not exist on this build");
  } else {
    if (companionRead.status !== 200) throw new Error(`the walk's member reads GET /api/agent/companion as ${companionRead.status}: ${companionRead.text.slice(0, 300)}`);
    await must(`write the ${KEPT_SECTION.blockName} section`, "PUT", `/api/admin/brain/${KEPT_SECTION.id}`, { body: KEPT_WORDS, audience: "admin" }, founder.token);
    const ask = async (p) =>
      (await must(`${p.name} asks about ${KEPT_SECTION.blockName}`, "POST", "/api/agent/ask", {
        messages: [{ role: "user", content: KEPT_QUESTION }], block: KEPT_SECTION.block,
      }, p.token)).json ?? {};
    const falseLine = `has not adopted an answer for ${KEPT_SECTION.blockName}`;
    const told = { member: await ask(byKey.member), founder: await ask(founder) };
    for (const [who, a] of Object.entries(told)) {
      const reply = String(a.reply ?? "");
      if (a.path !== "deterministic") throw new Error(`the ${who}'s question took the ${a.path} path with no model connected`);
      if (reply.includes(falseLine)) throw new Error(`the ${who} was told the village ${falseLine}, and it has: ${reply.slice(0, 300)}`);
      if (reply.includes(KEPT_WORDS)) throw new Error(`the ${who} was read words written at the administrators' audience: ${reply.slice(0, 300)}`);
    }
    const memberLine = `"${KEPT_SECTION.title}" is written, and not opened to members`;
    const founderLine = `"${KEPT_SECTION.title}" is adopted, and its words stay with the administrators`;
    if (!String(told.member.reply).includes(memberLine)) throw new Error(`the member was not told ${memberLine}: ${String(told.member.reply).slice(0, 300)}`);
    if (!String(told.founder.reply).includes(founderLine)) throw new Error(`the founder was not told ${founderLine}: ${String(told.founder.reply).slice(0, 300)}`);
    companionAsked = { block: KEPT_SECTION.blockName, member: memberLine, founder: founderLine };
    log(`the companion, with no model: ${byKey.member.name} is told ${memberLine}; ${founder.name} is told ${founderLine}; neither reads the words`);
  }

  // 12f. The village agreements read, if this build has it (Wave 4, defect 9): any
  // admitted member may list them, and a fresh village has none.
  const agreements = await api(BASE, "GET", "/api/governance/agreements", undefined, byKey.member.token);
  if (agreements.status === 404) {
    skipped.push("village agreements: GET /api/governance/agreements is 404 on this build");
    log("SKIPPED village agreements: the route does not exist on this build");
  } else if (agreements.status !== 200 || !Array.isArray(agreements.json?.agreements)) {
    throw new Error(`the walk's member reads GET /api/governance/agreements as ${agreements.status}: ${agreements.text.slice(0, 300)}`);
  } else {
    log(`village agreements: ${byKey.member.name} reads the list (${agreements.json.agreements.length} on a fresh village)`);
  }

  // 13. Every session works, and says who it is.
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
      // The NEWEST reading of the block read twice: it renders only from /api/canvas data, so a
      // refused or empty canvas cannot show it, and showing the older one instead would miss it.
      ...(canvasRecorded ? { canvasReading: READINGS.filter((r) => r.blockId === "purpose").at(-1).sentence } : {}),
      // The season's name and its LAST week's title: the week map lists every week whatever
      // today's date is, so this holds all season long and after it.
      ...(seasonLoaded ? { seasonName: seasonLoaded.name, seasonWeekTitle: seasonLoaded.lastWeekTitle } : {}),
      // The conflict door as /exit-policy and the launch checklist word it.
      ...(conflictDoor
        ? { conflictReplyTime: `${REPLY_HOURS} hours`, outsideContactName: OUTSIDE_CONTACT.name, outsideContactOrganisation: OUTSIDE_CONTACT.organisation }
        : {}),
      // The open suggestion on the Power block, and its author's first name as the Adopt frame prints it.
      ...(canvasSuggested ? { canvasSuggestion: canvasSuggested.body, canvasSuggester: canvasSuggested.by } : {}),
      // The declined one, its note, and who declined it, as "Decided lately" prints them.
      ...(canvasSuggested?.declineNote ? { canvasDeclineNote: canvasSuggested.declineNote, canvasDecider: canvasSuggested.decider } : {}),
    },
    // Which person the walk signs in as, per walk role.
    walkAs: { member: "member", founder: "founder" },
    // Wave 4, for the record: what the bells held and what the companion said (the seed checked both).
    keyMoments,
    companion: companionAsked,
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
  if (s.facts.conflictReplyTime) console.log(`  conflict door: a reply within ${s.facts.conflictReplyTime}; outside contact ${s.facts.outsideContactName}`);
  if (s.facts.seasonName) console.log(`  season: ${s.facts.seasonName} (last week: ${s.facts.seasonWeekTitle})`);
  if (s.facts.canvasSuggestion) console.log(`  canvas suggestion on Power, open, by ${s.facts.canvasSuggester}`);
  if (s.keyMoments) console.log(`  canvas moon ${s.keyMoments.newMoonAt.slice(0, 10)}: ${s.keyMoments.blocks.join(", ")}`);
  if (s.companion) console.log(`  companion on ${s.companion.block}: told the truth to the member and the founder`);
  console.log(`  skipped: ${s.skipped.length ? s.skipped.join("; ") : "nothing"}`);
  console.log(`  tokens and passwords (test values, outside the repository): ${tokensFile()}`);
}

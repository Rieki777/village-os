/**
 * PROPOSE MY ROLES FOR NEXT SEASON, END TO END (role proposals PR A): the
 * draft routes over real HTTP and the S5 scratch schema, with the member door
 * registered beside them, so submitting writes a real application.
 *
 * What is pinned:
 *
 *   - every owner door answers 401 to a visitor and 403 to a guest;
 *   - the draft lifecycle: create, save one step at a time, read, list,
 *     delete, and one draft at a time;
 *   - "start from my current card": the roles held live, the terms of the
 *     application that seated them with each role's review day, and the
 *     newest season plan's words, keeping only goals next season has; a
 *     member holding nothing starts empty;
 *   - a draft is invisible to the holder who adopts applications: 404 by id,
 *     absent from the application list and from Waiting on you;
 *   - at most five roles; the posted against proposed diff, with only the
 *     changed words stored;
 *   - the share link: on, read, off, made again, a stale or malformed token
 *     refused; the member tier against the public tier, terms never public;
 *   - feedback: 1000 characters, payment details refused, members only, the
 *     rate bound, the owner reads all of it and a commenter only their own,
 *     and erasure leaves the words naming nobody;
 *   - submit: refused until ready, then an ordinary application for next
 *     season starting on its first day, the draft stamped, the season words
 *     saved as next season's plan, and the draft frozen;
 *   - a new role in the application under the id the draft gave it, named,
 *     and never sent to a village vote (adoption is the consent suite's);
 *   - next season with no dates: the words, a null target, and the target
 *     settling once the village dates one;
 *   - the list reads a fixed number of statements however many proposals.
 */
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emptyBody, PROPOSAL_WORDS } from "../../shared/roleProposals";
import { CONSENT_WORDS } from "../../shared/roleProposalConsent";
import { WAITING_URL } from "../../shared/waitingOnYou";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole } from "../lib/orgChart";
import { forgetMemberProposals, insertProposal } from "../repos/roleProposals";
import { readApplication } from "../repos/seatApplications";
import { insertPlanVersion, planVersions } from "../repos/seasonPlans";
import { GOAL_FOOD, GOAL_TEAM, harness, HOLDER, MONEY_TERMS, NEXT_STARTS, OWNER, P, PEOPLE, READER, SEASONS } from "../testkit/roleProposalHarness";

const configured = testDbConfigured();
if (!configured) console.warn("[roleProposals] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

describe("every owner door turns away a visitor and a guest", () => {
  const h = harness();
  beforeAll(h.start);
  afterAll(h.stop);

  const doors: Array<[string, string]> = [
    ["GET", `${P}/mine`],
    ["POST", P],
    ["POST", `${P}/prefill`],
    ["GET", `${P}/rp-0123456789abcdef`],
    ["PUT", `${P}/rp-0123456789abcdef`],
    ["DELETE", `${P}/rp-0123456789abcdef`],
    ["POST", `${P}/rp-0123456789abcdef/share`],
    ["POST", `${P}/rp-0123456789abcdef/submit`],
  ];

  it("a visitor gets 401 and a guest 403, and the database is never read", async () => {
    for (const [method, url] of doors) {
      h.as(null);
      expect((await h.call(method, url)).status, `${method} ${url}`).toBe(401);
      h.as("u-guest", "guest");
      const r = await h.call(method, url);
      expect(r.status, `${method} ${url}`).toBe(403);
      expect(r.body.message).toBe("Proposing roles opens at the member rung.");
    }
  });

  it("a malformed share token reads as a link no longer shared, before any read", async () => {
    h.as(null);
    const r = await h.call("GET", `${P}/shared/not-a-token`);
    expect(r.status).toBe(404);
    expect(r.body.message).toBe(PROPOSAL_WORDS.linkOff);
  });
});

describe.skipIf(!configured)("role proposals, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    // Every statement the routes run is counted, for the batched-read case.
    const counted = new Proxy(pool, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return (...args: any[]) => {
            h.state.queries += 1;
            return (target.query as any)(...args);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    h.state.pool = () => counted;
    // The card reads each owner's user row.
    for (const p of Object.values(PEOPLE)) {
      await pool.query("INSERT INTO users (id, name, email, password_hash, paths) VALUES (?, ?, ?, 'x', '[]')", [p.id, p.name, `${p.id}@example.test`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-land', 'Land Circle', ?, 0), ('c-people', 'People Circle', ?, 0)",
      [JSON.stringify([]), JSON.stringify([])],
    );
    await h.start();
  });

  afterAll(async () => {
    await h.stop();
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    h.as(OWNER);
    h.state.holders = [HOLDER];
    h.state.seasons = SEASONS;
    h.state.governance = "public";
    h.state.limited = [];
    h.notices.length = 0;
  });

  /** A fresh role in the Land Circle, with words to change. */
  const role = async (name: string, over: Record<string, unknown> = {}) => {
    n += 1;
    return createOrgRole(pool, {
      id: `rp-role-${n}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
      name,
      seats: 2,
      circleId: "c-land",
      aim: `Keep the ${name.toLowerCase()} work moving.`,
      domain: `The ${name.toLowerCase()} and its tools.`,
      accountabilities: ["Report each moon", "Keep the list current"],
      ...over,
    });
  };

  /** Delete the owner's draft if they have one, so each case starts clean. */
  const clearDraft = async (who = OWNER) => {
    h.as(who);
    const mine = await h.call("GET", `${P}/mine`);
    if (mine.body.draftId) expect((await h.call("DELETE", `${P}/${mine.body.draftId}`)).status).toBe(200);
  };

  /** A ready draft for these roles: an aim and a seasonal goal. */
  const readyDraft = async (roleIds: string[], extra: Record<string, unknown> = {}) => {
    await clearDraft();
    h.as(OWNER);
    const r = await h.call("POST", P, {
      roles: roleIds.map((roleId) => ({ roleId })),
      season: { aim: "Feed thirty people from the beds.", seasonalGoals: [{ title: "Every bed planted", doneWhen: "each bed holds a crop" }], servesGoals: [{ goal: GOAL_FOOD, howItHelps: "The beds feed the kitchen." }] },
      ...extra,
    });
    expect(r.status, r.text).toBe(201);
    return r.body.proposal;
  };

  it("creates, saves step by step, reads, lists and deletes a draft, one at a time", async () => {
    await clearDraft();
    const garden = await role("Garden Steward");
    const made = await h.call("POST", P, {});
    expect(made.status, made.text).toBe(201);
    const id = made.body.proposal.id;
    expect(id).toMatch(/^rp-[0-9a-f]{16}$/);
    expect(made.body.proposal).toMatchObject({ status: "draft", roles: [], newRoles: [], target: { seasonId: "s-next", startsOn: NEXT_STARTS }, orgGoals: [GOAL_FOOD, GOAL_TEAM] });
    expect(made.body.proposal.share).toMatchObject({ on: false, audience: "members", link: null });

    // A second draft is refused, and names the first.
    const twice = await h.call("POST", `${P}/prefill`);
    expect(twice.status).toBe(409);
    expect(twice.body).toMatchObject({ error: "draft_exists", id });

    // One step at a time: the roles, then the season, then the terms and review days.
    expect((await h.call("PUT", `${P}/${id}`, { roles: [{ roleId: garden }] })).status).toBe(200);
    expect((await h.call("PUT", `${P}/${id}`, { season: { aim: "Feed thirty people." } })).status).toBe(200);
    const saved = await h.call("PUT", `${P}/${id}`, { settings: { v: 1, term: { lengthMoons: 6 } }, roles: [{ roleId: garden, reviewOn: "2026-11-16" }] });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.proposal.roles).toMatchObject([{ roleId: garden, name: "Garden Steward", circle: { id: "c-land", name: "Land Circle" }, reviewOn: "2026-11-16" }]);
    expect(saved.body.proposal.season.aim).toBe("Feed thirty people.");
    expect(saved.body.proposal.settings).toEqual({ v: 1, term: { lengthMoons: 6 } });

    const read = await h.call("GET", `${P}/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.proposal.readyToSubmit).toBe(false);
    expect(read.body.proposal.submitBlocked).toBe(PROPOSAL_WORDS.noSeasonalGoal);

    const mine = await h.call("GET", `${P}/mine`);
    expect(mine.body).toMatchObject({ draftId: id, nextSeason: { seasonId: "s-next", goals: [GOAL_FOOD, GOAL_TEAM] } });
    expect(mine.body.proposals.map((p: any) => p.id)).toContain(id);

    expect((await h.call("DELETE", `${P}/${id}`)).status).toBe(200);
    expect((await h.call("GET", `${P}/${id}`)).status).toBe(404);
  });

  it("starts from the current card: live roles, their terms and review days, and the newest season words", async () => {
    await clearDraft();
    const kitchen = await role("Kitchen Lead");
    // Seated the real way: the member applies with a review day, and the holder adopts.
    h.as(OWNER);
    const applied = await h.call("POST", "/api/governance/role-applications", {
      seatIds: [kitchen],
      deliverables: "The kitchen feeds the work days.",
      seatSettings: { v: 1, term: { reviewOn: "2026-11-23" } },
    });
    expect(applied.status, applied.text).toBe(201);
    h.as(HOLDER);
    const adopted = await h.call("POST", `/api/governance/role-applications/${applied.body.id}/adopt`);
    expect(adopted.body.status, adopted.text).toBe("adopted");
    // The newest plan serves one goal next season has and one it does not.
    await insertPlanVersion(pool, OWNER, "s-now", {
      aim: "Cook for every work day.",
      servesGoal: "Plant the beds",
      servesGoals: [{ goal: "Plant the beds", howItHelps: null }, { goal: GOAL_FOOD, howItHelps: "Meals keep people coming." }],
      seasonalGoals: [{ title: "A cook rota", doneWhen: "four people share it" }],
      cardWords: null,
      commitments: {},
      handingBack: [],
    });

    h.as(OWNER);
    const r = await h.call("POST", `${P}/prefill`);
    expect(r.status, r.text).toBe(201);
    const p = r.body.proposal;
    expect(p.roles.map((x: any) => x.roleId)).toEqual([kitchen]);
    expect(p.roles[0].reviewOn).toBe("2026-11-23");
    // Nothing changed yet: every field reads posted as proposed.
    expect(p.roles[0].changedCount).toBe(0);
    expect(p.settings).toEqual({ v: 1, term: { reviewOn: "2026-11-23" } });
    expect(p.season).toEqual({
      aim: "Cook for every work day.",
      seasonalGoals: [{ title: "A cook rota", doneWhen: "four people share it" }],
      servesGoals: [{ goal: GOAL_FOOD, howItHelps: "Meals keep people coming." }],
    });
  });

  it("starts empty for a member who holds no role", async () => {
    await clearDraft(READER);
    h.as(READER);
    const r = await h.call("POST", `${P}/prefill`);
    expect(r.status, r.text).toBe(201);
    expect(r.body.proposal).toMatchObject({ roles: [], newRoles: [], season: { aim: null, seasonalGoals: [], servesGoals: [] } });
    expect((await h.call("DELETE", `${P}/${r.body.proposal.id}`)).status).toBe(200);
  });

  it("keeps a draft from the holder who adopts applications", async () => {
    const water = await role("Water Keeper");
    const draft = await readyDraft([water]);
    h.as(HOLDER);
    for (const [method, url] of [
      ["GET", `${P}/${draft.id}`],
      ["PUT", `${P}/${draft.id}`],
      ["GET", `${P}/${draft.id}/card`],
      ["GET", `${P}/${draft.id}/comments`],
      ["POST", `${P}/${draft.id}/submit`],
    ] as const) {
      const r = await h.call(method, url, method === "PUT" ? { season: { aim: "x" } } : undefined);
      expect(r.status, `${method} ${url}`).toBe(404);
      expect(r.body.message).toBe(PROPOSAL_WORDS.notYours);
    }
    const list = await h.call("GET", "/api/governance/role-applications");
    expect(list.text).not.toContain(water);
    const waiting = await h.call("GET", WAITING_URL);
    expect(waiting.status).toBe(200);
    expect(waiting.text).not.toContain(water);
  });

  it("holds at most five roles", async () => {
    const ids = [];
    for (const name of ["Path One", "Path Two", "Path Three", "Path Four", "Path Five", "Path Six"]) ids.push(await role(name));
    const draft = await readyDraft(ids.slice(0, 5));
    expect(draft.roles).toHaveLength(5);
    const six = await h.call("PUT", `${P}/${draft.id}`, { roles: ids.map((roleId) => ({ roleId })) });
    expect(six.status).toBe(400);
    expect(six.body.error).toBe(PROPOSAL_WORDS.tooManyRoles);
    const plusNew = await h.call("PUT", `${P}/${draft.id}`, { newRoles: [{ circleId: "c-land", words: { name: "Orchard Keeper" } }] });
    expect(plusNew.status).toBe(400);
  });

  it("stores only the words that changed, and flags each field posted against proposed", async () => {
    const tools = await role("Tool Keeper");
    const draft = await readyDraft([tools]);
    const r = await h.call("PUT", `${P}/${draft.id}`, {
      roles: [{ roleId: tools, words: { domain: "The tool shed, the tools and the sharpening.", aim: "Keep the tool keeper work moving.", accountabilities: "Report each moon\nKeep the list current\nSharpen before each work day" } }],
    });
    expect(r.status, r.text).toBe(200);
    const fields = Object.fromEntries(r.body.proposal.roles[0].fields.map((f: any) => [f.field, f]));
    expect(fields.domain).toEqual({ field: "domain", posted: "The tool keeper and its tools.", proposed: "The tool shed, the tools and the sharpening.", changed: true });
    // Written the same as posted, so no change.
    expect(fields.aim).toMatchObject({ changed: false });
    expect(fields.accountabilities).toEqual({
      field: "accountabilities",
      posted: ["Report each moon", "Keep the list current"],
      proposed: ["Report each moon", "Keep the list current", "Sharpen before each work day"],
      changed: true,
    });
    expect(r.body.proposal.roles[0].changedCount).toBe(2);
    const [rows] = await pool.query<any[]>("SELECT body_json FROM role_proposals WHERE id = ?", [draft.id]); // module-review-ok: reading back the row this suite's request wrote
    const body = typeof rows[0].body_json === "string" ? JSON.parse(rows[0].body_json) : rows[0].body_json;
    expect(Object.keys(body.roles[0].words).sort()).toEqual(["accountabilities", "domain"]);
    // A field that is not a word is refused by name.
    const seats = await h.call("PUT", `${P}/${draft.id}`, { roles: [{ roleId: tools, words: { seats: "4" } }] });
    expect(seats.status).toBe(400);
    expect(seats.body.error).toBe(PROPOSAL_WORDS.notAWord);
  });

  it("shares a link that opens, closes, and dies when made again", async () => {
    const seeds = await role("Seed Keeper");
    const draft = await readyDraft([seeds], { settings: MONEY_TERMS });
    const on = await h.call("POST", `${P}/${draft.id}/share`);
    expect(on.status, on.text).toBe(200);
    const token = on.body.share.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(on.body.share).toMatchObject({ on: true, audience: "members", link: `/role-proposals/shared/${token}` });

    // A member with the link reads it at the member tier, terms included.
    h.as(READER);
    const member = await h.call("GET", `${P}/shared/${token}`);
    expect(member.status, member.text).toBe(200);
    expect(member.body.you).toMatchObject({ isOwner: false, mayComment: true, tier: "member" });
    expect(member.body.proposal.settings).toEqual(MONEY_TERMS);
    expect(member.body.proposal.roles[0].reviewOn).toBeNull();
    expect(member.body.proposal).not.toHaveProperty("share");
    expect(member.body.card.card.agreements.roles[0].rows.kind).toBe("shown");

    // Members only by default: a visitor is turned away.
    h.as(null);
    const visitor = await h.call("GET", `${P}/shared/${token}`);
    expect(visitor.status).toBe(401);
    expect(visitor.body.message).toBe(PROPOSAL_WORDS.membersOnly);

    // Anyone with the link: the public tier, with no terms, no season words and no review days.
    h.as(OWNER);
    expect((await h.call("POST", `${P}/${draft.id}/share`, { audience: "anyone" })).body.share).toMatchObject({ on: true, audience: "anyone", token });
    h.as(null);
    const anyone = await h.call("GET", `${P}/shared/${token}`);
    expect(anyone.status, anyone.text).toBe(200);
    expect(anyone.body.you).toMatchObject({ mayComment: false, tier: "public" });
    expect(anyone.body.proposal).not.toHaveProperty("settings");
    expect(anyone.body.proposal).not.toHaveProperty("season");
    expect(anyone.body.proposal.roles[0]).not.toHaveProperty("reviewOn");
    expect(anyone.body.card.card.agreements.roles.every((r: any) => r.rows.kind !== "shown")).toBe(true);
    expect(anyone.text).not.toContain("XTS");
    expect(anyone.text).not.toContain("4321000");
    // Control: the member's read of the same link carries the money the public one must not.
    expect(member.text).toContain("XTS");

    // Made again: the old link reads nothing, the new one works.
    h.as(OWNER);
    const again = await h.call("POST", `${P}/${draft.id}/share/regenerate`);
    const fresh = again.body.share.token;
    expect(fresh).not.toBe(token);
    h.as(READER);
    expect((await h.call("GET", `${P}/shared/${token}`)).status).toBe(404);
    expect((await h.call("GET", `${P}/shared/${fresh}`)).status).toBe(200);

    // Off: nothing reads it.
    h.as(OWNER);
    const off = await h.call("DELETE", `${P}/${draft.id}/share`);
    expect(off.body.share).toMatchObject({ on: false, link: null, token: null });
    h.as(READER);
    const stale = await h.call("GET", `${P}/shared/${fresh}`);
    expect(stale.status).toBe(404);
    expect(stale.body.message).toBe(PROPOSAL_WORDS.linkOff);
  });

  it("says when a village keeps governance from strangers, so anyone with the link cannot reach it", async () => {
    const bees = await role("Bee Keeper");
    const draft = await readyDraft([bees]);
    h.state.governance = "members";
    const r = await h.call("POST", `${P}/${draft.id}/share`, { audience: "anyone" });
    expect(r.body.share).toMatchObject({ anyoneReaches: false, anyoneNote: PROPOSAL_WORDS.anyoneNeedsPublicGovernance });
  });

  it("takes feedback from members only, within its limits, and keeps each commenter to their own", async () => {
    const compost = await role("Compost Keeper");
    const draft = await readyDraft([compost]);
    h.as(OWNER);
    const token = (await h.call("POST", `${P}/${draft.id}/share`, { audience: "anyone" })).body.share.token;
    const say = (text: string) => h.call("POST", `${P}/shared/${token}/comments`, { text });

    h.as(READER);
    const first = await say("The review day could move a week later.");
    expect(first.status, first.text).toBe(201);
    expect(first.body.comments).toMatchObject([{ text: "The review day could move a week later.", mine: true }]);
    expect(first.body.comments[0]).not.toHaveProperty("from");
    expect(h.notices.filter((x) => x.type === "role_proposal_feedback" && x.userId === OWNER)).toHaveLength(1);
    expect((await say("a".repeat(1001))).status).toBe(400);
    const card = await say("Pay into 4111 1111 1111 1111 please");
    expect(card.status).toBe(400);
    expect(card.body.error).toBe(PROPOSAL_WORDS.paymentInComment);

    h.as(HOLDER);
    expect((await say("Looks right for the season.")).status).toBe(201);
    const own = await h.call("GET", `${P}/shared/${token}/comments`);
    expect(own.body.comments.map((c: any) => c.text)).toEqual(["Looks right for the season."]);

    // A visitor reads the link but leaves nothing.
    h.as(null);
    expect((await say("A stranger's view")).status).toBe(401);

    // The rate bound answers before anything is written.
    h.as(READER);
    h.state.limited = ["role-proposal-comment:"];
    expect((await say("One more thought")).status).toBe(429);
    h.state.limited = [];

    // The owner reads every comment, each by first name.
    h.as(OWNER);
    const all = await h.call("GET", `${P}/${draft.id}/comments`);
    expect(all.body.comments.map((c: any) => [c.from, c.text])).toEqual([
      ["Member", "The review day could move a week later."],
      ["Member", "Looks right for the season."],
    ]);

    // A commenter who leaves the village: their words stay, naming nobody.
    await forgetMemberProposals(pool, READER);
    const after = await h.call("GET", `${P}/${draft.id}/comments`);
    expect(after.body.comments.map((c: any) => c.from)).toEqual(["A former member", "Member"]);
    expect(after.body.comments[0].text).toBe("The review day could move a week later.");
  });

  it("submits as an ordinary application for next season, saves the season, and freezes the draft", async () => {
    const orchard = await role("Orchard Keeper");
    await clearDraft();
    h.as(OWNER);
    const early = await h.call("POST", P, { roles: [{ roleId: orchard }] });
    const notReady = await h.call("POST", `${P}/${early.body.proposal.id}/submit`);
    expect(notReady.status).toBe(409);
    expect(notReady.body.message).toBe(PROPOSAL_WORDS.noAim);

    const draft = await readyDraft([orchard], { settings: { v: 1, term: { reviewOn: "2026-11-09" } } });
    const r = await h.call("POST", `${P}/${draft.id}/submit`);
    expect(r.status, r.text).toBe(201);
    expect(r.body).toMatchObject({ status: "awaiting-holder", seasonPlanSaved: true, proposal: { status: "submitted", application: { id: r.body.id } } });
    const a = await readApplication(pool, r.body.id);
    expect(a).toMatchObject({ candidateUserId: OWNER, seatIds: [orchard], termSeasonId: "s-next", status: "awaiting-holder", note: "Feed thirty people from the beds." });
    expect(a!.startsAt?.toISOString().slice(0, 10)).toBe(NEXT_STARTS);
    expect(a!.deliverables).toBe("Every bed planted: each bed holds a crop");
    // The holder hears, by the role's name.
    expect(h.notices.some((x) => x.userId === HOLDER && String(x.title).includes("Orchard Keeper"))).toBe(true);

    // The season words are next season's plan now.
    const plan = (await planVersions(pool, OWNER, "s-next")).pop();
    expect(plan).toMatchObject({ aim: "Feed thirty people from the beds.", seasonalGoals: [{ title: "Every bed planted", doneWhen: "each bed holds a crop" }] });
    expect(plan!.servesGoals).toEqual([{ goal: GOAL_FOOD, howItHelps: "The beds feed the kitchen." }]);

    // Frozen: no save, no delete, no second submit.
    expect((await h.call("PUT", `${P}/${draft.id}`, { season: { aim: "x" } })).status).toBe(409);
    expect((await h.call("DELETE", `${P}/${draft.id}`)).status).toBe(409);
    expect((await h.call("POST", `${P}/${draft.id}/submit`)).status).toBe(409);
    // A plain proposal is adopted the ordinary way.
    h.as(HOLDER);
    const adopted = await h.call("POST", `/api/governance/role-applications/${r.body.id}/adopt`);
    expect(adopted.status, adopted.text).toBe(200);
    expect(adopted.body.status).toBe("adopted");
  });

  it("names a new role in the application by its draft id, and never sends it to a village vote", async () => {
    const hives = await role("Hive Keeper");
    const draft = await readyDraft([hives], {
      newRoles: [{ circleId: "c-land", seats: 1, words: { name: "Pollinator Steward", aim: "Keep the pollinators fed." } }],
    });
    const newId = draft.newRoles[0].id;
    expect(newId).toMatch(/^role-[0-9a-f]{12}$/);
    expect(draft.changesRoles).toBe(true);
    const r = await h.call("POST", `${P}/${draft.id}/submit`);
    expect(r.status, r.text).toBe(201);
    // It waits on a holder, whatever the power's rule, and never opens a vote.
    expect(r.body.status).toBe("awaiting-holder");
    const a = await readApplication(pool, r.body.id);
    expect(a!.seatIds).toEqual([hives, newId]);

    h.as(HOLDER);
    const page = await h.call("GET", `/api/governance/role-applications/${r.body.id}`);
    expect(page.status).toBe(200);
    expect(page.body.application.seats).toEqual([
      { id: hives, name: "Hive Keeper", aim: "Keep the hive keeper work moving." },
      { id: newId, name: "Pollinator Steward", aim: null, proposedNew: true },
    ]);
    expect(page.body.application.proposal).toMatchObject({ id: draft.id, changesRoles: true, decided: null });
    expect(page.body.application.you).toMatchObject({ mayAdopt: true, mayPutToVillage: false });
    const vote = await h.call("POST", `/api/governance/role-applications/${r.body.id}/put-to-village`);
    expect(vote.status).toBe(409);
    expect(vote.body).toEqual({ error: "proposal_changes_roles", message: CONSENT_WORDS.noVote });
    // Nothing was created by reading it or by the refused vote.
    const [rows] = await pool.query<any[]>("SELECT id FROM org_roles WHERE id = ?", [newId]); // module-review-ok: reading back what the refused vote did not write
    expect(rows).toHaveLength(0);
    // The candidate can still take it back.
    h.as(OWNER);
    expect((await h.call("POST", `/api/governance/role-applications/${r.body.id}/withdraw`)).status).toBe(200);
  });

  it("says next season's dates aren't set yet, and settles the target once they are", async () => {
    await clearDraft();
    h.state.seasons = [SEASONS[0]];
    const made = await h.call("POST", P, {});
    expect(made.status).toBe(201);
    expect(made.body.proposal).toMatchObject({ target: null, targetWords: "Next season's dates aren't set yet", orgGoals: [] });
    const mine = await h.call("GET", `${P}/mine`);
    expect(mine.body).toMatchObject({ nextSeason: null, nextSeasonWords: PROPOSAL_WORDS.noTarget });
    const garden = await role("Herb Keeper");
    await h.call("PUT", `${P}/${made.body.proposal.id}`, {
      roles: [{ roleId: garden }],
      season: { aim: "Grow herbs.", seasonalGoals: [{ title: "Herbs dried" }] },
    });
    const refused = await h.call("POST", `${P}/${made.body.proposal.id}/submit`);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe(PROPOSAL_WORDS.noTargetSubmit);
    const [row] = await pool.query<any[]>("SELECT target_season_id FROM role_proposals WHERE id = ?", [made.body.proposal.id]); // module-review-ok: reading back the row this suite's request wrote
    expect(row[0].target_season_id).toBeNull();

    h.state.seasons = SEASONS;
    const later = await h.call("GET", `${P}/${made.body.proposal.id}`);
    expect(later.body.proposal.target).toMatchObject({ seasonId: "s-next" });
    const [settled] = await pool.query<any[]>("SELECT target_season_id FROM role_proposals WHERE id = ?", [made.body.proposal.id]); // module-review-ok: reading back the row this suite's request wrote
    expect(settled[0].target_season_id).toBe("s-next");
  });

  it("reads the member's list in a fixed number of statements however many proposals", async () => {
    const reader = "u-counted";
    PEOPLE[reader] = { id: reader, name: "Member Five" };
    const insert = (i: number) =>
      insertProposal(pool, { id: `rp-${String(i).padStart(16, "0")}`, userId: reader, targetSeasonId: "s-next", body: emptyBody(), now: new Date() });
    await insert(1);
    h.as(reader);
    h.state.queries = 0;
    expect((await h.call("GET", `${P}/mine`)).status).toBe(200);
    const one = h.state.queries;
    for (const i of [2, 3, 4]) await insert(i);
    h.state.queries = 0;
    const four = await h.call("GET", `${P}/mine`);
    expect(four.body.proposals).toHaveLength(4);
    expect(h.state.queries).toBe(one);
  });
});

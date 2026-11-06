/**
 * THE CIRCLE CONSENTS, AND THE NUDGES, END TO END (role proposals PR B): over
 * real HTTP and the S5 scratch schema, with the member door and the proposal
 * routes registered side by side (server/testkit/roleProposalHarness.ts).
 *
 * What is pinned:
 *
 *   - on submit, every other live holder of a role in the proposal's circles
 *     is asked once, in the bell and in Waiting on you; the candidate never;
 *     the window is 2 business days from the submit;
 *   - path (b): a consent, the window closing, "Consented by the circle", and
 *     the one click that records the adoption: the new role is created under
 *     its draft id with its words, the changed words are written, and the
 *     record reads "Adopted on ... after the circle consented";
 *   - an objection needs a reason, writes a tension into the circle's backlog
 *     naming the roles and never a person, tells the candidate, and blocks
 *     path (b); a holder of the power can still adopt it, "by the founder's
 *     power"; a circle that has not met records it all the same;
 *   - a circle with nobody else in it cannot consent, says so, and only the
 *     power adopts;
 *   - path (a) refuses the candidate, even one who holds the power;
 *   - answers close with the window, and an answer is given once;
 *   - the nudges: the window opening, a review day, and 2 business days before
 *     the window closes, each sent once however often the sweep runs; the
 *     banner's read says the same;
 *   - the application list reads a fixed number of statements however many
 *     proposals it carries.
 */
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import { CONSENT_WORDS, consentClosesAt, NUDGE_WORDS, PROPOSE_ENTRY_HREF, shortDay } from "../../shared/roleProposalConsent";
import { WAITING_URL } from "../../shared/waitingOnYou";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole, listOrgRoles } from "../lib/orgChart";
import { insertNotification } from "../lib/notify";
import { nudgeKey, ROLE_WORD_FIELDS, runProposalNudges, wordsNotWritten } from "../lib/roleProposals";
import { insertEntry } from "../repos/liveSessions";
import { insertProposal } from "../repos/roleProposals";
import { insertApplication, readApplication } from "../repos/seatApplications";
import { emptyBody } from "../../shared/roleProposals";
import { harness, HOLDER, OWNER, P, PEOPLE, READER, SEASONS } from "../testkit/roleProposalHarness";

const FOURTH = "u-four";
const configured = testDbConfigured();
if (!configured) console.warn("[roleProposals.consent] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

describe("the word fields a proposal may change", () => {
  it("are read off the role reader, the CCOS words included, with every list found as a list", () => {
    expect(ROLE_WORD_FIELDS.fields).toEqual(
      expect.arrayContaining(["name", "aim", "domain", "accountabilities", "whyItMatters", "bringMe", "notMine", "runbook", "existsWhile", "authorities", "responsibilities", "signsStretched", "flowsBack", "stepBack", "timeCommitment"]),
    );
    expect([...ROLE_WORD_FIELDS.lists].sort()).toEqual(["accountabilities", "authorities", "bringMe", "notMine", "responsibilities"]);
    // Structure, money and the recruitment pack are never words.
    for (const f of ["seats", "circleId", "termsOffer", "valueMinor", "compensationReality", "archetypes"]) expect(ROLE_WORD_FIELDS.fields).not.toContain(f);
  });
});

describe("a proposed word the draft path did not write", () => {
  it("is named by role and field, so an adoption can refuse instead of dropping it", () => {
    const body = { ...emptyBody(), roles: [{ roleId: "r1", words: { aim: "New aim", existsWhile: "the beds exist" }, reviewOn: null }] };
    const roles = new Map([["r1", { id: "r1", name: "Garden Steward", aim: "New aim" } as any]]);
    expect(wordsNotWritten(body, roles)).toEqual(["Garden Steward: existsWhile"]);
    roles.set("r1", { id: "r1", name: "Garden Steward", aim: "New aim", existsWhile: "the beds exist" } as any);
    expect(wordsNotWritten(body, roles)).toEqual([]);
  });
});

describe.skipIf(!configured)("the circle consents to a role proposal, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;
  let landSession = 0;

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
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
    PEOPLE[FOURTH] = { id: FOURTH, name: "Member Four" };
    for (const p of Object.values(PEOPLE)) {
      await q("INSERT INTO users (id, name, email, password_hash, paths) VALUES (?, ?, ?, 'x', '[]')", [p.id, p.name, `${p.id}@example.test`]);
    }
    await q(
      "INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-land', 'Land Circle', '[]', 0), ('c-people', 'People Circle', '[]', 0), ('c-solo', 'Quiet Circle', '[]', 0)",
    );
    // The land circle met once, so it has a backlog an objection can go to.
    const [opened]: any = await pool.query( // module-review-ok: a closed session fixture on the scratch schema this suite provisioned
      "INSERT INTO live_sessions (title, circle_id, status, facilitator_no, created_by_no, duration_min, state, stamp, closed_at) VALUES ('Land circle, week 1', 'c-land', 'closed', 1, 1, 45, '{}', '{}', NOW())",
    );
    landSession = Number(opened.insertId);
    await insertEntry(pool, { sessionId: landSession, itemId: null, kind: "note", text: "Walked the beds.", authorNo: 1, ownerSeatId: null, dueOn: null, now: new Date() });
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
    h.state.limited = [];
    h.state.sessionsOn = true;
    h.notices.length = 0;
  });

  /** A fresh role in a circle, seated by these members directly, the way a fixture seats. */
  const role = async (name: string, circleId: string, holders: string[] = []) => {
    n += 1;
    const id = await createOrgRole(pool, {
      id: `cp-role-${n}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
      name,
      seats: 3,
      circleId,
      aim: `Keep the ${name.toLowerCase()} work moving.`,
      domain: `The ${name.toLowerCase()} and its tools.`,
      accountabilities: ["Report each moon"],
    });
    for (const userId of holders) {
      await q("INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, term_ends_at) VALUES (?, ?, 'member', ?, ?, NULL)", [
        `cp-seat-${n}-${userId}`,
        id,
        userId,
        `cp-${n}-${userId}`,
      ]);
    }
    return id;
  };

  /** Delete the member's draft, then submit a fresh ready one, answering the submit. */
  const submit = async (who: string, roleIds: string[], extra: Record<string, unknown> = {}) => {
    h.as(who);
    const mine = await h.call("GET", `${P}/mine`);
    if (mine.body.draftId) await h.call("DELETE", `${P}/${mine.body.draftId}`);
    const made = await h.call("POST", P, {
      roles: roleIds.map((roleId) => ({ roleId })),
      season: { aim: "Feed thirty people from the beds.", seasonalGoals: [{ title: "Every bed planted", doneWhen: "each bed holds a crop" }] },
      ...extra,
    });
    expect(made.status, made.text).toBe(201);
    const r = await h.call("POST", `${P}/${made.body.proposal.id}/submit`);
    expect(r.status, r.text).toBe(201);
    return { proposalId: made.body.proposal.id as string, applicationId: r.body.id as string, draft: made.body.proposal, submitted: r.body };
  };

  const page = async (applicationId: string, who = HOLDER) => {
    h.as(who);
    const r = await h.call("GET", `/api/governance/role-applications/${applicationId}`);
    expect(r.status, r.text).toBe(200);
    return r.body.application;
  };

  const answer = (who: string, applicationId: string, body: unknown) => {
    h.as(who);
    return h.call("POST", `/api/governance/role-applications/${applicationId}/consent`, body);
  };

  /** Close the circle's window now, as two business days passing would. */
  const closeWindow = (proposalId: string) => q("UPDATE role_proposal_asks SET closes_at = ? WHERE proposal_id = ?", [new Date(Date.now() - 1000), proposalId]);

  it("asks every other holder in the proposal's circles once, in the bell and under Tasks, and never the candidate", async () => {
    const beds = await role("Bed Keeper", "c-land", [OWNER, READER, FOURTH]);
    await role("Welcome Keeper", "c-people", [FOURTH]);
    const before = Date.now();
    const s = await submit(OWNER, [beds], { newRoles: [{ circleId: "c-people", words: { name: "Newcomer Guide" } }] });
    const asks = await q("SELECT user_id, circle_id, UNIX_TIMESTAMP(closes_at) AS c, UNIX_TIMESTAMP(asked_at) AS a FROM role_proposal_asks WHERE proposal_id = ? ORDER BY user_id", [s.proposalId]);
    expect(asks.map((a: any) => [a.user_id, a.circle_id])).toEqual([
      [FOURTH, "c-land"],
      [READER, "c-land"],
    ]);
    // Two business days from the submit, on the village's clock.
    const askedAt = new Date(Number(asks[0].a) * 1000);
    expect(askedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(Number(asks[0].c) * 1000).toBe(consentClosesAt(askedAt, "UTC").getTime());
    const told = h.notices.filter((x) => x.type === "role_proposal_consent_ask");
    expect(told.map((x) => x.userId).sort()).toEqual([FOURTH, READER]);
    expect(told[0].title).toBe("Your circle is asked about a role proposal: Bed Keeper and Newcomer Guide");
    expect(told[0].link).toBe(`/role-applications/${s.applicationId}`);

    h.as(READER);
    const waiting = await h.call("GET", WAITING_URL);
    expect(waiting.body.toConsent).toEqual([
      expect.objectContaining({ proposalId: s.proposalId, applicationId: s.applicationId, roles: ["Bed Keeper", "Newcomer Guide"], circle: "Land Circle", applicant: "Member" }),
    ]);
    h.as(OWNER);
    expect((await h.call("GET", WAITING_URL)).body.toConsent).toEqual([]);
    const view = (await page(s.applicationId, READER)).proposal.consent;
    expect(view).toMatchObject({ state: "open", asked: 2, consented: 0, objected: 0, you: { asked: true, answer: null, mayAnswer: true } });
    expect(view.words).toBe(CONSENT_WORDS.open(view.closesOn));
    // Clean up for the cases below.
    h.as(OWNER);
    expect((await h.call("POST", `/api/governance/role-applications/${s.applicationId}/withdraw`)).status).toBe(200);
  });

  it("consented by the circle: one click records the adoption, creates the new role and writes the changed words", async () => {
    const orchard = await role("Orchard Keeper", "c-land", [READER, FOURTH]);
    const s = await submit(OWNER, [orchard], {
      // The CCOS words (0274) ride through by field name, a list sent as text one item per line.
      roles: [{ roleId: orchard, words: { domain: "The orchard, the nursery and the grafting.", existsWhile: "the village keeps fruit trees", authorities: "Choose the rootstock\nSet the pruning days" } }],
      newRoles: [{ circleId: "c-land", seats: 1, words: { name: "Graft Keeper", aim: "Keep every graft alive.", accountabilities: "Graft each spring\nLabel each tree\nKeep the scion wood cool" } }],
    });
    const newId = s.draft.newRoles[0].id;
    expect((await answer(READER, s.applicationId, { answer: "consent" })).status).toBe(200);
    expect((await answer(READER, s.applicationId, { answer: "consent" })).body.error).toBe(CONSENT_WORDS.answered);
    expect((await page(s.applicationId)).proposal.consent).toMatchObject({ state: "open", consented: 1 });

    await closeWindow(s.proposalId);
    // Answers close with the window.
    const late = await answer(FOURTH, s.applicationId, { answer: "consent" });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe(CONSENT_WORDS.windowClosed);
    const consented = (await page(s.applicationId)).proposal;
    expect(consented.consent).toMatchObject({ state: "consented", words: "Consented by the circle", record: "Record the adoption" });
    expect(consented.decided).toBeNull();

    h.as(HOLDER);
    const adopted = await h.call("POST", `/api/governance/role-applications/${s.applicationId}/adopt`);
    expect(adopted.status, adopted.text).toBe(200);
    expect(adopted.body).toMatchObject({ status: "adopted", decided: `Adopted on ${shortDay(new Date(), "UTC")} after the circle consented` });
    const roles = new Map((await listOrgRoles(pool)).map((r) => [r.id, r]));
    expect(roles.get(newId)).toMatchObject({ name: "Graft Keeper", circleId: "c-land", aim: "Keep every graft alive.", accountabilities: ["Graft each spring", "Label each tree", "Keep the scion wood cool"], seats: 1 });
    expect(roles.get(orchard)).toMatchObject({ domain: "The orchard, the nursery and the grafting.", existsWhile: "the village keeps fruit trees", authorities: ["Choose the rootstock", "Set the pruning days"] });
    expect((await readApplication(pool, s.applicationId))?.status).toBe("adopted");
    expect((await page(s.applicationId)).proposal.decided).toBe(adopted.body.decided);
  });

  it("an objection needs a reason, goes to the circle's next meeting, and blocks the circle's path", async () => {
    const paths = await role("Path Keeper", "c-land", [READER, FOURTH]);
    const s = await submit(OWNER, [paths]);
    const bare = await answer(FOURTH, s.applicationId, { answer: "object" });
    expect(bare.status).toBe(400);
    expect(bare.body.error).toBe(CONSENT_WORDS.reasonNeeded);
    const objected = await answer(FOURTH, s.applicationId, { answer: "object", reason: "Two of us already keep the paths." });
    expect(objected.status, objected.text).toBe(200);
    expect(objected.body).toMatchObject({ answer: "object", carried: true, carriedWords: null, consent: { state: "objected" } });
    const entries = await q("SELECT kind, text, status FROM live_session_entries WHERE session_id = ? AND kind = 'tension'", [landSession]);
    expect(entries).toEqual([{ kind: "tension", text: "An objection to a role proposal for Path Keeper: Two of us already keep the paths.", status: "open" }]);
    expect(entries[0].text).not.toContain("Member");
    const told = h.notices.find((x) => x.type === "role_proposal_objection");
    expect(told).toMatchObject({ userId: OWNER, body: "It goes to the circle's next meeting." });
    // A consent after an objection does not unblock the circle's path.
    expect((await answer(READER, s.applicationId, { answer: "consent" })).status).toBe(200);
    await closeWindow(s.proposalId);
    const after = (await page(s.applicationId)).proposal.consent;
    expect(after).toMatchObject({ state: "objected", record: null, objections: ["Two of us already keep the paths."] });
    // The power still adopts it, and says whose power.
    h.as(HOLDER);
    const adopted = await h.call("POST", `/api/governance/role-applications/${s.applicationId}/adopt`);
    expect(adopted.status, adopted.text).toBe(200);
    expect(adopted.body.decided).toBe(`Adopted on ${shortDay(new Date(), "UTC")} by the founder's power`);
  });

  it("records an objection where the circle has not met yet, and says where it waits", async () => {
    const hosts = await role("Host Keeper", "c-people", [READER]);
    const s = await submit(OWNER, [hosts]);
    const objected = await answer(READER, s.applicationId, { answer: "object", reason: "The welcome rota is full." });
    expect(objected.body).toMatchObject({ carried: false, carriedWords: CONSENT_WORDS.notCarried, consent: { state: "objected" } });
    h.as(OWNER);
    await h.call("POST", `/api/governance/role-applications/${s.applicationId}/withdraw`);
  });

  it("a circle with nobody else in it cannot consent, says so, and only the power adopts", async () => {
    const solo = await role("Quiet Keeper", "c-solo", [OWNER]);
    const s = await submit(OWNER, [solo]);
    expect(await q("SELECT user_id FROM role_proposal_asks WHERE proposal_id = ?", [s.proposalId])).toEqual([]);
    const view = (await page(s.applicationId)).proposal.consent;
    expect(view).toMatchObject({ state: "no-other-holders", words: CONSENT_WORDS.noOtherHolders, asked: 0, record: null });
    h.as(HOLDER);
    const adopted = await h.call("POST", `/api/governance/role-applications/${s.applicationId}/adopt`);
    expect(adopted.status, adopted.text).toBe(200);
    expect(adopted.body.decided).toBe(`Adopted on ${shortDay(new Date(), "UTC")} by the founder's power`);
  });

  it("path (a) refuses the candidate, even one who holds the power, and a member the circle never asked", async () => {
    const tools = await role("Shed Keeper", "c-land", [READER]);
    h.state.holders = [HOLDER, OWNER];
    const s = await submit(OWNER, [tools]);
    h.as(OWNER);
    const own = await h.call("POST", `/api/governance/role-applications/${s.applicationId}/adopt`);
    expect(own.status).toBe(403);
    expect(own.body.error).toBe("own_terms");
    // Not asked: the candidate and a holder outside the circle are told so.
    expect((await answer(OWNER, s.applicationId, { answer: "consent" })).body.error).toBe(CONSENT_WORDS.notAsked);
    expect((await answer(HOLDER, s.applicationId, { answer: "consent" })).status).toBe(404);
    h.as(OWNER);
    await h.call("POST", `/api/governance/role-applications/${s.applicationId}/withdraw`);
  });

  it("reads the application list in a fixed number of statements however many proposals it carries", async () => {
    h.as(HOLDER);
    h.state.queries = 0;
    expect((await h.call("GET", "/api/governance/role-applications")).status).toBe(200);
    const before = h.state.queries;
    const more = await role("Count Keeper", "c-land", [READER]);
    const more2 = await role("Tally Keeper", "c-land", [READER]);
    await submit(FOURTH, [more]);
    await submit(FOURTH, [more2]);
    h.as(HOLDER);
    h.state.queries = 0;
    const list = await h.call("GET", "/api/governance/role-applications");
    expect(list.body.applications.filter((a: any) => a.proposal).length).toBeGreaterThanOrEqual(4);
    expect(h.state.queries).toBe(before);
  });

  describe("the nudges", () => {
    /** A later season with its planning window set by hand: open 1 to 27 February 2031. */
    const LATER = [{ id: "n-later", name: "A later season", startsOn: "2031-03-01", endsOn: "2031-06-01", planWindow: { opensOn: "2031-02-01", closesOn: "2031-02-27" } }];
    const spine = (input: any) =>
      insertNotification(
        { pool, memberById: async () => null, sendEmail: async () => ({ ok: false }) as any, origin: () => "http://127.0.0.1", projectName: () => "Test village", isPresent: () => true },
        input,
      );
    const sweep = (now: string) =>
      runProposalNudges({
        pool,
        now: new Date(now),
        timeZone: "UTC",
        clock: LUNAR_CLOCK,
        seasons: LATER,
        lapse: { currentSeasonId: "s-now", cadence: "season_turn" } as any,
        members: Object.values(PEOPLE),
        isPresent: () => true,
        notify: spine,
      });
    const rowsOf = (type: string, userId: string) => q("SELECT dedupe_key FROM notifications WHERE type = ? AND user_id = ?", [type, userId]);

    it("say the window is open once, at a review day once, and 2 business days before the close once", async () => {
      // A draft for the later season, and a role whose terms set a review day.
      await insertProposal(pool, { id: "rp-00000000000000aa", userId: READER, targetSeasonId: "n-later", body: emptyBody(), now: new Date() });
      const water = await role("Rain Keeper", "c-land");
      await insertApplication(pool, {
        id: "sa-00000000000000aa",
        candidateUserId: FOURTH,
        proposedBy: FOURTH,
        seatIds: [water],
        note: null,
        deliverables: null,
        settings: { v: 1, term: { reviewOn: "2031-02-09" } } as any,
        settingsHash: "h",
        termEndsAt: new Date("2031-06-01T00:00:00Z"),
        termSeasonId: null,
        termFollowsSeason: false,
        startsAt: null,
        status: "adopted",
      });
      await q("INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, term_ends_at, application_id) VALUES ('cp-rain', ?, 'member', ?, 'cp-rain', NULL, 'sa-00000000000000aa')", [water, FOURTH]);

      // Monday 10 February: the window is open, the review day was yesterday.
      await sweep("2031-02-10T09:00:00Z");
      await sweep("2031-02-10T15:00:00Z");
      expect(await rowsOf("role_proposal_window_open", HOLDER)).toEqual([{ dedupe_key: nudgeKey({ reason: "window-open", trigger: "n-later" }, HOLDER) }]);
      // A member with a draft for that season is not told it is open.
      expect(await rowsOf("role_proposal_window_open", READER)).toEqual([]);
      expect(await rowsOf("role_proposal_review_due", FOURTH)).toEqual([{ dedupe_key: nudgeKey({ reason: "review-due", trigger: `${water}:2031-02-09` }, FOURTH) }]);
      expect(await rowsOf("role_proposal_window_closing", READER)).toEqual([]);

      // Tuesday 25 February is still more than 2 business days out; Wednesday 26 is inside them.
      await sweep("2031-02-25T09:00:00Z");
      expect(await rowsOf("role_proposal_window_closing", READER)).toEqual([]);
      await sweep("2031-02-26T09:00:00Z");
      await sweep("2031-02-26T21:00:00Z");
      expect(await rowsOf("role_proposal_window_closing", READER)).toHaveLength(1);
      // The open notice and the review notice never came again.
      expect(await rowsOf("role_proposal_window_open", HOLDER)).toHaveLength(1);
      expect(await rowsOf("role_proposal_review_due", FOURTH)).toHaveLength(1);
      const [one] = await q("SELECT title, body, link FROM notifications WHERE type = 'role_proposal_window_closing' AND user_id = ?", [READER]);
      expect(one).toEqual({ title: NUDGE_WORDS.heading, body: NUDGE_WORDS.body["window-closing"], link: PROPOSE_ENTRY_HREF });
    });

    it("the banner's read says the same reason the bell does", async () => {
      // The harness's next season, with its window open now by hand.
      const today = new Date().toISOString().slice(0, 10);
      const inAMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      h.state.seasons = [SEASONS[0], { ...SEASONS[1], planWindow: { opensOn: today, closesOn: inAMonth } }];
      h.as(HOLDER);
      const r = await h.call("GET", `${P}/nudge`);
      expect(r.status, r.text).toBe(200);
      expect(r.body).toEqual({
        show: true,
        reason: "window-open",
        heading: "Propose your roles for next season",
        reasonWords: "The window is open",
        href: PROPOSE_ENTRY_HREF,
        linkWords: NUDGE_WORDS.link,
      });
      // A member who has submitted for that season is not asked again.
      h.as(OWNER);
      const owner = await h.call("GET", `${P}/nudge`);
      expect(owner.body.reason).not.toBe("window-open");
    });
  });
});

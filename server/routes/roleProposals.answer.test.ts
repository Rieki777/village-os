/**
 * THE CIRCLE ANSWERS, DRIVEN THROUGH THE ROUTES (role proposals PR D): over
 * real HTTP and the S5 scratch schema, with the member door and the proposal
 * routes registered side by side (server/testkit/roleProposalHarness.ts).
 *
 * The village is a fixture (two circles, their roles and who holds them,
 * because the harness registers no admin routes); everything a member does
 * goes through the routes the pages call: the candidate drafts, shares and
 * submits; the asked holders read Waiting on you and the application, and
 * answer; a holder of the power adopts.
 *
 *   - a second holder in the circle consents and a third objects; each reads
 *     the tally in counts and the titles of the roles they hold, never a name,
 *     and their row leaves Waiting on you once answered;
 *   - an objection's reason is held to the 300 characters the page's box
 *     holds, and a reason is needed;
 *   - the share link's member read carries the circle's real state, the asks
 *     included (it read every submitted proposal as a circle nobody else holds
 *     a role in);
 *   - with the objection, the power holder adopts by the power;
 *   - in a second circle, a consent and the window closing read "Record the
 *     adoption", and the power holder's click records it "after the circle
 *     consented".
 */
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CONSENT_WORDS, shortDay } from "../../shared/roleProposalConsent";
import { WAITING_URL } from "../../shared/waitingOnYou";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole } from "../lib/orgChart";
import { insertEntry } from "../repos/liveSessions";
import { harness, HOLDER, OWNER, P, PEOPLE, READER, SEASONS } from "../testkit/roleProposalHarness";

/** A third member of the food circle: the one who objects. */
const FOURTH = "u-four";
const NAMES = /Member (One|Two|Three|Four)/;
const configured = testDbConfigured();
if (!configured) console.warn("[roleProposals.answer] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

describe.skipIf(!configured)("the circle answers a role proposal, through the routes", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  const roles: Record<string, string> = {};

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned

  /** A role in a circle, seated by these members, the way a fixture seats. */
  const role = async (key: string, name: string, circleId: string, holders: string[]) => {
    const id = await createOrgRole(pool, {
      id: `ans-role-${key}`,
      name,
      seats: 3,
      circleId,
      aim: `Keep the ${name.toLowerCase()} work moving.`,
      domain: `The ${name.toLowerCase()} and its tools.`,
      accountabilities: ["Report each moon"],
    });
    for (const userId of holders) {
      await q("INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, term_ends_at) VALUES (?, ?, 'member', ?, ?, NULL)", [`ans-${key}-${userId}`, id, userId, `ans-${key}-${userId}`]);
    }
    roles[key] = id;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    h.state.pool = () => pool;
    PEOPLE[FOURTH] = { id: FOURTH, name: "Member Four" };
    for (const p of Object.values(PEOPLE)) {
      await q("INSERT INTO users (id, name, email, password_hash, paths) VALUES (?, ?, ?, 'x', '[]')", [p.id, p.name, `${p.id}@example.test`]);
    }
    await q("INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-food', 'Food Circle', '[]', 0), ('c-land', 'Land Circle', '[]', 0)");
    // The food circle met once, and said something, so an objection has a backlog to go to.
    const opened: any = await q(
      "INSERT INTO live_sessions (title, circle_id, status, facilitator_no, created_by_no, duration_min, state, stamp, closed_at) VALUES ('Food circle, week 1', 'c-food', 'closed', 1, 1, 45, '{}', '{}', NOW())",
    );
    await insertEntry(pool, { sessionId: Number(opened.insertId), itemId: null, kind: "note", text: "Counted the stores.", authorNo: 1, ownerSeatId: null, dueOn: null, now: new Date() });
    // The candidate keeps the kitchen; a second member keeps the gate; a third bakes. HOLDER sits in no circle and holds the power.
    await role("kitchen", "Kitchen Keeper", "c-food", [OWNER]);
    await role("gate", "Gate Keeper", "c-food", [READER]);
    await role("bread", "Bread Keeper", "c-food", [FOURTH]);
    await role("orchard", "Orchard Keeper", "c-land", [READER]);
    await role("water", "Water Keeper", "c-land", [FOURTH]);
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

  /** The candidate drafts a proposal through the routes, turns its link on, and submits it. */
  const propose = async (roleIds: string[], words: Record<string, string>) => {
    h.as(OWNER);
    const mine = await h.call("GET", `${P}/mine`);
    if (mine.body.draftId) await h.call("DELETE", `${P}/${mine.body.draftId}`);
    const made = await h.call("POST", P, {
      roles: roleIds.map((roleId, i) => ({ roleId, words: i === 0 ? words : {} })),
      season: { aim: "Feed everyone from our own land.", seasonalGoals: [{ title: "Every meal on time", doneWhen: "a moon with no late meal" }] },
    });
    expect(made.status, made.text).toBe(201);
    const id = made.body.proposal.id as string;
    const shared = await h.call("POST", `${P}/${id}/share`, { audience: "members" });
    expect(shared.status, shared.text).toBe(200);
    const sent = await h.call("POST", `${P}/${id}/submit`);
    expect(sent.status, sent.text).toBe(201);
    return { proposalId: id, applicationId: sent.body.id as string, token: shared.body.share.token as string };
  };

  const application = async (who: string, id: string) => {
    h.as(who);
    const r = await h.call("GET", `/api/governance/role-applications/${id}`);
    expect(r.status, r.text).toBe(200);
    return r.body.application;
  };
  const waitingFor = async (who: string) => {
    h.as(who);
    const r = await h.call("GET", WAITING_URL);
    expect(r.status, r.text).toBe(200);
    return r.body.toConsent as any[];
  };
  const answer = (who: string, id: string, body: unknown) => {
    h.as(who);
    return h.call("POST", `/api/governance/role-applications/${id}/consent`, body);
  };

  it("a second holder consents, a third objects, and the power holder adopts by the power", async () => {
    const s = await propose([roles.kitchen], { aim: "Feed everyone from our own land, every day." });

    // Asked to consent: the two other holders in the food circle, never the candidate, never the power holder outside it.
    for (const who of [READER, FOURTH]) {
      expect(await waitingFor(who)).toEqual([
        expect.objectContaining({ applicationId: s.applicationId, href: `/role-applications/${s.applicationId}`, roles: ["Kitchen Keeper"], circle: "Food Circle", applicant: "Member" }),
      ]);
    }
    expect(await waitingFor(OWNER)).toEqual([]);
    expect(await waitingFor(HOLDER)).toEqual([]);

    // The second holder reads the application: asked, may answer, and the tally names roles.
    const before = await application(READER, s.applicationId);
    expect(before.proposal.consent).toMatchObject({ state: "open", asked: 2, roles: { consented: [], objected: [] }, you: { asked: true, answer: null, mayAnswer: true } });
    expect([...before.proposal.consent.roles.asked].sort()).toEqual(["Bread Keeper", "Gate Keeper"]);
    // The power holder outside the circle reads it too, and is not asked.
    expect((await application(HOLDER, s.applicationId)).proposal.consent.you).toEqual({ asked: false, answer: null, mayAnswer: false });

    const consented = await answer(READER, s.applicationId, { answer: "consent" });
    expect(consented.status, consented.text).toBe(200);
    expect(consented.body).toMatchObject({ answer: "consent", consent: { consented: 1, roles: { consented: ["Gate Keeper"] }, you: { answer: "consent", mayAnswer: false } } });
    // Answered once: the row leaves the board, and a second answer is refused.
    expect(await waitingFor(READER)).toEqual([]);
    expect((await answer(READER, s.applicationId, { answer: "object", reason: "Second thoughts." })).body.error).toBe(CONSENT_WORDS.answered);

    // An objection needs a reason, at most 300 characters.
    expect((await answer(FOURTH, s.applicationId, { answer: "object" })).body.error).toBe(CONSENT_WORDS.reasonNeeded);
    const long = await answer(FOURTH, s.applicationId, { answer: "object", reason: "a".repeat(301) });
    expect(long.status).toBe(400);
    expect(long.body).toEqual({ error: "Keep the reason to 300 characters.", field: "reason" });
    const objected = await answer(FOURTH, s.applicationId, { answer: "object", reason: "The bakery needs the kitchen on Fridays." });
    expect(objected.status, objected.text).toBe(200);
    expect(objected.body).toMatchObject({
      answer: "object",
      carried: true,
      consent: { state: "objected", consented: 1, objected: 1, objections: ["The bakery needs the kitchen on Fridays."], roles: { objected: ["Bread Keeper"] }, record: null },
    });
    expect(await waitingFor(FOURTH)).toEqual([]);
    const [entry] = await q("SELECT text FROM live_session_entries WHERE kind = 'tension' AND text LIKE 'An objection%'");
    expect(entry.text).toBe("An objection to a role proposal for Kitchen Keeper: The bakery needs the kitchen on Fridays.");

    // Every reader reads the same tally, in roles: the candidate on their own page, a member by the share link.
    h.as(OWNER);
    const own = await h.call("GET", `${P}/${s.proposalId}`);
    expect(own.body.proposal.consent).toMatchObject({ state: "objected", roles: { consented: ["Gate Keeper"], objected: ["Bread Keeper"] } });
    expect([...own.body.proposal.consent.roles.asked].sort()).toEqual(["Bread Keeper", "Gate Keeper"]);
    h.as(READER);
    const link = await h.call("GET", `${P}/shared/${s.token}`);
    expect(link.status, link.text).toBe(200);
    expect(link.body.proposal.consent).toMatchObject({ state: "objected", asked: 2, roles: { objected: ["Bread Keeper"] }, you: { asked: true, answer: "consent" } });
    // The consent state names nobody, whoever reads it.
    const states = [own.body.proposal.consent, link.body.proposal.consent, (await application(HOLDER, s.applicationId)).proposal.consent];
    for (const state of states) expect(JSON.stringify(state)).not.toMatch(NAMES);

    // The power holder: no "Record the adoption" after an objection, and adopting says whose power.
    const held = await application(HOLDER, s.applicationId);
    expect(held.proposal.consent.record).toBeNull();
    expect(held.you).toMatchObject({ mayAdopt: true, holdsThePower: true, mayPutToVillage: false });
    h.as(HOLDER);
    const adopted = await h.call("POST", `/api/governance/role-applications/${s.applicationId}/adopt`);
    expect(adopted.status, adopted.text).toBe(200);
    expect(adopted.body).toMatchObject({ status: "adopted", decided: `Adopted on ${shortDay(new Date(), "UTC")} by the founder's power` });
    expect((await application(READER, s.applicationId)).proposal.decided).toBe(adopted.body.decided);
  });

  it("a consent and the window closing read Record the adoption, and the power holder records it", async () => {
    const s = await propose([roles.orchard], { aim: "Keep every orchard tree bearing." });
    expect((await answer(READER, s.applicationId, { answer: "consent" })).status).toBe(200);
    // Before the window closes there is nothing to record yet.
    expect((await application(HOLDER, s.applicationId)).proposal.consent).toMatchObject({ state: "open", record: null });

    // Close the circle's window now, as two business days passing would.
    await q("UPDATE role_proposal_asks SET closes_at = ? WHERE proposal_id = ?", [new Date(Date.now() - 1000), s.proposalId]);
    // The holder who never answered has no row left, and the window is closed to them.
    expect(await waitingFor(FOURTH)).toEqual([]);
    expect((await answer(FOURTH, s.applicationId, { answer: "consent" })).body.error).toBe(CONSENT_WORDS.windowClosed);

    const held = await application(HOLDER, s.applicationId);
    expect(held.proposal.consent).toMatchObject({
      state: "consented",
      words: "Consented by the circle",
      record: "Record the adoption",
      asked: 2,
      consented: 1,
      roles: { consented: ["Orchard Keeper"], objected: [] },
    });
    expect([...held.proposal.consent.roles.asked].sort()).toEqual(["Orchard Keeper", "Water Keeper"]);
    expect(held.you.mayAdopt).toBe(true);
    // Only a holder of the power may record it: a member of the circle reads the same state and cannot adopt.
    expect((await application(READER, s.applicationId)).you).toMatchObject({ mayAdopt: false, holdsThePower: false });
    h.as(READER);
    expect((await h.call("POST", `/api/governance/role-applications/${s.applicationId}/adopt`)).status).toBe(403);

    h.as(HOLDER);
    const recorded = await h.call("POST", `/api/governance/role-applications/${s.applicationId}/adopt`);
    expect(recorded.status, recorded.text).toBe(200);
    expect(recorded.body).toMatchObject({ status: "adopted", decided: `Adopted on ${shortDay(new Date(), "UTC")} after the circle consented` });
    const after = await application(OWNER, s.applicationId);
    expect(after.status).toBe("adopted");
    expect(after.proposal.decided).toBe(recorded.body.decided);
  });
});

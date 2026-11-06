/**
 * WHO MAY ADOPT A ROLE PROPOSAL, AND WHAT THE PAGE SAYS ABOUT IT (E8): over
 * real HTTP and the S5 scratch schema, with the member door and the proposal
 * routes registered side by side (server/testkit/roleProposalHarness.ts).
 *
 * Found end to end on a fresh local village (main e1c5eb6): the submit
 * confirm promised "the founder, steward or organisation power adopts it" in
 * a village where nobody held it, and a proposal one asked holder consented
 * to still waited out the window. Rye ruled who adopts on 2026-10-31 (sheet
 * item 24a): "The default for adopting a role proposal is those in founder
 * roles until they give that power to the community to use governance to
 * do", "Founder/steward roles". What is pinned:
 *
 *   - BEFORE A HANDOVER a live holder of a role carrying `org.seat` adopts.
 *     An admin or a founder account holding no such role does not, and nor
 *     does the holder of any other role. Never the candidate.
 *   - AFTER A HANDOVER (the village holds `org.seat`) nobody adopts at the
 *     door, the holder included: the village decides by vote, and a proposal
 *     that changes roles, which never goes to a vote, waits.
 *   - THE COPY NAMES WHO, IN THIS VILLAGE: the role as "Role (FirstName)",
 *     what has to happen first when nobody holds it or no role carries it,
 *     the vote once the village holds it, and never the candidate's name.
 *   - ONE HOLDER ASKED, ONE CONSENTED: the window has nothing left to wait
 *     for, so it reads "Consented by the circle" at once, and an objection
 *     from a second asked holder still blocks.
 */
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CONSENT_WORDS, shortDay } from "../../shared/roleProposalConsent";
import { VOTE_CANNOT_WORDS, VOTE_DECIDES_WORDS } from "../../shared/seatApplications";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole } from "../lib/orgChart";
import { readApplication } from "../repos/seatApplications";
import { harness, OWNER, P, PEOPLE, POWER_ROLE, READER, SEASONS } from "../testkit/roleProposalHarness";

/** A founder account, a steward seated in the power role, a plain admin, and a fourth member. */
const FOUNDER = "u-founder";
const STEWARD = "u-steward";
const ADMIN = "u-admin";
const FOURTH = "u-fourth";

const configured = testDbConfigured();
if (!configured) console.warn("[roleProposals.adopt] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const CIRCLE = "The circle consents within 2 business days, or";
const NOBODY_HOLDS = "whoever holds Founder adopts it. Nobody holds it yet, so an admin places someone in it first.";
const NO_ROLE_CARRIES = "a founder or steward role adopts it. No role here carries the power to place people in roles yet, so an admin gives it to one first.";
const cap = (clause: string) => clause.charAt(0).toUpperCase() + clause.slice(1);

describe.skipIf(!configured)("who may adopt a role proposal, on a real schema (E8)", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    h.state.pool = () => pool;
    PEOPLE[FOUNDER] = { id: FOUNDER, name: "Rowan Field" };
    PEOPLE[STEWARD] = { id: STEWARD, name: "Hal Brook" };
    PEOPLE[ADMIN] = { id: ADMIN, name: "Ada Stone" };
    PEOPLE[FOURTH] = { id: FOURTH, name: "Ivo Lantern" };
    for (const p of Object.values(PEOPLE)) {
      await q("INSERT INTO users (id, name, email, password_hash, paths) VALUES (?, ?, ?, 'x', '[]')", [p.id, p.name, `${p.id}@example.test`]);
    }
    await q(
      "INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-solo', 'Quiet Circle', '[]', 0), ('c-one', 'Orchard Circle', '[]', 0), ('c-two', 'Water Circle', '[]', 0)",
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
    h.state.holders = [];
    h.state.admins = [];
    h.state.founders = [];
    h.state.villageHeld = [];
    h.state.powerRoles = [POWER_ROLE];
    h.state.seasons = SEASONS;
    h.state.limited = [];
    h.notices.length = 0;
  });

  /** A fresh role in a circle, seated by these members directly, the way a fixture seats. */
  const role = async (name: string, circleId: string, holders: string[] = []) => {
    n += 1;
    const id = await createOrgRole(pool, {
      id: `ad-role-${n}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
      name,
      seats: 3,
      circleId,
      aim: `Keep the ${name.toLowerCase()} work moving.`,
    });
    for (const userId of holders) {
      await q("INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, term_ends_at) VALUES (?, ?, 'member', ?, ?, NULL)", [
        `ad-seat-${n}-${userId}`,
        id,
        userId,
        `ad-${n}-${userId}`,
      ]);
    }
    return id;
  };

  /** A ready draft for these roles, the member's earlier draft deleted first. */
  const draft = async (who: string, roleIds: string[]) => {
    h.as(who);
    const mine = await h.call("GET", `${P}/mine`);
    if (mine.body.draftId) await h.call("DELETE", `${P}/${mine.body.draftId}`);
    const made = await h.call("POST", P, {
      roles: roleIds.map((roleId) => ({ roleId })),
      season: { aim: "Feed thirty people from the beds.", seasonalGoals: [{ title: "Every bed planted", doneWhen: "each bed holds a crop" }] },
    });
    expect(made.status, made.text).toBe(201);
    return made.body.proposal.id as string;
  };

  const submit = async (who: string, roleIds: string[]) => {
    const proposalId = await draft(who, roleIds);
    h.as(who);
    const r = await h.call("POST", `${P}/${proposalId}/submit`);
    expect(r.status, r.text).toBe(201);
    return { proposalId, applicationId: r.body.id as string };
  };

  const page = async (applicationId: string, who: string) => {
    h.as(who);
    const r = await h.call("GET", `/api/governance/role-applications/${applicationId}`);
    expect(r.status, r.text).toBe(200);
    return r.body.application;
  };

  const adopt = (applicationId: string, who: string) => {
    h.as(who);
    return h.call("POST", `/api/governance/role-applications/${applicationId}/adopt`);
  };

  const withdraw = async (applicationId: string) => {
    h.as(OWNER);
    expect((await h.call("POST", `/api/governance/role-applications/${applicationId}/withdraw`)).status).toBe(200);
  };

  const today = () => shortDay(new Date(), "UTC");

  /** A ready draft that proposes a new role, so it changes roles. */
  const submitNewRole = async (who: string, circleId: string, name: string) => {
    h.as(who);
    const mine = await h.call("GET", `${P}/mine`);
    if (mine.body.draftId) await h.call("DELETE", `${P}/${mine.body.draftId}`);
    const made = await h.call("POST", P, {
      newRoles: [{ circleId, words: { name, aim: "Keep the new work moving." } }],
      season: { aim: "Feed thirty people from the beds.", seasonalGoals: [{ title: "Every bed planted", doneWhen: "each bed holds a crop" }] },
    });
    expect(made.status, made.text).toBe(201);
    const r = await h.call("POST", `${P}/${made.body.proposal.id}/submit`);
    expect(r.status, r.text).toBe(201);
    return { proposalId: made.body.proposal.id as string, applicationId: r.body.id as string };
  };

  it("before handover a holder of the founder or steward role adopts; an admin or a founder account holding no such role is refused", async () => {
    h.state.holders = [STEWARD];
    h.state.founders = [FOUNDER];
    h.state.admins = [ADMIN];
    const s = await submit(OWNER, [await role("Gate Keeper", "c-solo")]);
    for (const who of [FOUNDER, ADMIN, READER]) {
      const seen = await page(s.applicationId, who);
      expect(seen.you, who).toMatchObject({ isCandidate: false, mayAdopt: false, holdsThePower: false });
      expect(seen.whoAdopts, who).toBe("Founder (Hal) adopts it.");
      const refused = await adopt(s.applicationId, who);
      expect(refused.status, who).toBe(403);
      expect(refused.body.error, who).toBe("not_a_holder");
    }
    expect((await readApplication(pool, s.applicationId))?.status).toBe("awaiting-holder");

    const steward = await page(s.applicationId, STEWARD);
    expect(steward.you).toMatchObject({ mayAdopt: true, holdsThePower: true });
    const adopted = await adopt(s.applicationId, STEWARD);
    expect(adopted.status, adopted.text).toBe(200);
    expect(adopted.body).toMatchObject({ status: "adopted", decided: `Adopted on ${today()} by the founder's power` });
  });

  it("ADVERSARIAL: a fresh fork where no role carries the power: nobody adopts, the founder and an admin included, and the page says what has to happen first", async () => {
    h.state.powerRoles = [];
    h.state.founders = [FOUNDER];
    h.state.admins = [ADMIN];
    const s = await submit(OWNER, [await role("Quiet Keeper", "c-solo")]);
    const founder = await page(s.applicationId, FOUNDER);
    expect(founder.status).toBe("awaiting-holder");
    expect(founder.whoAdopts).toBe(cap(NO_ROLE_CARRIES));
    // Nobody holds the power live, so any member may still send it to the village (red team G5); the ruling leaves that road as it was.
    expect(founder.you).toMatchObject({ mayAdopt: false, holdsThePower: false, mayPutToVillage: true });
    for (const who of [FOUNDER, ADMIN]) expect((await adopt(s.applicationId, who)).status, who).toBe(403);
    expect((await readApplication(pool, s.applicationId))?.status).toBe("awaiting-holder");
    await withdraw(s.applicationId);
  });

  it("ADVERSARIAL: a role carries the power and nobody holds it: the page names the role and says somebody has to be placed in it first", async () => {
    h.state.founders = [FOUNDER];
    const s = await submit(OWNER, [await role("Rain Keeper", "c-solo")]);
    const founder = await page(s.applicationId, FOUNDER);
    expect(founder.whoAdopts).toBe(cap(NOBODY_HOLDS));
    expect(founder.you.mayAdopt).toBe(false);
    expect((await adopt(s.applicationId, FOUNDER)).status).toBe(403);
    await withdraw(s.applicationId);
  });

  it("after handover nobody adopts at the door, the holder included: the village decides by vote, and a proposal that changes roles waits", async () => {
    h.state.villageHeld = ["org.seat"];
    h.state.holders = [STEWARD];
    h.state.founders = [FOUNDER];
    const s = await submit(OWNER, [await role("Bridge Keeper", "c-solo")]);
    const steward = await page(s.applicationId, STEWARD);
    expect(steward.whoAdopts).toBe(VOTE_DECIDES_WORDS);
    expect(steward.you).toMatchObject({ mayAdopt: false });
    // Any member may send it to the village, which is where the decision now lives.
    expect((await page(s.applicationId, READER)).you).toMatchObject({ mayAdopt: false, mayPutToVillage: true });
    for (const who of [STEWARD, FOUNDER]) {
      const refused = await adopt(s.applicationId, who);
      expect(refused.status, who).toBe(403);
      expect(refused.body.error, who).toBe("not_a_holder");
    }
    expect((await readApplication(pool, s.applicationId))?.status).toBe("awaiting-holder");
    await withdraw(s.applicationId);

    // A proposal that changes roles never goes to a vote (Rye, 2026-10-22), so the page says it waits, and offers no vote.
    const changing = await submitNewRole(OWNER, "c-solo", "Lantern Keeper");
    const read = await page(changing.applicationId, READER);
    expect(read.whoAdopts).toBe(VOTE_CANNOT_WORDS);
    expect(read.you).toMatchObject({ mayAdopt: false, mayPutToVillage: false });
    await withdraw(changing.applicationId);
  });

  it("ADVERSARIAL: the candidate who holds the power and is an admin cannot adopt their own proposal, before handover or after, and is never named", async () => {
    for (const held of [[], ["org.seat"]]) {
      h.state.villageHeld = held;
      h.state.founders = [OWNER];
      h.state.holders = [OWNER];
      const s = await submit(OWNER, [await role(`Own Keeper ${held.length}`, "c-solo")]);
      const own = await page(s.applicationId, OWNER);
      expect(own.you).toMatchObject({ isCandidate: true, mayAdopt: false });
      const refused = await adopt(s.applicationId, OWNER);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe("own_terms");
      expect(own.whoAdopts).not.toContain(PEOPLE[OWNER].name.split(" ")[0]);
      await withdraw(s.applicationId);
    }
  });

  it("the submit confirm names who adopts in this village, read from who holds the power, and never promises a power nobody holds", async () => {
    const quiet = await role("Lamp Keeper", "c-solo");
    const id = await draft(OWNER, [quiet]);
    const words = async () => {
      h.as(OWNER);
      const r = await h.call("POST", `${P}/${id}/words`);
      expect(r.status, r.text).toBe(200);
      expect(r.body.whoApproves).not.toContain("organisation power");
      return r.body.whoApproves;
    };
    expect(await words()).toBe(`${CIRCLE} ${NOBODY_HOLDS}`);
    h.state.holders = [STEWARD];
    expect(await words()).toBe(`${CIRCLE} Founder (Hal) adopts it.`);
    // Once the village holds the power, nobody at the door can record a consent, so there is no circle line.
    h.state.villageHeld = ["org.seat"];
    expect(await words()).toBe(VOTE_DECIDES_WORDS);
    // The member proposing is never named as the one who adopts their own.
    h.state.villageHeld = [];
    h.state.holders = [OWNER];
    expect(await words()).toBe(`${CIRCLE} whoever holds Founder adopts it. Nobody else holds it yet, so an admin places someone in it first.`);
    h.state.holders = [];
    h.state.powerRoles = [];
    expect(await words()).toBe(`${CIRCLE} ${NO_ROLE_CARRIES}`);
    h.as(OWNER);
    expect((await h.call("DELETE", `${P}/${id}`)).status).toBe(200);
  });

  it("one holder asked, one consented: consented by the circle at once, and the holder records it", async () => {
    h.state.holders = [STEWARD];
    const orchard = await role("Orchard Keeper", "c-one", [READER]);
    const s = await submit(OWNER, [orchard]);
    h.as(READER);
    const said = await h.call("POST", `/api/governance/role-applications/${s.applicationId}/consent`, { answer: "consent" });
    expect(said.status, said.text).toBe(200);
    expect(said.body.consent).toMatchObject({ state: "consented", asked: 1, consented: 1 });
    const steward = await page(s.applicationId, STEWARD);
    expect(steward.proposal.consent).toMatchObject({ state: "consented", words: CONSENT_WORDS.consented, record: CONSENT_WORDS.record });
    expect(steward.you.mayAdopt).toBe(true);
    const adopted = await adopt(s.applicationId, STEWARD);
    expect(adopted.status, adopted.text).toBe(200);
    expect(adopted.body.decided).toBe(`Adopted on ${today()} after the circle consented`);
  });

  it("ADVERSARIAL: one asked holder consents, then a second asked holder objects, and the objection blocks", async () => {
    h.state.holders = [STEWARD];
    const water = await role("Well Keeper", "c-two", [READER, FOURTH]);
    const s = await submit(OWNER, [water]);
    h.as(READER);
    const first = await h.call("POST", `/api/governance/role-applications/${s.applicationId}/consent`, { answer: "consent" });
    expect(first.body.consent).toMatchObject({ state: "open", asked: 2, consented: 1 });
    h.as(FOURTH);
    const second = await h.call("POST", `/api/governance/role-applications/${s.applicationId}/consent`, { answer: "object", reason: "The well has two keepers already." });
    expect(second.status, second.text).toBe(200);
    expect(second.body.consent).toMatchObject({ state: "objected", consented: 1, objected: 1 });
    expect((await page(s.applicationId, STEWARD)).proposal.consent).toMatchObject({ state: "objected", record: null });
    await withdraw(s.applicationId);
  });
});

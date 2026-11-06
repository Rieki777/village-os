/**
 * A ROLE PROPOSAL'S CARD IS DRAWN IN THE SEASON IT IS FOR (E9): over real HTTP
 * and the S5 scratch schema (server/testkit/roleProposalHarness.ts).
 *
 * Found end to end on a fresh local village (main e1c5eb6): a proposal for
 * Second Season showed its card headed "Unnamed Village · First Season, 22
 * September to 20 December 2026", right under the page header "For Second
 * Season", because the card was built with the RUNNING season. What is
 * pinned, for the owner's card and the shared view (the application card is
 * pinned in server/routes/applicationCard.test.ts):
 *
 *   - the eyebrow names the proposal's own season and the span is its dates;
 *   - the moon pill counts no day of a season that has not begun;
 *   - "My moon cycle" runs over that season's moons;
 *   - a season renamed after drafting reads by its new name, a village with
 *     no next season draws no season at all, never the running one, and a
 *     season that has since ended is named with no day counted.
 */
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spanWords } from "../../shared/playerCardHero";
import { civilDateInstant } from "../../shared/seatTerms";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole } from "../lib/orgChart";
import { DAY, harness, iso, NEXT_ENDS, NEXT_STARTS, OWNER, P, PEOPLE, READER, SEASONS } from "../testkit/roleProposalHarness";

const configured = testDbConfigured();
if (!configured) console.warn("[roleProposals.cardSeason] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

/** "1 December 2026 to 18 June 2027": the season's first day to the day before the next one starts. */
const spanOf = (startsOn: string, endsOn: string) =>
  spanWords(civilDateInstant(startsOn, "UTC") as Date, new Date((civilDateInstant(endsOn, "UTC") as Date).getTime() - 1), "UTC");

describe.skipIf(!configured)("a role proposal's card names the season it is for, on a real schema (E9)", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    h.state.pool = () => pool;
    for (const p of Object.values(PEOPLE)) {
      await pool.query("INSERT INTO users (id, name, email, password_hash, paths) VALUES (?, ?, ?, 'x', '[]')", [p.id, p.name, `${p.id}@example.test`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
    await pool.query("INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-land', 'Land Circle', '[]', 0)"); // module-review-ok: a fixture on the scratch schema this suite provisioned
    await h.start();
  });

  afterAll(async () => {
    await h.stop();
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    h.as(OWNER);
    h.state.seasons = SEASONS;
  });

  const role = async (name: string) => {
    n += 1;
    return createOrgRole(pool, { id: `cs-role-${n}`, name, seats: 2, circleId: "c-land", aim: `Keep the ${name.toLowerCase()} work moving.` });
  };

  /** A ready draft for a fresh role, the owner's earlier draft deleted first. */
  const readyDraft = async () => {
    h.as(OWNER);
    const mine = await h.call("GET", `${P}/mine`);
    if (mine.body.draftId) await h.call("DELETE", `${P}/${mine.body.draftId}`);
    const made = await h.call("POST", P, {
      roles: [{ roleId: await role(`Card Keeper ${n + 1}`) }],
      season: { aim: "Feed thirty people from the beds.", seasonalGoals: [{ title: "Every bed planted", doneWhen: "each bed holds a crop" }] },
    });
    expect(made.status, made.text).toBe(201);
    return made.body.proposal as { id: string; target: { seasonId: string } | null };
  };

  const ownCard = async (id: string) => {
    h.as(OWNER);
    const r = await h.call("GET", `${P}/${id}/card`);
    expect(r.status, r.text).toBe(200);
    return r.body.card;
  };

  it("the owner's card and the shared view name the target season, its dates and its moons, never the running one", async () => {
    const d = await readyDraft();
    expect(d.target?.seasonId).toBe("s-next");
    const card = await ownCard(d.id);
    expect(card.header.eyebrow).toBe("Test village · Next season");
    expect(card.header.span).toBe(spanOf(NEXT_STARTS, NEXT_ENDS));
    // The season has not begun, so the pill names today's moon and counts no day of it.
    expect(card.header.moon.day).toBeNull();
    expect(card.header.moon.words).not.toMatch(/Day/);
    // My moon cycle runs over that season, from its first day.
    expect(card.timeline.moons[0].startsAt).toBe((civilDateInstant(NEXT_STARTS, "UTC") as Date).toISOString());

    h.as(OWNER);
    const on = await h.call("POST", `${P}/${d.id}/share`);
    expect(on.status, on.text).toBe(200);
    h.as(READER);
    const shared = await h.call("GET", `${P}/shared/${on.body.share.token}`);
    expect(shared.status, shared.text).toBe(200);
    expect(shared.body.card.card.header.eyebrow).toBe("Test village · Next season");
    expect(shared.body.card.card.header.span).toBe(spanOf(NEXT_STARTS, NEXT_ENDS));
  });

  it("ADVERSARIAL: a season renamed after the proposal was drafted reads by its new name", async () => {
    const d = await readyDraft();
    h.state.seasons = [SEASONS[0], { ...SEASONS[1], name: "Spring of Roots" }];
    expect((await ownCard(d.id)).header.eyebrow).toBe("Test village · Spring of Roots");
  });

  it("ADVERSARIAL: a village with no next season, or no season at all, draws no season on the card, never the running one", async () => {
    h.state.seasons = [SEASONS[0]];
    const d = await readyDraft();
    expect(d.target).toBeNull();
    const card = await ownCard(d.id);
    expect(card.header.eyebrow).toBe("Test village");
    expect(card.header.span).toBeNull();
    expect(card.header.moon.day).toBeNull();
    h.state.seasons = [];
    expect((await ownCard(d.id)).header.eyebrow).toBe("Test village");
  });

  it("ADVERSARIAL: a submitted proposal for a season that has since ended names that season and counts no day", async () => {
    const d = await readyDraft();
    h.as(OWNER);
    const sent = await h.call("POST", `${P}/${d.id}/submit`);
    expect(sent.status, sent.text).toBe(201);
    // The season it was for is moved into the past, as a village correcting its calendar would.
    const pastStarts = iso(Date.now() - 400 * DAY);
    const pastEnds = iso(Date.now() - 300 * DAY);
    h.state.seasons = [{ ...SEASONS[1], startsOn: pastStarts, endsOn: pastEnds }, SEASONS[0]];
    const card = await ownCard(d.id);
    expect(card.header.eyebrow).toBe("Test village · Next season");
    expect(card.header.span).toBe(spanOf(pastStarts, pastEnds));
    expect(card.header.moon.day).toBeNull();
    h.as(OWNER);
    expect((await h.call("POST", `/api/governance/role-applications/${sent.body.id}/withdraw`)).status).toBe(200);
  });
});

/**
 * THE ROLE CARD AS TEXT, AND BRINGING A DESCRIPTION IN, over real HTTP and the
 * S5 scratch schema (server/routes/roleCardImport.ts), with the role proposal
 * routes and the member door registered as server/index.ts registers them.
 *
 * What is pinned:
 *
 *   - every door answers 401 to a visitor and 403 to a guest;
 *   - "Download my card as text": the owner's draft as a role-card.txt file,
 *     a role the village has named by its Role id; nobody else reads it; and
 *     /mine/text answers the draft, or the current card with no draft;
 *   - import reads and never writes: pasted text, a .docx, a .pdf, a .md and
 *     a Google Doc link each come back as their words, the draft unchanged;
 *   - a card fills the draft through the ordinary PUT with the changes the
 *     member ticks, and downloading it back gives the card that went in;
 *   - text that is not a card comes back as its words alone, for the AI
 *     half or the member's own AI;
 *   - the refusals: a kind it does not read, a file over 5 MB, a link to
 *     another host (never fetched), nothing sent, and the rate bound;
 *   - the name rule reads the village's members, and no member's name comes
 *     back unless the card itself wrote it;
 *   - the server's word fields are the ones the shared tests read with.
 */
import type mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_CARD_WORDS, writeRoleCard, type RoleCardDoc } from "../../shared/roleCardText";
import { acceptOnly } from "../../shared/roleCardApply";
import { workedExample } from "../../shared/roleCardPrompt";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole } from "../lib/orgChart";
import { ROLE_WORD_FIELDS } from "../lib/roleProposals";
import { DOCUMENT_WORDS, ROLE_DOCUMENT_MAX_BYTES } from "../lib/roleDocumentText";
import { makeDocx, makePdf, para } from "../testkit/roleDocuments";
import { GOAL_FOOD, GOAL_TEAM, harness, HOLDER, OWNER, P, PEOPLE, READER, SEASONS } from "../testkit/roleProposalHarness";

const configured = testDbConfigured();
if (!configured) console.warn("[roleCardImport] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const VILLAGE = "Test village";
const HEADER = `${VILLAGE} role card v1`;

describe("every role card door turns away a visitor and a guest", () => {
  const h = harness();
  beforeAll(h.start);
  afterAll(h.stop);

  it("a visitor gets 401 and a guest 403, before any read", async () => {
    for (const [method, url] of [
      ["GET", `${P}/mine/text`],
      ["GET", `${P}/rp-0123456789abcdef/text`],
      ["POST", `${P}/rp-0123456789abcdef/import`],
    ] as const) {
      h.as(null);
      expect((await h.call(method, url, method === "POST" ? { text: HEADER } : undefined)).status, `${method} ${url}`).toBe(401);
      h.as("u-guest", "guest");
      expect((await h.call(method, url, method === "POST" ? { text: HEADER } : undefined)).status, `${method} ${url}`).toBe(403);
    }
  });

  // THE GUARD ON A ROLE'S WORDS. The word list is DERIVED: every column a role
  // carries, minus NOT_ROLE_WORDS in shared/roleProposals.ts. So a column a
  // later release adds to roles becomes proposable by default, and money that
  // way rides on the words where adoption never applies it (batch 51's cash
  // pay did exactly that until it joined NOT_ROLE_WORDS). This pin turns the
  // next new column into a red: decide whether it is a word a member may
  // propose, and add it here, or a field that is not, and add it there.
  it("reads with the word fields the shared format's tests read with, and every new role column is decided", () => {
    expect(ROLE_WORD_FIELDS.fields).toEqual(["name", "aim", "domain", "accountabilities", "whyItMatters", "bringMe", "notMine", "runbook", "existsWhile", "authorities", "responsibilities", "signsStretched", "flowsBack", "stepBack", "timeCommitment"]);
    expect(Array.from(ROLE_WORD_FIELDS.lists).sort()).toEqual(["accountabilities", "authorities", "bringMe", "notMine", "responsibilities"]);
  });
});

describe.skipIf(!configured)("the role card routes, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    h.state.pool = () => pool;
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
    h.state.limited = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const role = async (name: string) => {
    n += 1;
    return createOrgRole(pool, {
      id: `rc-role-${n}`,
      name,
      seats: 2,
      circleId: "c-land",
      aim: `Keep the ${name.toLowerCase()} work moving.`,
      domain: `The ${name.toLowerCase()} and its tools.`,
      accountabilities: ["Report each moon", "Keep the list current", "Train someone new"],
    });
  };

  const freshDraft = async (body: Record<string, unknown> = {}, who = OWNER) => {
    h.as(who);
    const mine = await h.call("GET", `${P}/mine`);
    if (mine.body.draftId) expect((await h.call("DELETE", `${P}/${mine.body.draftId}`)).status).toBe(200);
    const r = await h.call("POST", P, body);
    expect(r.status, r.text).toBe(201);
    return r.body.proposal;
  };

  const download = async (url: string) => {
    const res = await h.raw(url, { headers: {} });
    return { status: res.status, type: res.headers.get("content-type"), disposition: res.headers.get("content-disposition"), text: await res.text() };
  };

  /** A card in this village: the founder's worked example, its roles in the Land Circle, serving next season's goals. */
  const exampleCard = (): string => {
    const doc = workedExample(VILLAGE);
    const here: RoleCardDoc = {
      ...doc,
      roles: doc.roles.map((r) => ({ ...r, circle: "Land Circle" })),
      season: {
        ...doc.season!,
        servesGoals: [
          { goal: GOAL_FOOD, howItHelps: "newcomers find a role in the kitchen." },
          { goal: GOAL_TEAM, howItHelps: "every role written down, consented to and reviewed on time." },
        ],
      },
    };
    return writeRoleCard(here);
  };

  it("downloads the owner's draft as role-card.txt, naming a role the village has by its Role id; nobody else reads it", async () => {
    const garden = await role("Garden Steward");
    const p = await freshDraft({
      roles: [{ roleId: garden, words: { bringMe: ["Seeds to share"] } }],
      newRoles: [{ circleId: "c-people", words: { name: "Welcome Host", aim: "Every newcomer is met at the gate." } }],
      season: { aim: "Feed thirty people.", seasonalGoals: [{ title: "Every bed planted", doneWhen: "each bed holds a crop" }], servesGoals: [] },
    });
    const got = await download(`${P}/${p.id}/text`);
    expect(got.status).toBe(200);
    expect(got.type).toBe("text/plain; charset=utf-8");
    expect(got.disposition).toBe('attachment; filename="role-card.txt"');
    expect(got.text).toBe(
      [
        HEADER,
        "",
        "## Role title",
        "Garden Steward",
        `Role id: ${garden}`,
        "",
        "### Circle",
        "Land Circle",
        "",
        "### Purpose",
        "Keep the garden steward work moving.",
        "",
        "### What I look after",
        "The garden steward and its tools.",
        "",
        "### What you can count on me for",
        "- Report each moon",
        "- Keep the list current",
        "- Train someone new",
        "",
        "### Bring me",
        "- Seeds to share",
        "",
        "## Role title",
        "Welcome Host",
        "",
        "### Circle",
        "People Circle",
        "",
        "### Purpose",
        "Every newcomer is met at the gate.",
        "",
        "## My season",
        "",
        "### My aim this season",
        "Feed thirty people.",
        "",
        "### My seasonal goals",
        "- Every bed planted",
        "  Done when: each bed holds a crop",
        "",
      ].join("\n"),
    );
    h.as(READER);
    expect((await download(`${P}/${p.id}/text`)).status).toBe(404);
  });

  it("/mine/text answers the draft, or the current card when there is none", async () => {
    const gate = await role("Gate Keeper");
    h.as(READER);
    const applied = await h.call("POST", "/api/governance/role-applications", { seatIds: [gate], deliverables: "The gate is open on work days." });
    expect(applied.status, applied.text).toBe(201);
    h.as(HOLDER);
    expect((await h.call("POST", `/api/governance/role-applications/${applied.body.id}/adopt`)).body.status).toBe("adopted");
    h.as(READER);
    const mine = await h.call("GET", `${P}/mine`);
    if (mine.body.draftId) await h.call("DELETE", `${P}/${mine.body.draftId}`);
    const current = await download(`${P}/mine/text`);
    expect(current.status).toBe(200);
    expect(current.text).toContain(`## Role title\nGate Keeper\nRole id: ${gate}\n`);
    const draft = await freshDraft({ newRoles: [{ circleId: "c-land", words: { name: "Tool Keeper" } }] }, READER);
    const drafted = await download(`${P}/mine/text`);
    expect(drafted.text).toBe((await download(`${P}/${draft.id}/text`)).text);
    expect(drafted.text).toContain("Tool Keeper");
  });

  it("reads a pasted card against the village and changes nothing until the member's ticks go through the PUT; then the download is the card", async () => {
    const p = await freshDraft();
    const card = exampleCard();
    const r = await h.call("POST", `${P}/${p.id}/import`, { text: card });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ source: "text", isCard: true });
    expect(r.body.read.problems).toEqual([]);
    expect(r.body.read.ok).toBe(true);
    expect(r.body.changes.map((c: any) => c.path)).toEqual(["newRoles.0", "newRoles.1", "newRoles.2", "settings.scoreboard.measures", "season.aim", "season.seasonalGoals", "season.servesGoals"]);
    // Reading changed nothing.
    const before = await h.call("GET", `${P}/${p.id}`);
    expect(before.body.proposal.newRoles).toEqual([]);
    expect(before.body.proposal.updatedAt).toBe(p.updatedAt);

    // The member keeps everything: the ordinary PUT fills the draft.
    const put = acceptOnly(r.body.read.proposalBody, new Set(r.body.changes.map((c: any) => c.path)), r.body.current);
    const saved = await h.call("PUT", `${P}/${p.id}`, put);
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.proposal.newRoles.map((x: any) => [x.name, x.circle.name])).toEqual([
      ["Human Operations & Onboarding Lead Steward", "Land Circle"],
      ["Front-End & Game Platform Steward", "Land Circle"],
      ["Organizational Design & Governance Facilitator", "Land Circle"],
    ]);
    expect(saved.body.proposal.newRoles[0].fields.every((f: any) => f.proposed === null || f.changed)).toBe(true);
    // Downloaded back, it is the card that went in.
    expect((await download(`${P}/${p.id}/text`)).text).toBe(card);
    // And reading it again over the filled draft changes nothing.
    const again = await h.call("POST", `${P}/${p.id}/import`, { text: card });
    expect(again.body.changes).toEqual([]);
  });

  it("reads a .docx, a .pdf and a .md file, and never writes the document", async () => {
    const p = await freshDraft();
    const lines = [HEADER, "## Role title", "Seed Keeper", "### Circle", "Land Circle", "### Purpose", "Keep our seeds alive."];
    const files: Array<[string, Buffer, string]> = [
      ["role.docx", makeDocx(lines.map((l) => (l.startsWith("#") ? para(l.replace(/^#+\s*/, ""), { style: `Heading${l.startsWith("###") ? 3 : 2}` }) : para(l)))), "docx"],
      ["role.pdf", makePdf(lines), "pdf"],
      ["role.md", Buffer.from(lines.join("\n")), "md"],
    ];
    const [[{ c: uploadsBefore }]]: any = await pool.query("SELECT COUNT(*) AS c FROM role_proposals"); // module-review-ok: a count on the scratch schema this suite provisioned
    for (const [name, bytes, kind] of files) {
      const form = new FormData();
      form.append("file", new Blob([bytes]), name);
      const res = await h.raw(`${P}/${p.id}/import`, { method: "POST", body: form });
      const body: any = await res.json();
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ source: "file", kind, isCard: true });
      expect(body.read.problems).toEqual([]);
      expect(body.read.proposalBody.newRoles[0]).toMatchObject({ circleId: "c-land", words: { name: "Seed Keeper", aim: "Keep our seeds alive." } });
    }
    const [[{ c: uploadsAfter }]]: any = await pool.query("SELECT COUNT(*) AS c FROM role_proposals"); // module-review-ok: a count on the scratch schema this suite provisioned
    expect(uploadsAfter).toBe(uploadsBefore);
    expect((await h.call("GET", `${P}/${p.id}`)).body.proposal.newRoles).toEqual([]);
  });

  it("answers a description that is not a card with its words alone", async () => {
    const p = await freshDraft();
    const r = await h.call("POST", `${P}/${p.id}/import`, { text: "I keep the seed library and teach saving seeds on Saturdays." });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ source: "text", kind: "txt", isCard: false, text: "I keep the seed library and teach saving seeds on Saturdays." });
  });

  it("reads a Google Doc shared as anyone with the link, from the export it builds, and refuses another host without fetching it", async () => {
    const p = await freshDraft();
    const outbound: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
      outbound.push(url);
      return new Response(`${HEADER}\n## Role title\nSeed Keeper\n### Circle\nLand Circle`, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
    });
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-";
    const r = await h.call("POST", `${P}/${p.id}/import`, { link: `https://docs.google.com/document/d/${id}/edit?usp=sharing` });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ source: "link", kind: "google-doc", isCard: true });
    expect(outbound).toEqual([`https://docs.google.com/document/d/${id}/export?format=txt`]);
    const other = await h.call("POST", `${P}/${p.id}/import`, { link: "https://example.org/role.txt" });
    expect(other.status).toBe(400);
    expect(other.body.error).toBe(DOCUMENT_WORDS.notGoogleDoc);
    expect(outbound).toHaveLength(1);
  });

  it("refuses a kind it does not read, a file over 5 MB, nothing at all, and past the rate bound", async () => {
    const p = await freshDraft();
    const picture = new FormData();
    picture.append("file", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])]), "me.png");
    const pic = await h.raw(`${P}/${p.id}/import`, { method: "POST", body: picture });
    expect(pic.status).toBe(415);
    expect(((await pic.json()) as any).error).toBe(DOCUMENT_WORDS.wrongKind);

    const big = new FormData();
    big.append("file", new Blob([Buffer.alloc(ROLE_DOCUMENT_MAX_BYTES + 10, 0x61)]), "big.txt");
    const huge = await h.raw(`${P}/${p.id}/import`, { method: "POST", body: big });
    expect(huge.status).toBe(413);
    expect(((await huge.json()) as any).error).toBe(DOCUMENT_WORDS.tooBig);

    expect((await h.call("POST", `${P}/${p.id}/import`, {})).status).toBe(400);
    expect((await h.call("POST", `${P}/${p.id}/import`, { text: "   " })).status).toBe(400);

    h.state.limited = ["role-proposal-import"];
    expect((await h.call("POST", `${P}/${p.id}/import`, { text: HEADER })).status).toBe(429);
  });

  it("reports a member's name in the card, and sends back no name the card did not write", async () => {
    const p = await freshDraft();
    const r = await h.call("POST", `${P}/${p.id}/import`, {
      text: `${HEADER}\n## Role title\nSeed Keeper\n### Circle\nLand Circle\n### What flows back\nSeed lists from ${PEOPLE[HOLDER].name}.`,
    });
    expect(r.body.read.problems).toEqual([expect.objectContaining({ field: "newRoles.0.words.flowsBack", sentence: ROLE_CARD_WORDS.person, kind: "name" })]);
    expect(JSON.stringify(r.body)).not.toContain(PEOPLE[READER].name);
  });

  it("only the owner imports into a draft", async () => {
    const p = await freshDraft();
    h.as(READER);
    expect((await h.call("POST", `${P}/${p.id}/import`, { text: HEADER })).status).toBe(404);
  });
});

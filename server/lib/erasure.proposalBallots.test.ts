/**
 * ROUND 4, FINDING 9: the ballot templates the ballot-words step never knew.
 *
 * A game-mechanics (or minting, or governance-mode) proposal taken to the
 * vote freezes "Proposed by <first name> on <date>; ..." into the ballot's
 * document, whoever opened the vote. A launch vote's document names whoever
 * opened it in one of three fixed sentences, and lists everybody on its
 * steward slate as "- <first name>". GET /api/governance/ballots/:id serves
 * that document to anybody, signed in or not, so after an erasure none of
 * those names may stand, and every living person's name must.
 *
 * Every document here is the template's own output (proposalMarkdown,
 * launchProposalDoc), and every slate row is written by insertSlate, the
 * launch door's own write. The sweep is the real one, anonymizeMember, and
 * the case for an old tombstone runs the step's function on a member whose
 * name and address the tombstone already cleared, as a backfill sees them.
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { anonymizeMember, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import { openBallot } from "./ballots";
import { proposalMarkdown } from "./mechanics";
import { launchProposalDoc, type SlateMember } from "./launchProposal";
import { insertSlate } from "../repos/stewardSlate";
import { forgetProposalBallotWordsOf } from "./ballotErasure";
import { MINT_RULE, VILLAGE_LAUNCH } from "../../shared/ballotSubjects";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";

function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: (u: any) => void) => real.update(id, fn) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

async function person(id: string, name: string): Promise<void> {
  await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, name, `${id}@example.test`]);
}

async function erase(id: string): Promise<void> {
  const target = await usersRepo(pool).byId(id);
  expect(target, `${id} must exist before it is erased`).toBeTruthy();
  await anonymizeMember(pool, target, "pb-admin", deps());
  expect((await erasureRecord(pool, id))?.finishedAt, `${id}'s sweep must finish`).toBeTruthy();
}

const docOf = async (id: string): Promise<string> => String((await q("SELECT doc_markdown FROM ballots WHERE id = ?", [id]))[0].doc_markdown);

async function proposal(id: string, proposer: string): Promise<void> {
  await q("INSERT INTO mechanics_proposals (id, title, rationale, change_set, proposer_user_id, status) VALUES (?,?,?,?,?,'open')", [
    id, "Raise the gratitude budget", "Wren and Ann both think so.", "[]", proposer,
  ]);
}

async function open(input: { subjectType: string; subjectRef: string; title: string; doc: string; openedBy: string; electorate: string[]; slate?: string[] }) {
  const r = await openBallot(pool, {
    subjectType: input.subjectType, subjectRef: input.subjectRef, title: input.title, docMarkdown: input.doc, method: "majority",
    weightMode: "equal", unityPct: 50, quorumPct: 10, durationDays: 7, openedBy: input.openedBy,
    electorate: input.electorate.map((userId) => ({ userId, weight: 1 })),
    ...(input.slate ? { onOpen: (conn: any, ballotId: string) => insertSlate(conn, ballotId, input.slate!, input.openedBy) } : {}),
  } as any);
  if (!r.ok) throw new Error(`ballot refused to open: ${r.error}`);
  return r.ballot;
}

/** The mechanics door's document, exactly: server/index.ts open-ballot, firstName(proposer.name). */
const mechanicsDoc = (id: string, proposerName: string) =>
  proposalMarkdown({ id, title: "Raise the gratitude budget", rationale: "Wren and Ann both think so.", changeSet: [], villageName: "Village", proposerName, supports: 3, createdAt: "2026-10-01T09:00:00.000Z" });

/** The launch door's document, exactly: server/index.ts, openedBy firstName(user.name), the slate's first names. */
const launchDoc = (openedBy: string, slate: SlateMember[]) =>
  launchProposalDoc({ villageName: "Village", quorumPct: 100, unityPct: 100, onTheRoll: 4, weightNote: "", openedBy, openedOn: "2026-10-05", slate, handover: [] });

describe.skipIf(!configured)("round 4, 9: the proposal and launch ballots that name an erased member", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-proposal-ballots-"));
    clearMemberDrivers();
    await person("pb-admin", "Avery Steward");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  it("a mechanics or minting vote on their proposal stops naming them, whoever opened it, and a living proposer's keeps the name", async () => {
    const wren = "pb-m-wren";
    const ann = "pb-m-ann";
    await person(wren, "Wren Halloway");
    await person(ann, "Ann Pryor");
    await proposal("gm-pb-wren", wren);
    await proposal("gm-pb-wren-mint", wren);
    await proposal("gm-pb-ann", ann);
    // Ann holds proposal.open and takes Wren's proposal to the vote, so opened_by is Ann's.
    const mech = await open({ subjectType: "mechanics", subjectRef: "gm-pb-wren", title: "Raise the gratitude budget", doc: mechanicsDoc("gm-pb-wren", "Wren"), openedBy: ann, electorate: [ann] });
    const mint = await open({ subjectType: MINT_RULE, subjectRef: "gm-pb-wren-mint", title: "Raise the gratitude budget", doc: mechanicsDoc("gm-pb-wren-mint", "Wren"), openedBy: wren, electorate: [ann] });
    const living = await open({ subjectType: "mechanics", subjectRef: "gm-pb-ann", title: "Raise the gratitude budget", doc: mechanicsDoc("gm-pb-ann", "Ann"), openedBy: wren, electorate: [ann] });
    expect(await docOf(mech.id), "the control: the ballot names the proposer today").toContain("Proposed by Wren on 2026-10-01; ");
    const livingBefore = await docOf(living.id);

    await erase(wren);

    for (const b of [mech, mint]) {
      const doc = await docOf(b.id);
      expect(doc, `${b.id}'s proposer line`).toContain("Proposed by a departed member on 2026-10-01; 3 member(s) supported it in-game before it came here.");
      expect(doc, `${b.id} keeps the proposal's own words`).toContain("Wren and Ann both think so.");
      expect(doc).not.toContain("Proposed by Wren");
    }
    expect(await docOf(living.id), "a living proposer's ballot, opened by the leaver, keeps its proposer").toBe(livingBefore);
    expect(livingBefore).toContain("Proposed by Ann on 2026-10-01; ");

    const settled = [await docOf(mech.id), await docOf(mint.id)];
    await erase(wren);
    expect([await docOf(mech.id), await docOf(mint.id)], "a second sweep changes nothing").toEqual(settled);
  });

  it("a launch vote they opened stops naming them in all three opener sentences, and their slate line goes", async () => {
    const wren = "pb-l-wren";
    const ann = "pb-l-ann";
    const bo = "pb-l-bo";
    await person(wren, "Wren Halloway");
    await person(ann, "Ann Pryor");
    await person(bo, "Bo Lind");
    const slate = [{ id: wren, name: "Wren" }, { id: ann, name: "Ann" }, { id: bo, name: "Bo" }];
    const withSlate = await open({ subjectType: VILLAGE_LAUNCH, subjectRef: "start-pb-1", title: "Start the Game in Village", doc: launchDoc("Wren", slate), openedBy: wren, electorate: [wren, ann, bo], slate: slate.map((m) => m.id) });
    const empty = await open({ subjectType: VILLAGE_LAUNCH, subjectRef: "start-pb-2", title: "Start the Game in Village", doc: launchDoc("Wren", []), openedBy: wren, electorate: [wren, ann, bo] });
    // Ann opened this one and put Wren on it beside herself.
    const annOpened = await open({ subjectType: VILLAGE_LAUNCH, subjectRef: "start-pb-3", title: "Start the Game in Village", doc: launchDoc("Ann", [{ id: ann, name: "Ann" }, { id: wren, name: "Wren" }]), openedBy: ann, electorate: [wren, ann, bo], slate: [ann, wren] });
    expect(await docOf(withSlate.id), "the control: the launch vote names its opener today").toContain("Wren opened this vote and chose who it puts forward.");
    expect(await docOf(empty.id)).toContain("Wren named nobody for the steward role");

    await erase(wren);

    const a = await docOf(withSlate.id);
    expect(a).toContain("A departed member opened this vote and chose who it puts forward.");
    expect(a).toContain("Every item on the journey to launch read done when a departed member opened this, on 2026-10-05.");
    expect(a).toContain("\n- A departed member\n- Ann\n- Bo\n");
    expect(a).not.toMatch(/\bWren\b/);
    const b = await docOf(empty.id);
    expect(b).toContain("A departed member named nobody for the steward role, so the village starts with it empty.");
    expect(b).not.toMatch(/\bWren\b/);
    const c = await docOf(annOpened.id);
    expect(c, "the living opener stays named").toContain("Ann opened this vote and chose who it puts forward.");
    expect(c).toContain("read done when Ann opened this, on 2026-10-05.");
    expect(c).toContain("\n- Ann\n- A departed member\n");
    expect(c).not.toMatch(/\bWren\b/);

    const settled = [a, b, c];
    await erase(wren);
    expect([await docOf(withSlate.id), await docOf(empty.id), await docOf(annOpened.id)], "a second sweep changes nothing").toEqual(settled);
  });

  it("a living namesake on the same slate keeps their line", async () => {
    const wren = "pb-n-wren";
    const wren2 = "pb-n-wren-two";
    const ann = "pb-n-ann";
    await person(wren, "Wren Halloway");
    await person(wren2, "Wren Okafor");
    await person(ann, "Ann Pryor");
    const ballot = await open({
      subjectType: VILLAGE_LAUNCH, subjectRef: "start-pb-n", title: "Start the Game in Village",
      doc: launchDoc("Ann", [{ id: wren2, name: "Wren" }, { id: ann, name: "Ann" }, { id: wren, name: "Wren" }]),
      openedBy: ann, electorate: [wren, wren2, ann], slate: [wren2, ann, wren],
    });

    await erase(wren);

    const doc = await docOf(ballot.id);
    expect(doc.match(/^- Wren$/gm), "one Wren still stands, the living one").toHaveLength(1);
    expect(doc.match(/^- A departed member$/gm)).toHaveLength(1);
    expect(doc).toContain("- Ann");
  });

  it("works on an old tombstone, by its id alone, with no name left to look for", async () => {
    const wren = "pb-o-wren";
    const ann = "pb-o-ann";
    await person(wren, "Wren Halloway");
    await person(ann, "Ann Pryor");
    await proposal("gm-pb-old", wren);
    const mech = await open({ subjectType: "mechanics", subjectRef: "gm-pb-old", title: "Raise the gratitude budget", doc: mechanicsDoc("gm-pb-old", "Wren"), openedBy: ann, electorate: [ann] });
    const launch = await open({ subjectType: VILLAGE_LAUNCH, subjectRef: "start-pb-o", title: "Start the Game in Village", doc: launchDoc("Ann", [{ id: ann, name: "Ann" }, { id: wren, name: "Wren" }]), openedBy: ann, electorate: [wren, ann], slate: [ann, wren] });
    const opened = await open({ subjectType: VILLAGE_LAUNCH, subjectRef: "start-pb-o2", title: "Start the Game in Village", doc: launchDoc("Wren", []), openedBy: wren, electorate: [wren, ann] });
    // The tombstone as an old record left it: name and address gone, the step never run.
    await q("UPDATE users SET name = 'A departed member', email = ? WHERE id = ?", [`erased-${wren}@anonymized.invalid`, wren]);
    const tomb = (await usersRepo(pool).byId(wren))!;

    const counts = await forgetProposalBallotWordsOf(pool, { id: tomb.id, name: tomb.name, handle: (tomb as any).handle, email: tomb.email });

    expect(await docOf(mech.id)).toContain("Proposed by a departed member on 2026-10-01; ");
    expect(await docOf(launch.id)).toContain("\n- Ann\n- A departed member\n");
    expect(await docOf(opened.id)).toContain("A departed member named nobody for the steward role");
    // The proposal's rationale is its proposer's own words and names Wren on purpose; the header line is the template's.
    expect(await docOf(mech.id)).not.toContain("Proposed by Wren");
    for (const id of [launch.id, opened.id]) expect(await docOf(id), id).not.toMatch(/\bWren\b/);
    expect(counts).toEqual({ proposals: 1, launchesOpened: 1, slateLines: 1, slatesLeft: 0 });
  });

  it("leaves a slate it cannot read alone and counts it, when a living member's line no longer matches their name", async () => {
    const wren = "pb-r-wren";
    const ann = "pb-r-ann";
    await person(wren, "Wren Halloway");
    await person(ann, "Ann Pryor");
    const launch = await open({ subjectType: VILLAGE_LAUNCH, subjectRef: "start-pb-r", title: "Start the Game in Village", doc: launchDoc("Bo", [{ id: ann, name: "Ann" }, { id: wren, name: "Wren" }]), openedBy: "pb-admin", electorate: [wren, ann], slate: [ann, wren] });
    await q("UPDATE users SET name = 'Annabel Pryor' WHERE id = ?", [ann]);
    await q("UPDATE users SET name = 'A departed member', email = ? WHERE id = ?", [`erased-${wren}@anonymized.invalid`, wren]);
    const before = await docOf(launch.id);

    const counts = await forgetProposalBallotWordsOf(pool, { id: wren, name: "A departed member", email: `erased-${wren}@anonymized.invalid` });

    expect(await docOf(launch.id), "no line is guessed at").toBe(before);
    expect(counts.slatesLeft).toBe(1);
  });
});

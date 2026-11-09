/**
 * "EVERYTHING THE VILLAGE HOLDS ABOUT ME" INCLUDES THE CANVAS
 * (W3a-export-erasure-omit).
 *
 * GET /api/profile/export promises everything, and the Governance Canvas
 * build added stores keyed on a member that the file never read: their
 * suggestions (in their own words, with the purpose line), the decisions
 * they made with the notes they were told are public, their readings, the
 * Decision Matrix rows they last wrote, the ombuds-door pointers, and the
 * agreement changes they proposed. `exportCanvasForMember` is what the
 * export adds, and this suite fills every one of those stores for two people
 * and checks each person gets their own rows and none of the other's.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { insertCanvasProposal, decideCanvasProposal } from "../repos/canvasProposals";
import { recordCanvasReading } from "../repos/canvasReadings";
import { writeDecisionMatrixRow } from "../repos/decisionMatrixRows";
import { writeConfigDocument } from "../repos/appConfigDocs";
import { OMBUDS_ASKS_KEY, proposalKeyFor } from "./conflictAgreement";
import { recordAgreement } from "./agreements";
import { exportCanvasForMember } from "./canvasExport";

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

describe.skipIf(!configured)("exportCanvasForMember", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    const mine = await insertCanvasProposal(pool, {
      blockId: "power", target: "words", sectionId: "decisions", door: null, change: null,
      body: "We decide by consent in the circle that holds the work.", source: "member",
      proposedBy: "ex-ash", servesPurpose: "It keeps decisions with the people doing the work, which the purpose asks.",
    } as any);
    const theirs = await insertCanvasProposal(pool, {
      blockId: "team", target: "words", sectionId: "membership", door: null, change: null,
      body: "Newcomers meet three of us first.", source: "member", proposedBy: "ex-ivy", servesPurpose: null,
    } as any);
    await decideCanvasProposal(pool, { id: theirs, status: "declined", decidedBy: "ex-ash", note: "Three is too many for a village of six.", outcome: null });
    void mine;
    await recordCanvasReading(pool, { blockId: "power", level: 2, sentence: "Nobody had asked who decides.", moment: "baseline", recordedBy: "ex-ash" } as any);
    await recordCanvasReading(pool, { blockId: "team", level: 3, sentence: "Ivy's reading.", moment: "baseline", recordedBy: "ex-ivy" } as any);
    await writeDecisionMatrixRow(pool, { subject: "Who signs a lease", approval: "Stewards", consultation: "Land circle", information: "Everyone", method: "consent", riskTags: [] } as any, "ex-ash");
    await writeConfigDocument(pool, OMBUDS_ASKS_KEY, {
      asks: [
        { id: "oa-1", askedBy: "ex-ash", askedAt: "2026-10-02T10:00:00.000Z", contactId: "oc-1", contactLabel: "Cohort Care" },
        { id: "oa-2", askedBy: "ex-ivy", askedAt: "2026-10-03T10:00:00.000Z", contactId: "oc-1", contactLabel: "Cohort Care" },
      ],
    });
    await writeConfigDocument(pool, proposalKeyFor("bal-ash-1"), { ballotId: "bal-ash-1", agreement: { replyHours: 12 }, proposedBy: "ex-ash", proposedAt: "2026-10-04T10:00:00.000Z" });
    await writeConfigDocument(pool, proposalKeyFor("bal-ivy-1"), { ballotId: "bal-ivy-1", agreement: { replyHours: 6 }, proposedBy: "ex-ivy", proposedAt: "2026-10-05T10:00:00.000Z" });
    await recordAgreement(pool, {
      id: "agr-ash", title: "Tools go back to the shed", body: "x".repeat(80), domain: null, circleId: null, reviewAt: null,
      status: "voting", ballotId: "bal-agr", proposedBy: "ex-ash", proposedAt: "2026-10-06T10:00:00.000Z", decidedAt: null,
    } as any);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("hands a member every canvas record keyed on them, and nobody else's", async () => {
    const out = await exportCanvasForMember(pool, "ex-ash");
    expect(out.suggestions.map((s) => s.body)).toEqual(["We decide by consent in the circle that holds the work."]);
    expect(out.suggestions[0].servesPurpose).toMatch(/keeps decisions with the people/);
    expect(out.decisionsMade.map((d) => d.decisionNote)).toEqual(["Three is too many for a village of six."]);
    expect(out.readings.map((r) => r.sentence)).toEqual(["Nobody had asked who decides."]);
    expect(out.decisionMatrixRows.map((r) => r.subject)).toEqual(["Who signs a lease"]);
    expect(out.ombudsAsks).toEqual([{ id: "oa-1", askedAt: "2026-10-02T10:00:00.000Z", contactId: "oc-1", contactLabel: "Cohort Care" }]);
    expect(out.conflictAgreementProposals.map((p) => p.ballotId)).toEqual(["bal-ash-1"]);
    expect(out.agreementsProposed.map((a) => a.id)).toEqual(["agr-ash"]);
    expect(JSON.stringify(out)).not.toContain("ex-ivy");
    expect(JSON.stringify(out)).not.toContain("Ivy's reading");
  });
});

/**
 * THE GOVERNANCE CANVAS'S HALF OF "EVERYTHING THE VILLAGE HOLDS ABOUT ME"
 * (W3a-export-erasure-omit).
 *
 * GET /api/profile/export promises everything, and the canvas build added
 * stores keyed on a member that the file never read. This is what it adds,
 * one key per store, each filtered to the member:
 *
 *   suggestions                 canvas_proposals they made: their words, the
 *                               purpose line, and what became of each
 *   decisionsMade               canvas_proposals they decided, with the note
 *                               they were told is public
 *   readings                    canvas_readings they recorded
 *   decisionMatrixRows          decision_matrix_rows they last wrote
 *   ombudsAsks                  the ombuds door's pointers to their own asks
 *                               (who they asked and when; the door keeps no words)
 *   conflictAgreementProposals  conflict agreement changes they put to a vote
 *   agreementsProposed          village agreements they put to a vote
 *
 * Nothing of anybody else rides along: a decision lists the suggestion by id
 * and the member's own note, never the other member's words or id.
 */
import type { Pool } from "mysql2/promise";
import { canvasProposalsTouching, type CanvasProposalRow } from "../repos/canvasProposals";
import { allCanvasReadings } from "../repos/canvasReadings";
import { allDecisionMatrixRows } from "../repos/decisionMatrixRows";
import { readConfigDocument, readConfigDocumentsByPrefix } from "../repos/appConfigDocs";
import { CONFLICT_AGREEMENT_PROPOSAL_KEY, OMBUDS_ASKS_KEY, asksBy } from "./conflictAgreement";
import { listAgreements } from "./agreements";

const suggestionOf = (p: CanvasProposalRow) => ({
  id: p.id,
  blockId: p.blockId,
  target: p.target,
  sectionId: p.sectionId,
  door: p.door,
  change: p.change,
  body: p.body,
  servesPurpose: p.servesPurpose,
  source: p.source,
  status: p.status,
  decisionNote: p.decisionNote,
  createdAt: p.createdAt,
  decidedAt: p.decidedAt,
});

export async function exportCanvasForMember(pool: Pool, userId: string) {
  const id = String(userId);
  const [proposals, readings, rows, asks, changeDocs, agreements] = await Promise.all([
    canvasProposalsTouching(pool, id),
    allCanvasReadings(pool),
    allDecisionMatrixRows(pool),
    readConfigDocument(pool, OMBUDS_ASKS_KEY),
    readConfigDocumentsByPrefix<Record<string, unknown>>(pool, `${CONFLICT_AGREEMENT_PROPOSAL_KEY}:`),
    listAgreements(pool),
  ]);
  return {
    suggestions: proposals.filter((p) => p.proposedBy === id).map(suggestionOf),
    decisionsMade: proposals
      .filter((p) => p.decidedBy === id && p.proposedBy !== id)
      .map((p) => ({ id: p.id, blockId: p.blockId, status: p.status, decisionNote: p.decisionNote, decidedAt: p.decidedAt })),
    readings: readings
      .filter((r) => r.recordedBy === id)
      .reverse()
      .map((r) => ({ id: r.id, blockId: r.blockId, level: r.level, sentence: r.sentence, moment: r.moment, recordedAt: r.recordedAt })),
    decisionMatrixRows: rows
      .filter((r) => r.updatedBy === id)
      .map((r) => ({
        id: r.id, subject: r.subject, approval: r.approval, consultation: r.consultation, information: r.information,
        method: r.method, riskTags: r.riskTags, updatedAt: r.updatedAt,
      })),
    ombudsAsks: asksBy(asks, id),
    conflictAgreementProposals: changeDocs
      .map(({ doc }) => doc)
      .filter((d) => String(d.proposedBy ?? "") === id)
      .map((d) => ({ ballotId: String(d.ballotId ?? ""), agreement: d.agreement ?? null, proposedAt: String(d.proposedAt ?? "") })),
    agreementsProposed: agreements
      .filter((a) => a.proposedBy === id)
      .map(({ proposedBy: _self, ...a }) => a),
  };
}

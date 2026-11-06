/**
 * What the differences need from here beside the stored reads, gathered in one
 * place for both of their readers: the list (server/lib/seraDifferencesRead.ts)
 * and the sync, which keeps each read with every record's match as it was made
 * then (server/lib/saberraSnapshot.ts, review C2). One gatherer, so the match a
 * read is kept with is made from exactly the chart and history the list reads.
 *
 * READS ONLY. Nothing here writes a row.
 */
import type { Pool } from "mysql2/promise";
import { traceAccepted, type AcceptedChange, type DifferencesInput } from "../../shared/seraDifferences";
import { dedupeKeyFor } from "./externalProposals";
import { liveChart } from "./structureReview";
import { acceptedProposalsFor, circlesForDifferences, publishedFromModule, rolesWithPaySet } from "../repos/seraDifferences";

const MODULE_ID = "saberra";

/** The live chart as the differences read it: circles in chart order, and each role with whether pay is set here, never its figure. */
export async function liveForDifferences(pool: Pool): Promise<DifferencesInput["live"]> {
  const [circles, paid] = await Promise.all([circlesForDifferences(pool), rolesWithPaySet(pool)]);
  const live = await liveChart(pool, circles);
  return {
    circles: live.circles.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases, status: c.status, isExample: c.isExample })),
    roles: live.seats.map((s) => ({
      id: s.id,
      name: s.name,
      circleId: s.circleId,
      active: s.active,
      isExample: s.isExample,
      holders: s.holders,
      aim: s.words?.aim ?? null,
      paySet: paid.has(s.id),
    })),
  };
}

/**
 * What this village published from the service, each change traced to what
 * the service itself said (R2): only to a proposal whose stored payload still
 * hashes to the dedupe key it landed under.
 */
export async function acceptedForDifferences(pool: Pool): Promise<AcceptedChange[]> {
  const changes = await publishedFromModule(pool, MODULE_ID);
  const proposals = await acceptedProposalsFor(pool, MODULE_ID, Array.from(new Set(changes.map((c) => c.draftId))));
  return traceAccepted(
    changes,
    proposals.map((p) => ({
      id: p.id,
      draftId: p.draftId,
      kind: p.kind,
      payload: p.payload,
      // Untouched: the payload still hashes to the key it landed under.
      original: dedupeKeyFor({ moduleId: MODULE_ID, kind: p.kind, sourceRef: p.sourceRef, payload: p.payload }) === p.dedupeKey,
    })),
  );
}

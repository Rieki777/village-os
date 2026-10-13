/**
 * THE TERMS A SEAT IS HELD ON, FOR THE LIVE CARD (red team U2).
 *
 * The live seat card's drawer read only the seat's terms on offer, so a member
 * seated on adopted terms, in force and aligned by both parties, showed "No
 * terms on offer yet". A seating made by the member door carries its
 * application's id (0248); this reads every such application once, with its
 * alignment, and the seat projection (server/lib/seatProjection.ts) puts them
 * on the seat for a reader holding `terms.read`, the tier that already
 * carries the terms on offer. Nobody else is handed any of it.
 *
 * A fixed number of reads for the whole chart: the applications, then their
 * texts in one `viewTexts`.
 */
import type { Pool } from "mysql2/promise";
import { civilDateKey } from "../../shared/lunar";
import type { OrgAssignment } from "./orgChart";
import { presentView, viewTexts } from "./alignmentSubjects";
import { readApplications } from "../repos/seatApplications";
import { readTexts } from "../repos/alignments";

export interface HeldTerms {
  applicationId: string;
  href: string;
  settings: unknown;
  adoptedVia: "holder" | "ballot" | null;
  decidedOn: string | null;
  alignment: { state: string; sealed: boolean; parties: Array<{ partyKey: string; label: string; capacity: string; required: boolean; aligned: boolean; at: string | null; method: string | null }> } | null;
}

/** The held terms behind these seatings, by application id. */
export async function heldTermsFor(
  pool: Pool,
  seatings: readonly Pick<OrgAssignment, "applicationId">[],
  opts: { timezone: string; nameOf: (userId: string) => string; today?: string },
): Promise<Map<string, HeldTerms>> {
  const out = new Map<string, HeldTerms>();
  const ids = Array.from(new Set(seatings.map((s) => s.applicationId).filter((id): id is string => !!id)));
  if (ids.length === 0) return out;
  const apps = await readApplications(pool, ids);
  const views = await viewTexts(pool, await readTexts(pool, apps.map((a) => a.textId).filter((t): t is string => !!t)), opts.today ?? civilDateKey(new Date(), opts.timezone || "UTC"), opts.timezone);
  for (const a of apps) {
    const v = a.textId ? views.find((x) => x.text.id === a.textId) : undefined;
    const served = v ? await presentView(v, null, async (id) => opts.nameOf(id), false) : null;
    out.set(a.id, {
      applicationId: a.id,
      href: `/seat-applications/${encodeURIComponent(a.id)}`,
      settings: a.settings,
      adoptedVia: a.adoptedVia,
      decidedOn: a.decidedAt ? civilDateKey(a.decidedAt, opts.timezone || "UTC") : null,
      alignment: served ? { state: served.state, sealed: served.sealed, parties: served.parties } : null,
    });
  }
  return out;
}

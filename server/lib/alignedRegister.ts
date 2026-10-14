/**
 * THE ALIGNED REGISTER (seat settings PR6): what `GET /api/aligned` serves.
 *
 * Every text in the alignment store of a kind the viewer may read, every
 * version, newest first, as rows a member reads on `/aligned`. The route
 * (server/routes/alignments.ts) holds the door; this file turns texts into
 * rows and answers a search.
 *
 * ── STATE IS THE STORE'S OWN DERIVATION ────────────────────────────────────
 *
 * Pending, in force or ended comes from `viewTexts` (server/lib/alignmentSubjects.ts),
 * which is the one derivation the profile, the application page and the
 * drawer already read. Nothing here decides a state.
 *
 * ── DAYS IN THE VILLAGE'S ZONE ─────────────────────────────────────────────
 *
 * Every date a row carries is a civil day, YYYY-MM-DD, in the village's own
 * time zone (red team U6). The page prints it as written; no reader's zone
 * moves a day.
 *
 * ── THE SEARCH NEVER LEAVES THE REQUEST ────────────────────────────────────
 *
 * A search builds a BM25 index from server/lib/knowledge.ts's helpers
 * (`indexDoc`, `rank`, which tokenize the same way the shelves do) over the
 * rows this viewer may read, ranks, and throws the index away when the answer
 * is sent. It is never added to the shelves, the village's second brain or the
 * concierge's corpus, and nothing here writes anywhere. The test
 * server/routes/alignedRegister.test.ts proves the corpus holds no terms.
 *
 * ── THE HASH GOES ONLY TO A PARTY ──────────────────────────────────────────
 *
 * `presentView` is handed `withHash` true only when the viewer is one of the
 * text's parties (red team S5). Everybody else reads the words and never the
 * fingerprint.
 */
import { REGISTER_KINDS, kindLabel, type RegisterKind, type RegisterRow } from "../../shared/alignedRegister";
import { userParty, VILLAGE_PARTY } from "../../shared/alignments";
import { civilDateKey } from "../../shared/lunar";
import { indexDoc, rank } from "./knowledge";
import { presentView, type TextView } from "./alignmentSubjects";

type NameOf = (userId: string) => Promise<string | null>;

/** The kinds a viewer may read, by the capability each one names. */
export function readableKinds(holds: (capability: RegisterKind["capability"]) => boolean): RegisterKind[] {
  return REGISTER_KINDS.filter((k) => holds(k.capability));
}

const dayIn = (d: Date | null | undefined, timezone: string): string | null =>
  d && !Number.isNaN(d.getTime()) ? civilDateKey(d, timezone || "UTC") : null;

/** One text as the register shows it, to this viewer. */
export async function registerRow(v: TextView, viewerId: string, nameOf: NameOf, timezone: string): Promise<RegisterRow> {
  const isParty = v.parties.some((p) => p.partyKey === userParty(viewerId));
  const served = await presentView(v, viewerId, nameOf, isParty);
  const current = v.alignments.filter((a) => a.contentHash === v.text.contentHash);
  const atOf = (partyKey: string) => current.find((a) => a.partyKey === partyKey)?.at ?? null;

  // Fully aligned on the day the last required party aligned.
  let alignedAt: Date | null = null;
  if (v.derived.allAligned) {
    for (const p of v.parties.filter((x) => x.required)) {
      const at = atOf(p.partyKey);
      if (at && (!alignedAt || at > alignedAt)) alignedAt = at;
    }
  }

  const villageRow = current.find((a) => a.partyKey === VILLAGE_PARTY) ?? null;
  let village: RegisterRow["village"] = null;
  if (villageRow?.method === "ballot" && villageRow.authorityRef) {
    village = { by: "ballot", ballotId: villageRow.authorityRef, href: `/decisions/${encodeURIComponent(villageRow.authorityRef)}` };
  } else if (villageRow?.method === "holder") {
    village = { by: "holder", name: (villageRow.userId ? await nameOf(villageRow.userId) : null) ?? "A former member" };
  }

  const writtenOn = dayIn(v.text.createdAt, timezone);
  return {
    textId: v.text.id,
    kind: v.text.subjectType,
    kindLabel: kindLabel(v.text.subjectType),
    title: served.title,
    body: served.body,
    version: served.version,
    seatNames: served.seatNames,
    state: served.state,
    why: served.why,
    sealed: served.sealed,
    money: served.money,
    parties: served.parties.map((p) => ({
      partyKey: p.partyKey,
      label: p.label,
      capacity: p.capacity,
      required: p.required,
      aligned: p.aligned,
      alignedOn: dayIn(atOf(p.partyKey), timezone),
    })),
    alignedOn: dayIn(alignedAt, timezone),
    writtenOn,
    year: writtenOn ? writtenOn.slice(0, 4) : "Undated",
    village,
    href: served.href,
    contentHash: isParty ? served.contentHash : null,
    endingLine: served.endingLine,
  };
}

/** What a search reads in a row: its name counts for more than its words. */
function searchText(r: RegisterRow): { text: string; identity: string } {
  const parties = r.parties.map((p) => `${p.label} ${p.capacity}`).join(" ");
  const how = r.village?.by === "holder" ? r.village.name : "";
  return {
    text: [r.kindLabel, r.title, r.seatNames.join(" "), r.body, parties, how].join("\n"),
    identity: [r.title, r.seatNames.join(" ")].join(" "),
  };
}

/**
 * Rank rows against a query with a BM25 index built for this request alone.
 * Ties keep the input order, which is newest first.
 */
export function searchRegister(rows: readonly RegisterRow[], query: string, max: number): RegisterRow[] {
  const docs = rows.map((r) => {
    const s = searchText(r);
    return indexDoc(r, s.text, s.identity);
  });
  return rank(docs, query, max);
}

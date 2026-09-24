/**
 * Turning what an outside governance service holds into a structure a steward
 * can accept, reject, or edit — using the proposal spine this platform already
 * has, and adding no second way in.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────
 *
 * The ask (Rye, 2026-09-23) is that the service can SUGGEST AN ORG STRUCTURE.
 * Suggest is the whole word. Nothing here writes a seat, a circle or a chart.
 * It produces one `org.proposed` record, which lands in the review queue like
 * any other outside claim, and a steward decides. That path already exists end
 * to end — queue, batch accept into a draft, preview, publish, withdraw — so
 * the work is translation and nothing else.
 *
 * ── WHY THE INPUT SHAPE IS DECLARED HERE ─────────────────────────────────
 *
 * Their connector answers in PROSE today: `ask_sera` and `search_memory`
 * return sentences with a Notion link, not records with stable ids. Prose
 * cannot be mapped to seats without guessing, and a guess that lands in a
 * village's chart is worse than no feature.
 *
 * So `VendorRecord` below is the shape a typed read has to produce, written
 * down as the contract rather than left as a conversation: an id that is
 * stable across reads, the record kind, the vendor's own field names
 * untouched, and a link back to the source. That typed read is an open ask
 * with their founder. Until it lands, this module has a tested translator and
 * no live producer, which is the honest state and is visible from here.
 *
 * ── WHAT IS DELIBERATELY NOT MAPPED ──────────────────────────────────────
 *
 * Only fields whose meaning is KNOWN are mapped. Their `Status` almost
 * certainly says whether a seat is vacant, and mapping it to `recruiting`
 * would be a guess about an enumeration nobody has sent us: guess wrong and
 * every seat in a village is silently advertised, or silently is not. So it is
 * reported as unmapped and named in the open asks instead. `unmapped` is a
 * feature and not an apology — it tells a steward exactly what the service
 * holds that this chart has no home for yet, which is the evidence for what to
 * build next.
 *
 * Pure: no pool, no clock, no network.
 */
import { readVendorRecord, type SaberraRecordKind } from "./saberraRecords";

/**
 * One record as a typed read must deliver it.
 *
 * `fields` is RAW, under the vendor's own names, and is passed through
 * `readVendorRecord` here rather than by the caller. That is the point: there
 * is one door, and this is the only thing upstream of it.
 */
export interface VendorRecord {
  /** Stable across reads. Their Notion page id serves, their URL does not. */
  id: string;
  kind: SaberraRecordKind;
  fields: Record<string, unknown>;
  /** A link back to the record in their product, for the steward reviewing it. */
  url?: string;
}

/** A record that could not become a seat, named with the reason. */
export interface SkippedRecord {
  id: string;
  reason: "not-a-role" | "no-name" | "everything-was-dropped";
}

export interface StructureProposal {
  kind: "org.proposed";
  /**
   * The envelope the review queue reads: `title` and `rationale` become the
   * draft's, and `seats` is read by `readProposedSeats`.
   */
  payload: { title: string; rationale: string; seats: Record<string, unknown>[] };
  /** Records that produced no seat, so a steward is never silently given fewer. */
  skipped: SkippedRecord[];
  /** Fields that crossed the boundary and this chart has no home for, once each. */
  unmapped: string[];
  /** Records where the boundary refused a field for carrying an address. */
  addressesSeen: { id: string; fields: string[] }[];
}

/** Vendor field -> the seat key it becomes. Only meanings we are sure of. */
const SEAT_FROM: Readonly<Record<string, string>> = {
  "Role Name": "name",
  Circle: "circleName",
  Body: "aim",
};

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * One structure proposal from a set of records.
 *
 * Roles become seats. Circles are not proposed as seats of their own: a seat
 * carries the name of the circle it belongs to, and the accept path places it.
 * A circle holding no roles therefore reaches nothing, which is reported.
 */
export function proposeStructure(
  records: readonly VendorRecord[],
  opts: { sourceName: string },
): StructureProposal {
  const seats: Record<string, unknown>[] = [];
  const skipped: SkippedRecord[] = [];
  const unmapped = new Set<string>();
  const addressesSeen: { id: string; fields: string[] }[] = [];
  const circlesSeen = new Set<string>();
  const circlesUsed = new Set<string>();

  for (const rec of records) {
    const read = readVendorRecord(rec.kind, rec.fields);
    if (read.droppedForAnAddress.length > 0) {
      addressesSeen.push({ id: rec.id, fields: read.droppedForAnAddress });
    }
    for (const k of read.ignored) unmapped.add(k);

    if (rec.kind === "circle") {
      const name = text(read.fields["Circle Name"]);
      if (name) circlesSeen.add(name);
      for (const k of Object.keys(read.fields)) if (!(k in SEAT_FROM)) unmapped.add(k);
      continue;
    }
    if (rec.kind !== "role") {
      skipped.push({ id: rec.id, reason: "not-a-role" });
      continue;
    }

    const seat: Record<string, unknown> = {};
    for (const [vendorKey, value] of Object.entries(read.fields)) {
      const seatKey = SEAT_FROM[vendorKey];
      if (!seatKey) {
        unmapped.add(vendorKey);
        continue;
      }
      const t = text(value);
      if (t !== null) seat[seatKey] = t;
    }
    if (Object.keys(read.fields).length === 0) {
      skipped.push({ id: rec.id, reason: "everything-was-dropped" });
      continue;
    }
    if (typeof seat.name !== "string") {
      // A seat with no name cannot be reviewed: there is nothing to say yes to.
      skipped.push({ id: rec.id, reason: "no-name" });
      continue;
    }
    // The vendor's id rides along so a second read updates this seat rather
    // than proposing it twice.
    seat.id = rec.id;
    if (typeof seat.circleName === "string") circlesUsed.add(seat.circleName);
    seats.push(seat);
  }

  const emptyCircles = Array.from(circlesSeen).filter((c) => !circlesUsed.has(c)).sort();

  return {
    kind: "org.proposed",
    payload: {
      title: `Structure suggested by ${opts.sourceName}`,
      rationale: rationaleFor(seats.length, emptyCircles, opts.sourceName),
      seats,
    },
    skipped,
    unmapped: Array.from(unmapped).sort(),
    addressesSeen,
  };
}

/**
 * What a steward reads first. It says where this came from, how big it is, and
 * what it does NOT contain, because the last one is the thing somebody would
 * otherwise discover after accepting.
 */
function rationaleFor(count: number, emptyCircles: string[], sourceName: string): string {
  const parts = [
    count === 1
      ? `${sourceName} suggests one seat.`
      : `${sourceName} suggests ${count} seats.`,
    "Nothing here is part of this village's chart until you accept it.",
    "Who holds each seat is not included and stays with this village.",
  ];
  if (emptyCircles.length === 1) {
    parts.push(`The circle ${emptyCircles[0]} has no seats in this suggestion.`);
  } else if (emptyCircles.length > 1) {
    parts.push(`These circles have no seats in this suggestion: ${emptyCircles.join(", ")}.`);
  }
  return parts.join(" ");
}

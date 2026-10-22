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
 * ── STATUS, AND WHAT EACH VALUE MEANS ───────────────────────────────────
 *
 * `Status` used to be reported as unmapped, on the argument that mapping an
 * enumeration nobody had sent us would be a guess. The values are known now
 * (Active, Proposed, Vacant, Archived, as the live read of 2026-10-09 showed
 * and as agreed with their founder), so the value is CARRIED, as `sourceStatus`
 * on the seat, and the meaning is applied in one place, the structure plan
 * (`shared/structurePlan.ts`): Archived is never proposed as new, Proposed is
 * shown as proposed, Vacant is a seat with nobody in it. It still never
 * becomes `recruiting`: whether a village advertises a seat is the village's
 * call, and a vendor's word for "empty" is not that call.
 *
 * ── A ROLE'S CIRCLE IS A RELATION ───────────────────────────────────────
 *
 * The first live sync (2026-10-09) proposed 56 seats with no circle and no aim
 * between them. `Circle` was kept only when it was a string, the vendor sends
 * a relation, and every fixture here sent a string. `saberraRelations.ts`
 * reads the relation in any shape and resolves its ids against the circle
 * records of the SAME read, which is why `proposeStructure` is handed the
 * circles as well as the roles. An id that resolves to nothing is counted and
 * never shown as a name: no circle is invented.
 *
 * Pure: no pool, no clock, no network.
 */
import { readVendorRecord, type SaberraRecordKind } from "./saberraRecords";
import { labelOf, normaliseId, plainText, resolveRelation, shapeOf } from "./saberraRelations";

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

/** How a role's circle relation was read, counted across the whole proposal. */
export interface CircleReading {
  /** Seats whose circle relation resolved to a circle name. */
  placed: number;
  /** Seats whose relation carried pointers and none of them resolved. */
  unresolved: number;
  /** Seats whose record carried no circle at all. */
  absent: number;
  /** Seats whose relation named more than one circle; the first is used. */
  several: number;
  /** Seats placed in a circle the source has archived. */
  inArchived: number;
  /** What the field looked like, by structure and never by value, once each. */
  shapes: string[];
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
  /** How the circles were read, for the sync's answer. */
  circles: CircleReading;
}

/**
 * The role fields this translator reads, each by its own rule below. A field
 * that crosses the boundary and is not one of these is reported as unmapped.
 * `Notes` is deliberately not read as an aim: it is the vendor's working
 * notes ("superseded by...") and not what a seat is for.
 */
const ROLE_READS = new Set(["Role Name", "Circle", "Body", "Status"]);
/** The circle fields read here: its name, to resolve relations, and its status. */
const CIRCLE_READS = new Set(["Circle Name", "Status"]);

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

const isArchived = (label: string | null | undefined): boolean => (label ?? "").trim().toLowerCase() === "archived";

/**
 * One structure proposal from a set of records.
 *
 * Roles become seats. Circles are not proposed as seats of their own: a seat
 * carries the name of the circle it belongs to, and the accept path places it.
 * Circle records are needed HERE all the same, because a role names its circle
 * by page id and the circle record is where that id becomes a name. A circle
 * holding no roles reaches nothing, which is reported, unless the source has
 * archived it, which is not news.
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
  const reading: CircleReading = { placed: 0, unresolved: 0, absent: 0, several: 0, inArchived: 0, shapes: [] };
  const shapes = new Set<string>();

  // The circles of this read first, so a role listed before its circle still
  // resolves. Names keyed by page id; statuses keyed by lowercased name.
  const reads = records.map((rec) => ({ rec, read: readVendorRecord(rec.kind, rec.fields) }));
  const circleNameById = new Map<string, string>();
  const circleStatusByName = new Map<string, string>();
  for (const { rec, read } of reads) {
    if (rec.kind !== "circle") continue;
    const name = text(read.fields["Circle Name"]) ?? plainText(read.fields["Circle Name"]);
    if (!name) continue;
    circleNameById.set(normaliseId(rec.id), name);
    const status = labelOf(read.fields.Status);
    if (status) circleStatusByName.set(name.toLowerCase(), status);
  }

  for (const { rec, read } of reads) {
    if (read.droppedForAnAddress.length > 0) {
      addressesSeen.push({ id: rec.id, fields: read.droppedForAnAddress });
    }
    for (const k of read.ignored) unmapped.add(k);

    if (rec.kind === "circle") {
      const name = text(read.fields["Circle Name"]) ?? plainText(read.fields["Circle Name"]);
      if (name && !isArchived(circleStatusByName.get(name.toLowerCase()))) circlesSeen.add(name);
      for (const k of Object.keys(read.fields)) if (!CIRCLE_READS.has(k)) unmapped.add(k);
      continue;
    }
    if (rec.kind !== "role") {
      skipped.push({ id: rec.id, reason: "not-a-role" });
      continue;
    }
    if (Object.keys(read.fields).length === 0) {
      skipped.push({ id: rec.id, reason: "everything-was-dropped" });
      continue;
    }
    for (const k of Object.keys(read.fields)) if (!ROLE_READS.has(k)) unmapped.add(k);

    const name = text(read.fields["Role Name"]) ?? plainText(read.fields["Role Name"]);
    if (!name) {
      // A seat with no name cannot be reviewed: there is nothing to say yes to.
      skipped.push({ id: rec.id, reason: "no-name" });
      continue;
    }
    const seat: Record<string, unknown> = { name };

    // THE CIRCLE, from whatever shape the relation arrived in.
    const rawCircle = read.fields.Circle;
    shapes.add(shapeOf(rawCircle));
    const rel = resolveRelation(rawCircle, circleNameById);
    if (rel.names.length > 0) {
      const circleName = rel.names[0];
      seat.circleName = circleName;
      reading.placed += 1;
      circlesUsed.add(circleName);
      const circleStatus = circleStatusByName.get(circleName.toLowerCase());
      if (circleStatus) seat.sourceCircleStatus = circleStatus;
      if (isArchived(circleStatus)) reading.inArchived += 1;
      if (rel.names.length > 1) {
        seat.sourceOtherCircles = rel.names.slice(1);
        reading.several += 1;
      }
    } else if (rel.present) {
      // It pointed somewhere this read does not hold. Said, never guessed.
      seat.sourceCircleUnresolved = true;
      reading.unresolved += 1;
    } else {
      reading.absent += 1;
    }

    // THE AIM, from the page's own text, after the same boundary.
    const aim = plainText(read.fields.Body);
    if (aim) seat.aim = aim;

    // THE STATUS, carried as the source wrote it. The plan says what it means.
    const status = labelOf(read.fields.Status);
    if (status) seat.sourceStatus = status;

    // The vendor's id rides along so a second read updates this seat rather
    // than proposing it twice.
    seat.id = rec.id;
    seats.push(seat);
  }

  reading.shapes = Array.from(shapes).sort();
  const emptyCircles = Array.from(circlesSeen).filter((c) => !circlesUsed.has(c)).sort();

  return {
    kind: "org.proposed",
    payload: {
      title: `Structure suggested by ${opts.sourceName}`,
      rationale: rationaleFor(seats.length, emptyCircles, opts.sourceName, reading),
      seats,
    },
    skipped,
    unmapped: Array.from(unmapped).sort(),
    addressesSeen,
    circles: reading,
  };
}

/**
 * What a steward reads first. It says where this came from, how big it is, and
 * what it does NOT contain, because the last one is the thing somebody would
 * otherwise discover after accepting.
 */
function rationaleFor(count: number, emptyCircles: string[], sourceName: string, circles: CircleReading): string {
  const parts = [
    count === 1
      ? `${sourceName} suggests one role.`
      : `${sourceName} suggests ${count} roles.`,
    "Nothing here is part of this village's chart until you accept it.",
    "Who holds each role is not included and stays with this village.",
  ];
  if (emptyCircles.length === 1) {
    parts.push(`The circle ${emptyCircles[0]} has no roles in this suggestion.`);
  } else if (emptyCircles.length > 1) {
    parts.push(`These circles have no roles in this suggestion: ${emptyCircles.join(", ")}.`);
  }
  const lost = circles.unresolved + circles.absent;
  if (lost === 1) parts.push("One role arrived with no circle this village could read.");
  else if (lost > 1) parts.push(`${lost} roles arrived with no circle this village could read.`);
  return parts.join(" ");
}

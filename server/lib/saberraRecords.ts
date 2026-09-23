/**
 * What an outside governance service holds about a circle or a role, read into
 * the shape this village will show, with every field that names a person
 * removed at the boundary.
 *
 * ── WHY A BOUNDARY EXISTS AT ALL ─────────────────────────────────────────
 *
 * The service this connector reads keeps nineteen databases, and people are
 * named all through them: a role carries its active holders, a risk carries an
 * owner, a tension carries who sensed it, a meeting carries its participants.
 * Reading those into the chart would make this module `member-pii`
 * (`shared/modules.ts`), and a module in that class driven by an outside
 * service may not go live without a signed processing agreement, a documented
 * hard-delete endpoint and a deletion driver wired into the erasure sweep.
 *
 * Rye's decision, 2026-09-23: hold off on the personal information. So the
 * chart takes STRUCTURE AND STATE only, this function is where that decision
 * is enforced, and the module stays `village-content`.
 *
 * THE POINT OF DOING IT HERE rather than in the caller: a filter at the point
 * of use is a filter somebody forgets at the second point of use. Nothing else
 * in this module is allowed to touch a raw vendor record, so there is exactly
 * one door and it is this one.
 *
 * ── AND WHY A DENY LIST IS THE WRONG SHAPE ───────────────────────────────
 *
 * The obvious build is a list of banned field names. It fails the first time
 * the vendor adds a field, which they will, because a new field arrives
 * allowed by default and a person's name rides in behind it. So this keeps an
 * ALLOW list per record type: a field nobody has thought about is dropped and
 * reported, and `ignored` says what was left behind, the same way the seat
 * reader reports keys it did not read.
 *
 * A second, cheaper net sits behind it: any value that looks like an email
 * address is dropped whatever field it arrived in, because the intake rule for
 * this whole platform is that a record carrying an address is refused rather
 * than partially cleaned, and a vendor record is not exempt from it.
 *
 * Pure: no pool, no clock, no network. The caller hands in what it fetched.
 */

/** A field that may cross, per record type. Anything absent here is dropped. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  circle: [
    "Circle Name",
    "Status",
    "Sector",
    "Notes",
    "Last Review Date",
    "Next Review Date",
  ],
  role: [
    "Role Name",
    "Circle",
    "Status",
    "Role Type",
    "Assignment Method",
    "Next Audit Date",
    "Last Audit Date",
    "Notes",
    /**
     * The role page's own text, which is where the vendor keeps what a role is
     * FOR. Without it a proposal is a seat with a name and no aim, which is a
     * steward being asked to approve a job title.
     *
     * It crosses although `Active Holders` does not, and the line between them
     * is worth stating because it is not "one might mention a person".
     * `Active Holders` is a STRUCTURED reference to a person record: taking it
     * means this village systematically holds an outside service's mapping of
     * people to seats, for everybody, which is `member-pii` and carries the
     * three-part bar. `Body` is prose describing a seat. It may name somebody
     * in passing, exactly as any proposal's free text may, and it meets the
     * same three defences the rest of the intake already applies: an address
     * makes the whole record refused, nothing here is ever auto-accepted, and
     * a steward reads it before it becomes part of the chart.
     */
    "Body",
  ],
  /**
   * `Role Holder` is absent on purpose and so is `Active Holders` above. Who
   * holds a seat is a fact this village already keeps, in `org_role_assignments`,
   * and it is the half of the join worth disagreeing about rather than copying.
   */
  roleAssignment: [
    "Assignment Title",
    "Role",
    "Circle",
    "Status",
    "Assignment Type",
    "Energization Level",
    "Term Length",
    "Next Review Date",
    "Notes",
  ],
  /** `Sensed By` is absent: a tension is shown, and who felt it stays theirs. */
  tension: ["Tension", "Status", "Type", "Affected Roles"],
  /** `Owner` is absent. `Owner Role` crosses, because a role is a seat and not a person. */
  risk: [
    "Risk",
    "Category",
    "Severity",
    "Status",
    "Review Date",
    "Owner Role",
    "Lifecycle",
    "Source Date",
    "Related Circles",
    "Collapse Pattern Type",
  ],
} as const;

export type SaberraRecordKind = keyof typeof ALLOWED;

/**
 * An address anywhere in a value, at any depth. Deliberately the same shape the
 * proposal intake refuses on, so the two cannot disagree about what an address
 * is: a local part, an @, a dot in the domain.
 */
const LOOKS_LIKE_AN_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** True when a value, or anything inside it, reads as an address. */
function carriesAnAddress(v: unknown, depth = 0): boolean {
  if (depth > 6) return true;
  if (typeof v === "string") return LOOKS_LIKE_AN_ADDRESS.test(v);
  if (Array.isArray(v)) return v.some((x) => carriesAnAddress(x, depth + 1));
  if (v && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).some(
      ([k, x]) => LOOKS_LIKE_AN_ADDRESS.test(k) || carriesAnAddress(x, depth + 1),
    );
  }
  return false;
}

export interface ReadRecord {
  /** The fields that may be shown, under the vendor's own names. */
  fields: Record<string, unknown>;
  /** Every field left behind, named, so a steward is never silently given less. */
  ignored: string[];
  /** Fields dropped because a value read as an address, named separately. */
  droppedForAnAddress: string[];
}

/**
 * One vendor record, filtered.
 *
 * `ignored` and `droppedForAnAddress` are separate lists because they mean
 * different things to whoever reads them. A field nobody has mapped yet is a
 * gap in this file. A field holding an address is the vendor sending personal
 * data down a path that carries none, and somebody should go and look.
 */
export function readVendorRecord(kind: SaberraRecordKind, raw: unknown): ReadRecord {
  const out: ReadRecord = { fields: {}, ignored: [], droppedForAnAddress: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const allowed = new Set(ALLOWED[kind] ?? []);
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      out.ignored.push(key);
      continue;
    }
    if (carriesAnAddress(value)) {
      out.droppedForAnAddress.push(key);
      continue;
    }
    out.fields[key] = value;
  }
  out.ignored.sort();
  out.droppedForAnAddress.sort();
  return out;
}

/** The fields this connector will show for a kind, for a card that wants to say so. */
export function shownFields(kind: SaberraRecordKind): readonly string[] {
  return ALLOWED[kind] ?? [];
}

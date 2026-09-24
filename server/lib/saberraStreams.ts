/**
 * Two streams out of one vendor read: the half that carries no person, and the
 * half that does.
 *
 * ── WHY THE SPLIT IS THE WHOLE DESIGN ────────────────────────────────────
 *
 * Rye's decision, 2026-09-24: the org structure and the assignments are
 * separate proposals with separate review experiences. The line between them
 * is not topic, it is PERSONAL DATA, and that is what makes the split worth
 * more than tidiness.
 *
 * A module whose domain holds personal data is `member-pii`, and behind a
 * vendor driver that class may not go live without a signed processing
 * agreement, a documented hard-delete endpoint, and a `forgetMember` driver in
 * the erasure sweep. The vendor's delete endpoint does not exist yet.
 *
 * Put both halves in one batch and the whole import waits on that endpoint.
 * Split them and the structure half, which is most of the value and all of the
 * urgency, lands without waiting for anything. A village rewriting its chart
 * from an outside reading gets to do that this week; seating actual people
 * waits for the protections that seating actual people requires.
 *
 * ── WHAT CHANGED THE ARITHMETIC ──────────────────────────────────────────
 *
 * `Assignment Title` used to be allowed. Its values are a person's name
 * followed by their seat, so every role assignment carried a person and the
 * assignments half was unavoidably `member-pii`. With it excluded, what
 * remains on an assignment record is state about a SEAT: its type, how
 * energized it is, its term, when it is next reviewed. No person. So role
 * assignments moved from the people half to the structure half, and the people
 * half is now only the thing that genuinely names somebody.
 *
 * That is the second time reading the values rather than the field names moved
 * a design decision, and it is why `saberraRecords.ts` is the only door.
 *
 * Pure: no pool, no clock, no network.
 */
import { readVendorRecord, type SaberraRecordKind } from "./saberraRecords";
import type { VendorRecord } from "./saberraProposals";

/**
 * Which half a record belongs to.
 *
 * `structure` is everything that names no person and can be proposed today.
 * `people` is everything that does, and it is gated until the erasure
 * protections exist on both sides.
 */
export type Stream = "structure" | "people";

/** Why a record produced no proposal, so a steward is never silently given less. */
export type HeldReason =
  | "no-create-circle-op"
  | "kind-not-allowed"
  | "everything-was-dropped"
  | "no-name";

export interface HeldRecord {
  id: string;
  kind: string;
  reason: HeldReason;
}

/**
 * The vendor's own detail for one record, kept under the vendor's own field
 * names with every value opaque. This is what a module-owned store holds beside
 * our seat, and what the org map panel renders when the module is on.
 */
export interface VendorFact {
  vendorKind: SaberraRecordKind;
  vendorRecordId: string;
  /** How the record names the seat or circle it belongs to, for later joining. */
  attachesTo: string | null;
  fields: Record<string, unknown>;
  url: string | null;
}

/**
 * Which proposal kind each vendor record becomes.
 *
 * `circle` is deliberately absent and that is not an oversight. `circle.proposed`
 * IS an accepted kind, and the review queue runs it through the SEAT reader
 * (`server/routes/review.ts`, `ORG_KINDS`), while `DraftOp` has no
 * `create_circle`. So a circle proposal accepted today becomes a seat named
 * after the circle. Emitting one would be shipping that bug rather than
 * finding it. Circles ride as facts until the operation exists, and every held
 * circle is named in `held` so the gap is visible instead of silent.
 */
const KIND_FOR: Readonly<Partial<Record<SaberraRecordKind, string>>> = {
  role: "org.proposed",
  tension: "tension.observed",
  risk: "risk.observed",
};

/** Which half each vendor kind belongs to, by whether its allowed fields name a person. */
const STREAM_FOR: Readonly<Record<SaberraRecordKind, Stream>> = {
  circle: "structure",
  role: "structure",
  // No person survives the boundary on an assignment record now that
  // `Assignment Title` and `Role Holder` are both excluded. What is left is
  // state about a seat.
  roleAssignment: "structure",
  tension: "structure",
  risk: "structure",
};

/** How each kind names the thing it attaches to, tried in order. */
const ATTACH_KEYS: Readonly<Record<SaberraRecordKind, readonly string[]>> = {
  circle: ["Circle Name"],
  role: ["Role Name"],
  roleAssignment: ["Role"],
  tension: [],
  risk: ["Owner Role"],
};

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export interface StreamReading {
  /** The half that may be proposed today, by proposal kind. */
  structure: { kind: string; records: VendorRecord[] }[];
  /** Detail for a module-owned store, for every record that crossed at all. */
  facts: VendorFact[];
  /** Records that produced no proposal, each with a reason. */
  held: HeldRecord[];
  /** Vendor fields that crossed and this chart has no home for, once each. */
  unmapped: string[];
  /** Records where the boundary refused a field for carrying an address. */
  addressesSeen: { id: string; fields: string[] }[];
}

/**
 * Sort one vendor read into the two halves.
 *
 * Every record that crosses the boundary produces a FACT, whether or not it
 * produces a proposal. That is the point of the module-owned store: a circle
 * we cannot propose yet still has detail worth showing beside the circle we
 * already have, and an assignment that proposes nothing still says how
 * energized a seat is.
 */
export function splitStreams(records: readonly VendorRecord[]): StreamReading {
  const byKind = new Map<string, VendorRecord[]>();
  const facts: VendorFact[] = [];
  const held: HeldRecord[] = [];
  const unmapped = new Set<string>();
  const addressesSeen: { id: string; fields: string[] }[] = [];

  for (const rec of records) {
    const read = readVendorRecord(rec.kind, rec.fields);
    if (read.droppedForAnAddress.length > 0) {
      addressesSeen.push({ id: rec.id, fields: read.droppedForAnAddress });
    }
    for (const k of read.ignored) unmapped.add(k);

    if (!(rec.kind in STREAM_FOR)) {
      held.push({ id: rec.id, kind: rec.kind, reason: "kind-not-allowed" });
      continue;
    }
    if (Object.keys(read.fields).length === 0) {
      held.push({ id: rec.id, kind: rec.kind, reason: "everything-was-dropped" });
      continue;
    }

    const attach = (ATTACH_KEYS[rec.kind] ?? [])
      .map((k) => text(read.fields[k]))
      .find((v) => v !== null) ?? null;

    facts.push({
      vendorKind: rec.kind,
      vendorRecordId: rec.id,
      attachesTo: attach,
      fields: read.fields,
      url: rec.url ?? null,
    });

    const kind = KIND_FOR[rec.kind];
    if (!kind) {
      held.push({
        id: rec.id,
        kind: rec.kind,
        reason: rec.kind === "circle" ? "no-create-circle-op" : "kind-not-allowed",
      });
      continue;
    }
    const list = byKind.get(kind) ?? [];
    list.push(rec);
    byKind.set(kind, list);
  }

  return {
    structure: [...byKind.entries()]
      .map(([kind, recs]) => ({ kind, records: recs }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
    facts,
    held,
    unmapped: [...unmapped].sort(),
    addressesSeen,
  };
}

/** Whether a vendor kind may be proposed today, for a caller that wants to ask first. */
export function streamFor(kind: SaberraRecordKind): Stream | null {
  return STREAM_FOR[kind] ?? null;
}

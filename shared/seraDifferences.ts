/**
 * THE WAYS THE OUTSIDE SERVICE'S CHART AND THE LIVE CHART HERE DIFFER, NOW.
 *
 * The structure review used to be a pile of batches, each one the service's
 * whole chart as it stood on the day it arrived. This replaces the pile with one
 * computed list: the newest stored snapshot of what the service holds
 * (`saberra_snapshots`, written by server/lib/saberraSnapshot.ts) against the
 * live chart, three ways against what this village took from the service.
 * Something the service added and then removed between two reads never
 * appears, because neither the snapshot nor the chart holds it.
 *
 * The rules are the sera-sync spec's section 8, and each is a test in
 * shared/seraDifferences.test.ts. In short:
 *
 * - R1. A role matches by a stored link, then by the role id its page id made
 *   (`seatIdFor`), then by the page id it answered to in an EARLIER read or in
 *   the history, then by name the way `planStructure` matches. A circle the
 *   same, without the role id. So the service renaming something keeps it the
 *   same subject, and the key is always the page id. A role or circle two
 *   records claim is never matched.
 * - R2. The base is what the SERVICE ITSELF SAID in the proposal this village
 *   published, read from the proposal as it landed (`traceAccepted`). A field a
 *   person changed at accept has an unknown base, and a change that cannot be
 *   traced to a proposal is left out. With no base, a difference is flagged,
 *   never applied by itself, never bulk-taken, and never a reason to retire
 *   anything. Something we hold with no record there and no history is OURS.
 *   Something we retired that the service keeps is "ours ahead".
 * - R3. A field the service did not send makes no difference, and clearing a
 *   value is never a change to apply. Presence needs the service's own status:
 *   Active, Proposed or Vacant is there, Archived is gone, anything else says
 *   nothing.
 * - R4. Removed means the service's own Archived, or the page id a subject last
 *   answered to missing from two whole reads in a row. A page id still sent is
 *   never a removal, whatever its name says now.
 * - R6. One normaliser, the name swap included, over the service's value, ours
 *   and the base, and a hash of each side. Clipped text is never compared.
 * - R7. One record per page id, and a move compares the SET of circles.
 * - R9. Words a member's name was swapped out of are flagged and never offered
 *   as the value to take.
 * - R12. One difference is one field, or one add or rest, and one key names one
 *   difference. Never a holder, never a power.
 * - R21. Every kind has a lane, and the Decision floor cannot be moved.
 *
 * Facts and a pay figure compare with the newest read at least a day older than
 * `asOf`, so a change stays in the list for a day whatever the schedule.
 *
 * Pure: no pool, no clock. The time and the name swap are handed in. The words
 * for each difference are in shared/seraDifferenceWords.ts.
 */
import { canonicalJson } from "./canonicalJson";
import { circlesNamed } from "./proposedSeats";
import { circleIdFor, proposedCircleName, readSourcePay, seatIdFor, seatNameKey, sourceStatusOf } from "./structurePlan";
import { pageKey, shownFlags, waitingKind } from "./seraWaiting";

// ── The snapshot, as the sync stores it ─────────────────────────────────────

/** How a kind came out of one read: whole, or carried forward from the read before, and why. */
export type SnapshotRead = "whole" | "not-asked" | "failed" | "cut-short" | "empty";
export const SNAPSHOT_READS: readonly SnapshotRead[] = ["whole", "not-asked", "failed", "cut-short", "empty"];

/** One pointer in a relation: the record it names by page id, or by name when that is all it carried. */
export interface SnapshotRef {
  id?: string;
  name?: string;
}

/** A field read into a plain value: text, a number, or a relation's pointers. */
export type SnapshotValue = string | number | SnapshotRef[];

export interface SnapshotRecord {
  /** The service's page id, as it sent it. Never the page address. */
  id: string;
  /** Only the fields that crossed the boundary, under the service's own names. */
  fields: Record<string, SnapshotValue>;
  /** When the service last edited the record, when that passed the boundary. */
  editedAt?: string;
  /** Fields whose text names a member here, by the wide match: a flag, never a reason to rewrite (R9). */
  namesAMember?: string[];
  /** Fields stored with a member's full name swapped out, by the narrow match (R9). */
  swapped?: string[];
  /** Fields too long to keep whole. They are stored clipped and never compared (R6). */
  clipped?: string[];
  /** The page id arrived more than once in this read; the first copy is kept (R7). */
  duplicate?: boolean;
  /**
   * On a kind carried forward (R5): when the whole read this record came from
   * was taken, carried unchanged, so a record ages from when it was read and
   * never from when it was carried (review N1). Absent: this row's own read.
   */
  readAt?: string;
  /**
   * What the record was matched to here when its read was kept, and how (R1,
   * review C2), so an older read keeps its match after a rename here. Null:
   * it matched nothing then. Absent: the row was kept before matches were
   * stored, and is matched against today's chart the old way.
   */
  match?: SnapshotMatch | null;
}

/** A compared field that can agree: a name, a role's description, a role's circle. */
export type AgreedSlot = "name" | "aim" | "circle";

/** One record's match as the sync made it, with what both sides last held the same. */
export interface SnapshotMatch {
  /** Our id. Ids are not personal data (review C2). */
  ourId: string;
  via: MatchVia;
  /**
   * What both sides last held for each compared field (review C2): the base
   * for a field the history gives none. A hash of the normalised value, a
   * name's folded to lower case, and never the words (review N3); for a
   * role's circle, our circle's id. Set where they agree at this read and
   * carried from the read before where they do not, so it outlives the reads
   * it was seen in.
   */
  held?: Partial<Record<AgreedSlot, string>>;
  /**
   * Per field in `held`: a mark of the history's base for it when both sides
   * last agreed (review K1). A change published since moves that base, so the
   * history is then the newer of the two; while it has not moved, what both
   * held is newer, because it was read after everything published by then.
   */
  traced?: Partial<Record<AgreedSlot, string>>;
  /**
   * Rows kept before review N3 held the words here instead, or `true` for the
   * service's own value in the record. Read, so such a row still reads; never
   * written now.
   */
  agreed?: Partial<Record<AgreedSlot, string | true>>;
  /**
   * With pay set here: a hash of the service's pay as it stood when ours was
   * last in step with it, carried while pay stays set, so a figure the service
   * changed shows until a person settles it, however many reads go by. Never
   * the figure itself.
   */
  pay?: string;
  /** With `pay`: the hash of the pay set here at this read, so a change here since restarts it (review K3). */
  ourPay?: string;
}

export interface SnapshotKind {
  read: SnapshotRead;
  records: SnapshotRecord[];
}

export interface Snapshot {
  takenAt: string;
  trigger: string;
  circles: SnapshotKind;
  roles: SnapshotKind;
}

// ── The live chart and the history ──────────────────────────────────────────

export interface LiveCircleIn {
  id: string;
  name: string;
  aliases?: unknown;
  /** `dormant` is a circle retired here. */
  status: string;
  isExample?: boolean;
}

export interface LiveRoleIn {
  id: string;
  name: string;
  circleId: string | null;
  /** False is a role retired here. */
  active: boolean;
  isExample?: boolean;
  /** How many people hold it here. Read only to say so on a retirement, never compared. */
  holders: number;
  aim: string | null;
  /** Whether this village has set any pay on the role. Never its figure. */
  paySet?: boolean;
  /**
   * A hash of the pay set here (value, cash, tokens, terms), never the figure:
   * a change here is a person settling the service's pay (review K3).
   */
  payHash?: string;
}

/**
 * What the service itself said about one subject, read from the proposal a
 * published change was built from, as that proposal landed. A field the
 * proposal did not carry is null.
 */
export interface SeraOriginal {
  pageId: string | null;
  name?: string | null;
  aim?: string | null;
  circleName?: string | null;
}

/** One change of a draft this village published from the service, oldest first, traced to the service's words. */
export interface AcceptedChange {
  op: string;
  orgRoleId: string;
  payload: Record<string, unknown> | null;
  /** What the service said for this subject, or null when no untouched proposal says. Null is left out of the base. */
  from: SeraOriginal | null;
}

/** A published change before it is traced. */
export interface PublishedChange {
  draftId: string;
  op: string;
  orgRoleId: string;
  payload: Record<string, unknown> | null;
}

/** A proposal accepted into a published draft. */
export interface AcceptedProposal {
  id: string;
  draftId: string;
  kind: string;
  payload: Record<string, unknown>;
  /** The stored payload still hashes to the key it landed under, so nobody edited it at accept. */
  original: boolean;
}

/** The village's lane table. The floor (`DECISION_FLOOR_KINDS`, `DECISION_FLOOR_FIELDS`) always wins. */
export type LaneTable = Readonly<Partial<Record<string, Lane>>>;

export interface DifferencesInput {
  /** Newest first. The first is the service as it stands, carried kinds included. */
  snapshots: readonly Snapshot[];
  live: { circles: readonly LiveCircleIn[]; roles: readonly LiveRoleIn[] };
  accepted: readonly AcceptedChange[];
  /** Page id to our id, from the stored link (R1) once it exists. Absent today. */
  links?: { circles?: Readonly<Record<string, string>>; roles?: Readonly<Record<string, string>> };
  lanes?: LaneTable;
  /** The moment the list is read for, an ISO time. Defaults to the newest read. */
  asOf?: string;
  /**
   * The name swap the snapshot ran over the service's prose, run here over ours
   * and the base too, so a name on one side and its stand-in on the other compare
   * equal (R6, R9). Defaults to leaving text as it is.
   */
  swap?: (text: string) => string;
}

// ── The difference ──────────────────────────────────────────────────────────

export type DifferenceKind =
  | "circleAdd"
  | "circleRest"
  | "roleAdd"
  | "roleRest"
  | "roleMove"
  | "rename"
  | "textField"
  | "valueField"
  | "pay";

export type Lane = "facts" | "lowRisk" | "decision";
export const LANES: readonly Lane[] = ["facts", "lowRisk", "decision"];

/**
 * `suggestion`: the service changed and we did not (or there is no base yet).
 * `conflict`: both changed and they disagree. `oursAhead`: we changed and the
 * service did not, which is counted and never a difference to act on.
 */
export type DifferenceState = "suggestion" | "conflict" | "oursAhead";

/**
 * What both sides agreed on last, or "unknown" when nothing traceable says.
 * `hash` is a value both held whose words are not kept (review N3): it is
 * compared by its hash, and shown as the words of whichever side still holds
 * it, when one does.
 */
export type DifferenceBase = "unknown" | { value: string | null } | { hash: string };

/** `earlier`: by the page id it answered to in an earlier read, or in the history. */
export type MatchVia = "link" | "pageId" | "earlier" | "name" | "alias";

/** A reason to look before acting, as a key and its parameters. The words are in seraDifferenceWords.ts. */
export type FlagKey =
  | "baseUnknown"
  | "firstSight"
  | "matchedByName"
  | "matchedEarlier"
  | "matchedTwice"
  | "sameNameAsLive"
  | "wasOurs"
  | "circleNotHere"
  | "circleUnknown"
  | "severalCircles"
  | "duplicatePageId"
  | "namesAMember"
  | "heldHere";

export interface DifferenceFlag {
  key: FlagKey;
  params?: Readonly<Record<string, string | number>>;
}

export interface DifferenceSubject {
  kind: "circle" | "role";
  /** The service's page id, or null for something here no read has ever tied to one. */
  pageId: string | null;
  /** Our id, or null for an addition. */
  ourId: string | null;
  via: MatchVia | null;
  /** Our name when matched, the service's otherwise. */
  name: string;
  /** For a role: the circle it sits in here, or the service's circle for an addition (`sera:<page id>` when it is not here). */
  circleId: string | null;
  circleName: string | null;
}

export interface Difference {
  /** Unique in the list and stable across reads: the subject's page id and the field, never a name. */
  key: string;
  kind: DifferenceKind;
  lane: Lane;
  state: DifferenceState;
  subject: DifferenceSubject;
  /** Our field for a chart field, the service's field for a fact, null for an add or a rest. */
  field: string | null;
  /** Normalised values. For an add or a rest, `live` and `gone`; for a move, the circle ids joined by "|". */
  sera: string | null;
  ours: string | null;
  /**
   * What "Here now" shows: our name, or a role's words, exactly as stored
   * here, before the name swap and the space collapse; `ours` for every other
   * kind. Shown only: `ours` and `oursHash` are what is compared and checked
   * (R6, R14). Always set by `differences`, optional so a hand-built one may
   * leave it out.
   */
  oursAsStored?: string | null;
  base: DifferenceBase;
  seraHash: string;
  oursHash: string;
  flags: DifferenceFlag[];
  namesAMember: boolean;
  /** May apply by itself once a holder turns its lane on: never a decision, never flagged, never a conflict. */
  autoEligible: boolean;
  /** May be taken in bulk: never flagged, never ours-ahead, never pay. */
  bulkEligible: boolean;
  /** The service's value may be taken as it stands. Never words a name was swapped out of, never pay. */
  takeable: boolean;
  source: { pageId: string | null; editedAt: string | null };
  params?: Record<string, string | number | string[] | null>;
}

// ── The service's field names ───────────────────────────────────────────────

const F = {
  circleName: "Circle Name",
  roleName: "Role Name",
  circle: "Circle",
  status: "Status",
  body: "Body",
  notes: "Notes",
  payModel: "Compensation Model",
  payStatus: "Compensation Status",
  payTerms: "Compensation Terms",
  payTarget: "Compensation Target (Monthly)",
} as const;

/** Fields shown only as the service's facts, never on the chart (spec US3.2). `Notes` is prose. */
export const CIRCLE_FACT_FIELDS = ["Status", "Sector", "Last Review Date", "Next Review Date", "Notes"] as const;
export const ROLE_FACT_FIELDS = ["Status", "Role Type", "Assignment Method", "Last Audit Date", "Next Audit Date", "Notes"] as const;
/** Prose: the name swap runs over these on every side. */
const PROSE_FIELDS = new Set<string>([F.body, F.notes, F.payTerms]);

/** How far back the facts digest and a pay figure look. */
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Lanes, and the floor no lane table moves (R21) ──────────────────────────

/**
 * The defaults. A role's description and the facts are the automatic lanes
 * (Rye's ruling S1, 2026-11-06); nothing here applies anything, and the switch
 * that lets them apply ships off. Anything not named is a decision.
 */
export const DEFAULT_LANES: LaneTable = {
  "textField:aim": "lowRisk",
  "textField:Notes": "facts",
  valueField: "facts",
};

/** R21: adds, rests, moves, renames and pay are decisions whatever a table says. */
export const DECISION_FLOOR_KINDS: ReadonlySet<DifferenceKind> = new Set<DifferenceKind>([
  "circleAdd",
  "circleRest",
  "roleAdd",
  "roleRest",
  "roleMove",
  "rename",
  "pay",
]);

/** R21: so are these fields, under any kind: pay and terms, holders and powers, and accountabilities. */
export const DECISION_FLOOR_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "circle",
  "pay",
  "terms",
  "holders",
  "powers",
  "accountabilities",
]);

/** A kind's lane: the floor first, then the village's table, then the defaults, then a decision. */
export function laneFor(kind: DifferenceKind, field: string | null, table: LaneTable = {}): Lane {
  if (DECISION_FLOOR_KINDS.has(kind)) return "decision";
  if (field !== null && DECISION_FLOOR_FIELDS.has(field)) return "decision";
  const pick = (t: LaneTable): Lane | undefined => (field !== null ? t[`${kind}:${field}`] : undefined) ?? t[kind];
  const lane = pick(table) ?? pick(DEFAULT_LANES) ?? "decision";
  return LANES.includes(lane) ? lane : "decision";
}

// ── One normaliser, one hash (R6) ───────────────────────────────────────────

/** Text as both sides are compared: one run of space for any whitespace, trimmed. Blank is absent. */
export function normaliseText(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.normalize("NFC").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/**
 * A 64-bit hash of a normalised value, as 16 hex digits. For telling whether a
 * value changed since somebody looked at it, never for security. Two 32-bit
 * lanes, each a multiply-xorshift over the UTF-16 code units, so it is the
 * same in every browser and in Node.
 */
export function valueHash(v: string | null): string {
  const s = v === null ? "\u0000" : `\u0001${v}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h2) + hex(h1);
}

/** The one normaliser, for one call: prose goes through the name swap first, everything else straight to `normaliseText`. */
interface Normaliser {
  plain: (v: unknown) => string | null;
  prose: (v: unknown) => string | null;
}

function normaliserFor(swap: ((text: string) => string) | undefined): Normaliser {
  return {
    plain: normaliseText,
    prose: (v) => normaliseText(typeof v === "string" && swap ? swap(v) : v),
  };
}

// ── Reading a stored record ─────────────────────────────────────────────────

/** A page id with its dashes gone and lowercased, so two spellings of one id meet. */
/** One key for a page id, shared with the page (./seraWaiting.ts), so both group alike (review C4). */
export { pageKey };

const PAGE_KEY_SHAPE = /^[0-9a-f]{32}$/;

/** A field as text, or null when absent, blank, a relation, or clipped (R3, R6). */
function textOf(rec: SnapshotRecord, field: string, norm: Normaliser): string | null {
  if (rec.clipped?.includes(field)) return null;
  const v = rec.fields[field];
  if (Array.isArray(v)) return null;
  return PROSE_FIELDS.has(field) ? norm.prose(v) : norm.plain(v);
}

type Presence = "live" | "gone";

/** R3: there only on the service's own Active, Proposed or Vacant, gone only on Archived, and otherwise nothing said. */
function presenceOf(rec: SnapshotRecord): Presence | null {
  const s = sourceStatusOf(normaliseText(rec.fields[F.status]));
  if (s === "active" || s === "proposed" || s === "vacant") return "live";
  return s === "archived" ? "gone" : null;
}

/** One copy per page id, the first, marked when another arrived (R7). */
function dedupe(records: readonly SnapshotRecord[]): SnapshotRecord[] {
  const seen = new Map<string, SnapshotRecord>();
  for (const r of records) {
    if (!r || typeof r.id !== "string") continue;
    const k = pageKey(r.id);
    if (k === "") continue;
    const prior = seen.get(k);
    if (prior) seen.set(k, { ...prior, duplicate: true });
    else seen.set(k, r);
  }
  return Array.from(seen.values());
}

/** The role ids a draft could have given this page id: as sent, without dashes, with them. */
function seatIdsFor(pageId: string): string[] {
  const raw = pageId.trim();
  const bare = pageKey(raw);
  const dashed = PAGE_KEY_SHAPE.test(bare)
    ? `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}`
    : "";
  const ids = [raw, bare, dashed].filter((v) => v !== "").map((v) => seatIdFor(v, ""));
  return Array.from(new Set(ids.filter((v) => v !== "")));
}

function linkFor(links: Readonly<Record<string, string>> | undefined, pageId: string): string | null {
  if (!links) return null;
  return links[pageId] ?? links[pageKey(pageId)] ?? null;
}

const fold = (s: string): string => s.trim().toLowerCase();
const has = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

// ── Tracing what was published to what the service said (R2) ───────────────

/** The seats a structure or role proposal carries. */
function seatsOf(payload: Record<string, unknown>): Record<string, unknown>[] {
  const list = Array.isArray(payload.seats) ? payload.seats : [payload];
  return list.filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s));
}

/**
 * Each published change, with what the service ITSELF said for its subject:
 * read from the proposals accepted into the same draft, and only from those the
 * caller found untouched (`original`). A role is traced by the role id its page
 * id made, an update by the name it was matched on, a circle by the id or the
 * name it was made under. Anything else, and every rest, is untraceable: a
 * steward's choice to retire the old chart is not the service's word.
 */
export function traceAccepted(changes: readonly PublishedChange[], proposals: readonly AcceptedProposal[]): AcceptedChange[] {
  const byDraft = new Map<string, AcceptedProposal[]>();
  for (const p of proposals) {
    if (!p.original) continue;
    byDraft.set(p.draftId, [...(byDraft.get(p.draftId) ?? []), p]);
  }
  return changes.map((c) => ({ op: c.op, orgRoleId: c.orgRoleId, payload: c.payload, from: traceOne(c, byDraft.get(c.draftId) ?? []) }));
}

function traceOne(c: PublishedChange, props: readonly AcceptedProposal[]): SeraOriginal | null {
  const p = c.payload ?? {};
  if (c.op === "create_seat" || c.op === "update_seat") {
    const seats = props.filter((k) => k.kind === "org.proposed" || k.kind === "role.proposed").flatMap((k) => seatsOf(k.payload));
    let hits = seats.filter((s) => typeof s.id === "string" && seatIdFor(s.id, "") === c.orgRoleId);
    if (hits.length === 0 && c.op === "update_seat" && typeof p.name === "string") {
      hits = seats.filter((s) => seatNameKey(s.name) === seatNameKey(p.name));
    }
    if (hits.length !== 1) return null;
    const s = hits[0];
    return { pageId: strOrNull(s.id), name: strOrNull(s.name), aim: strOrNull(s.aim), circleName: strOrNull(s.circleName) };
  }
  if (c.op === "create_circle") {
    const id = c.orgRoleId.startsWith("circle:") ? c.orgRoleId.slice("circle:".length) : c.orgRoleId;
    const hits = props.filter((k) => {
      if (k.kind !== "circle.proposed") return false;
      const name = proposedCircleName(k.payload);
      return name !== "" && (circleIdFor(name, k.id) === id || (typeof p.name === "string" && fold(name) === fold(p.name)));
    });
    if (hits.length !== 1) return null;
    return { pageId: strOrNull(hits[0].payload.vendorRecordId), name: proposedCircleName(hits[0].payload) };
  }
  return null;
}

// ── The base (R2) ───────────────────────────────────────────────────────────

interface Base {
  name?: DifferenceBase;
  circleId?: DifferenceBase;
  aim?: DifferenceBase;
  presence?: Presence;
  pageId?: string;
}

/**
 * What each role and circle here last took from the service, folded from the
 * traced published changes in order. A field is known only where what was
 * published is what the service said; where a person changed it at accept,
 * it is unknown. Untraceable changes are left out.
 */
function basesFrom(accepted: readonly AcceptedChange[], circles: readonly LiveCircleIn[], norm: Normaliser): { roles: Map<string, Base>; circles: Map<string, Base> } {
  const roles = new Map<string, Base>();
  const circleBases = new Map<string, Base>();
  const agreed = (published: string | null, said: string | null): DifferenceBase => (published === said ? { value: published } : "unknown");
  const circleAgreed = (published: unknown, saidName: unknown): DifferenceBase => {
    const id = strOrNull(published);
    const name = strOrNull(saidName);
    if (id === null && name === null) return { value: null };
    return id !== null && name !== null && circlesNamed(name, circles).includes(id) ? { value: id } : "unknown";
  };
  for (const c of accepted) {
    if (!c || typeof c.orgRoleId !== "string" || !c.from) continue;
    const p = c.payload && typeof c.payload === "object" ? c.payload : {};
    const from = c.from;
    if (c.op === "create_seat" || c.op === "update_seat") {
      const b = roles.get(c.orgRoleId) ?? {};
      const creates = c.op === "create_seat";
      if (creates || has(p, "name")) b.name = agreed(norm.plain(p.name), norm.plain(from.name ?? null));
      if (creates || has(p, "aim")) b.aim = agreed(norm.prose(p.aim), norm.prose(from.aim ?? null));
      if (creates || has(p, "circleId")) b.circleId = circleAgreed(p.circleId, from.circleName ?? null);
      b.presence = "live";
      if (from.pageId) b.pageId = from.pageId;
      roles.set(c.orgRoleId, b);
    } else if (c.op === "create_circle") {
      const id = c.orgRoleId.startsWith("circle:") ? c.orgRoleId.slice("circle:".length) : c.orgRoleId;
      const b = circleBases.get(id) ?? {};
      b.name = agreed(norm.plain(p.name), norm.plain(from.name ?? null));
      b.presence = "live";
      if (from.pageId) b.pageId = from.pageId;
      circleBases.set(id, b);
    }
  }
  return { roles, circles: circleBases };
}

// ── Matching (R1) ───────────────────────────────────────────────────────────

interface Match {
  ourId: string;
  via: MatchVia;
}

interface Matching {
  /** Page key to what it matched. */
  byPage: Map<string, Match>;
  /** Page keys that named the same thing here as another record did: never matched. */
  twice: Set<string>;
  /** Page key to the name of what it collided with here. */
  sameName: Map<string, string>;
  /** Page key to the subject it answered to before, now held by another record. */
  wasOurs: Map<string, string>;
  /** Every id here any record pointed at, matched or not. */
  claimed: Set<string>;
}

function emptyMatching(): Matching {
  return { byPage: new Map(), twice: new Set(), sameName: new Map(), wasOurs: new Map(), claimed: new Set() };
}

/** Settle tentative name claims: one claim matches, two or more match nothing. */
function settle(out: Matching, tentative: Map<string, Array<{ pk: string; via: MatchVia }>>): void {
  for (const [ourId, claims] of Array.from(tentative.entries())) {
    if (claims.length > 1) for (const c of claims) out.twice.add(c.pk);
    else out.byPage.set(claims[0].pk, { ourId, via: claims[0].via });
  }
  for (const m of Array.from(out.byPage.values())) out.claimed.add(m.ourId);
}

/**
 * The page ids it answered to before: a page id still sent is the same subject,
 * whatever its name says now. One whose name still names that subject is
 * matched by name or alias, as it was then (review C3): only a name that moved
 * since is a match under an older name, and only that one is checked for a
 * rename. One whose subject was retired here and whose name now names exactly
 * one live subject goes to that one by name instead (`replaced`, review K2).
 */
function matchEarlier(
  out: Matching,
  records: readonly SnapshotRecord[],
  earlier: ReadonlyMap<string, Match>,
  exists: (id: string) => boolean,
  byName: (rec: SnapshotRecord, ourId: string) => MatchVia | null,
  replaced: (rec: SnapshotRecord, ourId: string) => boolean = () => false,
): void {
  const taken = new Set(Array.from(out.byPage.values()).map((m) => m.ourId));
  for (const rec of records) {
    const pk = pageKey(rec.id);
    if (out.byPage.has(pk)) continue;
    const ourId = earlier.get(pk)?.ourId;
    if (!ourId || !exists(ourId) || replaced(rec, ourId)) continue;
    out.claimed.add(ourId);
    if (taken.has(ourId)) {
      out.wasOurs.set(pk, ourId);
      continue;
    }
    out.byPage.set(pk, { ourId, via: byName(rec, ourId) ?? "earlier" });
    taken.add(ourId);
  }
}

function matchRoles(
  records: readonly SnapshotRecord[],
  roles: readonly LiveRoleIn[],
  norm: Normaliser,
  links?: Readonly<Record<string, string>>,
  earlier: ReadonlyMap<string, Match> = new Map(),
): Matching {
  const out = emptyMatching();
  const byId = new Map(roles.map((r) => [r.id, r]));
  for (const rec of records) {
    const pk = pageKey(rec.id);
    const linked = linkFor(links, rec.id);
    if (linked && byId.has(linked)) {
      out.byPage.set(pk, { ourId: linked, via: "link" });
      continue;
    }
    const hit = seatIdsFor(rec.id).find((id) => byId.has(id));
    if (hit) out.byPage.set(pk, { ourId: hit, via: "pageId" });
  }
  // A role retired here, whose name now names exactly one live role: that one, by the
  // active-first rule name matching keeps below (review K2).
  const replaced = (rec: SnapshotRecord, ourId: string): boolean => {
    if (byId.get(ourId)?.active !== false) return false;
    const name = textOf(rec, F.roleName, norm);
    if (name === null) return false;
    const key = seatNameKey(name);
    return roles.filter((r) => r.active && seatNameKey(r.name) === key).length === 1;
  };
  matchEarlier(
    out,
    records,
    earlier,
    (id) => byId.has(id),
    (rec, ourId) => {
      const name = textOf(rec, F.roleName, norm);
      return name !== null && seatNameKey(name) === seatNameKey(byId.get(ourId)?.name) ? "name" : null;
    },
    replaced,
  );
  const taken = new Set(Array.from(out.byPage.values()).map((m) => m.ourId));
  const tentative = new Map<string, Array<{ pk: string; via: MatchVia }>>();
  for (const rec of records) {
    const pk = pageKey(rec.id);
    if (out.byPage.has(pk) || out.wasOurs.has(pk)) continue;
    const name = textOf(rec, F.roleName, norm);
    if (!name) continue;
    const key = seatNameKey(name);
    const active = roles.filter((r) => r.active && seatNameKey(r.name) === key);
    const candidates = active.length ? active : roles.filter((r) => !r.active && seatNameKey(r.name) === key);
    for (const c of candidates) out.claimed.add(c.id);
    if (candidates.length !== 1 || taken.has(candidates[0].id)) {
      if (candidates.length) out.sameName.set(pk, candidates[0].name);
      continue;
    }
    tentative.set(candidates[0].id, [...(tentative.get(candidates[0].id) ?? []), { pk, via: "name" }]);
  }
  settle(out, tentative);
  return out;
}

function matchCircles(
  records: readonly SnapshotRecord[],
  circles: readonly LiveCircleIn[],
  norm: Normaliser,
  links?: Readonly<Record<string, string>>,
  earlier: ReadonlyMap<string, Match> = new Map(),
): Matching {
  const out = emptyMatching();
  const byId = new Map(circles.map((c) => [c.id, c]));
  for (const rec of records) {
    const linked = linkFor(links, rec.id);
    if (linked && byId.has(linked)) out.byPage.set(pageKey(rec.id), { ourId: linked, via: "link" });
  }
  matchEarlier(out, records, earlier, (id) => byId.has(id), (rec, ourId) => {
    const name = textOf(rec, F.circleName, norm);
    if (name === null || !circlesNamed(name, circles).includes(ourId)) return null;
    return fold(byId.get(ourId)?.name ?? "") === fold(name) ? "name" : "alias";
  });
  const taken = new Set(Array.from(out.byPage.values()).map((m) => m.ourId));
  const tentative = new Map<string, Array<{ pk: string; via: MatchVia }>>();
  for (const rec of records) {
    const pk = pageKey(rec.id);
    if (out.byPage.has(pk) || out.wasOurs.has(pk)) continue;
    const name = textOf(rec, F.circleName, norm);
    if (!name) continue;
    const ids = circlesNamed(name, circles);
    for (const id of ids) out.claimed.add(id);
    if (ids.length !== 1 || taken.has(ids[0])) {
      if (ids.length) out.sameName.set(pk, byId.get(ids[0])?.name ?? name);
      continue;
    }
    const via: MatchVia = fold(byId.get(ids[0])?.name ?? "") === fold(name) ? "name" : "alias";
    tentative.set(ids[0], [...(tentative.get(ids[0]) ?? []), { pk, via }]);
  }
  settle(out, tentative);
  return out;
}

/** A kind whose read was kept with each record's match (review C2). One kept before carries none. */
const stamped = (k: SnapshotKind | undefined): boolean => !!k && Array.isArray(k.records) && k.records.some((r) => !!r && r.match !== undefined);

/**
 * Which page id each subject last answered to, and the reverse, from the
 * history first and then every older read in order, oldest to newest. A read
 * kept with its matches gives them as they were made then, so a rename here
 * since never undoes one (review C2); a read kept before matches were stored
 * is matched with what the reads before it established, against today's
 * chart. The newest read's own stored matches come last. So a rename at the
 * service is carried from one read to the next for as long as reads are kept.
 */
function earlierLinks(
  older: readonly SnapshotKind[],
  latest: SnapshotKind | undefined,
  history: ReadonlyMap<string, Base>,
  matchAll: (records: readonly SnapshotRecord[], earlier: ReadonlyMap<string, Match>) => Matching,
  exists: (id: string) => boolean,
): { earlier: Map<string, Match>; last: Map<string, string> } {
  const earlier = new Map<string, Match>();
  const last = new Map<string, string>();
  for (const [ourId, b] of Array.from(history.entries())) {
    if (!b.pageId) continue;
    earlier.set(pageKey(b.pageId), { ourId, via: "earlier" });
    last.set(ourId, pageKey(b.pageId));
  }
  const fromStamps = (k: SnapshotKind) => {
    for (const rec of dedupe(k.records)) {
      const m = rec.match;
      if (!m || typeof m.ourId !== "string" || !exists(m.ourId)) continue;
      const pk = pageKey(rec.id);
      earlier.set(pk, { ourId: m.ourId, via: m.via });
      last.set(m.ourId, pk);
    }
  };
  for (const k of older) {
    if (stamped(k)) {
      fromStamps(k);
      continue;
    }
    const m = matchAll(dedupe(k.records), earlier);
    for (const [pk, mm] of Array.from(m.byPage.entries())) {
      // The match as it was made at that read, its way included (review C3).
      earlier.set(pk, mm);
      last.set(mm.ourId, pk);
    }
  }
  if (latest && stamped(latest)) fromStamps(latest);
  return { earlier, last };
}

/** The newest kept copy of a record that was stored matched to this subject, or null when none was. */
function newestStampOf(snapshots: readonly Snapshot[], kind: "circles" | "roles", pk: string, ourId: string): SnapshotRecord | null {
  for (const s of snapshots) {
    const rec = (s?.[kind]?.records ?? []).find((r) => !!r && typeof r.id === "string" && pageKey(r.id) === pk);
    if (rec?.match && rec.match.ourId === ourId) return rec;
  }
  return null;
}

/** The field a slot compares, in the service's record. A circle's placement is not one field. */
const slotField = (kind: "circles" | "roles", slot: AgreedSlot): string | null =>
  slot === "aim" ? F.body : slot === "name" ? (kind === "circles" ? F.circleName : F.roleName) : null;

/**
 * What a stored match says both sides last held for a slot, or null when it
 * says nothing: a hash (a circle's our id), or the words a row kept before
 * review N3 held.
 */
function heldBase(rec: SnapshotRecord, kind: "circles" | "roles", slot: AgreedSlot, norm: Normaliser): DifferenceBase | null {
  const m = rec.match;
  if (!m) return null;
  const h = m.held?.[slot];
  if (typeof h === "string") return slot === "circle" ? { value: h } : { hash: h };
  const v = m.agreed?.[slot];
  if (typeof v === "string") return { value: v };
  const field = slotField(kind, slot);
  const text = v === true && field !== null ? textOf(rec, field, norm) : null;
  return text === null ? null : { value: text };
}

/**
 * What both sides last held for one subject's field, from the newest read kept
 * with its match to that subject (review C2), and the mark of the history's
 * base it was held under (review K1), when the read kept one.
 */
function heldFor(
  snapshots: readonly Snapshot[],
  kind: "circles" | "roles",
  pk: string,
  ourId: string,
  slot: AgreedSlot,
  norm: Normaliser,
): { base: DifferenceBase; traced?: string } | null {
  for (const s of snapshots) {
    const rec = (s?.[kind]?.records ?? []).find((r) => !!r && typeof r.id === "string" && pageKey(r.id) === pk);
    if (!rec || rec.match?.ourId !== ourId) continue;
    const held = heldBase(rec, kind, slot, norm);
    if (held === null) continue;
    const traced = rec.match.traced?.[slot];
    return typeof traced === "string" ? { base: held, traced } : { base: held };
  }
  return null;
}

/** A mark of the history's base for a field, as it stands: moved by any change published to it (review K1). */
const tracedMark = (b: DifferenceBase | undefined): string =>
  b === undefined ? "none" : b === "unknown" ? "unknown" : "hash" in b ? b.hash : valueHash(b.value);

/**
 * The newer of the two bases (review K1). What both sides held was read after
 * everything published by then, so it is the newer one while the history's
 * base has not moved since; a change published after it makes the history
 * newer. With only one, that one; with neither, unknown. A read kept before
 * this carried no mark, and the history wins over it, as it did.
 */
function newerBase(traced: DifferenceBase | undefined, raw: DifferenceBase | undefined, held: { base: DifferenceBase; traced?: string } | null): DifferenceBase {
  const known = traced !== undefined && traced !== "unknown";
  if (held && (!known || held.traced === tracedMark(raw))) return held.base;
  if (known) return traced;
  return held?.base ?? "unknown";
}

/**
 * A traced base is known only up to capitals (review C5). The proposal it was
 * read from is called untouched when its claim, folded to lower case and one
 * space (`normalizeClaim`), still hashes to the key it landed under, so a
 * steward's edit of capitals alone at accept passes for the service's words.
 * Where the service's value differs from the traced one by capitals alone,
 * the base could be either: the steward's fix, or the service's own change.
 * It is unknown, so it is flagged and never applies by itself or in bulk.
 */
function tracedUpToCase(traced: DifferenceBase | undefined, sera: string | null): DifferenceBase | undefined {
  if (!traced || traced === "unknown" || !("value" in traced) || traced.value === null || sera === null || traced.value === sera) return traced;
  return traced.value.toLowerCase() === sera.toLowerCase() ? "unknown" : traced;
}

// ── The three ways ──────────────────────────────────────────────────────────

/** What a value is compared by: a hash of it (R6), so a base known by its hash alone compares too (review N3). */
type Key = (v: string | null) => string;
const exactKey: Key = (v) => valueHash(v);
/** Two names are one name when only their capitals differ, the rule matching by name already keeps: no rename. */
const nameKey: Key = (v) => valueHash(v === null ? null : fold(v));
const keyFor = (slot: AgreedSlot): Key => (slot === "name" ? nameKey : exactKey);
const sameName = (a: string | null, b: string | null): boolean => nameKey(a) === nameKey(b);
const baseKey = (b: Exclude<DifferenceBase, "unknown">, key: Key): string => ("hash" in b ? b.hash : key(b.value));

/** A base known by its hash, shown as the words of whichever side still holds it, when one does. */
function shownBase(base: DifferenceBase, sera: string | null, ours: string | null, key: Key): DifferenceBase {
  if (base === "unknown" || !("hash" in base)) return base;
  if (base.hash === key(sera)) return { value: sera };
  if (base.hash === key(ours)) return { value: ours };
  return base;
}

/** A field's state, or null when there is nothing to say (absent at the service, or both the same). */
function threeWay(sera: string | null, ours: string | null, base: DifferenceBase, key: Key = exactKey): DifferenceState | null {
  if (sera === null || key(sera) === key(ours)) return null;
  if (base === "unknown" || baseKey(base, key) === key(ours)) return "suggestion";
  return baseKey(base, key) === key(sera) ? "oursAhead" : "conflict";
}

/**
 * Whether something is there at all. Retired here and live there is ours ahead
 * unless we retired it on the service's own word. Live here and gone there is
 * a rest only on a known base: an unknown one never proposes a rest (R2).
 */
function presenceState(sera: Presence, ours: Presence, base: Presence | undefined): DifferenceState | null {
  if (sera === ours) return null;
  if (ours === "gone") return base === "gone" ? "suggestion" : "oursAhead";
  if (base === undefined) return null;
  return base === "live" ? "suggestion" : "oursAhead";
}

/** A move compares the SET of the service's circles with the one circle a role sits in here (R7). */
function moveState(seraKeys: readonly string[], ours: string | null, base: DifferenceBase): DifferenceState | null {
  if (seraKeys.length === 0 || (ours !== null && seraKeys.includes(ours))) return null;
  // A circle's base is our circle's id, never a hash.
  if (base === "unknown" || !("value" in base)) return "suggestion";
  if (base.value !== null && seraKeys.includes(base.value)) return "oursAhead";
  return base.value === ours ? "suggestion" : "conflict";
}

// ── A role's circles ────────────────────────────────────────────────────────

interface CircleRef {
  /** Our circle id, or `sera:<page key>` / `name:<name>` for one that is not here. */
  key: string;
  name: string;
  here: boolean;
}

interface Placement {
  refs: CircleRef[];
  /** The relation carried at least one pointer. */
  present: boolean;
}

interface Chart {
  circleById: Map<string, LiveCircleIn>;
  liveCircles: readonly LiveCircleIn[];
  /** The newest snapshot's circles by page key: carried ones included, so roles resolve against the combined snapshot (R5). */
  seraCircles: Map<string, SnapshotRecord>;
  circleMatch: Matching;
  norm: Normaliser;
}

function placementOf(rec: SnapshotRecord, chart: Chart): Placement {
  const raw = rec.fields[F.circle];
  const pointers: SnapshotRef[] = Array.isArray(raw)
    ? raw.filter((x): x is SnapshotRef => !!x && typeof x === "object")
    : typeof raw === "string" && raw.trim() !== ""
      ? [{ name: raw }]
      : [];
  const refs: CircleRef[] = [];
  const byName = (name: string): CircleRef => {
    const ids = circlesNamed(name, chart.liveCircles);
    const here = ids.length === 1 ? chart.circleById.get(ids[0]) : undefined;
    return here ? { key: here.id, name: here.name, here: true } : { key: `name:${fold(name)}`, name, here: false };
  };
  for (const p of pointers) {
    const c = typeof p.id === "string" ? chart.seraCircles.get(pageKey(p.id)) : undefined;
    let ref: CircleRef | null = null;
    if (c) {
      // A circle the service archived places nothing.
      if (presenceOf(c) === "gone") continue;
      const m = chart.circleMatch.byPage.get(pageKey(c.id));
      const ours = m ? chart.circleById.get(m.ourId) : undefined;
      const name = textOf(c, F.circleName, chart.norm) ?? "";
      ref = ours ? { key: ours.id, name: ours.name, here: true } : name ? { key: `sera:${pageKey(c.id)}`, name, here: false } : null;
    } else if (typeof p.name === "string" && p.name.trim() !== "") {
      ref = byName(p.name.trim());
    }
    if (ref && !refs.some((r) => r.key === ref!.key)) refs.push(ref);
  }
  return { refs, present: pointers.length > 0 };
}

// ── Pay ─────────────────────────────────────────────────────────────────────

/** The four Compensation fields: a key compared whole and unclipped, and the reading the words use. */
function payOf(rec: SnapshotRecord, norm: Normaliser): { key: string; params: Record<string, string | number | null> } | null {
  const model = textOf(rec, F.payModel, norm);
  const status = textOf(rec, F.payStatus, norm);
  const terms = textOf(rec, F.payTerms, norm);
  const rawTarget = rec.fields[F.payTarget];
  const target = typeof rawTarget === "number" && Number.isFinite(rawTarget) ? rawTarget : textOf(rec, F.payTarget, norm);
  if (model === null && status === null && terms === null && target === null) return null;
  const read = readSourcePay({ model, status, terms, monthlyUsd: target });
  return {
    key: canonicalJson({ model, status, terms, target }),
    params: {
      model: read?.model ?? null,
      standing: read?.standing ?? null,
      statusLabel: read?.statusLabel ?? null,
      monthlyUsd: read?.monthlyUsd ?? null,
    },
  };
}

// ── Building one difference ─────────────────────────────────────────────────

interface Draft {
  kind: DifferenceKind;
  state: DifferenceState;
  subject: DifferenceSubject;
  field: string | null;
  /** The part of the subject this is about, for the key: presence, name, circle, aim, pay, or fact:<field>. */
  slot: string;
  sera: string | null;
  ours: string | null;
  /** Our value as stored, for "Here now", where it is text; `ours` otherwise. */
  oursAsStored?: string | null;
  base: DifferenceBase;
  flags: DifferenceFlag[];
  rec: SnapshotRecord | null;
  /** Set when the key cannot be the page id: a subject no read ties to one, or one another subject's rest already keys on. */
  keyOverride?: string;
  params?: Record<string, string | number | string[] | null>;
}

const FLAG_ORDER: readonly FlagKey[] = [
  "baseUnknown",
  "firstSight",
  "matchedByName",
  "matchedEarlier",
  "matchedTwice",
  "sameNameAsLive",
  "wasOurs",
  "circleNotHere",
  "circleUnknown",
  "severalCircles",
  "duplicatePageId",
  "namesAMember",
  "heldHere",
];

function keyOf(d: Draft): string {
  if (d.keyOverride) return d.keyOverride;
  const pk = d.subject.pageId !== null ? pageKey(d.subject.pageId) : `here:${d.subject.ourId ?? ""}`;
  return `${d.subject.kind}:${pk}:${d.slot}`;
}

function finish(d: Draft, table: LaneTable): Difference {
  const lane = laneFor(d.kind, d.field, table);
  const flags = FLAG_ORDER.flatMap((k) => d.flags.filter((f) => f.key === k).slice(0, 1));
  const flagged = flags.length > 0;
  const namesAMember = flags.some((f) => f.key === "namesAMember");
  return {
    key: keyOf(d),
    kind: d.kind,
    lane,
    state: d.state,
    subject: d.subject,
    field: d.field,
    sera: d.sera,
    ours: d.ours,
    oursAsStored: d.oursAsStored !== undefined ? d.oursAsStored : d.ours,
    base: d.base,
    seraHash: valueHash(d.sera),
    oursHash: valueHash(d.ours),
    flags,
    namesAMember,
    autoEligible: lane !== "decision" && d.state === "suggestion" && !flagged,
    bulkEligible: d.kind !== "pay" && d.state !== "oursAhead" && !flagged,
    takeable: d.kind !== "pay" && d.state !== "oursAhead" && !namesAMember,
    source: { pageId: d.subject.pageId, editedAt: d.rec?.editedAt ?? null },
    ...(d.params ? { params: d.params } : {}),
  };
}

const flag = (key: FlagKey, params?: Record<string, string | number>): DifferenceFlag => (params ? { key, params } : { key });

/** The flags a record's own state carries, for a difference about the fields named in `uses`. */
function recordFlags(rec: SnapshotRecord, uses: readonly string[]): DifferenceFlag[] {
  const out: DifferenceFlag[] = [];
  if (rec.duplicate) out.push(flag("duplicatePageId"));
  if (uses.some((f) => rec.namesAMember?.includes(f) || rec.swapped?.includes(f))) out.push(flag("namesAMember"));
  return out;
}

const SLOT_RANK = (slot: string): number =>
  slot === "presence" ? 0 : slot === "name" ? 1 : slot === "circle" ? 2 : slot === "aim" ? 3 : slot === "pay" ? 4 : 5;

/** The newest two reads of a kind that were whole and held something (R4, R5). */
function wholeReads(snapshots: readonly Snapshot[], kind: "circles" | "roles"): SnapshotKind[] {
  return snapshots.map((s) => s?.[kind]).filter((k): k is SnapshotKind => !!k && k.read === "whole" && k.records.length > 0).slice(0, 2);
}

/** The newest read at least a day older than `asOf`, or the oldest kept when none is that old yet. */
function readADayBefore(snapshots: readonly Snapshot[], asOf: number): Snapshot | null {
  const older = snapshots.slice(1);
  const cutoff = asOf - DAY_MS;
  return older.find((s) => Date.parse(s.takenAt) <= cutoff) ?? older[older.length - 1] ?? null;
}

// ── The function ────────────────────────────────────────────────────────────

/** The newest read matched to the live chart: what the list and the sync's stored matches both start from. */
interface Prepared {
  latest: Snapshot;
  norm: Normaliser;
  liveCircles: LiveCircleIn[];
  liveRoles: LiveRoleIn[];
  circleById: Map<string, LiveCircleIn>;
  roleById: Map<string, LiveRoleIn>;
  bases: { roles: Map<string, Base>; circles: Map<string, Base> };
  circleLinks: { earlier: Map<string, Match>; last: Map<string, string> };
  roleLinks: { earlier: Map<string, Match>; last: Map<string, string> };
  circles: SnapshotRecord[];
  roles: SnapshotRecord[];
  circleMatch: Matching;
  roleMatch: Matching;
  chart: Chart;
}

function prepare(input: DifferencesInput): Prepared | null {
  const latest = input.snapshots[0];
  if (!latest) return null;
  const norm = normaliserFor(input.swap);
  const links = input.links ?? {};
  const liveCircles = input.live.circles.filter((c) => !c.isExample);
  const liveRoles = input.live.roles.filter((r) => !r.isExample);
  const circleById = new Map(liveCircles.map((c) => [c.id, c]));
  const roleById = new Map(liveRoles.map((r) => [r.id, r]));
  const bases = basesFrom(input.accepted ?? [], liveCircles, norm);

  const matchCirclesWith = (r: readonly SnapshotRecord[], e: ReadonlyMap<string, Match>) => matchCircles(r, liveCircles, norm, links.circles, e);
  const matchRolesWith = (r: readonly SnapshotRecord[], e: ReadonlyMap<string, Match>) => matchRoles(r, liveRoles, norm, links.roles, e);
  const olderOldestFirst = input.snapshots.slice(1).reverse();
  const circleLinks = earlierLinks(olderOldestFirst.map((s) => s.circles), latest.circles, bases.circles, matchCirclesWith, (id) => circleById.has(id));
  const roleLinks = earlierLinks(olderOldestFirst.map((s) => s.roles), latest.roles, bases.roles, matchRolesWith, (id) => roleById.has(id));

  const circles = dedupe(latest.circles?.records ?? []);
  const roles = dedupe(latest.roles?.records ?? []);
  const circleMatch = matchCirclesWith(circles, circleLinks.earlier);
  const roleMatch = matchRolesWith(roles, roleLinks.earlier);
  const chart: Chart = { circleById, liveCircles, seraCircles: new Map(circles.map((c) => [pageKey(c.id), c])), circleMatch, norm };
  return { latest, norm, liveCircles, liveRoles, circleById, roleById, bases, circleLinks, roleLinks, circles, roles, circleMatch, roleMatch, chart };
}

/**
 * The newest read with each record's match as it is made now, and where both
 * sides hold the same value (review C2). The sync keeps this, so a later read
 * of the list never re-matches an older read against a chart renamed since: a
 * rename here is ours ahead, and a change at the service after both agreed is
 * a suggestion against the value they agreed on. Null with no read.
 *
 * What this cannot reach (review K4): a rename here made before the first read
 * kept with its matches. That read matches against a chart already renamed,
 * finds nothing by name, and keeps the record as an addition, and every read
 * after carries it so. PR C's link table (R1) resolves it, a stored link set by
 * a person. There is no backfill at deploy on purpose: a write at deploy time
 * needs Rye's own yes.
 */
export function stampMatches(input: DifferencesInput): Snapshot | null {
  const p = prepare(input);
  if (!p) return null;
  const { latest, norm, circleById, roleById, bases, circleMatch, roleMatch, chart } = p;
  const older = input.snapshots.slice(1);
  const dayBefore = readADayBefore(input.snapshots, Date.parse(latest.takenAt));
  /**
   * One slot: what both sides hold now when they agree, else what an older
   * read carried, if anything. Always a hash, a name's folded, and for a
   * circle our circle's id: the words never travel on (review N3).
   */
  const slot = (
    kind: "circles" | "roles",
    rec: SnapshotRecord,
    ourId: string,
    s: AgreedSlot,
    now: string | null,
    history: DifferenceBase | undefined,
  ): { held: string; traced?: string } | undefined => {
    // Agreeing now: held under the history's base as it stands at this read (review K1).
    if (now !== null) return { held: s === "circle" ? now : keyFor(s)(now), traced: tracedMark(history) };
    const carried = heldFor(older, kind, pageKey(rec.id), ourId, s, norm);
    if (!carried || carried.base === "unknown") return undefined;
    const b = carried.base;
    const held = "hash" in b ? b.hash : b.value === null ? null : s === "circle" ? b.value : keyFor(s)(b.value);
    if (held === null) return undefined;
    return carried.traced !== undefined ? { held, traced: carried.traced } : { held };
  };
  const heldOf = (entries: Array<[AgreedSlot, { held: string; traced?: string } | undefined]>): Pick<SnapshotMatch, "held" | "traced"> => {
    const held: Partial<Record<AgreedSlot, string>> = {};
    const traced: Partial<Record<AgreedSlot, string>> = {};
    for (const [s, v] of entries) {
      if (!v) continue;
      held[s] = v.held;
      if (v.traced !== undefined) traced[s] = v.traced;
    }
    return { held, ...(Object.keys(traced).length ? { traced } : {}) };
  };

  const circleStamp = (rec: SnapshotRecord): SnapshotMatch | null => {
    const m = circleMatch.byPage.get(pageKey(rec.id));
    const live = m ? circleById.get(m.ourId) : undefined;
    if (!m || !live) return null;
    const name = textOf(rec, F.circleName, norm);
    const nameNow = name !== null && sameName(name, norm.plain(live.name)) ? name : null;
    const history = bases.circles.get(live.id);
    return { ourId: live.id, via: m.via, ...heldOf([["name", slot("circles", rec, live.id, "name", nameNow, history?.name)]]) };
  };
  const roleStamp = (rec: SnapshotRecord): SnapshotMatch | null => {
    const m = roleMatch.byPage.get(pageKey(rec.id));
    const live = m ? roleById.get(m.ourId) : undefined;
    if (!m || !live) return null;
    const name = textOf(rec, F.roleName, norm);
    const aim = textOf(rec, F.body, norm);
    const inCircle = live.circleId !== null && placementOf(rec, chart).refs.some((r) => r.key === live.circleId);
    const history = bases.roles.get(live.id);
    const out: SnapshotMatch = {
      ourId: live.id,
      via: m.via,
      ...heldOf([
        ["name", slot("roles", rec, live.id, "name", name !== null && sameName(name, norm.plain(live.name)) ? name : null, history?.name)],
        ["aim", slot("roles", rec, live.id, "aim", aim !== null && aim === norm.prose(live.aim) ? aim : null, history?.aim)],
        ["circle", slot("roles", rec, live.id, "circle", inCircle ? live.circleId : null, history?.circleId)],
      ]),
    };
    // Pay set here: the service's pay when ours was last in step, carried while ours stays as it was.
    // Ours changed since the read before: a person set it, having seen the service's pay at that read,
    // so that read's pay is in step now (review K3). The first time, the read a day before stands in,
    // the rule a row kept before this one is read by.
    if (live.paySet) {
      const before = newestStampOf(older, "roles", pageKey(rec.id), live.id);
      const kept = before?.match;
      const prior = dayBefore?.roles?.records?.find((r) => !!r && typeof r.id === "string" && pageKey(r.id) === pageKey(rec.id));
      if (kept?.pay !== undefined && (kept.ourPay === undefined || kept.ourPay === live.payHash)) out.pay = kept.pay;
      else if (kept?.pay !== undefined && before) out.pay = valueHash(payOf(before, norm)?.key ?? null);
      else out.pay = valueHash(prior ? (payOf(prior, norm)?.key ?? null) : (payOf(rec, norm)?.key ?? null));
      if (live.payHash !== undefined) out.ourPay = live.payHash;
    }
    return out;
  };
  const kind = (k: SnapshotKind | undefined, stamp: (rec: SnapshotRecord) => SnapshotMatch | null): SnapshotKind => ({
    read: k?.read ?? "empty",
    records: (k?.records ?? []).map((rec) => ({ ...rec, match: stamp(rec) })),
  });
  return { ...latest, circles: kind(latest.circles, circleStamp), roles: kind(latest.roles, roleStamp) };
}

/** Every way the newest snapshot and the live chart differ, three ways against what this village took from the service. */
export function differences(input: DifferencesInput): Difference[] {
  const p = prepare(input);
  if (!p) return [];
  const { latest, norm, liveCircles, liveRoles, circleById, roleById, bases, circleLinks, roleLinks, circles, roles, circleMatch, roleMatch, chart } = p;
  const table = input.lanes ?? {};
  const asOfParsed = Date.parse(String(input.asOf ?? latest.takenAt));
  const dayBefore = readADayBefore(input.snapshots, Number.isFinite(asOfParsed) ? asOfParsed : Date.parse(latest.takenAt));
  const previous = input.snapshots[1] ?? null;
  /**
   * A field's base: the newer of the history's and what both sides last held
   * (review C2, K1). `traced` is the history's as compared, `raw` as it was
   * traced, which is what its mark is made from.
   */
  const baseFor = (kind: "circles" | "roles", rec: SnapshotRecord, ourId: string, slot: AgreedSlot, traced: DifferenceBase | undefined, raw = traced) =>
    newerBase(traced, raw, heldFor(input.snapshots, kind, pageKey(rec.id), ourId, slot, norm));
  const keyed = (list: readonly SnapshotRecord[] | undefined) => new Map(dedupe(list ?? []).map((r) => [pageKey(r.id), r]));
  const seenBefore = { circles: keyed(previous?.circles.records), roles: keyed(previous?.roles.records) };
  const aDayAgo = { circles: keyed(dayBefore?.circles.records), roles: keyed(dayBefore?.roles.records) };
  const drafts: Draft[] = [];

  /** The people who hold roles in a circle here, for a circle's retirement. */
  const heldIn = (circleId: string) => liveRoles.filter((r) => r.active && r.circleId === circleId).reduce((n, r) => n + Math.max(0, r.holders), 0);
  const held = (holders: number) => (holders > 0 ? [flag("heldHere", { holders })] : []);

  /** The facts a matched subject carries, against the read a day before (the digest the facts store keeps). */
  const facts = (rec: SnapshotRecord, prior: SnapshotRecord | undefined, fields: readonly string[], subject: DifferenceSubject, extra: DifferenceFlag[]) => {
    if (!prior) return;
    for (const field of fields) {
      const sera = textOf(rec, field, norm);
      const was = textOf(prior, field, norm);
      if (sera === null || sera === was) continue;
      drafts.push({
        kind: PROSE_FIELDS.has(field) ? "textField" : "valueField",
        state: "suggestion",
        subject,
        field,
        slot: `fact:${field}`,
        sera,
        ours: was,
        base: { value: was },
        flags: [...extra, ...recordFlags(rec, [field])],
        rec,
      });
    }
  };

  /** How a subject was matched, as flags every difference about it carries. */
  const matchFlags = (via: MatchVia): DifferenceFlag[] =>
    via === "name" || via === "alias" ? [flag("matchedByName")] : via === "earlier" ? [flag("matchedEarlier")] : [];

  /** An unmatched record's reasons to check first, shared by circles and roles. */
  const additionFlags = (rec: SnapshotRecord, m: Matching, of: "circle" | "role", seen: Map<string, SnapshotRecord>, nameOf: (id: string) => string | undefined) => {
    const pk = pageKey(rec.id);
    const out = [flag("baseUnknown")];
    if (!seen.has(pk)) out.push(flag("firstSight"));
    if (m.twice.has(pk)) out.push(flag("matchedTwice", { of }));
    const same = m.sameName.get(pk);
    if (same) out.push(flag("sameNameAsLive", { name: same, of }));
    const was = m.wasOurs.get(pk);
    if (was) out.push(flag("wasOurs", { name: nameOf(was) ?? was, of }));
    return out;
  };

  // ── Circles ──
  for (const rec of circles) {
    const pk = pageKey(rec.id);
    const name = textOf(rec, F.circleName, norm);
    const presence = presenceOf(rec);
    const m = circleMatch.byPage.get(pk);
    if (!m) {
      if (presence !== "live" || !name) continue;
      drafts.push({
        kind: "circleAdd", state: "suggestion", field: null, slot: "presence", sera: name, ours: null, base: "unknown",
        subject: { kind: "circle", pageId: rec.id, ourId: null, via: null, name, circleId: null, circleName: null },
        flags: [...additionFlags(rec, circleMatch, "circle", seenBefore.circles, (id) => circleById.get(id)?.name), ...recordFlags(rec, [F.circleName])],
        rec, params: { roles: 0 },
      });
      continue;
    }
    const live = circleById.get(m.ourId)!;
    const base = bases.circles.get(live.id);
    const subject: DifferenceSubject = { kind: "circle", pageId: rec.id, ourId: live.id, via: m.via, name: live.name, circleId: null, circleName: null };
    const how = matchFlags(m.via);
    const ours: Presence = live.status === "dormant" ? "gone" : "live";
    const state = presence ? presenceState(presence, ours, base?.presence) : null;
    if (state && presence) {
      drafts.push({
        kind: ours === "gone" ? "circleAdd" : "circleRest", state, subject, field: null, slot: "presence",
        sera: presence, ours, base: base?.presence ? { value: base.presence } : "unknown",
        flags: [...(base?.presence ? [] : [flag("baseUnknown")]), ...how, ...recordFlags(rec, []), ...(ours === "live" ? held(heldIn(live.id)) : [])],
        rec, params: { reason: "archived" },
      });
    }
    if (presence === "gone" || ours === "gone") continue;
    // While the service's name still names our circle, by its name or an alias, it is no
    // rename (review C3); one matched by a link or an older read may carry a new one.
    if (name === null || !circlesNamed(name, liveCircles).includes(live.id)) {
      const ourName = norm.plain(live.name);
      const nameBase = shownBase(baseFor("circles", rec, live.id, "name", base?.name), name, ourName, nameKey);
      const renamed = threeWay(name, ourName, nameBase, nameKey);
      if (renamed) {
        drafts.push({
          kind: "rename", state: renamed, subject, field: "name", slot: "name", sera: name, ours: ourName, oursAsStored: live.name, base: nameBase,
          flags: [...(nameBase === "unknown" ? [flag("baseUnknown")] : []), ...how, ...recordFlags(rec, [F.circleName])], rec,
        });
      }
    }
    facts(rec, aDayAgo.circles.get(pk), CIRCLE_FACT_FIELDS, subject, how);
  }

  // ── Roles ──
  for (const rec of roles) {
    const pk = pageKey(rec.id);
    const name = textOf(rec, F.roleName, norm);
    const presence = presenceOf(rec);
    const m = roleMatch.byPage.get(pk);
    const placed = placementOf(rec, chart);
    if (!m) {
      if (presence !== "live" || !name) continue;
      const at = placed.refs.find((r) => r.here) ?? placed.refs[0] ?? null;
      const flags = additionFlags(rec, roleMatch, "role", seenBefore.roles, (id) => roleById.get(id)?.name);
      if (at && !placed.refs.some((r) => r.here)) flags.push(flag("circleNotHere", { circle: at.name }));
      if (placed.present && placed.refs.length === 0) flags.push(flag("circleUnknown"));
      drafts.push({
        kind: "roleAdd", state: "suggestion", field: null, slot: "presence", sera: name, ours: null, base: "unknown",
        subject: { kind: "role", pageId: rec.id, ourId: null, via: null, name, circleId: at?.key ?? null, circleName: at?.name ?? null },
        flags: [...flags, ...recordFlags(rec, [F.roleName, F.body])], rec,
        // What the new role is for, so whoever decides reads more than a job title.
        params: { aim: textOf(rec, F.body, norm) },
      });
      continue;
    }
    const live = roleById.get(m.ourId)!;
    const base = bases.roles.get(live.id);
    const sitsIn = live.circleId ? circleById.get(live.circleId) : undefined;
    const subject: DifferenceSubject = {
      kind: "role", pageId: rec.id, ourId: live.id, via: m.via, name: live.name,
      circleId: live.circleId, circleName: sitsIn?.name ?? null,
    };
    const how = matchFlags(m.via);
    const ours: Presence = live.active ? "live" : "gone";
    const state = presence ? presenceState(presence, ours, base?.presence) : null;
    if (state && presence) {
      drafts.push({
        kind: ours === "gone" ? "roleAdd" : "roleRest", state, subject, field: null, slot: "presence",
        sera: presence, ours, base: base?.presence ? { value: base.presence } : "unknown",
        flags: [...(base?.presence ? [] : [flag("baseUnknown")]), ...how, ...recordFlags(rec, []), ...(ours === "live" ? held(live.holders) : [])],
        rec, params: { reason: "archived" },
      });
    }
    if (presence === "gone" || ours === "gone") continue;

    const field = (
      kind: DifferenceKind, slot: string, fieldName: string, sera: string | null, oursValue: string | null,
      fieldBase: DifferenceBase, fieldState: DifferenceState | null, uses: string[],
      { extra = [], params, stored }: { extra?: DifferenceFlag[]; params?: Draft["params"]; stored?: string | null } = {},
    ) => {
      if (!fieldState) return;
      drafts.push({
        kind, state: fieldState, subject, field: fieldName, slot, sera, ours: oursValue, ...(stored !== undefined ? { oursAsStored: stored } : {}), base: fieldBase,
        flags: [...(fieldBase === "unknown" ? [flag("baseUnknown")] : []), ...how, ...extra, ...recordFlags(rec, uses)],
        rec, ...(params ? { params } : {}),
      });
    };

    const ourName = norm.plain(live.name);
    const nameBase = shownBase(baseFor("roles", rec, live.id, "name", base?.name), name, ourName, nameKey);
    field("rename", "name", "name", name, ourName, nameBase, threeWay(name, ourName, nameBase, nameKey), [F.roleName], { stored: live.name });

    const keys = placed.refs.map((r) => r.key).sort();
    const circleBase = baseFor("roles", rec, live.id, "circle", base?.circleId);
    const away = placed.refs.find((r) => !r.here);
    const moveFlags = [
      ...(away ? [flag("circleNotHere", { circle: away.name })] : []),
      ...(placed.refs.length > 1 ? [flag("severalCircles", { count: placed.refs.length })] : []),
    ];
    field("roleMove", "circle", "circle", keys.join("|") || null, live.circleId, circleBase, moveState(keys, live.circleId, circleBase), [], {
      extra: moveFlags,
      params: { from: sitsIn?.name ?? null, to: placed.refs.map((r) => r.name) },
    });

    const aim = textOf(rec, F.body, norm);
    const ourAim = norm.prose(live.aim);
    const aimBase = shownBase(baseFor("roles", rec, live.id, "aim", tracedUpToCase(base?.aim, aim), base?.aim), aim, ourAim, exactKey);
    field("textField", "aim", "aim", aim, ourAim, aimBase, threeWay(aim, ourAim, aimBase), [F.body], { stored: live.aim });

    // Pay is information: its base is never known, so it is never taken in bulk (R23).
    const pay = payOf(rec, norm);
    if (pay) {
      const prior = aDayAgo.roles.get(pk);
      const was = prior ? (payOf(prior, norm)?.key ?? null) : undefined;
      // With pay set here, against the pay the stored match carries: it shows until a person
      // settles it, never only for a day. A row kept before matches were stored keeps the day.
      const stamp = newestStampOf(input.snapshots, "roles", pk, live.id)?.match;
      const inStep = stamp?.pay;
      // Pay set here changed since the newest read: a person settled what that read showed (review K3).
      const settledHere = inStep !== undefined && stamp?.ourPay !== undefined && live.payHash !== undefined && stamp.ourPay !== live.payHash;
      const moved = settledHere ? false : inStep !== undefined ? inStep !== valueHash(pay.key) : was !== undefined && was !== pay.key;
      const payState: DifferenceState | null = !live.paySet ? "suggestion" : moved ? "conflict" : null;
      // Which rule said so, for its words: since pay was set here, or since the read a day before.
      pay.params.since = inStep !== undefined ? "set" : "dayBefore";
      field("pay", "pay", "pay", pay.key, live.paySet ? "set" : "none", "unknown", payState, [F.payTerms], { params: pay.params });
    }

    facts(rec, aDayAgo.roles.get(pk), ROLE_FACT_FIELDS, subject, how);
  }

  // ── Missing from two whole reads, by page id (R4) ──
  const restKeys = new Set<string>();
  const missing = (
    kind: "circles" | "roles",
    baseMap: Map<string, Base>,
    latestMatch: Matching,
    last: Map<string, string>,
    latestPages: Set<string>,
    describe: (ourId: string) => { subject: Omit<DifferenceSubject, "pageId">; ours: Presence; holders: number } | null,
  ) => {
    const reads = wholeReads(input.snapshots, kind);
    if (reads.length < 2) return;
    const pagesIn = reads.map((k) => new Set(k.records.map((r) => pageKey(r.id))));
    for (const [ourId, base] of Array.from(baseMap.entries())) {
      if (latestMatch.claimed.has(ourId)) continue;
      const pk = last.get(ourId) ?? (kind === "roles" && PAGE_KEY_SHAPE.test(pageKey(ourId)) ? pageKey(ourId) : null);
      // A subject no read or history ties to a page id cannot be proved gone.
      if (pk === null) continue;
      // Its page id is still sent: present, whatever its name says now (the record itself is flagged).
      if (latestPages.has(pk) || pagesIn.some((s) => s.has(pk))) continue;
      const here = describe(ourId);
      if (!here) continue;
      const state = presenceState("gone", here.ours, base.presence);
      if (!state) continue;
      const subjectKind = kind === "circles" ? "circle" : "role";
      const plain = `${subjectKind}:${pk}:presence`;
      const key = restKeys.has(plain) ? `${subjectKind}:here:${ourId}:presence` : plain;
      restKeys.add(key);
      drafts.push({
        kind: kind === "circles" ? "circleRest" : "roleRest", state, field: null, slot: "presence",
        subject: { ...here.subject, pageId: pk }, sera: "gone", ours: here.ours, base: { value: base.presence ?? null },
        flags: held(here.holders), rec: null, keyOverride: key,
        params: { reason: "missingTwice" },
      });
    }
  };
  missing("circles", bases.circles, circleMatch, circleLinks.last, new Set(circles.map((r) => pageKey(r.id))), (id) => {
    const c = circleById.get(id);
    if (!c) return null;
    return {
      subject: { kind: "circle", ourId: c.id, via: null, name: c.name, circleId: null, circleName: null },
      ours: c.status === "dormant" ? "gone" : "live",
      holders: heldIn(c.id),
    };
  });
  missing("roles", bases.roles, roleMatch, roleLinks.last, new Set(roles.map((r) => pageKey(r.id))), (id) => {
    const r = roleById.get(id);
    if (!r) return null;
    return {
      subject: { kind: "role", ourId: r.id, via: null, name: r.name, circleId: r.circleId, circleName: (r.circleId && circleById.get(r.circleId)?.name) || null },
      ours: r.active ? "live" : "gone",
      holders: r.holders,
    };
  });

  // A new circle counts the new roles that sit in it.
  for (const d of drafts) {
    if (d.kind !== "circleAdd" || d.subject.ourId !== null || d.subject.pageId === null) continue;
    const key = `sera:${pageKey(d.subject.pageId)}`;
    d.params = { roles: drafts.filter((x) => x.kind === "roleAdd" && x.subject.ourId === null && x.subject.circleId === key).length };
  }

  const subjectKey = (d: Draft) => d.subject.pageId ?? `here:${d.subject.ourId}`;
  return drafts
    .sort(
      (a, b) =>
        (a.subject.kind === "circle" ? 0 : 1) - (b.subject.kind === "circle" ? 0 : 1) ||
        fold(a.subject.name).localeCompare(fold(b.subject.name)) ||
        subjectKey(a).localeCompare(subjectKey(b)) ||
        SLOT_RANK(a.slot) - SLOT_RANK(b.slot) ||
        a.slot.localeCompare(b.slot),
    )
    .map((d) => finish(d, table));
}

// ── The count (R25) ─────────────────────────────────────────────────────────

export interface DifferenceCount {
  /** What waits for a person: toDecide and the small changes. Never facts, never ours ahead (review C8). */
  total: number;
  /** Of the total, what a person decides: every decision and every conflict (shared/seraWaiting.ts). The headline's number. */
  toDecide: number;
  /** Of the total, the small changes, which wait only while automatic apply is off. */
  small: number;
  /** The service's facts that changed since yesterday. They wait for nobody, so they are never in the total. */
  facts: number;
  lanes: Record<Lane, number>;
  conflicts: number;
  /** Of the total, how many SHOW a reason to check first (shownFlags), the chip's own number. */
  checkFirst: number;
  /** Things changed here that the service still has the old way. */
  oursAhead: number;
}

/** Totals only: no subject, no name, no value. */
export function countDifferences(list: readonly Difference[]): DifferenceCount {
  const out: DifferenceCount = { total: 0, toDecide: 0, small: 0, facts: 0, lanes: { facts: 0, lowRisk: 0, decision: 0 }, conflicts: 0, checkFirst: 0, oursAhead: 0 };
  for (const d of list) {
    const kind = waitingKind(d);
    if (kind === "oursAhead") {
      out.oursAhead += 1;
      continue;
    }
    out.lanes[d.lane] += 1;
    if (d.state === "conflict") out.conflicts += 1;
    if (kind === "facts") {
      out.facts += 1;
      continue;
    }
    // What waits for a person, by the one rule (review C8).
    out.total += 1;
    if (kind === "toDecide") out.toDecide += 1;
    else out.small += 1;
    if (shownFlags(d).length > 0) out.checkFirst += 1;
  }
  return out;
}

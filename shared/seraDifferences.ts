/**
 * THE WAYS THE OUTSIDE SERVICE'S CHART AND THE LIVE CHART HERE DIFFER, NOW.
 *
 * The structure review used to be a pile of batches, each one the service's
 * whole chart as it stood on the day it arrived. This replaces the pile with one
 * computed list: the newest stored snapshot of what the service holds
 * (`saberra_snapshots`, written by server/lib/saberraSnapshot.ts) against the
 * live chart, three ways against what this village last PUBLISHED from the
 * service. Something the service added and then removed between two reads never
 * appears, because neither the snapshot nor the chart holds it.
 *
 * The rules are the sera-sync spec's section 8, and each is a test in
 * shared/seraDifferences.test.ts. In short:
 *
 * - R1. A role matches by the role id its page id made (`seatIdFor`), then by
 *   name the way `planStructure` matches; a circle by name or alias. A stored
 *   link (the next slice's table) wins over both when it is handed in, and the
 *   key is the page id either way, so switching to the link changes no key. A
 *   role two records name is never matched.
 * - R2. The base is what this village published from the service. With none,
 *   the base is "unknown": flagged, never applied by itself, never bulk-taken,
 *   and never a reason to retire anything. Something we hold with no record
 *   there and no history is OURS. Something we retired that the service keeps
 *   is "ours ahead", never a difference to act on.
 * - R3. A field the service did not send makes no difference, and clearing a
 *   value is never a change to apply.
 * - R4. Removed means the service's own Archived, or missing from two whole
 *   reads in a row.
 * - R6. One normaliser, and a hash of each side. Clipped text is never compared.
 * - R7. One record per page id, and a move compares the SET of circles.
 * - R12. One difference is one field, or one add or rest. Never a holder, never
 *   a power.
 * - R21. Every kind has a lane, and the Decision floor cannot be moved.
 *
 * Pure: no pool, no clock. The words for each difference are in
 * shared/seraDifferenceWords.ts.
 */
import { canonicalJson } from "./canonicalJson";
import { circlesNamed } from "./proposedSeats";
import { readSourcePay, seatIdFor, seatNameKey, sourceStatusOf } from "./structurePlan";

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
  /** Fields whose prose named a member here, stored with the name swapped out (R9). */
  namesAMember?: string[];
  /** Fields too long to keep whole. They are stored clipped and never compared (R6). */
  clipped?: string[];
  /** The page id arrived more than once in this read; the first copy is kept (R7). */
  duplicate?: boolean;
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
}

/** One change of a draft this village published from the service, oldest first. */
export interface AcceptedChange {
  op: string;
  orgRoleId: string;
  payload: Record<string, unknown> | null;
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

/** What this village last published from the service for the field, or "unknown" when it never did. */
export type DifferenceBase = "unknown" | { value: string | null };

export type MatchVia = "link" | "pageId" | "name" | "alias";

/** A reason to look before acting, as a key and its parameters. The words are in seraDifferenceWords.ts. */
export type FlagKey =
  | "baseUnknown"
  | "firstSight"
  | "matchedByName"
  | "matchedTwice"
  | "sameNameAsLive"
  | "circleNotHere"
  | "circleUnknown"
  | "duplicatePageId"
  | "namesAMember"
  | "heldHere";

export interface DifferenceFlag {
  key: FlagKey;
  params?: Readonly<Record<string, string | number>>;
}

export interface DifferenceSubject {
  kind: "circle" | "role";
  /** The service's page id, or null for something here the newest reads no longer hold. */
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
  /** Stable across reads: the subject's page id and the field, never a name. */
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
  base: DifferenceBase;
  seraHash: string;
  oursHash: string;
  flags: DifferenceFlag[];
  namesAMember: boolean;
  /** May apply by itself once a holder turns its lane on: never a decision, never flagged, never a conflict. */
  autoEligible: boolean;
  /** May be taken in bulk: never flagged, never ours-ahead. */
  bulkEligible: boolean;
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
const PROSE_FACTS = new Set<string>(["Notes"]);

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

// ── Reading a stored record ─────────────────────────────────────────────────

/** A page id with its dashes gone and lowercased, so two spellings of one id meet. */
export const pageKey = (id: string): string => id.trim().toLowerCase().replace(/-/g, "");

/** A field as text, or null when absent, blank, a relation, or clipped (R3, R6). */
function textOf(rec: SnapshotRecord, field: string): string | null {
  if (rec.clipped?.includes(field)) return null;
  const v = rec.fields[field];
  return Array.isArray(v) ? null : normaliseText(v);
}

const isArchived = (rec: SnapshotRecord): boolean => sourceStatusOf(textOf(rec, F.status)) === "archived";

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
  const dashed = /^[0-9a-f]{32}$/.test(bare)
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
  /** Every id here any record pointed at, matched or not, so "missing" never mistakes a collision for an absence. */
  claimed: Set<string>;
}

function emptyMatching(): Matching {
  return { byPage: new Map(), twice: new Set(), sameName: new Map(), claimed: new Set() };
}

/** Settle tentative name claims: one claim matches, two or more match nothing. */
function settle(out: Matching, tentative: Map<string, Array<{ pk: string; via: MatchVia }>>): void {
  for (const [ourId, claims] of Array.from(tentative.entries())) {
    if (claims.length > 1) for (const c of claims) out.twice.add(c.pk);
    else out.byPage.set(claims[0].pk, { ourId, via: claims[0].via });
  }
  for (const m of Array.from(out.byPage.values())) out.claimed.add(m.ourId);
}

function matchRoles(records: readonly SnapshotRecord[], roles: readonly LiveRoleIn[], links?: Readonly<Record<string, string>>): Matching {
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
  const taken = new Set(Array.from(out.byPage.values()).map((m) => m.ourId));
  const tentative = new Map<string, Array<{ pk: string; via: MatchVia }>>();
  for (const rec of records) {
    const pk = pageKey(rec.id);
    if (out.byPage.has(pk)) continue;
    const name = textOf(rec, F.roleName);
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

function matchCircles(records: readonly SnapshotRecord[], circles: readonly LiveCircleIn[], links?: Readonly<Record<string, string>>): Matching {
  const out = emptyMatching();
  const byId = new Map(circles.map((c) => [c.id, c]));
  for (const rec of records) {
    const linked = linkFor(links, rec.id);
    if (linked && byId.has(linked)) out.byPage.set(pageKey(rec.id), { ourId: linked, via: "link" });
  }
  const taken = new Set(Array.from(out.byPage.values()).map((m) => m.ourId));
  const tentative = new Map<string, Array<{ pk: string; via: MatchVia }>>();
  for (const rec of records) {
    const pk = pageKey(rec.id);
    if (out.byPage.has(pk)) continue;
    const name = textOf(rec, F.circleName);
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

// ── The base (R2) ───────────────────────────────────────────────────────────

type Presence = "live" | "gone";

interface Base {
  name?: string | null;
  circleId?: string | null;
  aim?: string | null;
  presence?: Presence;
}

const has = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** What each role and circle here last took from the service, folded from its published changes in order. */
function basesFrom(accepted: readonly AcceptedChange[]): { roles: Map<string, Base>; circles: Map<string, Base> } {
  const roles = new Map<string, Base>();
  const circles = new Map<string, Base>();
  for (const c of accepted) {
    if (!c || typeof c.orgRoleId !== "string") continue;
    const p = c.payload && typeof c.payload === "object" ? c.payload : {};
    if (c.op === "create_seat" || c.op === "update_seat" || c.op === "rest_seat") {
      const b = roles.get(c.orgRoleId) ?? {};
      if (c.op === "create_seat") {
        b.name = strOrNull(p.name);
        b.circleId = strOrNull(p.circleId);
        b.aim = strOrNull(p.aim);
        b.presence = "live";
      } else if (c.op === "update_seat") {
        for (const k of ["name", "circleId", "aim"] as const) if (has(p, k)) b[k] = strOrNull(p[k]);
        b.presence = b.presence ?? "live";
      } else {
        b.presence = "gone";
      }
      roles.set(c.orgRoleId, b);
    } else if (c.op === "create_circle" || c.op === "update_circle" || c.op === "rest_circle" || c.op === "move_circle") {
      const id = c.orgRoleId.startsWith("circle:") ? c.orgRoleId.slice("circle:".length) : c.orgRoleId;
      const b = circles.get(id) ?? {};
      if (c.op === "create_circle") {
        b.name = strOrNull(p.name);
        b.presence = "live";
      } else if (c.op === "rest_circle") {
        b.presence = "gone";
      } else {
        if (has(p, "name")) b.name = strOrNull(p.name);
        b.presence = b.presence ?? "live";
      }
      circles.set(id, b);
    }
  }
  return { roles, circles };
}

const baseOf = (v: string | null | undefined): DifferenceBase => (v === undefined ? "unknown" : { value: normaliseText(v) });

// ── The three ways ──────────────────────────────────────────────────────────

/** A field's state, or null when there is nothing to say (absent at the service, or both the same). */
function threeWay(sera: string | null, ours: string | null, base: DifferenceBase): DifferenceState | null {
  if (sera === null || sera === ours) return null;
  if (base === "unknown" || base.value === ours) return "suggestion";
  return base.value === sera ? "oursAhead" : "conflict";
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
  if (base === "unknown") return "suggestion";
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
      if (isArchived(c)) continue;
      const m = chart.circleMatch.byPage.get(pageKey(c.id));
      const ours = m ? chart.circleById.get(m.ourId) : undefined;
      const name = textOf(c, F.circleName) ?? "";
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
function payOf(rec: SnapshotRecord): { key: string; params: Record<string, string | number | null> } | null {
  const model = textOf(rec, F.payModel);
  const status = textOf(rec, F.payStatus);
  const terms = textOf(rec, F.payTerms);
  const rawTarget = rec.fields[F.payTarget];
  const target = typeof rawTarget === "number" && Number.isFinite(rawTarget) ? rawTarget : textOf(rec, F.payTarget);
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
  base: DifferenceBase;
  flags: DifferenceFlag[];
  rec: SnapshotRecord | null;
  params?: Record<string, string | number | string[] | null>;
}

const FLAG_ORDER: readonly FlagKey[] = [
  "baseUnknown",
  "firstSight",
  "matchedByName",
  "matchedTwice",
  "sameNameAsLive",
  "circleNotHere",
  "circleUnknown",
  "duplicatePageId",
  "namesAMember",
  "heldHere",
];

function finish(d: Draft, table: LaneTable): Difference {
  const lane = laneFor(d.kind, d.field, table);
  const flags = FLAG_ORDER.flatMap((k) => d.flags.filter((f) => f.key === k).slice(0, 1));
  const flagged = flags.length > 0;
  const pk = d.subject.pageId !== null ? pageKey(d.subject.pageId) : `here:${d.subject.ourId ?? ""}`;
  return {
    key: `${d.subject.kind}:${pk}:${d.slot}`,
    kind: d.kind,
    lane,
    state: d.state,
    subject: d.subject,
    field: d.field,
    sera: d.sera,
    ours: d.ours,
    base: d.base,
    seraHash: valueHash(d.sera),
    oursHash: valueHash(d.ours),
    flags,
    namesAMember: flags.some((f) => f.key === "namesAMember"),
    autoEligible: lane !== "decision" && d.state === "suggestion" && !flagged,
    bulkEligible: d.state !== "oursAhead" && !flagged,
    source: { pageId: d.subject.pageId, editedAt: d.rec?.editedAt ?? null },
    ...(d.params ? { params: d.params } : {}),
  };
}

const flag = (key: FlagKey, params?: Record<string, string | number>): DifferenceFlag => (params ? { key, params } : { key });

function recordFlags(rec: SnapshotRecord, uses: readonly string[]): DifferenceFlag[] {
  const out: DifferenceFlag[] = [];
  if (rec.duplicate) out.push(flag("duplicatePageId"));
  if (uses.some((f) => rec.namesAMember?.includes(f))) out.push(flag("namesAMember"));
  return out;
}

const SLOT_RANK = (slot: string): number =>
  slot === "presence" ? 0 : slot === "name" ? 1 : slot === "circle" ? 2 : slot === "aim" ? 3 : slot === "pay" ? 4 : 5;

/** The newest two reads of a kind that were whole and held something (R4, R5). */
function wholeReads(snapshots: readonly Snapshot[], kind: "circles" | "roles"): SnapshotKind[] {
  return snapshots.map((s) => s?.[kind]).filter((k): k is SnapshotKind => !!k && k.read === "whole" && k.records.length > 0).slice(0, 2);
}

// ── The function ────────────────────────────────────────────────────────────

/** Every way the newest snapshot and the live chart differ, three ways against what this village published. */
export function differences(input: DifferencesInput): Difference[] {
  const latest = input.snapshots[0];
  if (!latest) return [];
  const previous = input.snapshots[1] ?? null;
  const table = input.lanes ?? {};
  const links = input.links ?? {};
  const bases = basesFrom(input.accepted ?? []);
  const liveCircles = input.live.circles.filter((c) => !c.isExample);
  const liveRoles = input.live.roles.filter((r) => !r.isExample);
  const circleById = new Map(liveCircles.map((c) => [c.id, c]));
  const roleById = new Map(liveRoles.map((r) => [r.id, r]));

  const circles = dedupe(latest.circles?.records ?? []);
  const roles = dedupe(latest.roles?.records ?? []);
  const circleMatch = matchCircles(circles, liveCircles, links.circles);
  const roleMatch = matchRoles(roles, liveRoles, links.roles);
  const chart: Chart = { circleById, liveCircles, seraCircles: new Map(circles.map((c) => [pageKey(c.id), c])), circleMatch };
  const before = {
    circles: new Map((previous ? dedupe(previous.circles?.records ?? []) : []).map((r) => [pageKey(r.id), r])),
    roles: new Map((previous ? dedupe(previous.roles?.records ?? []) : []).map((r) => [pageKey(r.id), r])),
  };
  const drafts: Draft[] = [];

  /** The facts a matched subject carries, against the read before (the digest the facts store keeps). */
  const facts = (rec: SnapshotRecord, prior: SnapshotRecord | undefined, fields: readonly string[], subject: DifferenceSubject, extra: DifferenceFlag[]) => {
    if (!prior) return;
    for (const field of fields) {
      const sera = textOf(rec, field);
      const was = textOf(prior, field);
      if (sera === null || sera === was) continue;
      drafts.push({
        kind: PROSE_FACTS.has(field) ? "textField" : "valueField",
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

  // ── Circles ──
  for (const rec of circles) {
    const pk = pageKey(rec.id);
    const name = textOf(rec, F.circleName);
    if (!name) continue;
    const archived = isArchived(rec);
    const m = circleMatch.byPage.get(pk);
    if (!m) {
      if (archived) continue;
      const flags = [flag("baseUnknown")];
      if (!before.circles.has(pk)) flags.push(flag("firstSight"));
      if (circleMatch.twice.has(pk)) flags.push(flag("matchedTwice", { of: "circle" }));
      const same = circleMatch.sameName.get(pk);
      if (same) flags.push(flag("sameNameAsLive", { name: same, of: "circle" }));
      drafts.push({
        kind: "circleAdd", state: "suggestion", field: null, slot: "presence", sera: name, ours: null, base: "unknown",
        subject: { kind: "circle", pageId: rec.id, ourId: null, via: null, name, circleId: null, circleName: null },
        flags: [...flags, ...recordFlags(rec, [])], rec, params: { roles: 0 },
      });
      continue;
    }
    const live = circleById.get(m.ourId)!;
    const base = bases.circles.get(live.id);
    const subject: DifferenceSubject = { kind: "circle", pageId: rec.id, ourId: live.id, via: m.via, name: live.name, circleId: null, circleName: null };
    const matchFlags = m.via === "name" || m.via === "alias" ? [flag("matchedByName")] : [];
    const ours: Presence = live.status === "dormant" ? "gone" : "live";
    const state = presenceState(archived ? "gone" : "live", ours, base?.presence);
    if (state) {
      drafts.push({
        kind: ours === "gone" ? "circleAdd" : "circleRest", state, subject, field: null, slot: "presence",
        sera: archived ? "gone" : "live", ours, base: base?.presence ? { value: base.presence } : "unknown",
        flags: [...(base?.presence ? [] : [flag("baseUnknown")]), ...matchFlags, ...recordFlags(rec, [])], rec,
        params: { reason: "archived" },
      });
    }
    if (archived || ours === "gone") continue;
    const nameBase = baseOf(base?.name);
    const renamed = m.via === "link" ? threeWay(name, normaliseText(live.name), nameBase) : null;
    if (renamed) {
      drafts.push({
        kind: "rename", state: renamed, subject, field: "name", slot: "name", sera: name, ours: normaliseText(live.name), base: nameBase,
        flags: [...(nameBase === "unknown" ? [flag("baseUnknown")] : []), ...recordFlags(rec, [])], rec,
      });
    }
    facts(rec, before.circles.get(pk), CIRCLE_FACT_FIELDS, subject, matchFlags);
  }

  // ── Roles ──
  for (const rec of roles) {
    const pk = pageKey(rec.id);
    const name = textOf(rec, F.roleName);
    if (!name) continue;
    const archived = isArchived(rec);
    const m = roleMatch.byPage.get(pk);
    const placed = placementOf(rec, chart);
    if (!m) {
      if (archived) continue;
      const at = placed.refs.find((r) => r.here) ?? placed.refs[0] ?? null;
      const flags = [flag("baseUnknown")];
      if (!before.roles.has(pk)) flags.push(flag("firstSight"));
      if (roleMatch.twice.has(pk)) flags.push(flag("matchedTwice", { of: "role" }));
      const same = roleMatch.sameName.get(pk);
      if (same) flags.push(flag("sameNameAsLive", { name: same, of: "role" }));
      if (at && !placed.refs.some((r) => r.here)) flags.push(flag("circleNotHere", { circle: at.name }));
      if (placed.present && placed.refs.length === 0) flags.push(flag("circleUnknown"));
      drafts.push({
        kind: "roleAdd", state: "suggestion", field: null, slot: "presence", sera: name, ours: null, base: "unknown",
        subject: { kind: "role", pageId: rec.id, ourId: null, via: null, name, circleId: at?.key ?? null, circleName: at?.name ?? null },
        flags: [...flags, ...recordFlags(rec, [F.body])], rec,
        // What the new role is for, so whoever decides reads more than a job title.
        params: { aim: textOf(rec, F.body) },
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
    const matchFlags = m.via === "name" ? [flag("matchedByName")] : [];
    const ours: Presence = live.active ? "live" : "gone";
    const state = presenceState(archived ? "gone" : "live", ours, base?.presence);
    if (state) {
      drafts.push({
        kind: ours === "gone" ? "roleAdd" : "roleRest", state, subject, field: null, slot: "presence",
        sera: archived ? "gone" : "live", ours, base: base?.presence ? { value: base.presence } : "unknown",
        flags: [
          ...(base?.presence ? [] : [flag("baseUnknown")]),
          ...matchFlags,
          ...recordFlags(rec, []),
          ...(ours === "live" && live.holders > 0 ? [flag("heldHere", { holders: live.holders })] : []),
        ],
        rec, params: { reason: "archived" },
      });
    }
    if (archived || ours === "gone") continue;

    const field = (
      kind: DifferenceKind, slot: string, fieldName: string, sera: string | null, oursValue: string | null,
      base: DifferenceBase, state: DifferenceState | null, uses: string[], params?: Draft["params"],
    ) => {
      if (!state) return;
      drafts.push({
        kind, state, subject, field: fieldName, slot, sera, ours: oursValue, base,
        flags: [...(base === "unknown" ? [flag("baseUnknown")] : []), ...matchFlags, ...recordFlags(rec, uses)],
        rec, ...(params ? { params } : {}),
      });
    };

    const nameBase = baseOf(base?.name);
    const ourName = normaliseText(live.name);
    field("rename", "name", "name", name, ourName, nameBase, threeWay(name, ourName, nameBase), []);

    const keys = placed.refs.map((r) => r.key).sort();
    const circleBase: DifferenceBase = base?.circleId === undefined ? "unknown" : { value: base.circleId };
    field("roleMove", "circle", "circle", keys.join("|") || null, live.circleId, circleBase, moveState(keys, live.circleId, circleBase), [], {
      from: sitsIn?.name ?? null,
      to: placed.refs.map((r) => r.name),
    });

    const aim = textOf(rec, F.body);
    const aimBase = baseOf(base?.aim);
    const ourAim = normaliseText(live.aim);
    field("textField", "aim", "aim", aim, ourAim, aimBase, threeWay(aim, ourAim, aimBase), [F.body]);

    const pay = payOf(rec);
    if (pay) {
      const prior = before.roles.get(pk);
      const was = prior ? payOf(prior)?.key ?? null : undefined;
      const payBase: DifferenceBase = was === undefined ? "unknown" : { value: was };
      const payState: DifferenceState | null = !live.paySet ? "suggestion" : was !== undefined && was !== pay.key ? "conflict" : null;
      field("pay", "pay", "pay", pay.key, live.paySet ? "set" : "none", payBase, payState, [F.payTerms], pay.params);
    }

    facts(rec, before.roles.get(pk), ROLE_FACT_FIELDS, subject, matchFlags);
  }

  // ── Missing from two whole reads (R4) ──
  const missing = (
    kind: "circles" | "roles",
    baseMap: Map<string, Base>,
    latestClaimed: Set<string>,
    matchAll: (records: readonly SnapshotRecord[]) => Matching,
    describe: (ourId: string) => { subject: Omit<DifferenceSubject, "pageId">; ours: Presence; holders: number } | null,
  ) => {
    const reads = wholeReads(input.snapshots, kind);
    if (reads.length < 2) return;
    const claimedIn = reads.map((k) => matchAll(dedupe(k.records)).claimed);
    // Each snapshot matched once, and only when a missing subject asks for its page id.
    const matched: Array<{ recs: SnapshotRecord[]; m: Matching } | undefined> = [];
    const matchedAt = (i: number) => {
      if (!matched[i]) {
        const recs = dedupe(input.snapshots[i]?.[kind]?.records ?? []);
        matched[i] = { recs, m: matchAll(recs) };
      }
      return matched[i]!;
    };
    for (const [ourId, base] of Array.from(baseMap.entries())) {
      if (latestClaimed.has(ourId) || claimedIn.some((s) => s.has(ourId))) continue;
      const here = describe(ourId);
      if (!here) continue;
      const state = presenceState("gone", here.ours, base.presence);
      if (!state) continue;
      // The page id it last answered to, from the newest snapshot that held it.
      let pageId: string | null = null;
      for (let i = 0; i < input.snapshots.length && pageId === null; i += 1) {
        const { recs, m } = matchedAt(i);
        const hit = Array.from(m.byPage.entries()).find(([, mm]) => mm.ourId === ourId);
        if (hit) pageId = recs.find((r) => pageKey(r.id) === hit[0])?.id ?? null;
      }
      drafts.push({
        kind: kind === "circles" ? "circleRest" : "roleRest", state, field: null, slot: "presence",
        subject: { ...here.subject, pageId }, sera: "gone", ours: here.ours, base: { value: base.presence ?? null },
        flags: here.holders > 0 ? [flag("heldHere", { holders: here.holders })] : [], rec: null,
        params: { reason: "missingTwice" },
      });
    }
  };
  missing("circles", bases.circles, circleMatch.claimed, (r) => matchCircles(r, liveCircles, links.circles), (id) => {
    const c = circleById.get(id);
    if (!c) return null;
    return {
      subject: { kind: "circle", ourId: c.id, via: null, name: c.name, circleId: null, circleName: null },
      ours: c.status === "dormant" ? "gone" : "live",
      holders: 0,
    };
  });
  missing("roles", bases.roles, roleMatch.claimed, (r) => matchRoles(r, liveRoles, links.roles), (id) => {
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
  /** Differences that wait for somebody, ours-ahead left out. */
  total: number;
  lanes: Record<Lane, number>;
  conflicts: number;
  /** Of the total, how many carry a reason to check first. */
  checkFirst: number;
  /** Things changed here that the service still has the old way. */
  oursAhead: number;
}

/** Totals only: no subject, no name, no value. */
export function countDifferences(list: readonly Difference[]): DifferenceCount {
  const out: DifferenceCount = { total: 0, lanes: { facts: 0, lowRisk: 0, decision: 0 }, conflicts: 0, checkFirst: 0, oursAhead: 0 };
  for (const d of list) {
    if (d.state === "oursAhead") {
      out.oursAhead += 1;
      continue;
    }
    out.total += 1;
    out.lanes[d.lane] += 1;
    if (d.state === "conflict") out.conflicts += 1;
    if (d.flags.length > 0) out.checkFirst += 1;
  }
  return out;
}

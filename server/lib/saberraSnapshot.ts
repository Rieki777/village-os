/**
 * THE SNAPSHOT A SYNC KEEPS: what the outside service holds about circles and
 * roles, read whole, after every read the sync makes (spec R5 to R11).
 *
 * The review's list of differences (shared/seraDifferences.ts) is computed from
 * these rows and the live chart at read time. The proposal batches cannot serve
 * that: they are upserted and never forget a record the service dropped, which
 * is the stale-record defect #687 fixed.
 *
 * ── WHAT A ROW HOLDS ─────────────────────────────────────────────────────
 *
 * Circles and roles only (R8): tensions, risks and role assignments are never
 * kept here. Each record is:
 *
 * - the page id (R10). Never the page address, which carries the page title;
 *   "Open in" is built from the module's dashboard address and the id;
 * - the fields `readVendorRecord` lets cross, read into plain values (text, a
 *   number, or a relation's pointers), so the pure function in shared/ needs
 *   no vendor shapes;
 * - prose with members' full names, "@handles" and addresses swapped out (R9,
 *   the narrow match in server/lib/saberraNames.ts), named in `swapped`;
 * - every field whose text the WIDE match says may name a member, names
 *   included, named in `namesAMember`: a flag, never a rewrite, so the
 *   difference says "check this one" and its value cannot be taken as it is;
 * - the last-edited time, only through `editedAtOf` (R11). Never who edited.
 *
 * Text longer than `TEXT_KEEP` code points is clipped, on a code point, and
 * named in `clipped`, and the differences never compare a clipped field (R6).
 * Cutting a UTF-16 string mid-pair would leave half a character, which the
 * JSON column refuses.
 *
 * ── CARRY FORWARD (R5) ───────────────────────────────────────────────────
 *
 * A kind that was not asked for, failed, was cut short at the page ceiling, or
 * came back empty keeps the previous snapshot's records for that kind, and the
 * row says which of the four it was. So a failed read never makes a record look
 * removed, the same rule `withdrawGone` keeps for the queue.
 *
 * ── ONE PAGE ID, ONCE (R7) ───────────────────────────────────────────────
 *
 * A page id that arrives twice (a page boundary that overlapped, or the same id
 * with and without its dashes) is kept once, the first copy, marked
 * `duplicate`, and its differences are flagged.
 *
 * ── WHAT EACH RECORD WAS MATCHED TO (review C2) ───────────────────────────
 *
 * Each record is kept with its match as it is made at this read (our id, and
 * how), and the value both sides last held for its name, a role's description
 * and a role's circle, carried from the read before where they differ now. So
 * the list never re-matches an older read against a chart renamed since: a
 * rename here is ours ahead, and the service's change after both agreed is a
 * suggestion against the value they agreed on. Our ids are not personal data.
 * A row kept before this has no match, and is read the old way.
 *
 * Every read writes one row, under the sync's lock, and the newest
 * `SNAPSHOT_KEEP` are kept.
 */
import type { Pool } from "mysql2/promise";
import type { SyncTrigger } from "../../shared/saberraSyncLog";
import { canonicalJson } from "../../shared/canonicalJson";
import {
  stampMatches,
  traceAccepted,
  valueHash,
  type AcceptedChange,
  type DifferencesInput,
  type Snapshot,
  type SnapshotKind,
  type SnapshotRead,
  type SnapshotRecord,
  type SnapshotRef,
  type SnapshotValue,
} from "../../shared/seraDifferences";
import { dedupeKeyFor } from "./externalProposals";
import { nameCheckFor, type NameCheck } from "./saberraNames";
import type { VendorRecord } from "./saberraProposals";
import { readVendorRecord, type SaberraRecordKind } from "./saberraRecords";
import { idShapeOk, labelOf, normaliseId, pageIdOf, plainText, relationRefs } from "./saberraRelations";
import { listOrgRoles } from "./orgChart";
import { liveChart } from "./structureReview";
import { rosterRows } from "../repos/peopleRoster";
import { insertSnapshot, pruneCarriedOlderThan, pruneSnapshots, pruneSnapshotsOlderThan, recentSnapshots } from "../repos/saberraSnapshots";
import { acceptedProposalsFor, circlesForDifferences, publishedFromModule, rolesWithPaySet } from "../repos/seraDifferences";

/** How many reads are kept. R4 needs two whole ones; the rest are history. */
export const SNAPSHOT_KEEP = 30;
/**
 * The oldest a stored read may be, in days. Reads rotate by count only while
 * syncs run; this ages them out when nothing is syncing, so a name stored as
 * sent cannot outlive the member it named. The newest goes too: with nothing
 * left, the page says nothing has been read yet.
 */
export const SNAPSHOT_MAX_AGE_DAYS = 60;

const MAX_AGE_MS = SNAPSHOT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Delete every stored read older than the age, the newest included, and every
 * carried kind whose own whole read is older than that, from the rows that
 * carry it (review N1): a row taken yesterday carrying a read from 61 days ago
 * holds that read no longer. Says how many reads went.
 */
export async function pruneByAge(pool: Pool, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MAX_AGE_MS);
  return (await pruneSnapshotsOlderThan(pool, cutoff)) + (await pruneCarriedOlderThan(pool, cutoff));
}

/** The longest text kept whole, in code points. Anything longer is clipped, named, and never compared. */
export const TEXT_KEEP = 20_000;

/** Text cut to `max` code points, never between the two halves of one. */
export function clipCodePoints(v: string, max: number): { text: string; clipped: boolean } {
  if (v.length <= max) return { text: v, clipped: false };
  const points = Array.from(v);
  return points.length <= max ? { text: v, clipped: false } : { text: points.slice(0, max).join(""), clipped: true };
}

/** A role's or a circle's name: checked for a member's name, never rewritten (R9). */
const NAME_FIELDS = new Set(["Role Name", "Circle Name"]);

const KINDS: ReadonlyArray<{ kind: SaberraRecordKind; key: "circles" | "roles" }> = [
  { kind: "circle", key: "circles" },
  { kind: "role", key: "roles" },
];

/** A field that points at other records. Kept as pointers, resolved against the snapshot later (R5). */
const RELATION_FIELDS = new Set(["Circle"]);

/** What one read was, in our kinds: which were asked, which failed, which were cut short. */
export interface ReadForSnapshot {
  asked: readonly string[];
  failed: readonly string[];
  truncated: readonly string[];
  records: readonly VendorRecord[];
}

/** A date property as its start: `{ start }` or `{ date: { start } }`. */
function dateText(v: unknown, depth = 0): string | null {
  if (depth > 2 || !v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.start === "string" && o.start.trim() !== "") return o.start.trim();
  return dateText(o.date, depth + 1);
}

/** A multi-select as its labels, joined, when every item is one. */
function labelsOf(v: unknown): string | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const parts = v.map((x) => labelOf(x));
  return parts.every((p): p is string => typeof p === "string") ? parts.join(", ") : null;
}

/** One field as a plain value, or null when it carries nothing this snapshot can keep (R3: absent). */
function plainValue(field: string, v: unknown): SnapshotValue | null {
  if (RELATION_FIELDS.has(field)) {
    const refs: SnapshotRef[] = relationRefs(v)
      .map((r) => ({ ...(r.id ? { id: normaliseId(r.id) } : {}), ...(r.name ? { name: r.name } : {}) }))
      .filter((r) => r.id !== undefined || r.name !== undefined);
    return refs.length ? refs : null;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as Record<string, unknown>).number === "number") {
    const n = (v as Record<string, unknown>).number as number;
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return plainText(v) ?? labelOf(v) ?? dateText(v) ?? labelsOf(v);
}

/** One record through the boundary, into the snapshot's shape. */
export function snapshotRecord(kind: SaberraRecordKind, rec: VendorRecord, check: NameCheck): SnapshotRecord {
  const read = readVendorRecord(kind, rec.fields);
  const fields: Record<string, SnapshotValue> = {};
  const named: string[] = [];
  const swapped: string[] = [];
  const clipped: string[] = [];
  for (const [field, raw] of Object.entries(read.fields)) {
    let v = plainValue(field, raw);
    if (v === null) continue;
    if (typeof v === "string") {
      // The wide match flags EVERY text field, names included. The narrow one rewrites every
      // text field but a role's or a circle's name, which is compared with our own names (R9).
      if (check.names(v)) named.push(field);
      if (!NAME_FIELDS.has(field)) {
        const out = check.swap(v);
        if (out !== v) {
          v = out;
          swapped.push(field);
          if (!named.includes(field)) named.push(field);
        }
      }
      const cut = clipCodePoints(v, TEXT_KEEP);
      if (cut.clipped) {
        v = cut.text;
        clipped.push(field);
      }
    }
    fields[field] = v;
  }
  // The page id alone, never a title cut with it (review #5).
  const out: SnapshotRecord = { id: pageIdOf(rec.id), fields };
  if (rec.editedAt) out.editedAt = rec.editedAt;
  if (named.length) out.namesAMember = named.sort();
  if (swapped.length) out.swapped = swapped.sort();
  if (clipped.length) out.clipped = clipped.sort();
  return out;
}

/** One copy per page id, the first, marked when another arrived (R7). */
function dedupe(records: readonly SnapshotRecord[]): SnapshotRecord[] {
  const seen = new Map<string, SnapshotRecord>();
  for (const r of records) {
    const k = normaliseId(r.id);
    if (k === "") continue;
    const prior = seen.get(k);
    if (prior) seen.set(k, { ...prior, duplicate: true });
    else seen.set(k, r);
  }
  return Array.from(seen.values());
}

/** Whether a kind came out of this read whole, or why it did not (R5). */
function readOf(kind: string, read: ReadForSnapshot, records: readonly SnapshotRecord[]): SnapshotRead {
  if (!read.asked.includes(kind)) return "not-asked";
  if (read.failed.includes(kind)) return "failed";
  if (read.truncated.includes(kind)) return "cut-short";
  return records.length === 0 ? "empty" : "whole";
}

// ── What the matches are made from, and the list reads too ─────────────────

/*
 * The live chart and the traced history, gathered in one place for both of the
 * differences' readers: the matches each read is kept with (below) and the list
 * (server/lib/seraDifferencesRead.ts). One gatherer, so a read is kept with
 * matches made from exactly the chart and history the list reads (review C2).
 * Reads only.
 */

const MODULE_ID = "saberra";

/** The live chart as the differences read it: circles in chart order, and each role with whether pay is set here, never its figure. */
export async function liveForDifferences(pool: Pool): Promise<DifferencesInput["live"]> {
  const [circles, paid, roles] = await Promise.all([circlesForDifferences(pool), rolesWithPaySet(pool), listOrgRoles(pool)]);
  const live = await liveChart(pool, circles);
  // What pay is set here, as a hash and never the figure: a change here settles the service's pay (review K3).
  const payHash = new Map(
    roles.map((r) => [
      r.id,
      valueHash(
        canonicalJson({
          value: r.valueMinor ?? null,
          valueCurrency: r.valueCurrency ?? null,
          tokens: r.valueTokens ?? null,
          cash: r.cashMinor ?? null,
          cashCurrency: r.cashCurrency ?? null,
          terms: r.termsOffer ?? null,
        }),
      ),
    ]),
  );
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
      ...(paid.has(s.id) && payHash.has(s.id) ? { payHash: payHash.get(s.id) } : {}),
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

/** How many stored reads before this one its matches are made against. Each carries the matches of the ones before it. */
const MATCH_FROM = 5;

/**
 * The read with each record's match as it is made now (`stampMatches`), from
 * the same chart and history the list reads. A chart that cannot be read
 * leaves the row as rows were kept before matches were stored, which the list
 * reads the old way, and is said once by its error code.
 */
async function withMatches(pool: Pool, read: Snapshot, older: readonly Snapshot[], check: NameCheck): Promise<Snapshot> {
  try {
    const [live, accepted] = await Promise.all([liveForDifferences(pool), acceptedForDifferences(pool)]);
    return stampMatches({ snapshots: [read, ...older], live, accepted, swap: check.swap }) ?? read;
  } catch (e) {
    const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code: string }).code) : "unknown";
    console.warn(`[saberra] this read is kept without its matches (${code}); the list matches it against today's chart`);
    return read;
  }
}

/**
 * A kind not read whole keeps the read before's records (R5), each with when
 * it was last read whole, carried unchanged (review N1). A record whose whole
 * read is past the age is never carried: the kind then holds nothing, and the
 * page says it has no read. A row kept before this carried no time: its
 * source is the newest whole read of the kind among the rows read here, or
 * failing that the row itself, the most that can honestly be said of it.
 */
function carriedForward(previous: Snapshot | null, key: "circles" | "roles", older: readonly Snapshot[], at: Date): SnapshotRecord[] {
  if (!previous) return [];
  const prior = previous[key];
  const source = prior.read === "whole" ? previous.takenAt : (older.find((s) => s[key].read === "whole")?.takenAt ?? previous.takenAt);
  return prior.records
    .map((r) => ({ ...r, readAt: r.readAt ?? source }))
    .filter((r) => {
      const t = Date.parse(r.readAt);
      return Number.isFinite(t) && t >= at.getTime() - MAX_AGE_MS;
    });
}

/**
 * Keep one read: each kind whole, or carried from the snapshot before, each
 * record with its match as made now, then delete everything older than the
 * newest `SNAPSHOT_KEEP`. Says which row it wrote and how each kind came out.
 */
export async function writeSnapshot(
  pool: Pool,
  read: ReadForSnapshot,
  trigger: SyncTrigger,
  at: Date,
): Promise<{ seq: number; circles: SnapshotRead; roles: SnapshotRead }> {
  const check = nameCheckFor(await rosterRows(pool));
  const older = (await recentSnapshots(pool, MATCH_FROM)).map((r) => r.snapshot);
  const previous = older[0] ?? null;
  const kept: Record<"circles" | "roles", SnapshotKind> = { circles: { read: "empty", records: [] }, roles: { read: "empty", records: [] } };
  for (const { kind, key } of KINDS) {
    // An id is an id (R10): a record with an address for one is never kept.
    const fresh = dedupe(read.records.filter((r) => r.kind === kind && idShapeOk(r.id)).map((r) => snapshotRecord(kind, r, check)));
    const state = readOf(kind, read, fresh);
    kept[key] = state === "whole" ? { read: state, records: fresh } : { read: state, records: carriedForward(previous, key, older, at) };
  }
  const stamped = await withMatches(pool, { takenAt: at.toISOString(), trigger, circles: kept.circles, roles: kept.roles }, older, check);
  const seq = await insertSnapshot(pool, at, { trigger, circles: stamped.circles, roles: stamped.roles });
  await pruneSnapshots(pool, SNAPSHOT_KEEP);
  // By age too, on every read, so nothing outlives the age when the daily job does not run (review N6).
  await pruneByAge(pool, at);
  return { seq, circles: kept.circles.read, roles: kept.roles.read };
}

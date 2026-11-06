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
 * Every read writes one row, under the sync's lock, and the newest
 * `SNAPSHOT_KEEP` are kept.
 */
import type { Pool } from "mysql2/promise";
import type { SyncTrigger } from "../../shared/saberraSyncLog";
import type { SnapshotKind, SnapshotRead, SnapshotRecord, SnapshotRef, SnapshotValue } from "../../shared/seraDifferences";
import { nameCheckFor, type NameCheck } from "./saberraNames";
import type { VendorRecord } from "./saberraProposals";
import { readVendorRecord, type SaberraRecordKind } from "./saberraRecords";
import { labelOf, normaliseId, plainText, relationRefs } from "./saberraRelations";
import { rosterRows } from "../repos/peopleRoster";
import { insertSnapshot, pruneSnapshots, recentSnapshots } from "../repos/saberraSnapshots";

/** How many reads are kept. R4 needs two whole ones; the rest are history. */
export const SNAPSHOT_KEEP = 30;
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
/** Prose, where a member can be named in passing, so names are swapped out here (R9). */
const PROSE_FIELDS = new Set(["Body", "Notes", "Compensation Terms"]);

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
      // The wide match flags, over prose and names alike; only the narrow one rewrites, and only prose.
      if ((PROSE_FIELDS.has(field) || NAME_FIELDS.has(field)) && check.names(v)) named.push(field);
      if (PROSE_FIELDS.has(field)) {
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
  const out: SnapshotRecord = { id: rec.id.trim(), fields };
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

/**
 * Keep one read: each kind whole, or carried from the snapshot before, then
 * delete everything older than the newest `SNAPSHOT_KEEP`. Says which row it
 * wrote and how each kind came out.
 */
export async function writeSnapshot(
  pool: Pool,
  read: ReadForSnapshot,
  trigger: SyncTrigger,
  at: Date,
): Promise<{ seq: number; circles: SnapshotRead; roles: SnapshotRead }> {
  const check = nameCheckFor(await rosterRows(pool));
  const previous = (await recentSnapshots(pool, 1))[0]?.snapshot ?? null;
  const kept: Record<"circles" | "roles", SnapshotKind> = { circles: { read: "empty", records: [] }, roles: { read: "empty", records: [] } };
  for (const { kind, key } of KINDS) {
    const fresh = dedupe(read.records.filter((r) => r.kind === kind).map((r) => snapshotRecord(kind, r, check)));
    const state = readOf(kind, read, fresh);
    kept[key] = state === "whole" ? { read: state, records: fresh } : { read: state, records: previous?.[key].records ?? [] };
  }
  const seq = await insertSnapshot(pool, at, { trigger, circles: kept.circles, roles: kept.roles });
  await pruneSnapshots(pool, SNAPSHOT_KEEP);
  return { seq, circles: kept.circles.read, roles: kept.roles.read };
}

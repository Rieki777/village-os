/**
 * The arithmetic of Organisational Memory's schedule: when the next scheduled
 * sync falls due, how far a run of failures pushes it out, whether what a sync
 * read is the same as what last landed, and the run log's own shape.
 *
 * ── WHY A SCHEDULED SYNC FINGERPRINTS WHAT IT READ ───────────────────────
 *
 * Pressing Sync now again REPLACES what is still waiting (#468): a changed
 * claim supersedes the waiting one and an unchanged one is moved into the new
 * batch (`rebatchWaiting`), so the newest read is one batch a steward reviews
 * whole. That is right for a press, because the person pressing is the person
 * about to review. A schedule presses nobody's button. Run every six hours it
 * would keep moving a steward's open batch out from under them while they
 * worked through it, and nothing would have changed at the service.
 *
 * So a scheduled run lands only a REAL change. `fingerprintRead` hashes what
 * the read would land, after the boundary in `saberraRecords.ts` has dropped
 * every field this village does not take, sorted so the order the service
 * answered in is not a change. A field the boundary drops changing at the
 * service changes nothing here, which is correct: nothing this village would
 * propose changed either. A press keeps today's behaviour exactly, and its
 * read becomes the one later scheduled runs compare against.
 *
 * ── WHY THE GAP ONLY EVER GROWS ──────────────────────────────────────────
 *
 * The clock is the last run that called the service, by hand or on the
 * schedule, so a press pushes the next scheduled run out by a whole gap: the
 * queue was just made current, and a poll an hour later would read the same
 * thing. After consecutive failures the gap doubles, up to four times the
 * schedule, and never shrinks below it: a failing service is asked less
 * often, never more. Any run that reads the service whole resets it.
 *
 * Pure: no pool, no network. The caller hands in the log and the clock.
 */
import { createHash } from "crypto";
import type { SaberraPollSchedule } from "../../shared/modules";
import type {
  SyncCircleReading,
  SyncFailureWhy,
  SyncKind,
  SyncOutcome,
  SyncReason,
  SyncRun,
  SyncTrigger,
} from "../../shared/saberraSyncLog";
import type { HeldKind } from "./saberraKinds";
import type { VendorRecord } from "./saberraProposals";
import { readVendorRecord } from "./saberraRecords";

/**
 * The run log names kinds by this village's ids, and the browser cannot
 * import the server's list. These two lines fail to compile the day the two
 * sets differ, in either direction.
 */
const LOG_NAMES_EVERY_HELD_KIND: SyncKind = "circle" as HeldKind;
const EVERY_LOGGED_KIND_IS_HELD: HeldKind = "circle" as SyncKind;
void LOG_NAMES_EVERY_HELD_KIND;
void EVERY_LOGGED_KIND_IS_HELD;

/** Runs kept. The founder asked for a full report of each run, and twenty is a week of six-hourly ones. */
export const KEEP_RUNS = 20;

const HOUR = 60 * 60 * 1000;

/** The gap each schedule keeps between calls to the service. Off never calls it. */
export const POLL_EVERY_MS: Readonly<Record<SaberraPollSchedule, number | null>> = {
  off: null,
  daily: 24 * HOUR,
  "every-6-hours": 6 * HOUR,
};

/** The most a run of failures stretches the gap, as a multiple of the schedule's own. */
export const MAX_BACKOFF = 4;

/**
 * The one sentence each reason is shown with. A run stores this and never a
 * message from anywhere else, which is how a vendor's words and the key stay
 * out of the log by construction.
 */
export const RUN_SENTENCE: Readonly<Record<SyncReason, string>> = {
  "no-key": "Not run: no key is set for the service.",
  "key-unreadable": "Not run: a key is stored and this server cannot open it.",
  "cannot-store-keys": "Not run: this server cannot store a key yet.",
  "no-address": "Not run: no https service address is saved.",
  "no-session": "The service did not open a session. Its address or the key may be wrong.",
  "kind-failed": "Some kinds could not be read, so this scheduled sync sent nothing to the review queue.",
  partial: "Some kinds could not be read. What could be read went to the review queue.",
  error: "The sync stopped on an error in this village's server, and nothing after that point ran.",
};

/**
 * How many times the schedule's gap the next wait is, after `failures`
 * consecutive failed runs. One failure is often a blip and retries on the
 * schedule; from the second the gap doubles, up to `MAX_BACKOFF`.
 */
export function backoffFactor(failures: number): number {
  if (failures < 2) return 1;
  return Math.min(2 ** (failures - 1), MAX_BACKOFF);
}

/**
 * Consecutive failed runs at the head of the log (newest first). A run that
 * never called the service is passed over, and so is a press that landed only
 * part of a read: it did not fail, and it did not read the service whole,
 * which is the only thing that resets the backoff.
 */
export function failureStreak(runs: readonly SyncRun[]): number {
  let n = 0;
  for (const r of runs) {
    if (r.outcome === "not-run") continue;
    if (r.outcome === "landed" && r.reason === "partial") continue;
    if (r.outcome !== "failed") break;
    n += 1;
  }
  return n;
}

/**
 * When the next scheduled sync falls due, in epoch milliseconds. Null when the
 * schedule is off. Zero when nothing has called the service yet, which is due
 * at once.
 */
export function pollDueAt(schedule: SaberraPollSchedule, runs: readonly SyncRun[]): number | null {
  const every = POLL_EVERY_MS[schedule];
  if (every === null) return null;
  const last = runs.find((r) => r.outcome !== "not-run");
  if (!last) return 0;
  const at = Date.parse(last.at);
  if (!Number.isFinite(at)) return 0;
  return at + every * backoffFactor(failureStreak(runs));
}

/** True when the newest entry already says this, so a due schedule waiting on it records nothing more. */
export function alreadySaid(runs: readonly SyncRun[], reason: SyncReason): boolean {
  const newest = runs[0];
  return newest !== undefined && newest.outcome === "not-run" && newest.reason === reason;
}

/** The log with one run added at the head, the oldest dropped past `KEEP_RUNS`. */
export function appendRun(runs: readonly SyncRun[], run: SyncRun): SyncRun[] {
  return [run, ...runs].slice(0, KEEP_RUNS);
}

/** A JSON value with every object's keys sorted, so two equal reads serialise alike. */
function canonical(v: unknown, depth = 0): unknown {
  if (depth > 16) return null;
  if (Array.isArray(v)) return v.map((x) => canonical(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonical((v as Record<string, unknown>)[k], depth + 1);
    }
    return out;
  }
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v === undefined ? null : v;
}

/**
 * A stable hash of what a read would land: each record's kind, id, link, and
 * the fields the boundary lets cross, keys sorted, records sorted. The header
 * says why the boundary runs first.
 */
export function fingerprintRead(records: readonly VendorRecord[]): string {
  const rows = records
    .map((r) =>
      JSON.stringify(canonical({ k: r.kind, i: r.id, u: r.url ?? null, f: readVendorRecord(r.kind, r.fields).fields })),
    )
    .sort();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/**
 * The words `shapeOf` (`server/lib/saberraRelations.ts`) builds a shape from.
 * Its one number is a list's length, and it only ever follows "of". Anything
 * else in a shape was written by the service.
 */
const SHAPE_WORDS: ReadonlySet<string> = new Set(["absent", "id", "text", "empty", "list", "of", "object", "number", "boolean", "|"]);

/**
 * One shape as the log keeps it, or null. `shapeOf` names an object by its
 * keys ("object (id, name)"), and those keys are the service's field names, so
 * they come out ("object"). What is left has to be `shapeOf`'s own words, or
 * the shape is dropped whole: a key with a bracket in it, or a stored row
 * edited by hand, never reaches the panel as text.
 */
function keyless(shape: string): string | null {
  const bare = shape.replace(/object \([^()]*\)/g, "object");
  const words = bare.split(" ");
  const ours = words.every((w, i) => SHAPE_WORDS.has(w) || (/^\d{1,6}$/.test(w) && words[i - 1] === "of"));
  return ours ? bare : null;
}

/** The shapes line, kept: `shapeOf`'s words only, object keys taken out, clipped, at most eight. */
export function keptShapes(shapes: readonly unknown[]): string[] {
  return shapes
    .filter((s): s is string => typeof s === "string" && s !== "")
    .map(keyless)
    .filter((s): s is string => s !== null)
    .map((s) => (s.length > 80 ? s.slice(0, 80) : s))
    .slice(0, 8);
}

/** A run with nothing counted yet, for the caller to fill in. */
export function blankRun(at: Date, trigger: SyncTrigger, outcome: SyncOutcome, reason: SyncReason | null): SyncRun {
  return {
    at: at.toISOString(),
    trigger,
    outcome,
    reason,
    error: reason ? RUN_SENTENCE[reason] : null,
    ms: 0,
    records: 0,
    facts: 0,
    landed: 0,
    refused: 0,
    superseded: 0,
    rebatched: 0,
    gone: 0,
    held: 0,
    addresses: 0,
    skipped: [],
    truncated: [],
    failed: [],
    plan: null,
    circles: null,
  };
}

// ── Reading the stored log back, believing nothing ─────────────────────────

// Each set is read off a record keyed by its union, so a member added to the
// union and missed here fails to compile instead of being dropped on read.
const KIND_SET: Record<SyncKind, true> = { circle: true, role: true, roleAssignment: true, tension: true, risk: true };
const TRIGGER_SET: Record<SyncTrigger, true> = { scheduled: true, "by-hand": true };
const OUTCOME_SET: Record<SyncOutcome, true> = { landed: true, "no-change": true, failed: true, "not-run": true };
const WHY_SET: Record<SyncFailureWhy, true> = { "no-session": true, refused: true, unreadable: true, "vendor-error": true };
const KINDS = Object.keys(KIND_SET) as SyncKind[];
const TRIGGERS = Object.keys(TRIGGER_SET) as SyncTrigger[];
const OUTCOMES = Object.keys(OUTCOME_SET) as SyncOutcome[];
const WHYS = Object.keys(WHY_SET) as SyncFailureWhy[];

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const oneOf = <T extends string>(v: unknown, set: readonly T[]): T | null =>
  typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T) : null;
const kinds = (v: unknown): SyncKind[] =>
  Array.isArray(v) ? v.map((k) => oneOf(k, KINDS)).filter((k): k is SyncKind => k !== null) : [];

function circlesOf(v: unknown): SyncCircleReading | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const c = v as Record<string, unknown>;
  return {
    placed: count(c.placed),
    unresolved: count(c.unresolved),
    absent: count(c.absent),
    several: count(c.several),
    inArchived: count(c.inArchived),
    shapes: keptShapes(Array.isArray(c.shapes) ? c.shapes : []),
  };
}

/**
 * One stored run, or null when it is not one. Every field is rebuilt from its
 * own type, and `error` is rebuilt from `reason` rather than read back, so a
 * row edited by hand cannot put words on the panel that this file did not write.
 */
export function readRun(raw: unknown): SyncRun | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const at = typeof r.at === "string" && Number.isFinite(Date.parse(r.at)) ? new Date(Date.parse(r.at)) : null;
  const trigger = oneOf(r.trigger, TRIGGERS);
  const outcome = oneOf(r.outcome, OUTCOMES);
  if (!at || !trigger || !outcome) return null;
  const reason = oneOf(r.reason, Object.keys(RUN_SENTENCE) as SyncReason[]);
  const run = blankRun(at, trigger, outcome, reason);
  run.ms = count(r.ms);
  run.records = count(r.records);
  run.facts = count(r.facts);
  run.landed = count(r.landed);
  run.refused = count(r.refused);
  run.superseded = count(r.superseded);
  run.rebatched = count(r.rebatched);
  run.gone = count(r.gone);
  run.held = count(r.held);
  run.addresses = count(r.addresses);
  run.skipped = kinds(r.skipped);
  run.truncated = kinds(r.truncated);
  run.failed = Array.isArray(r.failed)
    ? r.failed
        .map((f) => {
          const o = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
          const kind = oneOf(o.kind, KINDS);
          const why = oneOf(o.why, WHYS);
          return kind && why ? { kind, why } : null;
        })
        .filter((f): f is { kind: SyncKind; why: SyncFailureWhy } => f !== null)
    : [];
  run.plan = oneOf(r.plan, ["schema", "mail"] as const);
  run.circles = circlesOf(r.circles);
  return run;
}

/** The stored document: the runs, newest first, and the fingerprint of the last read that landed. */
export interface SyncLog {
  runs: SyncRun[];
  landedFingerprint: string | null;
}

export function readLog(raw: unknown): SyncLog {
  const doc = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const runs = Array.isArray(doc.runs)
    ? doc.runs.map(readRun).filter((r): r is SyncRun => r !== null).slice(0, KEEP_RUNS)
    : [];
  const fp = typeof doc.landedFingerprint === "string" && /^[0-9a-f]{64}$/.test(doc.landedFingerprint)
    ? doc.landedFingerprint
    : null;
  return { runs, landedFingerprint: fp };
}

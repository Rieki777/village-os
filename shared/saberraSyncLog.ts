/**
 * The run log of Organisational Memory's syncs, as the server keeps it and the
 * admin panel reads it: one entry per sync, by hand or on the schedule, the
 * last twenty kept.
 *
 * ── TYPED FIELDS ONLY ────────────────────────────────────────────────────
 *
 * Every field below is a count, a closed set of words this platform chose, or
 * an instant. Nothing the service wrote is kept here: no field value, no field
 * name, no error message, and never the key. The one string a run carries
 * beyond its codes is `error`, and it is taken from a fixed table on the
 * server (`server/lib/saberraPolling.ts`), keyed by `reason`.
 *
 * The circle `shapes` line is the one exception worth naming. It describes
 * what the service's `Circle` field LOOKED like ("list of 1 id"), by structure
 * and never by value (`shapeOf` in `server/lib/saberraRelations.ts`). Before
 * it is kept, an object's keys are taken out, because they are the service's
 * field names, and a shape holding any word `shapeOf` does not write is
 * dropped whole (`keptShapes` in `server/lib/saberraPolling.ts`).
 *
 * Types only, so the browser can import it without pulling any server code.
 */
import type { SaberraPollSchedule } from "./modules";

/** The kinds this village reads from the service, by its own ids (`HELD_KINDS`). */
export type SyncKind = "circle" | "role" | "roleAssignment" | "tension" | "risk";

/** Who started a run. */
export type SyncTrigger = "scheduled" | "by-hand";

/**
 * What a run came to.
 *
 * `landed`: what it read went to the review queue (by hand, always; on the
 * schedule, only when the read changed). `no-change`: a scheduled read matched
 * the last read that landed, so nothing was touched. `failed`: the service
 * could not be read whole. `not-run`: the schedule was due and something this
 * village has to supply was missing, so the service was never called.
 */
export type SyncOutcome = "landed" | "no-change" | "failed" | "not-run";

/** Why a run did not run, or why it failed. A closed set, each with one sentence. */
export type SyncReason =
  | "no-key"
  | "key-unreadable"
  | "cannot-store-keys"
  | "no-address"
  | "no-session"
  | "kind-failed"
  | "partial"
  | "error";

/** How one kind's call failed, in the client's own words (`CallFailure.why`). */
export type SyncFailureWhy = "no-session" | "refused" | "unreadable" | "vendor-error";

/** How the roles' circle relation was read: counts, and the field's shape. */
export interface SyncCircleReading {
  placed: number;
  unresolved: number;
  absent: number;
  several: number;
  inArchived: number;
  shapes: string[];
}

export interface SyncRun {
  /** When the run started, as an ISO instant. */
  at: string;
  trigger: SyncTrigger;
  outcome: SyncOutcome;
  reason: SyncReason | null;
  /** The fixed sentence for `reason`, or null when nothing went wrong. */
  error: string | null;
  /** Milliseconds the run took. */
  ms: number;
  /** Records the service answered with, across every kind asked for. */
  records: number;
  /** Facts stored about seats and circles. */
  facts: number;
  /** Suggestions that reached the review queue. */
  landed: number;
  /** Suggestions the review queue refused. */
  refused: number;
  /** Waiting suggestions a changed claim replaced. */
  superseded: number;
  /** Waiting suggestions moved, unchanged, into this run's batch. */
  rebatched: number;
  /** Waiting suggestions withdrawn because the service stopped sending their record. */
  gone: number;
  /** Records held back from the queue (a kind it does not take, a record with no name). */
  held: number;
  /** Records where a field carrying an email address was dropped. */
  addresses: number;
  /** Kinds this village reads that the service does not offer, so were not asked for. */
  skipped: SyncKind[];
  /** Kinds cut short because the service held more than one sync reads. */
  truncated: SyncKind[];
  /** Kinds whose call failed, and how. */
  failed: { kind: SyncKind; why: SyncFailureWhy }[];
  /** Whether the service's own schema chose what to ask for, or its mail did. */
  plan: "schema" | "mail" | null;
  /** How the roles' circles were read, when roles were read. */
  circles: SyncCircleReading | null;
}

/** GET /api/saberra/runs. */
export interface SyncRunsAnswer {
  schedule: SaberraPollSchedule;
  /** False when this server runs no background work at all (`SCHEDULER_ENABLED`). */
  schedulerOn: boolean;
  /** The village's IANA timezone, which every time on the panel is shown in. */
  timezone: string;
  /** When the next scheduled sync falls due, or null when the schedule is off. */
  nextAt: string | null;
  /** What the schedule is waiting for before it can call the service, or null. */
  blocked: Extract<SyncReason, "no-key" | "key-unreadable" | "cannot-store-keys" | "no-address"> | null;
  /** Consecutive failed syncs, and how many times the schedule's gap the next wait is. */
  backoff: { failures: number; factor: number };
  /** Newest first, the last twenty. */
  runs: SyncRun[];
}

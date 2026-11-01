/**
 * One sync with the outside governance service, and the two ways one starts:
 * a steward pressing Sync now, and the schedule beside that button.
 *
 * The read and the landing moved here from `server/routes/saberra.ts` so the
 * scheduled job runs exactly the code a press runs. The route keeps the gate.
 *
 * ── NEVER TWO AT ONCE ────────────────────────────────────────────────────
 *
 * Every sync, pressed or scheduled, runs inside one named database lock
 * (`withNamedLock`, `server/repos/namedLock.ts`, the lock the failed-actions
 * job already runs under). A second caller learns at once that it lost: a
 * press is answered 409 with a sentence, a scheduled run waits for the next
 * check. The lock belongs to one database session, so a process that dies
 * mid-sync takes its lock with it and the next sync is never shut out.
 *
 * ── WHAT THE SCHEDULE DOES AND DOES NOT DO ───────────────────────────────
 *
 * Off, the default, never calls the service and writes nothing. On, it calls
 * only while the module is not off and a key and an address are set; a
 * missing one is written to the log ONCE as a run that did not run, and the
 * next check that finds the same gap says nothing more. A scheduled read
 * lands only when it differs from the last read that landed
 * (`saberraPolling.ts` says why), and a read with any kind missing lands
 * nothing, because half a read is not a change. Failures stretch the gap.
 *
 * ── THE LOG CARRIES NOTHING THE SERVICE WROTE ────────────────────────────
 *
 * Each run is stored as counts and closed sets of this platform's own words
 * (`shared/saberraSyncLog.ts`). A failure's detail, the plan's note, a field
 * name, an error message and the key all stay out of it, because the log
 * outlives the request that could have shown them.
 */
import type { Pool } from "mysql2/promise";
import { MODULES_BY_ID, httpsAddress, saberraPollSchedule } from "../../shared/modules";
import type { SyncRun, SyncRunsAnswer, SyncTrigger } from "../../shared/saberraSyncLog";
import { identityKeyFor, landProposal } from "./externalProposals";
import { recordEvent } from "./events";
import { withdrawGone } from "../repos/externalProposals";
import { instanceIdentity } from "./identity";
import { effectiveLifecycle, moduleConfig } from "./modules";
import { listOrgRoles } from "./orgChart";
import { callTool, listTools, openSession, type CallFailure, type ClientOptions } from "./saberraClient";
import { readConnection } from "./saberraConnection";
import { HELD_KINDS, KIND_LABEL, planKinds, type HeldKind, type KindPlan } from "./saberraKinds";
import {
  alreadySaid,
  appendRun,
  backoffFactor,
  blankRun,
  failureStreak,
  fingerprintRead,
  keptShapes,
  pollDueAt,
  readLog,
  type SyncLog,
} from "./saberraPolling";
import { proposeStructure, type VendorRecord } from "./saberraProposals";
import type { SaberraRecordKind } from "./saberraRecords";
import { proposalKindFor, splitStreams } from "./saberraStreams";
import { schedulerEnabled } from "./scheduler";
import { secretStatus, secretValue, villageSecretsConfigured, villageSecretsKeyProblem } from "./secrets";
import { villageTimezone } from "./villageReaders";
import { upsertFacts } from "../repos/moduleFacts";
import { withNamedLock } from "../repos/namedLock";
import { readSyncLogDocument, writeSyncLogDocument } from "../repos/saberraSyncLog";

const MODULE_ID = "saberra";
const SECRET_KEY = "sera_api_secret";
/** `landProposal` refuses an identifier over this, so it is clipped rather than refused. */
const ID_MAX = 64;
/** Their page ceiling. More than this many pages is a village, not a sync. */
const MAX_PAGES = 20;

/** The lock every sync runs under, pressed or scheduled. */
export const SYNC_LOCK = "saberra-sync";
/** The scheduler's name for the poll. */
export const POLL_JOB = "saberra-poll";

/** What a press hears when a sync is already running. */
export const BUSY_SENTENCE = "A sync is already running. Its report appears under Sync now when it finishes.";
const NO_SESSION_SENTENCE = "The service did not open a session. Its address or the key may be wrong.";

/**
 * The service's address for THIS village, from the store.
 *
 * An https scheme is required and checked with a real parse, because the
 * village's key is about to be sent to whatever comes back from here. The rule
 * is `httpsAddress`, the same one the module's config validator refuses a save
 * with, so an address that saved is an address this will call.
 */
function serviceUrl(): string | null {
  const cfg = (moduleConfig(MODULE_ID) as Record<string, unknown> | null) ?? {};
  return httpsAddress(cfg.apiUrl);
}

/** Read one vendor record into the shape the boundary expects, believing nothing. */
function asVendorRecord(kind: SaberraRecordKind, raw: unknown): VendorRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() !== "" ? r.id.trim() : "";
  if (id === "") return null;
  const fields =
    r.fields && typeof r.fields === "object" && !Array.isArray(r.fields)
      ? (r.fields as Record<string, unknown>)
      : r;
  const url = typeof r.url === "string" ? r.url : undefined;
  return { id, kind, fields, url };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ── Before anything goes out ────────────────────────────────────────────────

type Gap = "no-key" | "key-unreadable" | "cannot-store-keys" | "no-address";

type Preflight =
  | { ok: true; client: ClientOptions }
  | { ok: false; gap: Gap; body: { error: string; state: string } };

/**
 * Whether a sync could call the service now, and with what. In-process reads
 * only: the secret store and the module config are both cached here.
 *
 * The bodies are the ones the route has always answered a press with.
 */
function preflight(): Preflight {
  const connection = readConnection(secretStatus(SECRET_KEY), villageSecretsConfigured(), villageSecretsKeyProblem());
  if (!connection.mayCall) {
    const gap: Gap =
      connection.state === "key-changed" ? "key-unreadable" : connection.state === "cannot-store" ? "cannot-store-keys" : "no-key";
    return { ok: false, gap, body: { error: connection.sentence, state: connection.state } };
  }
  const token = secretValue(SECRET_KEY);
  const baseUrl = serviceUrl();
  if (!token || !baseUrl) {
    return {
      ok: false,
      gap: token ? "no-address" : "no-key",
      body: {
        error: "This village has no https address for the service yet. Set it on the module before syncing.",
        state: "not-connected",
      },
    };
  }
  return { ok: true, client: { baseUrl, token, fetchImpl: fetch as never } };
}

// ── The read ────────────────────────────────────────────────────────────────

interface Fetched {
  plan: KindPlan;
  records: VendorRecord[];
  failures: { kind: HeldKind; label: string; why: CallFailure["why"]; detail: string }[];
  truncated: HeldKind[];
}

/**
 * Everything the service holds that this village reads, kind by kind.
 *
 * Every refusal is NAMED. A sync that answers "nothing happened" is the
 * report that costs an afternoon, so an unreadable reply, a refused call and
 * a genuinely empty village are three different answers here.
 */
async function readService(client: ClientOptions, sessionId: string): Promise<Fetched> {
  // What to ask for, read off the service's own schema where it gives one.
  // A failed read is not a failed sync: the plan falls back to the mail and
  // its note says so.
  const listing = await listTools(client, sessionId);
  const plan = listing.ok ? planKinds(listing.tools) : planKinds(null, listing.detail);

  const records: VendorRecord[] = [];
  const failures: Fetched["failures"] = [];
  const truncated: HeldKind[] = [];
  for (const { kind, wire } of plan.ask) {
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await callTool(client, sessionId, "list_records", {
        [plan.argument]: wire,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (!r.ok) {
        failures.push({ kind, label: KIND_LABEL[kind], why: r.why, detail: r.detail });
        break;
      }
      for (const raw of r.records) {
        const rec = asVendorRecord(kind, raw);
        if (rec) records.push(rec);
      }
      cursor = r.cursor;
      pages += 1;
      // A cursor still in hand at the ceiling means we stopped early, and a
      // steward is told rather than handed a smaller number as a success.
      if (cursor && pages >= MAX_PAGES) {
        truncated.push(kind);
        break;
      }
    } while (cursor);
  }
  return { plan, records, failures, truncated };
}

// ── The landing ─────────────────────────────────────────────────────────────

/** What a press of Sync now answers, unchanged from before the schedule existed. */
type SyncAnswer = Record<string, unknown> & {
  landed: number;
  refused: { kind: string; ok: boolean; reason?: string }[];
  superseded: number;
  rebatched: number;
  /** Waiting suggestions withdrawn because the service stopped sending their record. */
  gone: number;
  facts: number;
  held: unknown[];
  addressesSeen: unknown[];
  circles: ReturnType<typeof proposeStructure>["circles"] | null;
};

/** Where a one-apiece suggestion points back to, and so what makes two of them about the same record. */
const sourceRefOf = (rec: VendorRecord): string => (rec.url ?? rec.id).slice(0, 400);

/** Store the facts and land the suggestions one read produced. */
async function landRead(pool: Pool, fetched: Fetched, sessionId: string): Promise<SyncAnswer> {
  const { plan, records, failures, truncated } = fetched;
  const reading = splitStreams(records);
  const villageId = instanceIdentity().instanceId;

  /*
   * ATTACH EACH FACT TO A SEAT THIS VILLAGE ALREADY HAS, by the name the
   * vendor used. Unresolved is a real state and stays null: a seat we have
   * not created yet is exactly what a proposal is for.
   */
  const liveRoles = await listOrgRoles(pool);
  const seatIdFor = (name: string | null): string | null => {
    if (!name) return null;
    const hit = liveRoles.find((r) => sameName(String(r.name ?? ""), name));
    return hit ? String(hit.id) : null;
  };

  await upsertFacts(
    pool,
    villageId,
    MODULE_ID,
    reading.facts.map((f) => {
      const isCircle = f.vendorKind === "circle";
      return {
        entityKind: isCircle ? "circle" : "org_role",
        entityId: isCircle ? null : seatIdFor(f.attachesTo),
        vendorKind: f.vendorKind,
        vendorRecordId: f.vendorRecordId,
        attachesTo: f.attachesTo,
        fields: f.fields,
        sourceUrl: f.url,
      };
    }),
  );

  /*
   * ONE `org.proposed` FOR THE WHOLE STRUCTURE, built by the translator.
   *
   * An earlier version landed each role as its own proposal carrying the
   * vendor's raw keys. `readProposedSeats` looks for `name`, `circleName` and
   * the rest, so every one of those arrived with no name and an unreadable
   * circle, and a steward could not have accepted any of them.
   */
  const batchId = `sync-${sessionId}`.slice(0, ID_MAX);
  const sourceName = MODULES_BY_ID[MODULE_ID]?.name ?? "the connected service";
  const landed: { kind: string; ok: boolean; reason?: string }[] = [];
  /*
   * A LANDING REPLACES WHAT IS STILL WAITING. A changed claim about the same
   * thing supersedes the waiting one (`landProposal`'s identity key); an
   * unchanged one is moved into this delivery (`rebatchWaiting`), so the
   * newest read is one batch a steward can review whole. Anything a steward
   * already decided is history and is left exactly as it is. A scheduled read
   * only gets this far when it changed (`saberraPolling.ts`).
   */
  let superseded = 0;
  let rebatched = 0;
  const note = (r: Awaited<ReturnType<typeof landProposal>>) => {
    if (!r.ok) return;
    superseded += r.superseded;
    if (r.rebatched || r.reopened) rebatched += 1;
  };

  // The circles go in WITH the roles: a role names its circle by page id,
  // and the circle record is where that id becomes a name.
  const roleRecords = records.filter((r) => r.kind === "role");
  let circleReading: ReturnType<typeof proposeStructure>["circles"] | null = null;
  if (roleRecords.length > 0) {
    const structure = proposeStructure(
      records.filter((r) => r.kind === "role" || r.kind === "circle"),
      { sourceName },
    );
    circleReading = structure.circles;
    if (structure.payload.seats.length > 0) {
      const r = await landProposal(pool, {
        villageId,
        moduleId: MODULE_ID,
        batchId,
        kind: structure.kind,
        payload: structure.payload,
        trustTier: "extracted_unreviewed",
        rebatchWaiting: true,
      });
      note(r);
      landed.push(r.ok ? { kind: structure.kind, ok: true } : { kind: structure.kind, ok: false, reason: r.reason });
    }
  }

  // Tensions and risks land one apiece: each is a separate thing observed,
  // and the queue shows them as notes rather than as chart changes.
  for (const group of reading.structure) {
    if (group.kind === "org.proposed") continue;
    for (const rec of group.records) {
      const fact = reading.facts.find((f) => f.vendorRecordId === rec.id);
      const r = await landProposal(pool, {
        villageId,
        moduleId: MODULE_ID,
        batchId,
        kind: group.kind,
        payload: { ...(fact?.fields ?? {}), vendorRecordId: rec.id },
        sourceRef: sourceRefOf(rec),
        trustTier: "extracted_unreviewed",
        rebatchWaiting: true,
      });
      note(r);
      landed.push(r.ok ? { kind: group.kind, ok: true } : { kind: group.kind, ok: false, reason: r.reason });
    }
  }

  /*
   * A RECORD THE SERVICE STOPPED SENDING LEAVES THE QUEUE. Superseding and
   * rebatching both need the record to come back, so one the service archived
   * out of its answer, or deleted, used to wait for good: on 2026-10-31
   * thirteen circles had waited three weeks after the answer dropped them.
   *
   * Only a kind read WHOLE can say a record is missing. One that failed, or was
   * cut short at the page ceiling, says nothing about what it did not reach,
   * and an empty answer is too thin to withdraw on. The structure batch is left
   * to its own identity: a changed structure already supersedes the waiting one.
   * A record that comes back later returns to the queue (`reopenSuperseded`).
   */
  const present = new Set<string>();
  const goneKinds: string[] = [];
  for (const { kind } of plan.ask) {
    if (failures.some((f) => f.kind === kind) || truncated.includes(kind)) continue;
    const proposalKind = proposalKindFor(kind);
    if (!proposalKind || proposalKind === "org.proposed") continue;
    const read = records.filter((r) => r.kind === kind);
    if (!read.length) continue;
    goneKinds.push(proposalKind);
    for (const rec of read) present.add(identityKeyFor({ moduleId: MODULE_ID, kind: proposalKind, sourceRef: sourceRefOf(rec) }));
  }
  const gone = await withdrawGone(pool, { villageId, moduleId: MODULE_ID, kinds: goneKinds, present });
  for (const id of gone) {
    void recordEvent(pool, {
      kind: "external_proposal",
      text: `proposal withdrawn: the service no longer sends its record (batch ${batchId})`,
      actorKind: "agent",
      originModuleId: MODULE_ID,
      entityType: "external_proposal",
      entityRef: id,
      audience: "admin",
    });
  }

  return {
    gone: gone.length,
    landed: landed.filter((l) => l.ok).length,
    refused: landed.filter((l) => !l.ok),
    batchId,
    // Waiting proposals this read replaced, and unchanged ones it carried forward.
    superseded,
    rebatched,
    // How each role's circle was read: placed, unresolved, absent, and the
    // SHAPE the field arrived in (never its value), so the shape is measured.
    circles: circleReading,
    facts: reading.facts.length,
    attached: reading.facts.filter((f) => f.vendorKind !== "circle" && seatIdFor(f.attachesTo)).length,
    held: reading.held,
    unmapped: reading.unmapped,
    addressesSeen: reading.addressesSeen,
    truncated: truncated.map((k) => KIND_LABEL[k]),
    failures,
    notOffered: plan.notOffered,
    asked: { argument: plan.argument, kinds: plan.ask.map((a) => a.wire), source: plan.source, note: plan.note },
  };
}

// ── The log ─────────────────────────────────────────────────────────────────

async function readSyncLog(pool: Pool): Promise<SyncLog> {
  return readLog(await readSyncLogDocument(pool));
}

async function writeSyncLog(pool: Pool, log: SyncLog): Promise<void> {
  await writeSyncLogDocument(pool, { runs: log.runs, landedFingerprint: log.landedFingerprint });
}

/** What a read was, as typed fields: never a detail, a note, a name or a value. */
function describeRead(run: SyncRun, fetched: Fetched): SyncRun {
  const asked = new Set(fetched.plan.ask.map((a) => a.kind));
  run.records = fetched.records.length;
  run.skipped = HELD_KINDS.filter((k) => !asked.has(k));
  run.truncated = [...fetched.truncated];
  run.failed = fetched.failures.map((f) => ({ kind: f.kind, why: f.why }));
  run.plan = fetched.plan.source;
  return run;
}

/** What a landing did, as counts. */
function describeLanding(run: SyncRun, answer: SyncAnswer): SyncRun {
  run.facts = answer.facts;
  run.landed = answer.landed;
  run.refused = answer.refused.length;
  run.superseded = answer.superseded;
  run.rebatched = answer.rebatched;
  run.gone = answer.gone;
  run.held = answer.held.length;
  run.addresses = answer.addressesSeen.length;
  run.circles = answer.circles
    ? {
        placed: answer.circles.placed,
        unresolved: answer.circles.unresolved,
        absent: answer.circles.absent,
        several: answer.circles.several,
        inArchived: answer.circles.inArchived,
        shapes: keptShapes(answer.circles.shapes),
      }
    : null;
  return run;
}

/**
 * Call the service once, inside the lock, and log what happened. A press
 * always lands what it read, which is how Sync now has always behaved; a
 * scheduled run lands only a whole read that changed.
 *
 * An error is logged as a failed run and then thrown on, so the route answers
 * 500 and the scheduler reports it the way it reports any job that threw.
 */
async function runLocked(
  pool: Pool,
  client: ClientOptions,
  trigger: SyncTrigger,
  at: Date,
): Promise<{ status: number; body: Record<string, unknown>; run: SyncRun }> {
  const started = Date.now();
  const log = await readSyncLog(pool);
  const finish = async (run: SyncRun, landedFingerprint = log.landedFingerprint) => {
    run.ms = Date.now() - started;
    await writeSyncLog(pool, { runs: appendRun(log.runs, run), landedFingerprint });
    return run;
  };

  try {
    const sessionId = await openSession(client);
    if (!sessionId) {
      const run = await finish(blankRun(at, trigger, "failed", "no-session"));
      return { status: 502, body: { error: NO_SESSION_SENTENCE }, run };
    }
    const fetched = await readService(client, sessionId);
    const fingerprint = fingerprintRead(fetched.records);

    if (trigger === "scheduled") {
      if (fetched.failures.length > 0) {
        const run = await finish(describeRead(blankRun(at, trigger, "failed", "kind-failed"), fetched));
        return { status: 200, body: {}, run };
      }
      if (fingerprint === log.landedFingerprint) {
        const run = await finish(describeRead(blankRun(at, trigger, "no-change", null), fetched));
        return { status: 200, body: {}, run };
      }
    }

    const answer = await landRead(pool, fetched, sessionId);
    const reason = fetched.failures.length > 0 ? "partial" : null;
    const run = await finish(describeLanding(describeRead(blankRun(at, trigger, "landed", reason), fetched), answer), fingerprint);
    return { status: 200, body: answer, run };
  } catch (e) {
    await finish(blankRun(at, trigger, "failed", "error")).catch(() => undefined);
    throw e;
  }
}

// ── The two ways in ─────────────────────────────────────────────────────────

/**
 * A steward pressed Sync now. The answer is what the route has always sent,
 * plus one new refusal: a sync already running answers 409 and starts nothing.
 */
export async function syncByHand(pool: Pool): Promise<{ status: number; body: Record<string, unknown> }> {
  const ready = preflight();
  if (!ready.ok) return { status: 409, body: ready.body };
  const outcome = await withNamedLock(pool, SYNC_LOCK, () => runLocked(pool, ready.client, "by-hand", new Date()));
  if (!outcome.ran) return { status: 409, body: { error: BUSY_SENTENCE, state: "busy" } };
  return { status: outcome.value.status, body: outcome.value.body };
}

/**
 * One check by the scheduler, every tick. It answers the line the scheduler
 * keeps as the job's last result, and calls the service only when the
 * schedule is on, the module is on, a key and an address are set, and the
 * schedule's gap (stretched by any failures) has passed since the last call.
 */
export async function pollOnce(pool: Pool, now: () => number = Date.now): Promise<string> {
  const schedule = saberraPollSchedule(moduleConfig(MODULE_ID));
  if (schedule === "off") return "the schedule is off";
  if (effectiveLifecycle(MODULE_ID) === "off") return "the module is off";

  const log = await readSyncLog(pool);
  const due = pollDueAt(schedule, log.runs) ?? Infinity;
  if (due > now()) return `next sync due ${new Date(due).toISOString()}`;

  const ready = preflight();
  if (!ready.ok) {
    // Once, never every tick: the newest entry already saying so is enough.
    if (alreadySaid(log.runs, ready.gap)) return `not run: ${ready.gap}, already in the log`;
    const wrote = await withNamedLock(pool, SYNC_LOCK, async () => {
      const fresh = await readSyncLog(pool);
      if (alreadySaid(fresh.runs, ready.gap)) return false;
      await writeSyncLog(pool, { ...fresh, runs: appendRun(fresh.runs, blankRun(new Date(now()), "scheduled", "not-run", ready.gap)) });
      return true;
    });
    if (!wrote.ran) return "a sync was already running, so this check waits for the next one";
    return wrote.value ? `not run: ${ready.gap}` : `not run: ${ready.gap}, already in the log`;
  }

  const outcome = await withNamedLock(pool, SYNC_LOCK, async () => {
    // Read again under the lock: a press, or another process, may have run
    // between the check above and taking the lock.
    const fresh = await readSyncLog(pool);
    const stillDue = pollDueAt(schedule, fresh.runs) ?? Infinity;
    if (stillDue > now()) return `another sync ran first; next due ${new Date(stillDue).toISOString()}`;
    const { run } = await runLocked(pool, ready.client, "scheduled", new Date(now()));
    return run.reason ? `${run.outcome}: ${run.reason}` : `${run.outcome}, ${run.records} records read, ${run.landed} landed`;
  });
  return outcome.ran ? outcome.value : "a sync was already running, so this check waits for the next one";
}

/** GET /api/saberra/runs: the schedule, when it next calls, and the log. */
export async function syncRunsAnswer(pool: Pool, now: () => number = Date.now): Promise<SyncRunsAnswer> {
  const schedule = saberraPollSchedule(moduleConfig(MODULE_ID));
  const log = await readSyncLog(pool);
  const due = pollDueAt(schedule, log.runs);
  const ready = preflight();
  const failures = failureStreak(log.runs);
  return {
    schedule,
    schedulerOn: schedulerEnabled(),
    timezone: villageTimezone(),
    nextAt: due === null ? null : new Date(Math.max(due, now())).toISOString(),
    blocked: ready.ok ? null : ready.gap,
    backoff: { failures, factor: backoffFactor(failures) },
    runs: log.runs,
  };
}

/**
 * The bridge to the organisational memory service, part 1: what would cross,
 * recorded, and nothing sent.
 *
 * ── THE RULINGS ──────────────────────────────────────────────────────────
 *
 *   "All journal entries go to Saberra (if that module is on) unless
 *   specifically marked private." (2026-10-05)
 *
 *   The pulse stays even for a small team, and anonymity lives in how
 *   anonymous feedback is captured and distributed (2026-10-02).
 *
 * And what the founder told the vendor on 2026-10-13, which this file keeps
 * line by line:
 *
 *   - A journal entry crosses under its author's CODE-NAME, with every member
 *     name the village knows swapped for that member's code-name
 *     (server/lib/nameSwap.ts). The payload carries the code-name, the
 *     swapped words, the date and the kind. Never a user id, an email or a
 *     display name.
 *   - A PRIVATE ENTRY NEVER LEAVES. It is never queued; an entry turned
 *     private (or deleted) before it is sent is withdrawn: held, payload
 *     cleared. The drain looks again before any send, so a withdrawal that
 *     failed is still caught.
 *   - FEEDBACK NEVER CROSSES. It is the anonymous channel, and nothing in this
 *     file reads `journal_feedback`. There is no function here that could
 *     queue it, which is the guarantee.
 *   - A TEAM SIGNAL NEVER CARRIES ONE MEMBER'S NUMBERS. A metric crosses only
 *     when at least two members answered it that week (or the village's own
 *     pulse floor, if higher), so a week with a single answer sends nothing.
 *     A pulse entry's own numbers never ride along with its words.
 *   - AN OUTBOX RETRIES EACH SEND UNTIL IT LANDS, and NOTHING IS SENT YET: the
 *     service has not named a write path. `OutboxTransport` is the adapter a
 *     transport will fill, and nothing fills it.
 *
 * ── WHEN SOMETHING IS QUEUED ─────────────────────────────────────────────
 *
 * Only while BOTH modules are on or in preview (`effectiveLifecycle` is not
 * `off`, the repo's own test for "on"). An entry saved while either is off is
 * not queued then; the bridge job's backfill queues it once both are on,
 * which is also how entries written before this release reach the outbox
 * ("the history is ready to send the day your write path exists").
 *
 * ── THE JOURNAL WRITE NEVER WAITS ON THIS, AND NEVER FAILS BECAUSE OF IT ─
 *
 * The routes answer the member first and queue afterwards, and every call
 * from a route goes through `quietly`, which logs a failure and swallows it.
 * A queueing that failed is repaired by the next backfill, because the
 * backfill queues any shared entry that has no row.
 *
 * ── NO EVENTS ────────────────────────────────────────────────────────────
 *
 * Nothing here calls `recordEvent`, for the journal's own reason: the events
 * table defaults to a public audience.
 */
import { createHash } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { effectiveLifecycle } from "./modules";
import {
  codeNamesFor,
  codeNamesPendingVendorDelete,
  markCodeNamesPendingVendorDelete,
  resolveCodeName,
} from "./codeNames";
import { mentionedMembers, namesOf, swapNames, type NamedMember } from "./nameSwap";
import { isoWeekId, isoWeekStart, pulseAggregate, pulseFloor, readEntry } from "./journal";
import { isTombstone } from "./oauthAccounts";
import { isExampleUser } from "./examples";
import { sharedEntryIdsForUser } from "../repos/journal";
import {
  dueRows,
  existingSourceRefs,
  holdById,
  holdBySourceRef,
  insertTeamSignalIfAbsent,
  listingRows,
  markFailedRow,
  markSentRow,
  scrubCodeNames,
  statusCounts,
  upsertJournalItemIfShared,
} from "../repos/saberraOutbox";
import { civilDateKey } from "../../shared/lunar";
import { sharesWithMemory, type JournalEntry } from "../../shared/journal";
import {
  OUTBOX_KINDS,
  OUTBOX_LISTING_LIMIT,
  OUTBOX_STATUSES,
  type OutboxKind,
  type OutboxListItem,
  type OutboxStatus,
  type OutboxView,
} from "../../shared/saberraBridge";

export { OUTBOX_KINDS, OUTBOX_STATUSES, type OutboxKind, type OutboxStatus, type OutboxView };

/** The fewest members whose numbers may cross as one team signal. */
export const TEAM_SIGNAL_MIN_MEMBERS = 2;

/** How many missing entries one run of the backfill queues, at most. */
export const BACKFILL_PER_RUN = 500;

/** How many items one drain attempts, at most. */
const DRAIN_PER_RUN = 100;

/* -------------------------------------------------------------------------- *
 * The transport adapter. NO IMPLEMENTATION EXISTS.
 * -------------------------------------------------------------------------- */

/** One item as a transport receives it: an opaque id, its kind, and the payload. */
export interface OutboxSend {
  id: string;
  kind: OutboxKind;
  payload: unknown;
}

/**
 * What a transport to the service must do: deliver one item and say whether
 * the service confirmed it holds it. Silence is not confirmation, so anything
 * short of `landed: true` leaves the item to be tried again.
 *
 * NOTHING IMPLEMENTS THIS. The service has not named a write path (ask 1, still
 * open on 2026-10-14), so there is no address to send to and no shape to send
 * in. Until a transport is set, the drain sends nothing and says so.
 */
export interface OutboxTransport {
  send(item: OutboxSend): Promise<{ landed: boolean; detail?: string }>;
}

let transport: OutboxTransport | null = null;

/**
 * The slot a transport goes in. Nothing in the server calls this: it exists
 * so the day the service names a write path is one adapter and one line,
 * and so the retry rules below are testable against a stand-in today.
 */
export function setOutboxTransport(t: OutboxTransport | null): void {
  transport = t;
}

export function outboxTransport(): OutboxTransport | null {
  return transport;
}

/* -------------------------------------------------------------------------- *
 * When the bridge is open, and who it knows.
 * -------------------------------------------------------------------------- */

/** Both modules on, or in preview. Either one off and nothing is queued. */
export function bridgeOpen(): boolean {
  return effectiveLifecycle("saberra") !== "off" && effectiveLifecycle("journal") !== "off";
}

/**
 * Every member whose names the swap must know, from the users repository's
 * records. A departed member's record holds no name any more, and an example
 * identity is not a person, so neither is on it.
 */
export function rosterOf(records: readonly unknown[]): NamedMember[] {
  const out: NamedMember[] = [];
  for (const raw of records) {
    const r = raw as Record<string, any> | null;
    if (!r || typeof r.id !== "string" || r.id === "") continue;
    if (isTombstone({ email: String(r.email ?? "") }) || isExampleUser(r)) continue;
    out.push({ id: r.id, names: namesOf(r) });
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * The payload. Pure.
 * -------------------------------------------------------------------------- */

export const journalSourceRef = (entryId: string): string => `journal_entry:${entryId}`;
export const teamSignalSourceRef = (weekId: string): string => `team_signal:${weekId}`;

/**
 * An item's id, derived from its source so two writers racing to queue the
 * same entry name it the same way, and the id the payload carries is the id
 * of its row. A hash, so it says nothing the source ref does not.
 */
export function outboxItemId(sourceRef: string): string {
  return `sbo-${createHash("sha256").update(sourceRef).digest("hex").slice(0, 32)}`;
}

/** A journal entry exactly as it would cross. */
export interface JournalPayload {
  item: string;
  kind: "journal_entry";
  /** The author's code-name. */
  author: string;
  /** The civil date the entry was written, on the village's clock. */
  date: string;
  practice: JournalEntry["practice"];
  depth: JournalEntry["depth"];
  /** `internal` or `clear`; a private entry never gets this far. */
  shared: JournalEntry["privacy"];
  answers: Array<{ question: string; prompt: string; text: string }>;
  /** The author's confirmed reflection. An unconfirmed one is the guide's guess and stays. */
  reflection?: string;
  /** A debrief's call, seats and quests, which can carry names too. */
  debrief?: { call?: string; seats?: string[]; quests?: string[] };
}

/** A week's team numbers as they would cross. Means and counts, never a person. */
export interface TeamSignalPayload {
  item: string;
  kind: "team_signal";
  week: string;
  metrics: Array<{ metric: string; answered: number; mean: number }>;
}

/** Every piece of an entry a member wrote, which is every piece a name could hide in. */
export function entryTexts(entry: JournalEntry): string[] {
  const out: string[] = [];
  for (const a of entry.answers) out.push(a.prompt, a.text);
  if (entry.confirmed && entry.reflection) out.push(entry.reflection);
  const m = entry.meta;
  if (m?.call) out.push(m.call);
  for (const s of m?.seats ?? []) out.push(s);
  for (const q of m?.quests ?? []) out.push(q);
  return out.filter((t) => typeof t === "string" && t !== "");
}

/**
 * Build the payload with every text run through `swap`. No scores: a pulse
 * entry's numbers cross only inside a team signal, so one member's numbers
 * never cross alone. No local hour, no client id, no entry id.
 */
export function journalPayload(
  entry: JournalEntry,
  opts: { item: string; author: string; timeZone: string; swap: (text: string) => string },
): JournalPayload {
  const { swap } = opts;
  const out: JournalPayload = {
    item: opts.item,
    kind: "journal_entry",
    author: opts.author,
    date: civilDateKey(new Date(entry.writtenAt), opts.timeZone),
    practice: entry.practice,
    depth: entry.depth,
    shared: entry.privacy,
    answers: entry.answers
      .filter((a) => a.text.trim() !== "")
      .map((a) => ({ question: a.questionKey, prompt: swap(a.prompt), text: swap(a.text) })),
  };
  if (entry.confirmed && entry.reflection) out.reflection = swap(entry.reflection);
  const m = entry.meta;
  if (m && (m.call || m.seats?.length || m.quests?.length)) {
    out.debrief = {
      ...(m.call ? { call: swap(m.call) } : {}),
      ...(m.seats?.length ? { seats: m.seats.map(swap) } : {}),
      ...(m.quests?.length ? { quests: m.quests.map(swap) } : {}),
    };
  }
  return out;
}

/** Characters of member writing a payload carries: what the admin listing shows instead of the words. */
export function writtenChars(p: JournalPayload): number {
  let n = 0;
  for (const a of p.answers) n += a.text.length;
  if (p.reflection) n += p.reflection.length;
  return n;
}

/* -------------------------------------------------------------------------- *
 * Queueing and withdrawing one entry.
 * -------------------------------------------------------------------------- */

export type EnqueueOutcome = "bridge-closed" | "no-entry" | "withdrawn" | "author-unknown" | "no-words" | "written";

/**
 * Queue one entry as it stands NOW, or withdraw it if it is now private.
 *
 * Reads the entry fresh rather than taking one, so whatever ran between the
 * member's save and this call is what counts. The write itself is gated on
 * the entry's privacy in the same statement (see the repo), which closes the
 * last gap.
 *
 * FAILS CLOSED ON AN INCOMPLETE ROSTER. The author is always a member, so a
 * roster without them is a roster that did not load, and a swap against it
 * would let names through. Nothing is queued; the backfill tries again.
 */
export async function enqueueJournalEntry(
  pool: Pool,
  input: { userId: string; entryId: string; roster: () => Promise<NamedMember[]>; timeZone: string },
): Promise<EnqueueOutcome> {
  if (!bridgeOpen()) return "bridge-closed";
  const entry = await readEntry(pool, input.userId, input.entryId);
  if (!entry) return "no-entry";
  if (!sharesWithMemory(entry.privacy)) {
    await holdBySourceRef(pool, journalSourceRef(entry.id));
    return "withdrawn";
  }
  const roster = await input.roster();
  if (!roster.some((m) => m.id === input.userId)) return "author-unknown";
  return queueEntry(pool, input.userId, entry, roster, input.timeZone);
}

/** True when an entry carries any words of the member's own: an answer, a confirmed reflection, a debrief detail. */
function hasWords(entry: JournalEntry): boolean {
  const m = entry.meta;
  return (
    entry.answers.some((a) => a.text.trim() !== "") ||
    (entry.confirmed && !!entry.reflection?.trim()) ||
    !!(m?.call || m?.seats?.length || m?.quests?.length)
  );
}

/**
 * Queue one entry that is known to be shared.
 *
 * AN ENTRY WITH NO WORDS IS NOT QUEUED, and one that lost its words is
 * withdrawn. A pulse saved as numbers alone would cross as "this code-name
 * did a pulse on this date" and nothing else: its numbers travel only inside
 * a team signal, so what is left is a fact about one person's evening.
 */
async function queueEntry(
  pool: Pool,
  userId: string,
  entry: JournalEntry,
  roster: readonly NamedMember[],
  timeZone: string,
): Promise<"written" | "no-words"> {
  if (!hasWords(entry)) {
    await holdBySourceRef(pool, journalSourceRef(entry.id));
    return "no-words";
  }
  const mentioned = mentionedMembers(entryTexts(entry), roster);
  const codes = await codeNamesFor(pool, [userId, ...Array.from(mentioned)], "journal");
  const author = codes.get(userId)!;
  const sourceRef = journalSourceRef(entry.id);
  const item = outboxItemId(sourceRef);
  const payload = journalPayload(entry, { item, author, timeZone, swap: (t) => swapNames(t, roster, codes) });
  await upsertJournalItemIfShared(
    pool,
    {
      id: item,
      sourceRef,
      codeName: author,
      period: payload.date,
      payload: JSON.stringify(payload),
      textChars: writtenChars(payload),
      sourceVersion: new Date(entry.updatedAt).getTime(),
    },
    entry.id,
    userId,
  );
  return "written";
}

/**
 * Take one entry back: held, payload cleared. Runs whatever the modules'
 * state, because clearing words is right whether or not anything could send
 * them.
 */
export async function withdrawJournalEntry(pool: Pool, entryId: string): Promise<void> {
  await holdBySourceRef(pool, journalSourceRef(entryId));
}

/**
 * Run a piece of bridge work so that it can never fail the caller. A failure
 * is logged with what was being done and nothing of the member's words, and
 * swallowed: the journal write it rode on has already succeeded and stands.
 */
export async function quietly(what: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (e: any) {
    console.error(`[saberra-outbox] could not ${what}; the journal write stands: ${String(e?.message ?? e).slice(0, 200)}`);
  }
}

/* -------------------------------------------------------------------------- *
 * The backfill, the team signal, the drain, and the job that runs them.
 * -------------------------------------------------------------------------- */

/**
 * Queue every shared entry that has no row yet, member by member.
 *
 * ONE-TIME IN EFFECT, IDEMPOTENT BY CONSTRUCTION. An entry with a row of any
 * status is skipped, and the row's unique source ref means a second queueing
 * of the same entry could only ever update its one row. So the first run
 * queues the history, and every later run queues only an entry whose live
 * queueing failed, which is the repair `quietly` relies on.
 *
 * Reads each member's own entries through a read keyed on their id, so no
 * statement here reads the journal across members.
 */
export async function backfillJournalOutbox(
  pool: Pool,
  opts: { roster: readonly NamedMember[]; timeZone: string; limit?: number },
): Promise<{ queued: number; skipped: number }> {
  let queued = 0;
  let skipped = 0;
  if (!bridgeOpen()) return { queued, skipped };
  const limit = opts.limit ?? BACKFILL_PER_RUN;
  for (const member of opts.roster) {
    if (queued >= limit) break;
    const ids = await sharedEntryIdsForUser(pool, member.id);
    if (ids.length === 0) continue;
    const have = await existingSourceRefs(pool, ids.map(journalSourceRef));
    for (const id of ids) {
      if (queued >= limit) break;
      if (have.has(journalSourceRef(id))) {
        skipped += 1;
        continue;
      }
      const entry = await readEntry(pool, member.id, id);
      if (!entry || !sharesWithMemory(entry.privacy)) continue;
      if ((await queueEntry(pool, member.id, entry, opts.roster, opts.timeZone)) === "written") queued += 1;
      else skipped += 1;
    }
  }
  return { queued, skipped };
}

/** The ISO week that ended most recently, on the village's clock. */
export function lastCompletedWeekId(now: Date, timeZone: string): string {
  const thisWeek = isoWeekStart(now, timeZone);
  return isoWeekId(new Date(thisWeek.getTime() - 12 * 60 * 60 * 1000), timeZone);
}

/**
 * Queue one week's team numbers, once, if enough members answered.
 *
 * The floor is `TEAM_SIGNAL_MIN_MEMBERS` or the village's own pulse floor,
 * whichever is higher: what crosses is never finer than what the village's
 * members can see. A metric under it is left out, and a week with no metric
 * over it queues nothing at all.
 */
export async function enqueueTeamSignal(
  pool: Pool,
  opts: { weekId: string; timeZone: string; now?: Date },
): Promise<"bridge-closed" | "too-few" | "queued" | "already"> {
  if (!bridgeOpen()) return "bridge-closed";
  const floor = Math.max(TEAM_SIGNAL_MIN_MEMBERS, pulseFloor());
  const aggregate = await pulseAggregate(pool, { now: opts.now, timeZone: opts.timeZone, villageName: "", floor });
  const week = aggregate.weeks.find((w) => w.weekId === opts.weekId);
  const metrics = (week?.cells ?? [])
    .filter((c) => !c.suppressed && c.n !== null && c.mean !== null && c.n >= floor)
    .map((c) => ({ metric: c.metric, answered: c.n as number, mean: c.mean as number }));
  if (metrics.length === 0) return "too-few";
  const sourceRef = teamSignalSourceRef(opts.weekId);
  const item = outboxItemId(sourceRef);
  const payload: TeamSignalPayload = { item, kind: "team_signal", week: opts.weekId, metrics };
  const wrote = await insertTeamSignalIfAbsent(pool, {
    id: item,
    sourceRef,
    period: opts.weekId,
    payload: JSON.stringify(payload),
  });
  return wrote > 0 ? "queued" : "already";
}

/**
 * Try every item that is due, through the transport, until each one lands.
 *
 * With no transport there is nothing to try, and the answer says so. With
 * one, a journal item is LOOKED AT AGAIN before it goes: its author is
 * resolved inside the village and the entry re-read, and an entry that is
 * gone or private is held instead of sent. A send that does not confirm is
 * marked failed and stays due, so it is tried again next run.
 */
export async function drainOutbox(
  pool: Pool,
  t: OutboxTransport | null = outboxTransport(),
): Promise<{ sent: number; failed: number; held: number; note: string }> {
  const out = { sent: 0, failed: 0, held: 0, note: "" };
  if (!t) {
    out.note = "nothing sent: the service has not named a write path";
    return out;
  }
  if (!bridgeOpen()) {
    out.note = "nothing sent: a module is off";
    return out;
  }
  for (const row of await dueRows(pool, DRAIN_PER_RUN)) {
    const id = String(row.id);
    const kind = String(row.kind) as OutboxKind;
    if (kind === "journal_entry") {
      const entryId = String(row.source_ref).slice("journal_entry:".length);
      const author = row.code_name ? await resolveCodeName(pool, String(row.code_name)) : null;
      const entry = author ? await readEntry(pool, author, entryId) : null;
      if (!entry || !sharesWithMemory(entry.privacy)) {
        await holdById(pool, id);
        out.held += 1;
        continue;
      }
    }
    let payload: unknown;
    try {
      payload = JSON.parse(String(row.payload));
    } catch {
      await markFailedRow(pool, id, "the stored payload could not be read");
      out.failed += 1;
      continue;
    }
    try {
      const r = await t.send({ id, kind, payload });
      if (r?.landed === true) {
        await markSentRow(pool, id, Number(row.source_version));
        out.sent += 1;
      } else {
        await markFailedRow(pool, id, r?.detail || "the service did not confirm it holds this");
        out.failed += 1;
      }
    } catch (e: any) {
      await markFailedRow(pool, id, String(e?.message ?? e));
      out.failed += 1;
    }
  }
  out.note = `${out.sent} sent, ${out.failed} to try again, ${out.held} held`;
  return out;
}

/** The scheduler's name for the bridge job, and how often it runs. */
export const SABERRA_BRIDGE_JOB = "saberra-bridge";
export const SABERRA_BRIDGE_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * One run of the bridge: the backfill, last week's team signal, and the drain.
 * Answers one line for the scheduler's ledger. Reads the roster only when the
 * bridge is open.
 */
export async function runBridgeJob(
  pool: Pool,
  opts: { roster: () => Promise<NamedMember[]>; timeZone: string; now?: Date },
): Promise<string> {
  if (!bridgeOpen()) return "bridge closed: the journal or the organisational memory module is off";
  const now = opts.now ?? new Date();
  const roster = await opts.roster();
  const backfill = await backfillJournalOutbox(pool, { roster, timeZone: opts.timeZone });
  const weekId = lastCompletedWeekId(now, opts.timeZone);
  const signal = await enqueueTeamSignal(pool, { weekId, timeZone: opts.timeZone, now });
  const drained = await drainOutbox(pool);
  return `backfill queued ${backfill.queued}; team signal ${weekId}: ${signal}; ${drained.note}`;
}

/* -------------------------------------------------------------------------- *
 * Erasure, and the admin's view.
 * -------------------------------------------------------------------------- */

/**
 * The erasure's step: scrub every outbox row filed under this member's
 * code-names, then mark the code-names pending a vendor delete. The map
 * entries are NOT dropped: the service has no delete endpoint, so no confirm
 * can arrive, and until one does the village must still be able to say whom
 * a code-name named. Constant writes keyed on the member, so a resumed
 * erasure that runs this again changes nothing new.
 */
export async function forgetMemberInOutbox(pool: Pool, userId: string): Promise<void> {
  const held = await markCodeNamesPendingVendorDelete(pool, userId);
  await scrubCodeNames(pool, held);
}

/**
 * The admin's view: counts, code-names, dates, lengths and statuses. Never a
 * payload and never a word of a member's writing. Inside the village an entry
 * is still its author's alone, and no admin reads it, here or anywhere.
 */
export async function outboxView(pool: Pool): Promise<OutboxView> {
  const counts: Record<OutboxStatus, number> = { queued: 0, sent: 0, failed: 0, held: 0 };
  const byKind: Record<OutboxKind, number> = { journal_entry: 0, team_signal: 0 };
  for (const c of await statusCounts(pool)) {
    if ((OUTBOX_STATUSES as readonly string[]).includes(c.status)) counts[c.status as OutboxStatus] += c.n;
    if ((OUTBOX_KINDS as readonly string[]).includes(c.kind)) byKind[c.kind as OutboxKind] += c.n;
  }
  const items: OutboxListItem[] = (await listingRows(pool, OUTBOX_LISTING_LIMIT)).map((r) => ({
    id: String(r.id),
    kind: String(r.kind) as OutboxKind,
    period: String(r.period ?? ""),
    codeName: r.code_name === null || r.code_name === undefined ? null : String(r.code_name),
    chars: Number(r.text_chars ?? 0),
    status: String(r.status) as OutboxStatus,
    attempts: Number(r.attempts ?? 0),
    createdAt: new Date(r.created_at).toISOString(),
  }));
  return {
    writePath: outboxTransport() !== null,
    journalOn: effectiveLifecycle("journal") !== "off",
    counts,
    byKind,
    pendingVendorDelete: await codeNamesPendingVendorDelete(pool),
    items,
  };
}

/**
 * The differences between the outside service's chart and the live chart,
 * read at request time for the two routes in server/routes/saberra.ts.
 *
 * It gathers what the one pure function (`differences` in
 * shared/seraDifferences.ts) needs and hands it over: the stored snapshots the
 * rules read, the live chart (`liveChart`, the structure review's own reader),
 * which roles have pay set, the name swap, and what this village published
 * from the service, traced to what the service itself said (R2).
 *
 * ── WHICH SNAPSHOTS ──────────────────────────────────────────────────────
 *
 * Not all thirty. The newest two (the service now, and whether a record was
 * seen before), the newest at least a day old (the facts digest and a pay
 * figure), and the two newest whole reads of each kind (missing twice). The
 * index that chooses them reads no records.
 *
 * ── THE BASE, TRACED ─────────────────────────────────────────────────────
 *
 * A published change is traced to the proposals accepted into its draft, and
 * only to one whose stored payload still hashes to the dedupe key it landed
 * under. A steward's edit at accept overwrites the payload and never the key,
 * so an edited proposal fails the check and its changes are left out of the
 * base. So does a structure split at accept, whose kept half is stored as an
 * edit: those fields read as an unknown base, flagged, until a later accept.
 *
 * ── THE CACHE ────────────────────────────────────────────────────────────
 *
 * The answer is computed once per change of anything it depends on: the rows
 * chosen, which of them is the read a day before (the clock moves it), the
 * live chart, the published history, and who the name swap knows. The cheap
 * reads that decide the key run every time; the snapshots' records and the
 * history are read only on a miss. A row pruned between choosing and reading
 * makes the rows be chosen again, once, and an answer from part of its rows
 * is never kept.
 *
 * ── WHO HOLDS EACH ROLE ──────────────────────────────────────────────────
 *
 * A role is named with its holders' first names in its sentence ("Role
 * (FirstName)", Rye 2026-10-30). The names are read from the seatings HERE on
 * every call, outside the cache, and never from the service, so a seating
 * changed a moment ago shows at once and nothing the service holds names
 * anybody.
 *
 * WRITES NOTHING. No row, no event, no notice: looking at the list changes
 * nothing anywhere.
 */
import { createHash } from "crypto";
import type { Pool } from "mysql2/promise";
import { canonicalJson } from "../../shared/canonicalJson";
import { pageKey } from "../../shared/seraWaiting";
import {
  countDifferences,
  differences,
  type Difference,
  type DifferenceCount,
  type Snapshot,
  type SnapshotRead,
} from "../../shared/seraDifferences";
import { differenceSentence, flagWords, openInUrl, openInWords, shownFlags, sourceWords } from "../../shared/seraDifferenceWords";
import { nameCheckFor } from "./saberraNames";
import { acceptedForDifferences, liveForDifferences } from "./saberraSnapshot";
import { listOrgAssignments, type LapseContext, type OrgAssignment } from "./orgChart";
import { rosterRows } from "../repos/peopleRoster";
import { snapshotIndex, snapshotsBySeq, type SnapshotIndexRow } from "../repos/saberraSnapshots";
import { publishStamp } from "../repos/seraDifferences";
import { answersFor, linksFor, publishedRoleChanges } from "../repos/seraSettled";
import { withAnswers, type SettledRow } from "../../shared/seraSettle";
import { normaliseText, valueHash } from "../../shared/seraDifferences";

const MODULE_ID = "saberra";
const DAY_SECONDS = 24 * 60 * 60;

export interface DifferencesRead {
  list: Difference[];
  /** The newest read, or null before the first one. */
  latest: { takenAt: string; circles: SnapshotRead; roles: SnapshotRead } | null;
  /** When each kind was last read whole, so a failed read can say which check the list is from (R36). */
  lastWhole: { circles: string | null; roles: string | null };
  /** The circles here in chart order, by id, so the page can group in that order (US2.3). Ids only, never a name. */
  circleOrder: string[];
  /** Who holds each role here now, by role id, as names. Read on every call, never cached. */
  holders: Record<string, string[]>;
  /** Every page id the newest read holds, as one key: an arrival is held in the list when all of its are here. */
  heldPageIds: string[];
  /**
   * How each difference was answered (0350), read on every call outside the
   * cache, so an answer given a moment ago shows at once. Absent: nothing has
   * been answered, and the list is the engine's whole.
   */
  answers?: ReadonlyMap<string, SettledRow>;
}

/**
 * The page ids a read READ ITSELF (review R3-3): a kind read whole, and in it
 * no record carried from the read before (`readAt`). A record a failed or cut
 * kind carried is the older read's, so an arrival landed from that run is not
 * held by this one.
 */
export function heldPageIdsOf(top: Snapshot): string[] {
  const own = (k: Snapshot["circles"]) => (k.read === "whole" ? k.records.filter((r) => !r.readAt) : []);
  return [...own(top.circles), ...own(top.roles)].map((r) => pageKey(r.id));
}

/** One waiting proposal that changes the chart, from the service, as the list reads it. */
export interface WaitingChartItem {
  batchId: string;
  kind: string;
  receivedAt: string | null;
  payload: Record<string, unknown> | null;
}

/** The page ids one proposal carries: a structure's seats, or a record's own id. */
function pageIdsOf(item: WaitingChartItem): string[] {
  const p = item.payload ?? {};
  const seats = Array.isArray(p.seats) ? p.seats : [];
  const ids = seats.map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>).id : null));
  ids.push(p.vendorRecordId, p.id);
  return ids.filter((x): x is string => typeof x === "string" && x.trim() !== "").map(pageKey);
}

/**
 * WHICH ARRIVAL HOLDS EACH DIFFERENCE (review C7), and which arrivals the newest
 * read holds whole (review S1). A role is held by the waiting structure carrying
 * its page id, a circle by the waiting record of that id; the newest arrival
 * wins, by its newest item. None is null, and the page says so with no link.
 */
export function batchLinks(
  list: ReadonlyArray<Pick<Difference, "subject">>,
  items: readonly WaitingChartItem[],
  heldPageIds: readonly string[],
  /** When the newest read was taken: an arrival newer than it cannot be held by it (review K6). */
  readAt: string | null,
): { links: (string | null)[]; held: string[] } {
  const byBatch = new Map<string, { newest: number; ids: Set<string>; anyWithout: boolean }>();
  for (const it of items) {
    const b = byBatch.get(it.batchId) ?? { newest: 0, ids: new Set<string>(), anyWithout: false };
    b.newest = Math.max(b.newest, Date.parse(it.receivedAt ?? "") || 0);
    const ids = pageIdsOf(it);
    if (ids.length === 0) b.anyWithout = true;
    for (const id of ids) b.ids.add(id);
    byBatch.set(it.batchId, b);
  }
  const newestFirst = Array.from(byBatch.entries()).sort((x, y) => y[1].newest - x[1].newest);
  const links = list.map((d) => {
    const id = d.subject.pageId ? pageKey(d.subject.pageId) : null;
    return id ? (newestFirst.find(([, b]) => b.ids.has(id))?.[0] ?? null) : null;
  });
  const here = new Set(heldPageIds.map(pageKey));
  const readMs = readAt ? Date.parse(readAt) : NaN;
  const held = newestFirst
    .filter(([, b]) => Number.isFinite(readMs) && b.newest > 0 && b.newest < readMs)
    .filter(([, b]) => !b.anyWithout && b.ids.size > 0 && Array.from(b.ids).every((id) => here.has(id)))
    .map(([k]) => k);
  return { links, held };
}

/** Each role's holders here, by name: a member by the roster's name, a documented holder by the name written. Examples left out. */
export function holderNamesByRole(
  seatings: readonly Pick<OrgAssignment, "orgRoleId" | "userId" | "displayName" | "isExample" | "lapsed">[],
  roster: readonly { id: string | null; name: string }[],
): Record<string, string[]> {
  const nameOf = new Map(roster.filter((r) => r.id !== null).map((r) => [String(r.id), r.name]));
  const out: Record<string, string[]> = {};
  for (const a of seatings) {
    // An example, or a seating whose term has lapsed, names nobody (review N5).
    if (a.isExample || a.lapsed) continue;
    const name = a.userId ? nameOf.get(String(a.userId)) : a.displayName;
    if (!name) continue;
    (out[a.orgRoleId] ??= []).push(name);
  }
  return out;
}

/**
 * The rows the rules read, from the index, newest first: the newest two, the
 * newest at least a day before `now` (or the oldest kept when none is yet),
 * and the two newest whole reads of each kind.
 */
export function snapshotsNeeded(index: readonly SnapshotIndexRow[], nowSeconds: number): number[] {
  const want = new Set<number>(index.slice(0, 2).map((r) => r.seq));
  const older = index.slice(1);
  const dayBefore = older.find((r) => r.taken <= nowSeconds - DAY_SECONDS) ?? older[older.length - 1];
  if (dayBefore) want.add(dayBefore.seq);
  for (const r of index.filter((x) => x.circlesRead === "whole").slice(0, 2)) want.add(r.seq);
  for (const r of index.filter((x) => x.rolesRead === "whole").slice(0, 2)) want.add(r.seq);
  return Array.from(want).sort((a, b) => b - a);
}

/**
 * The last answer and what it was computed from. The key holds the row the
 * facts digest and a pay figure compare with, chosen by the clock: the set of
 * rows can stay the same while that row moves within it, and an answer for
 * yesterday's clock must never serve today's.
 */
let cached: { key: string; value: DifferencesRead } | null = null;

export async function readDifferences(pool: Pool, now: number = Date.now(), lapse?: LapseContext): Promise<DifferencesRead> {
  // Twice at most: a row pruned between choosing the rows and reading them is chosen again, once.
  for (let attempt = 1; ; attempt += 1) {
    const [index, liveIn, stamp, roster, seatings, links, answers] = await Promise.all([
      snapshotIndex(pool),
      liveForDifferences(pool),
      publishStamp(pool, MODULE_ID),
      rosterRows(pool),
      // With the lapse context, so a lapsed holder is never named (review N5).
      listOrgAssignments(pool, lapse),
      // The page ids a person tied to ours (R1): they match before anything else does.
      linksFor(pool),
      answersFor(pool),
    ]);
    const holders = holderNamesByRole(seatings, roster);
    const check = nameCheckFor(roster);
    const nowSeconds = Math.floor(now / 1000);
    const seqs = snapshotsNeeded(index, nowSeconds);
    // The read a day before, by the rule `snapshotsNeeded` chooses it by, so the key moves with the clock.
    const older = index.slice(1);
    const dayBefore = (older.find((r) => r.taken <= nowSeconds - DAY_SECONDS) ?? older[older.length - 1])?.seq ?? null;
    const key = createHash("sha256").update(canonicalJson({ seqs, dayBefore, live: liveIn, stamp, names: check.fingerprint, links })).digest("hex");
    if (cached?.key === key) return { ...cached.value, holders, answers };

    const [rows, accepted] = await Promise.all([snapshotsBySeq(pool, seqs), acceptedForDifferences(pool)]);
    // A chosen row went (a prune ran in between): choose again rather than answer from part of them.
    const whole = rows.length === seqs.length;
    if (!whole && attempt < 2) continue;
    const snapshots = rows.map((r) => r.snapshot);
    const list = differences({ snapshots, live: liveIn, accepted, links, asOf: new Date(now).toISOString(), swap: check.swap });
    const top = snapshots[0];
    // From the index, which is newest first; the two newest whole reads of each kind are in `seqs`, so the key moves with them.
    const wholeAt = (kind: "circlesRead" | "rolesRead") => {
      const row = index.find((r) => r[kind] === "whole");
      return row ? new Date(row.taken * 1000).toISOString() : null;
    };
    const value: DifferencesRead = {
      list,
      latest: top ? { takenAt: top.takenAt, circles: top.circles.read, roles: top.roles.read } : null,
      lastWhole: { circles: wholeAt("circlesRead"), roles: wholeAt("rolesRead") },
      circleOrder: liveIn.circles.map((c) => c.id),
      holders,
      heldPageIds: top ? heldPageIdsOf(top) : [],
    };
    // An answer from part of its rows is given once and never kept.
    if (whole) cached = { key, value };
    return { ...value, answers };
  }
}

/** For tests: forget the cached answer. */
export function forgetCachedDifferences(): void {
  cached = null;
}

/** The newest read whole for both kinds. */
const wholeRead = (read: DifferencesRead): boolean => read.latest !== null && read.latest.circles === "whole" && read.latest.roles === "whole";

/** The list once every answer is read: what still waits, what is set aside, and what is in a draft (R13, R16). */
export function answered(read: DifferencesRead) {
  return withAnswers(read.list, read.answers ?? new Map());
}

export type CountAnswer = DifferenceCount & {
  lastReadAt: string | null;
  lastReadWhole: boolean;
  /** Each open draft the list's answers made, by id and how many changes it holds: no subject (R38's door to a vote). */
  drafts: Array<{ id: string; changes: number }>;
};

/** R25: totals per lane and the last read, and never a subject. What is answered or in a draft waits for nobody. */
export function countAnswer(read: DifferencesRead): CountAnswer {
  const a = answered(read);
  return {
    ...countDifferences(a.open),
    lastReadAt: read.latest?.takenAt ?? null,
    lastReadWhole: wholeRead(read),
    drafts: a.inDraft.map((g) => ({ id: g.draftId, changes: g.items.length })),
  };
}

/**
 * When somebody here last rewrote the field each conflict is about, as an ISO
 * time, for "Someone here rewrote it on 1 Nov". Only from published draft
 * history, and only where that change is what stands now: a field changed by
 * hand since has no time to give, and gets none.
 */
export async function changedHereAt(pool: Pool, list: readonly Difference[], swap: (t: string) => string = (t) => t): Promise<Record<string, string>> {
  const conflicts = list.filter((d) => d.state === "conflict" && d.subject.kind === "role" && d.subject.ourId && (d.field === "name" || d.field === "aim"));
  if (conflicts.length === 0) return {};
  const changes = await publishedRoleChanges(pool, Array.from(new Set(conflicts.map((d) => d.subject.ourId!))));
  const out: Record<string, string> = {};
  for (const d of conflicts) {
    const field = d.field as "name" | "aim";
    const last = changes.find((c) => c.orgRoleId === d.subject.ourId && (c.op === "create_seat" || Object.prototype.hasOwnProperty.call(c.payload, field)));
    if (!last || !last.at) continue;
    const raw = last.payload[field];
    const value = typeof raw === "string" && field === "aim" ? normaliseText(swap(raw)) : normaliseText(raw);
    if (valueHash(value) === d.oursHash) out[d.key] = new Date(last.at * 1000).toISOString();
  }
  return out;
}

export interface ListedDifference extends Difference {
  setAside?: true;
  changedHereAt?: string;
  words: { sentence: string; flags: string[]; source: string; open: string | null; openWords: string };
}

/** The whole list, each difference with its words, for a reader the list's gate let in. */
export function listAnswer(
  read: DifferencesRead,
  opts: { agent: string; dashboard: unknown; timeZone: string; waiting?: readonly WaitingChartItem[]; changedHere?: Readonly<Record<string, string>> },
): {
  agent: string;
  lastReadAt: string | null;
  lastReadWhole: boolean;
  reads: { circles: SnapshotRead; roles: SnapshotRead } | null;
  lastWholeAt: { circles: string | null; roles: string | null };
  circleOrder: string[];
  heldBatches: string[];
  count: DifferenceCount;
  differences: ListedDifference[];
  inDraft: Array<{ draftId: string; title: string | null; items: Array<{ key: string; sentence: string }>; with: number }>;
} {
  const { agent, dashboard, timeZone } = opts;
  const a = answered(read);
  const { links, held } = batchLinks(a.open, opts.waiting ?? [], read.heldPageIds ?? [], read.latest?.takenAt ?? null);
  const sentenceOf = (d: Difference) => wordsOf(d, read, { agent, dashboard, timeZone }).sentence;
  return {
    agent,
    lastReadAt: read.latest?.takenAt ?? null,
    lastReadWhole: wholeRead(read),
    reads: read.latest ? { circles: read.latest.circles, roles: read.latest.roles } : null,
    lastWholeAt: read.lastWhole,
    circleOrder: read.circleOrder,
    heldBatches: held,
    count: countDifferences(a.open),
    // R13: what a person took, in its own group, with its draft (the page offers Publish and Withdraw).
    inDraft: a.inDraft.map((g) => ({ draftId: g.draftId, title: g.title, items: g.items.map((d) => ({ key: d.key, sentence: sentenceOf(d) })), with: g.with.length })),
    differences: a.open.map((d, i) => ({
      ...d,
      // The arrival that holds it, for the structure review link; moderator data, never on the count.
      batchId: links[i],
      // R16: kept by somebody without the power to decide it, so it waits for those who have it.
      ...(a.setAside.has(d.key) ? { setAside: true } : {}),
      // When somebody here rewrote what a conflict is about, where published history says so.
      ...(opts.changedHere?.[d.key] ? { changedHereAt: opts.changedHere[d.key] } : {}),
      words: wordsOf(d, read, { agent, dashboard, timeZone }),
    })),
  };
}

/** One difference's words, as the list sends them: its sentence, its shown flags, where it came from, and the link to the service. */
export function wordsOf(d: Difference, read: Pick<DifferencesRead, "holders">, opts: { agent: string; dashboard: unknown; timeZone: string }): ListedDifference["words"] {
  const { agent } = opts;
  return {
    // A role here is named with who holds it here; a circle, or a role not here yet, with nobody.
    sentence: differenceSentence(d, agent, d.subject.kind === "role" && d.subject.ourId ? { holders: read.holders[d.subject.ourId] ?? [] } : {}),
    // Shown flags only (R39); `d.flags` keeps every one for R2.
    flags: shownFlags(d).map((f) => flagWords(f, agent)),
    source: sourceWords(d, agent, opts.timeZone),
    open: d.source.pageId ? openInUrl(opts.dashboard, d.source.pageId) : null,
    openWords: openInWords(agent),
  };
}

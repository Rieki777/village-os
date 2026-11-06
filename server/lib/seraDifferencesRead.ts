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
 * chosen, the live chart, the published history, and who the name swap knows.
 * The cheap reads that decide the key run every time; the snapshots' records
 * and the history are read only on a miss.
 *
 * WRITES NOTHING. No row, no event, no notice: looking at the list changes
 * nothing anywhere.
 */
import { createHash } from "crypto";
import type { Pool } from "mysql2/promise";
import { canonicalJson } from "../../shared/canonicalJson";
import {
  countDifferences,
  differences,
  traceAccepted,
  type Difference,
  type DifferenceCount,
  type DifferencesInput,
  type SnapshotRead,
} from "../../shared/seraDifferences";
import { differenceSentence, flagWords, openInUrl, openInWords, sourceWords } from "../../shared/seraDifferenceWords";
import { dedupeKeyFor } from "./externalProposals";
import { nameCheckFor } from "./saberraNames";
import { liveChart } from "./structureReview";
import { rosterRows } from "../repos/peopleRoster";
import { snapshotIndex, snapshotsBySeq, type SnapshotIndexRow } from "../repos/saberraSnapshots";
import { acceptedProposalsFor, circlesForDifferences, publishedFromModule, publishStamp, rolesWithPaySet } from "../repos/seraDifferences";

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

let cached: { key: string; value: DifferencesRead } | null = null;

export async function readDifferences(pool: Pool, now: number = Date.now()): Promise<DifferencesRead> {
  const [index, circles, paid, stamp, roster] = await Promise.all([
    snapshotIndex(pool),
    circlesForDifferences(pool),
    rolesWithPaySet(pool),
    publishStamp(pool, MODULE_ID),
    rosterRows(pool),
  ]);
  const live = await liveChart(pool, circles);
  const check = nameCheckFor(roster);
  const seqs = snapshotsNeeded(index, Math.floor(now / 1000));
  const liveIn: DifferencesInput["live"] = {
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
    })),
  };
  const key = createHash("sha256").update(canonicalJson({ seqs, live: liveIn, stamp, names: check.fingerprint })).digest("hex");
  if (cached?.key === key) return cached.value;

  const [rows, changes] = await Promise.all([snapshotsBySeq(pool, seqs), publishedFromModule(pool, MODULE_ID)]);
  const proposals = await acceptedProposalsFor(pool, MODULE_ID, Array.from(new Set(changes.map((c) => c.draftId))));
  const accepted = traceAccepted(
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
  const snapshots = rows.map((r) => r.snapshot);
  const list = differences({ snapshots, live: liveIn, accepted, asOf: new Date(now).toISOString(), swap: check.swap });
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
  };
  cached = { key, value };
  return value;
}

/** For tests: forget the cached answer. */
export function forgetCachedDifferences(): void {
  cached = null;
}

/** The newest read whole for both kinds. */
const wholeRead = (read: DifferencesRead): boolean => read.latest !== null && read.latest.circles === "whole" && read.latest.roles === "whole";

export type CountAnswer = DifferenceCount & { lastReadAt: string | null; lastReadWhole: boolean };

/** R25: totals per lane and the last read, and never a subject. */
export function countAnswer(read: DifferencesRead): CountAnswer {
  return { ...countDifferences(read.list), lastReadAt: read.latest?.takenAt ?? null, lastReadWhole: wholeRead(read) };
}

export interface ListedDifference extends Difference {
  words: { sentence: string; flags: string[]; source: string; open: string | null; openWords: string };
}

/** The whole list, each difference with its words, for a reader the list's gate let in. */
export function listAnswer(
  read: DifferencesRead,
  opts: { agent: string; dashboard: unknown; timeZone: string },
): {
  agent: string;
  lastReadAt: string | null;
  lastReadWhole: boolean;
  reads: { circles: SnapshotRead; roles: SnapshotRead } | null;
  lastWholeAt: { circles: string | null; roles: string | null };
  circleOrder: string[];
  count: DifferenceCount;
  differences: ListedDifference[];
} {
  const { agent, dashboard, timeZone } = opts;
  return {
    agent,
    lastReadAt: read.latest?.takenAt ?? null,
    lastReadWhole: wholeRead(read),
    reads: read.latest ? { circles: read.latest.circles, roles: read.latest.roles } : null,
    lastWholeAt: read.lastWhole,
    circleOrder: read.circleOrder,
    count: countDifferences(read.list),
    differences: read.list.map((d) => ({
      ...d,
      words: {
        sentence: differenceSentence(d, agent),
        flags: d.flags.map((f) => flagWords(f, agent)),
        source: sourceWords(d, agent, timeZone),
        open: d.source.pageId ? openInUrl(dashboard, d.source.pageId) : null,
        openWords: openInWords(agent),
      },
    })),
  };
}

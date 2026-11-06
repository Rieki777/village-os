/**
 * The differences between the outside service's chart and the live chart,
 * read at request time for the two routes in server/routes/saberra.ts.
 *
 * It gathers four things and hands them to the one pure function
 * (`differences` in shared/seraDifferences.ts): the newest stored snapshots,
 * the live chart (`liveChart`, the structure review's own reader), which roles
 * have pay set, and what this village published from the service. The count
 * and the list are both built from that one read, so they cannot disagree.
 *
 * WRITES NOTHING. No row, no event, no notice: looking at the list changes
 * nothing anywhere.
 */
import type { Pool } from "mysql2/promise";
import { countDifferences, differences, type Difference, type DifferenceCount, type SnapshotRead } from "../../shared/seraDifferences";
import { differenceSentence, flagWords, openInUrl, openInWords, sourceWords } from "../../shared/seraDifferenceWords";
import { SNAPSHOT_KEEP } from "./saberraSnapshot";
import { liveChart } from "./structureReview";
import { recentSnapshots } from "../repos/saberraSnapshots";
import { circlesForDifferences, publishedFromModule, rolesWithPaySet } from "../repos/seraDifferences";

const MODULE_ID = "saberra";

export interface DifferencesRead {
  list: Difference[];
  /** The newest read, or null before the first one. */
  latest: { takenAt: string; circles: SnapshotRead; roles: SnapshotRead } | null;
}

export async function readDifferences(pool: Pool): Promise<DifferencesRead> {
  const [rows, circles, paid, accepted] = await Promise.all([
    recentSnapshots(pool, SNAPSHOT_KEEP),
    circlesForDifferences(pool),
    rolesWithPaySet(pool),
    publishedFromModule(pool, MODULE_ID),
  ]);
  const live = await liveChart(pool, circles);
  const snapshots = rows.map((r) => r.snapshot);
  const list = differences({
    snapshots,
    live: {
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
    },
    accepted,
  });
  const top = snapshots[0];
  return { list, latest: top ? { takenAt: top.takenAt, circles: top.circles.read, roles: top.roles.read } : null };
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
  count: DifferenceCount;
  differences: ListedDifference[];
} {
  const { agent, dashboard, timeZone } = opts;
  return {
    agent,
    lastReadAt: read.latest?.takenAt ?? null,
    lastReadWhole: wholeRead(read),
    reads: read.latest ? { circles: read.latest.circles, roles: read.latest.roles } : null,
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

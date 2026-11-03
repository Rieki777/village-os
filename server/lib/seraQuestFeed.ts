/**
 * Sera's quest feed into the village's quest review queue.
 *
 * Reads list_quest_proposals page by page (has_more / next_cursor), with
 * changed_since after the first real run. Each quest lands through
 * `proposeQuest`, the same door the public form and companions use, so nothing
 * reaches the board until a steward accepts it and types the reward. A quest
 * already held under its Sera id, in any status, is counted as already seen
 * and never re-proposed, so a rejected one stays rejected.
 *
 * A dry run reads and counts and writes nothing, not even the bookmark.
 */
import type { Pool } from "mysql2/promise";
import { mapSeraQuest, type QuestFeedAnswer } from "../../shared/seraQuestFeed";
import { instanceIdentity } from "./identity";
import { effectiveLifecycle } from "./modules";
import { proposeQuest } from "./questProposals";
import { callToolJson, listTools, openSession } from "./saberraClient";
import { preflight } from "./saberraSync";
import { questFeedSetting, seenSeraQuestIds, setQuestFeedSetting } from "../repos/seraQuestFeed";

export const QUEST_FEED_MODULE = "saberra";
const TOOL = "list_quest_proposals";
const MAX_PAGES = 20;
/** One batch per day, so a steward's review is one sitting; the cap only guards a runaway feed. */
const BATCH_CAP = 200;

/** Pure: one page's results and the next cursor, from whatever shape the answer took. */
export function pageOf(value: unknown): { results: unknown[]; next: string | null; dropped: number } {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const results = Array.isArray(v.results) ? v.results : Array.isArray(value) ? (value as unknown[]) : [];
  const next = v.has_more === true && typeof v.next_cursor === "string" && v.next_cursor ? v.next_cursor : null;
  const dropped = Number.isFinite(Number(v.dropped_for_email)) ? Number(v.dropped_for_email) : 0;
  return { results, next, dropped };
}

export async function runQuestFeed(pool: Pool, opts: { dryRun: boolean }): Promise<QuestFeedAnswer> {
  const at = new Date().toISOString();
  const out: QuestFeedAnswer = { dryRun: opts.dryRun, status: "ok", read: 0, queued: 0, alreadySeen: 0, droppedForEmail: 0, refusedHere: 0, at };
  if (effectiveLifecycle("saberra") === "off") return { ...out, status: "not-connected", detail: "the module is off" };
  const pre = preflight();
  if (!pre.ok) return { ...out, status: "not-connected", detail: String(pre.gap) };
  const session = await openSession(pre.client);
  if (!session) return { ...out, status: "not-connected", detail: "no session" };
  const listing = await listTools(pre.client, session);
  if (!listing.ok || !listing.tools.some((t) => t.name === TOOL)) return { ...out, status: "no-tool", detail: `the service does not offer ${TOOL}` };

  const since = await questFeedSetting(pool, "quest_feed_since");
  const batchId = `sera-quests-${at.slice(0, 10)}`;
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r = await callToolJson(pre.client, session, TOOL, { page_size: 50, ...(cursor ? { cursor } : {}), ...(since ? { changed_since: since } : {}) });
    if (!r.ok) return { ...out, status: "error", detail: `${r.why}: ${r.detail}`.slice(0, 200) };
    const page = pageOf(r.value);
    out.droppedForEmail += page.dropped;
    out.read += page.results.length;
    const mapped = page.results.map(mapSeraQuest);
    out.refusedHere += mapped.filter((m) => !m).length;
    const good = mapped.filter((m): m is NonNullable<typeof m> => !!m);
    const seen = await seenSeraQuestIds(pool, QUEST_FEED_MODULE, good.map((m) => m.seraId.slice(0, 64)));
    for (const m of good) {
      if (seen.has(m.seraId.slice(0, 64))) {
        out.alreadySeen += 1;
        continue;
      }
      if (opts.dryRun) {
        out.queued += 1;
        continue;
      }
      const landed = await proposeQuest(pool, {
        villageId: instanceIdentity().instanceId, moduleId: QUEST_FEED_MODULE, batchId, batchCap: BATCH_CAP,
        sourceProposalId: m.seraId, prose: m.prose, rationale: m.rationale, quote: m.quote, sourceRef: m.sourceRef, proposedByKind: "agent",
      });
      if (!landed.ok) out.refusedHere += 1;
      else if (landed.outcome === "duplicate") out.alreadySeen += 1;
      else out.queued += 1;
    }
    cursor = page.next;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);

  if (!opts.dryRun) {
    await setQuestFeedSetting(pool, "quest_feed_since", at);
    await setQuestFeedSetting(pool, "quest_feed_last", JSON.stringify({ r: out.read, q: out.queued, s: out.alreadySeen, d: out.droppedForEmail, x: out.refusedHere, at }));
  }
  return out;
}

/** The last real run's counts, for the board. */
export async function lastQuestFeed(pool: Pool): Promise<QuestFeedAnswer | null> {
  try {
    const raw = await questFeedSetting(pool, "quest_feed_last");
    if (!raw) return null;
    const j = JSON.parse(raw) as Record<string, unknown>;
    const n = (k: string) => Number(j[k] ?? 0) || 0;
    return { dryRun: false, status: "ok", read: n("r"), queued: n("q"), alreadySeen: n("s"), droppedForEmail: n("d"), refusedHere: n("x"), at: String(j.at ?? "") };
  } catch {
    return null;
  }
}

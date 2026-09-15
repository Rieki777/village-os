/**
 * A public form's submission, stored, and a quest idea put where a steward decides.
 *
 * ── THE PROPOSE A QUEST FORM FEEDS THE REVIEW QUEUE (Rye, 2026-09-14) ────
 *
 * "People should be able to propose quests." Until that ruling the form wrote
 * only `submissions`, the quest half of /review was permanently empty, and
 * `proposeQuest` (server/lib/questProposals.ts) had no caller outside its own
 * test. Now a `quest-proposal` submission is stored exactly as before, and a
 * `quest_proposals` row is derived from it for a steward holding
 * `quest.approve` to accept, with the reward that steward types.
 *
 * ── WHAT IS COPIED, AND WHAT IS NOT ──────────────────────────────────────
 *
 * The idea is copied: the title, what the person wants to do, and what they
 * bring, need, ask for in return and by when. Who they are is not. Name and
 * email stay in the submission, which the admin inbox, the member export, the
 * retention sweep and erasure already handle. The proposal points back at it
 * through `source_ref` (`submission:<id>`). A signed-in member's id goes in
 * `proposed_by`, which erasure clears (server/repos/questProposals.ts).
 *
 * ── THE SUBMISSION IS THE RECORD, THE PROPOSAL IS DERIVED ────────────────
 *
 * A proposal that cannot be stored leaves the submission standing and the
 * response unchanged, because the steward inbox still receives every
 * submission. `proposeQuest` refuses an idea carrying an email address (the
 * screen vendor intake uses) or with nothing to title it by, and refuses one
 * past an allowance: three open ideas per member, ten from visitors together.
 * A database error keeps one out as well. So the derivation is awaited, logged
 * when it refuses, and never allowed to throw into the form's response.
 *
 * ── WHY server/index.ts CALLS THIS INSTEAD OF DOING IT ───────────────────
 *
 * `POST /api/forms/submit` lives in server/index.ts, which may not grow
 * (scripts/check-server-index-size.mjs counts every line but a route import
 * and a register call). The handler's one INSERT became one call to
 * `landPublicSubmission`, and the reasoning lives here.
 */
import { createHash } from "crypto";
import type { Pool } from "mysql2/promise";
import { PROPOSE_QUEST_MODULE, QUEST_IDEA_FORM } from "../../shared/questIdeas";
import { villageId } from "./economy";
import { proposeQuest, type ProposeQuestResult } from "./questProposals";

/**
 * How many ideas one member may hold in the review queue at once.
 *
 * The form's rate limit caps a burst from one address, and nothing capped a
 * member filling the queue over a week. A fourth idea is not lost: it stays in
 * the steward inbox as a submission, and the member can propose it again once a
 * steward has decided on one of the three.
 */
export const OPEN_IDEAS_PER_MEMBER = 3;

/**
 * How many ideas from visitors, taken together, may wait in the review queue.
 *
 * A visitor has no identity to count against, so visitors share one allowance.
 * The rate limit bounds a burst from one address, and this bounds a flood from
 * many, which would otherwise bury the ideas a steward is there to read. An idea
 * past it is not lost either: it stays in the steward inbox.
 */
export const OPEN_VISITOR_IDEAS = 10;

/** What the form sends. Every field is caller-controlled JSON, and nothing upstream checks a type. */
type FormData = Record<string, unknown>;

export interface SubmissionEntry {
  id: string;
  type: string;
  data: unknown;
  userId?: string;
  userName?: string;
  [key: string]: unknown;
}

/** A string the caller sent, trimmed, or empty. */
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The title a steward reads. The form's own title when there is one, which is
 * optional on the page; otherwise the first line of what the person wants to
 * do, cut at a word boundary short enough to read as a title.
 */
export function titleFrom(data: FormData): string {
  const given = text(data.title);
  if (given) return given;
  const first = text(data.whatYouWantToDo).split(/\r?\n/)[0]?.trim() ?? "";
  if (first.length <= 80) return first;
  const cut = first.slice(0, 80);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : cut).trimEnd();
}

/** The form's four practical answers, one labelled line each, in the order the page asks them. */
const ASKED: ReadonlyArray<readonly [key: string, label: string]> = [
  ["resourcesBringing", "What they bring"],
  ["resourcesNeeded", "What they need"],
  ["compensation", "What they ask in return"],
  ["timelineMilestones", "Timeline"],
];

export function rationaleFrom(data: FormData): string | null {
  const lines = ASKED.map(([key, label]) => {
    const value = text(data[key]);
    return value ? `${label}: ${value}` : null;
  }).filter((line): line is string => line !== null);
  return lines.length ? lines.join("\n") : null;
}

/**
 * The batch a quest idea counts against. `proposeQuest` refuses a batch already
 * holding its cap of open ideas, so the batch is where each allowance above is
 * counted. A member's ideas share one batch, hashed because `batch_id` holds 64
 * characters and a user id may already be 64. Visitors share one between them.
 * Both begin with the module id, because every source of quest proposals counts
 * its batches in the same column.
 */
function batchFor(member: string | null): { batchId: string; batchCap: number } {
  if (!member) return { batchId: `${PROPOSE_QUEST_MODULE}:visitors`, batchCap: OPEN_VISITOR_IDEAS };
  const digest = createHash("sha256").update(member).digest("hex").slice(0, 32);
  return { batchId: `${PROPOSE_QUEST_MODULE}:member:${digest}`, batchCap: OPEN_IDEAS_PER_MEMBER };
}

/** Derive and store the review queue's copy of a quest idea. Refusals come back as values; a database error throws. */
export async function proposeQuestFromSubmission(pool: Pool, entry: SubmissionEntry): Promise<ProposeQuestResult> {
  const data: FormData =
    entry.data && typeof entry.data === "object" && !Array.isArray(entry.data) ? (entry.data as FormData) : {};
  const member = typeof entry.userId === "string" && entry.userId ? entry.userId : null;
  return proposeQuest(pool, {
    villageId: villageId(),
    moduleId: PROPOSE_QUEST_MODULE,
    ...batchFor(member),
    prose: { title: titleFrom(data), description: text(data.whatYouWantToDo) || null },
    rationale: rationaleFrom(data),
    quote: null,
    sourceRef: `submission:${entry.id}`,
    proposedBy: member,
    proposedByKind: "human",
  });
}

/**
 * Store a public form's submission, and queue a quest idea for review.
 *
 * The submission is one INSERT, never a snapshot, a push and a `replaceAll`:
 * two concurrent public submissions raced that way, and the later whole-table
 * rewrite deleted the earlier member's row. It is awaited and may throw, so a
 * submission that could not be stored still answers 500. The proposal is
 * awaited and never throws.
 */
export async function landPublicSubmission(
  submissionsRepo: { insert(entry: any): Promise<unknown> },
  pool: Pool,
  entry: SubmissionEntry,
): Promise<{ proposal: ProposeQuestResult | null }> {
  await submissionsRepo.insert(entry);
  if (entry.type !== QUEST_IDEA_FORM) return { proposal: null };
  try {
    const proposal = await proposeQuestFromSubmission(pool, entry);
    if (!proposal.ok) {
      console.log(`[forms] quest idea ${entry.id} stays in the inbox only: ${proposal.error}`);
    }
    return { proposal };
  } catch (err) {
    console.error(`[forms] quest idea ${entry.id} could not reach the review queue:`, err);
    return { proposal: { ok: false, error: "The review queue could not be written." } };
  }
}

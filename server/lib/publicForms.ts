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
 * bring, need, ask for in return and by when, each cut to what the table keeps
 * before anything reads it. Who they are is not. Name and email stay in the
 * submission, which the admin inbox, the member export, the retention sweep and
 * erasure already handle. The proposal points back at it through `source_ref`
 * (`submission:<id>`). A signed-in member's id goes in `proposed_by`, which the
 * member export lists and erasure clears (server/repos/questProposals.ts), and
 * nothing else on the row is made from it: the batch id names the submission,
 * because a hash of a member's id identifies them to anybody holding the id.
 *
 * ── THE SUBMISSION IS THE RECORD, THE PROPOSAL IS DERIVED ────────────────
 *
 * A proposal that cannot be stored leaves the submission standing and the
 * response unchanged, because the steward inbox still receives every
 * submission. An idea is held back when it carries an email address, has
 * nothing to title it by, or would pass an allowance: three open ideas per
 * member, ten from visitors together. Each one held back is counted in
 * `external_proposal_drops` under this form's module id, which /review already
 * reads out, so a queue emptied by hold-backs does not read like a queue nobody
 * wrote to. A database error keeps an idea out as well, and is logged. The
 * derivation is awaited and never allowed to throw into the form's response.
 *
 * ── THE ALLOWANCES HOLD UNDER A BURST ────────────────────────────────────
 *
 * Counting open ideas and inserting one are two statements. Requests arriving
 * together would all count the same number and all insert, so both run under
 * one named lock, on the connection holding it (`withIdeaLock`). Ideas arrive a
 * few an hour, so nobody waits on it.
 *
 * ── WHY server/index.ts CALLS THIS INSTEAD OF DOING IT ───────────────────
 *
 * `POST /api/forms/submit` lives in server/index.ts, which may not grow
 * (scripts/check-server-index-size.mjs counts every line but a route import
 * and a register call). The handler's one INSERT became one call to
 * `landPublicSubmission`, and the member export reads a member's ideas through
 * `ideasProposedBy`, re-exported here so that file imports one module for both.
 */
import type { Pool } from "mysql2/promise";
import { PROPOSE_QUEST_MODULE, QUEST_IDEA_FORM } from "../../shared/questIdeas";
import { MEMBER_BATCH_PREFIX, VISITOR_BATCH_PREFIX, openIdeas, withIdeaLock } from "../repos/questProposals";
import { villageId } from "./economy";
import { containsEmail, countDrop, type DropReason } from "./externalProposals";
import { proposeQuest, type ProposeQuestResult } from "./questProposals";

export { ideasProposedBy } from "../repos/questProposals";

/**
 * How many ideas one member may hold in the review queue at once.
 *
 * The form's rate limit slows one address down, and nothing capped a member
 * filling the queue over a week. A fourth idea is not lost: it stays in the
 * steward inbox as a submission, and the member can propose it again once a
 * steward has decided on one of the three.
 */
export const OPEN_IDEAS_PER_MEMBER = 3;

/**
 * How many ideas from visitors, taken together, may wait in the review queue.
 *
 * A visitor has no identity to count against, so visitors share one allowance.
 * The rate limit slows one address down, and this bounds a flood from many,
 * which would otherwise bury the ideas a steward is there to read. An idea past
 * it is not lost either: it stays in the steward inbox, and /review counts it.
 */
export const OPEN_VISITOR_IDEAS = 10;

/**
 * The widths `proposeQuest` stores (`W` in server/lib/questProposals.ts), applied
 * before anything reads an idea. A form body may carry a megabyte and the email
 * screen reads every character it is handed, so an idea is first cut to what
 * the table would keep. Four labelled answers of ANSWER_WIDTH fit the
 * rationale's 8000.
 */
const TITLE_WIDTH = 200;
const PROSE_WIDTH = 8000;
const ANSWER_WIDTH = 1900;

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

/** What became of a quest idea: stored, refused, or held back for a reason /review counts. */
export type IdeaOutcome = ProposeQuestResult | { ok: false; error: string; heldBack: DropReason };

/** A string the caller sent, trimmed and cut to `width`, or empty. */
const text = (v: unknown, width: number): string => (typeof v === "string" ? v.trim().slice(0, width) : "");

/**
 * The title a steward reads. The form's own title when there is one, which is
 * optional on the page; otherwise the first line of what the person wants to
 * do, cut at a word boundary short enough to read as a title.
 */
export function titleFrom(data: FormData): string {
  const given = text(data.title, TITLE_WIDTH);
  if (given) return given;
  const first = text(data.whatYouWantToDo, PROSE_WIDTH).split(/\r?\n/)[0]?.trim() ?? "";
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
    const value = text(data[key], ANSWER_WIDTH);
    return value ? `${label}: ${value}` : null;
  }).filter((line): line is string => line !== null);
  return lines.length ? lines.join("\n") : null;
}

/** An idea kept out of the queue, counted where /review reads refusals. */
async function heldBack(pool: Pool, reason: DropReason, error: string): Promise<IdeaOutcome> {
  await countDrop(pool, { villageId: villageId(), moduleId: PROPOSE_QUEST_MODULE, reason });
  return { ok: false, error, heldBack: reason };
}

/** Derive and store the review queue's copy of a quest idea. Hold-backs come back as values; a database error throws. */
export async function proposeQuestFromSubmission(pool: Pool, entry: SubmissionEntry): Promise<IdeaOutcome> {
  const data: FormData =
    entry.data && typeof entry.data === "object" && !Array.isArray(entry.data) ? (entry.data as FormData) : {};
  const member = typeof entry.userId === "string" && entry.userId ? entry.userId : null;
  const prose = { title: titleFrom(data), description: text(data.whatYouWantToDo, PROSE_WIDTH) || null };
  const rationale = rationaleFrom(data);

  if (!prose.title) return heldBack(pool, "empty_payload", "An idea with nothing to title it by stays in the inbox.");
  if (containsEmail([prose, rationale])) {
    return heldBack(pool, "contained_an_email", "An idea carrying an email address stays in the inbox.");
  }
  // One batch per submission, so a batch id says which submission an idea came
  // from and nothing about who sent it.
  const batchId = `${member ? MEMBER_BATCH_PREFIX : VISITOR_BATCH_PREFIX}${entry.id}`;
  if (batchId.length > 64 || (member ?? "").length > 64) {
    return heldBack(pool, "identifier_too_long", "An idea whose identifiers run past 64 characters stays in the inbox.");
  }

  const outcome = await withIdeaLock(pool, async (conn): Promise<ProposeQuestResult | "full"> => {
    const open = await openIdeas(conn, member ? { member } : "visitors");
    if (open >= (member ? OPEN_IDEAS_PER_MEMBER : OPEN_VISITOR_IDEAS)) return "full";
    return proposeQuest(conn, {
      villageId: villageId(),
      moduleId: PROPOSE_QUEST_MODULE,
      batchId,
      batchCap: 1,
      prose,
      rationale,
      quote: null,
      sourceRef: `submission:${entry.id}`,
      proposedBy: member,
      proposedByKind: "human",
    });
  });
  if (outcome !== "full") return outcome;
  return heldBack(
    pool,
    "over_allowance",
    member
      ? `This member already has ${OPEN_IDEAS_PER_MEMBER} ideas waiting for a steward, so this one stays in the inbox.`
      : `${OPEN_VISITOR_IDEAS} ideas from visitors already wait for a steward, so this one stays in the inbox.`,
  );
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
): Promise<{ proposal: IdeaOutcome | null }> {
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

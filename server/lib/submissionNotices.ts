/**
 * WHAT SOMEBODY HEARS WHEN THE THING THEY SENT IN MOVES.
 *
 * `PUT /api/admin/submissions/:id/status` walks one pipeline over half a
 * dozen unrelated acts: an offer to hold a seat, a proposal to work together,
 * a quest somebody thought of, a request to visit, a membership application,
 * an investor asking for a call. The pipeline's own words are `new`,
 * `reviewing`, `in-conversation`, `accepted` and `declined`, and none of them
 * is a sentence for a person. This module turns the move into one.
 *
 * Pure on purpose: every judgement here is copy and privacy, both of which a
 * test can hold without a database.
 *
 * TWO STATUSES SAY NOTHING, and that is the design:
 *
 *  - `new` is where everything starts. Moving one back is a founder
 *    correcting their own filing, and the person who sent it has no stake in
 *    that.
 *  - `in-conversation` records that a human is already talking to them. The
 *    notification would arrive after the conversation it describes, telling
 *    somebody about a thread they are holding one end of.
 */

/**
 * The thing they sent, in their words, keyed by the pipeline's type string.
 * A type absent here falls back to the neutral phrase: a village adding a new
 * form gets a sentence that is plain instead of one that is wrong.
 */
const WHAT_THEY_SENT: Record<string, string> = {
  "role-application": "your offer to hold a seat",
  "work-with-us": "your proposal to work together",
  "quest-proposal": "the quest you proposed",
  "visit-inquiry": "your request to visit",
  "membership-508": "your membership request",
  "membership-request": "your request to join",
  "steward-interest": "your interest in stewarding",
  steward: "your interest in stewarding",
  resident: "your request to live here",
  investor: "your investor enquiry",
  "investor-call": "your request for a call",
  "investor-pack": "your request for the investor pack",
  "investor-doc-request": "your request for the investor documents",
  prosperity: "what you sent us",
  contact: "what you sent us",
};

const FALLBACK = "what you sent us";

/**
 * A raised hand names its seat, because a member may have raised several and
 * "your offer to hold a seat" would leave them guessing which one moved. Only
 * this type carries a name worth saying: the rest are free text a stranger
 * typed, and quoting it back into an email subject is a different decision.
 */
export function submissionSubject(type: string, data?: Record<string, unknown> | null): string {
  const base = WHAT_THEY_SENT[type] ?? FALLBACK;
  if (type === "role-application") {
    const seat = String((data as any)?.roleName ?? "").trim();
    if (seat) return `your offer to hold ${seat}`;
  }
  return base;
}

export interface SubmissionNotice {
  headline: string;
  line: string;
}

/**
 * The words for one move, or null for a move nobody needs to hear about.
 *
 * `declined` is written plainly. A village that lets applications go quiet
 * teaches people to stop applying, and a clear no leaves somebody free to do
 * something else with their week.
 */
export function submissionStatusNotice(
  type: string,
  status: string,
  data?: Record<string, unknown> | null,
): SubmissionNotice | null {
  const subject = submissionSubject(type, data);
  switch (status) {
    case "reviewing":
      return {
        headline: `Someone is reading ${subject}`,
        line: "A person has it open. Nothing is decided yet, and it is no longer sitting unopened.",
      };
    case "accepted":
      return {
        headline: `Yes to ${subject}`,
        line: "Someone from the village will be in touch about what happens next.",
      };
    case "declined":
      return {
        headline: `We are leaving ${subject} where it is`,
        line: "Thank you for sending it. This one is a no for now, and you are welcome to come back with another.",
      };
    default:
      return null;
  }
}

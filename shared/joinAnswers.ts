/**
 * ANSWERING A REQUEST TO JOIN, OUT LOUD: the words (Rye, sheet A5,
 * 2026-10-31). PURE, so the client and the server read one spelling.
 *
 * Before this, Accept on a `membership-request` changed a label and told
 * nobody: the person had no account for the bell to reach, and the founder
 * made an invitation link by hand and emailed it themselves. Now Accept emails
 * the invitation to the address the person typed, and Decline sends a short,
 * kind no (server/routes/joinAnswers.ts).
 *
 * In the 2026-10-02 voice: say what happens next, never how. The letters a
 * stranger reads name the village and the next step. The desk's sentences
 * name what went out, where, and what the admin does when nothing did, and
 * when nothing did the link is right there to send by hand.
 */

/** The form a request to join is filed under (server/lib/comms/paths.ts `JOINING_FORM_TYPE`). */
export const JOIN_REQUEST_TYPE = "membership-request";

/** The invitation an answered request carries, named after the request so a second answer finds it. */
export function joinInviteId(submissionId: string): string {
  return `inv-join-${submissionId}`.slice(0, 64);
}

/** A first name for a greeting, or null when the request gave none worth using. */
export function greetingName(raw: unknown): string | null {
  const first = String(raw ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || first.includes("@") || first.length > 40) return null;
  return first;
}

export interface AcceptLetterIn {
  firstName: string | null;
  village: string;
  /** The whole invitation address, origin included. */
  link: string;
  days: number;
}

/** The yes, as the person reads it. */
export function acceptLetter(i: AcceptLetterIn): { subject: string; text: string } {
  const hello = i.firstName ? `Hi ${i.firstName},` : "Hi,";
  return {
    subject: `Yes, come and join ${i.village}`,
    text: [
      hello,
      "",
      `${i.village} said yes to your request to join.`,
      "",
      "Here is your invitation. Open it to make your account:",
      i.link,
      "",
      `It works once and lasts ${i.days} days.`,
      "",
    ].join("\n"),
  };
}

/** The kind no, as the person reads it. */
export function declineLetter(i: { firstName: string | null; village: string }): { subject: string; text: string } {
  const hello = i.firstName ? `Hi ${i.firstName},` : "Hi,";
  return {
    subject: `Your request to join ${i.village}`,
    text: [
      hello,
      "",
      `Thank you for asking to join ${i.village}. We can't say yes this time.`,
      "",
      "We're glad you found us, and we wish you well.",
      "",
    ].join("\n"),
  };
}

/** Why an email did not go out, in the desk's words. */
export type NotSentWhy = "not_set_up" | "bad_address" | "no_address" | "failed";

const NOT_SENT: Record<NotSentWhy, string> = {
  not_set_up: "Email is not set up yet, so nothing went out.",
  bad_address: "The address on the request does not look like an email address, so nothing went out.",
  no_address: "The request has no email address, so nothing went out.",
  failed: "The email did not go through.",
};

/** What the admin reads after answering. Every one that sends nothing says what to do instead. */
export const JOIN_ANSWER_WORDS = {
  acceptedEmailed: (address: string, days: number) => `Accepted. The invitation went to ${address}. It works once and lasts ${days} days.`,
  acceptedNotEmailed: (why: NotSentWhy) => `Accepted. ${NOT_SENT[why]} Copy their invitation below and send it to them yourself.`,
  alreadyMember: "Accepted. That address already has an account here, so no invitation was needed.",
  alreadyAccepted: "This request was already accepted, and its invitation went out then.",
  declinedEmailed: (address: string) => `Declined. A kind no went to ${address}.`,
  declinedNotEmailed: (why: NotSentWhy) => `Declined. ${NOT_SENT[why]}`,
  linkWithdrawn: "Its invitation was withdrawn, so it no longer works.",
  alreadyDeclined: "This request was already declined.",
  alreadyJoined: "They already joined with their invitation, so this request stays accepted.",
  notARequest: "That is not a request to join.",
  notFound: "There is no request by that id.",
  copyLink: "Copy invitation",
} as const;

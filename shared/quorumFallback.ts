/**
 * THE QUORUM FALLBACK: a vote too few of us answered is asked again, once.
 *
 * Rye's answers of 2026-11-06 to the quorum fallback note:
 *
 *   1. A re-run's second miss is decided by a simple majority of the votes
 *      cast. More yes than no carries it; a tie fails; an abstention takes no
 *      side.
 *   2. The re-run lasts as long as the first ballot did.
 *   3. One dial for every decision type.
 *
 * And one change from the note: besides being a village-governed dial, a
 * steward OR an admin may switch it ON at any time, as a failsafe. It stays OFF
 * by default, and every switch, by anyone, is recorded and announced. Whether a
 * steward or an admin may also switch it OFF is NOT decided, so the failsafe
 * door only ever turns it on, and OFF is left to the village's ordinary vote.
 *
 * This file holds the rules as pure functions, so the engine, the routes and
 * the pages read one answer. The SQL is in `server/repos/ballotReruns.ts` and
 * the close is in `server/lib/ballots.ts`.
 */

/** The dial. Ring 2, village-governed, `"off" | "on"`, off by default. */
export const QUORUM_FALLBACK_KEY = "governance.quorum_fallback";

/** The status a first ballot closes with when it is asked again. */
export const NO_QUORUM_RERUN = "no_quorum_rerun";

/** Is the dial on? Anything but the word `on` is off, which fails closed. */
export function quorumFallbackOn(raw: unknown): boolean {
  return String(raw ?? "").trim().toLowerCase() === "on";
}

/**
 * Subjects the fallback never re-runs.
 *
 * The Birthing (`village_launch`) only. It already has its own answer to a
 * missed quorum: the subject comes back and the village asks again on a FRESH
 * roll the same hour (`rerunOffer` and `quorumMissReading` in
 * shared/ballotSubjects.ts exempt it for the same reason). A half-quorum re-run
 * on the old roll would be a second, worse door to the same place, and a
 * majority of a handful starting a village's Game is not what the fallback was
 * asked for. Written as a literal so this file imports nothing.
 */
export const QUORUM_FALLBACK_EXEMPT: ReadonlySet<string> = new Set(["village_launch"]);

/** Half the quorum, rounded up to a whole percent, and never below one. */
export function rerunQuorumPct(quorumPct: number): number {
  const q = Math.max(0, Number(quorumPct) || 0);
  return Math.max(1, Math.ceil(q / 2));
}

/**
 * How many days the first ballot ran, which is how long the re-run runs.
 *
 * Whole days, because `ballotWindow` opens on whole days. A first ballot whose
 * window was cut short by a facilitator still froze the window it opened
 * with, and that frozen window is what this reads.
 */
export function rerunDurationDays(opensAt: string, closesAt: string): number {
  const ms = Date.parse(closesAt) - Date.parse(opensAt);
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return Math.max(1, Math.min(90, Number.isFinite(days) ? days : 1));
}

/** The ballot facts that decide whether a missed quorum is asked again. */
export interface RerunEligibility {
  subjectType: string;
  /** The dial, frozen onto the ballot when it opened. */
  quorumFallback: boolean;
  /** Set when this ballot is itself a re-run. */
  rerunOf: string | null;
}

/** Does a missed quorum on this ballot open a re-run? */
export function missOpensRerun(b: RerunEligibility): boolean {
  return b.quorumFallback && !b.rerunOf && !QUORUM_FALLBACK_EXEMPT.has(b.subjectType);
}

/** Does a missed quorum on this ballot get decided by the votes cast? */
export function missDecidedByMajority(b: RerunEligibility): boolean {
  return b.quorumFallback && !!b.rerunOf;
}

/**
 * Is this status the END of a subject's vote?
 *
 * `no_quorum_rerun` is not: the question is open again on a linked ballot, and
 * no surface may show it as an outcome.
 */
export function statusIsFinal(status: string): boolean {
  return status === "passed" || status === "failed" || status === "no_quorum" || status === "withdrawn";
}

const dayWords = (days: number): string => (days === 1 ? "1 day" : `${days} days`);

/** The village feed's line when a re-run opens. Rule 5 of the note, verbatim in shape. */
export function rerunFeedLine(title: string, days: number): string {
  return `Too few of us voted on ${title}. It is open again for ${dayWords(days)}, and this time half as many voices are enough.`;
}

/** The outcome note the first ballot closes with. */
export function rerunOutcomeNote(note: string, rerunQuorum: number, days: number): string {
  const said = String(note ?? "").trim();
  const line = `Too few voted, so it is open again for ${dayWords(days)} at half the quorum (${rerunQuorum}%).`;
  return said ? `${said}\n\n${line}` : line;
}

/** The sentence a majority decision adds to its outcome note, and the feed. */
export function majorityDecisionLine(outcome: "passed" | "failed", yes: number, no: number): string {
  const counts = `${trim(yes)} for, ${trim(no)} against`;
  return outcome === "passed"
    ? `Too few voted again, so the votes cast decided it: more said yes than no (${counts}).`
    : `Too few voted again, so the votes cast decided it: it needed more yes than no and did not get them (${counts}).`;
}

/** The feed line for a re-run decided by the votes cast. */
export function majorityFeedLine(title: string, outcome: "passed" | "failed"): string {
  return outcome === "passed"
    ? `Too few of us voted on ${title} a second time, so a majority of the votes cast carried it.`
    : `Too few of us voted on ${title} a second time, and a majority of the votes cast did not carry it.`;
}

function trim(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return String(v);
}

/** Who asked to switch the dial through the failsafe door. */
export interface FailsafeActor {
  isAdmin: boolean;
  /** Holds a live, unlapsed seat on a role carrying `steward.veto`. */
  isSteward: boolean;
}

/**
 * THE FAILSAFE DOOR'S ONE RULE, as a refusal sentence or null.
 *
 * ON only. Whether a steward or an admin may switch the fallback OFF is not
 * decided, so this door refuses it and names the door that is: the village's
 * ordinary vote on the dial.
 */
export function failsafeRefusal(actor: FailsafeActor, value: unknown): string | null {
  if (!actor.isAdmin && !actor.isSteward) {
    return "Switching the quorum fallback on here is for a steward or an admin. Anyone may propose it to the village as a change to the dial.";
  }
  if (!quorumFallbackOn(value)) {
    return "This door only switches the quorum fallback on. Turning it off is the village's to decide, by proposing a change to the dial.";
  }
  return null;
}

/** The feed line for any switch of the dial, by anyone. */
export function switchFeedLine(on: boolean, by: "steward" | "admin" | "village"): string {
  const state = on ? "on" : "off";
  const who = by === "village" ? "The village" : by === "steward" ? "A steward" : "An admin";
  const what = on
    ? "A vote too few of us answer is now asked again once, at half the quorum."
    : "A vote too few of us answer now ends as it closes.";
  return `${who} switched the quorum fallback ${state}. ${what}`;
}

/**
 * Why the admin variables route will not write this dial. ON has its own door
 * (the failsafe), and OFF is the village's to decide by its vote, so the
 * setup panel's generic write would be a third door the ruling never opened.
 */
export const ADMIN_ROUTE_REFUSAL =
  "The quorum fallback has its own door. A steward or an admin switches it on through the failsafe, and switching it off is the village's to decide by proposing a change to the dial.";

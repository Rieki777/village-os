/**
 * TELLING THE ROLL, once, keyed on the ballot.
 *
 * Everyone who was ASKED is told what the answer was, including the people who
 * did not vote: a decision binds them either way, and finding out later from
 * somebody else is how a village stops trusting its own process.
 *
 * The roll comes from `ballot_electorate`, the frozen one, and never from a
 * live member list, for the same reason every other evaluation reads it: the
 * people asked are the people who were asked, and somebody who joined
 * yesterday was not.
 *
 * NEVER THROWS. It is called without an await from request handlers, so a
 * throw here would be an unhandled rejection rather than a 500, and a trace
 * that failed must not fail the deed it is a trace OF.
 *
 * Moved out of `server/index.ts` by the dispatcher lane. The behaviour is
 * unchanged to the line; what changed is which file carries it.
 */
import type { Pool } from "mysql2/promise";
import { electorateOf } from "./ballots";

/**
 * WHERE A NOTICE ABOUT A BALLOT LANDS: on the ballot. ONE copy of the URL.
 *
 * It pointed at the proposal card on /game-mechanics until the decision surface
 * existed, because a notice has to land on something a member can actually see.
 * /decisions/:id is now that thing and it is strictly better: the vote widget,
 * the clock, the frozen roll and the close beat are all on it, so every decision
 * notice lands where its reader can act on it.
 *
 * A STALE LINK IS NEVER AN ERROR STATE, and that is the property this protects.
 * A withdrawn ballot renders the decision page's own "No such decision" card
 * with a way through to /decisions, and the notification row renders and clears
 * from its stored text without ever resolving the ballot. A notice outlives the
 * thing it points at.
 *
 * It lives HERE because this module owns `RollNoticeDeps.link` and every caller
 * that rings a roll. `ballotLink` in `server/index.ts` delegates to it and
 * `tellRollItTookEffect` in `server/lib/atCloseLanding.ts` reads it, so a route
 * rename moves one string. There was briefly a second copy, and no gate reads
 * either one, so the two would have drifted with nothing to say so.
 */
export const decisionLink = (b: { id: string }): string => `/decisions/${b.id}`;

export interface RollNoticeDeps {
  pool: Pool;
  notify: (input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    dedupeKey: string;
  }) => Promise<unknown>;
  /** Where a notice about this ballot should land. */
  link: (b: { id: string }) => string;
}

export interface RollNotice {
  type: string;
  title: string;
  body?: string | null;
  keySuffix: string;
  /** Already told in their own words, so the roll's line skips them. */
  except?: Array<string | null | undefined>;
  /** An explicit roll, when the caller already has one. */
  roll?: string[];
}

export async function notifyRollRows(deps: RollNoticeDeps, b: { id: string }, input: RollNotice): Promise<number> {
  let rung = 0;
  try {
    const roll = input.roll ?? (await electorateOf(deps.pool, b.id));
    const skip = new Set((input.except ?? []).filter((x): x is string => !!x));
    for (const userId of roll) {
      if (skip.has(userId)) continue;
      await deps.notify({
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: deps.link(b),
        dedupeKey: `bal:${b.id}:${input.keySuffix}:u${userId}`,
      });
      rung += 1;
    }
  } catch (e) {
    console.error(`[governance] telling the roll about ballot ${b.id} failed (the ballot stands)`, e);
  }
  return rung;
}

/*
 * ── WHAT A HUMAN CLOSE TELLS THE VILLAGE, FROM WHAT ROUTING SETTLED ─────────
 *
 * Moved out of the close route in `server/index.ts`, with its reasoning. The
 * pulse line and the roll's notice used to be written from the tally, and the
 * pulse line before routing ran at all. So a decision whose landing threw inside
 * the close (`server/lib/atCloseLanding.ts`) was announced as carried and in
 * effect: the pulse said a vote carried, and the whole roll got
 * `ballot_carried`, whose blurb says what was voted on now applies, with a
 * celebration, about a decision that had not happened. Both now read the
 * routing's own outcome and `landingFailed`. The pulse line reading the routed
 * outcome also stops a steward's no at the close reading as carried.
 *
 * THREE OUTCOMES AND THREE SENTENCES, because "without passing" said the same
 * thing about a village that answered no and a village that barely turned up,
 * and only one of those is a verdict on the question. A carried vote whose
 * landing failed is a fourth, and says so with the routing's `held` sentence.
 *
 * THE KIND CARRIES THE MEANING, because the bell groups, batches and rations
 * celebration by KIND and never by title. `ballot_failed` used to fire for a
 * missed quorum while its blurb read "The village said no". `ballot_carried` is
 * one of the four kinds that earn a celebration, so an advisory vote never
 * reaches it, and neither does a carried vote that has not taken effect: that is
 * `ballot_not_yet_in_effect`, and the roll hears `ballot_carried` from the
 * landing job once it is true (`tellRollItTookEffect`).
 *
 * The type ternary stays INLINE on the property. `shared/notificationKinds.test.ts`
 * reads the produced types out of server source by brace-matching the object
 * literal inside a `notifyRoll(` or `notify(` call and splitting it on top-level
 * commas, and it has no idea what a comment is, so no comment sits inside it.
 *
 * THE PROPOSER of a failed landing is told the same thing even off the roll,
 * with the roll's own key shape (`bal:<id>:outcome:u<user>`), so a proposer who
 * is also on the roll gets one row and a retried call is a no-op. Never throws;
 * the route calls it without an await, like every roll-wide ring.
 */

export type CloseOutcome = "passed" | "failed" | "no_quorum";

/** The public pulse line for a close. */
export function closeActivityLine(title: string, outcome: CloseOutcome, landingFailed?: "retrying" | "stalled"): string {
  if (outcome === "passed") {
    return landingFailed ? `A village vote carried and has not taken effect yet: ${title}` : `A village vote carried: ${title}`;
  }
  return outcome === "no_quorum"
    ? `A village vote closed with too few voting to settle it: ${title}`
    : `A village vote closed without passing: ${title}`;
}

export interface CloseOutcomeNotice {
  ballot: { id: string; title: string };
  /** The outcome routing settled, which a steward's no can differ from the tally's. */
  outcome: CloseOutcome;
  binds: boolean;
  outcomeNote: string | null;
  routing: { held: string | null; proposerTold: string | null; landingFailed?: "retrying" | "stalled" };
  /** Whoever proposed the subject, told of a failed landing even when off the roll. */
  proposerId: string | null;
}

/** Ring the roll with the close's outcome, and the proposer when the landing failed. */
export async function tellRollTheOutcome(deps: RollNoticeDeps, input: CloseOutcomeNotice): Promise<number> {
  const { ballot: b, outcome, binds, routing } = input;
  const notYet = binds && outcome === "passed" && !!routing.landingFailed;
  const notYetTitle = `Carried, not yet in effect: ${b.title}`;
  const notYetBody = [input.outcomeNote, routing.held].filter((s): s is string => !!s && !!s.trim()).join("\n\n");
  const notifyRoll = (ballot: { id: string }, notice: RollNotice) => notifyRollRows(deps, ballot, notice);
  const rung = await notifyRoll(b, {
    type: !binds
      ? "ballot_advisory_closed"
      : outcome === "passed"
        ? (notYet ? "ballot_not_yet_in_effect" : "ballot_carried")
        : outcome === "no_quorum"
          ? "ballot_no_quorum"
          : "ballot_failed",
    title:
      outcome === "no_quorum"
        ? `Closed without quorum: ${b.title}`
        : outcome === "passed"
          ? binds
            ? (notYet ? notYetTitle : `Carried: ${b.title}`)
            : `The village would have said yes: ${b.title}`
          : binds
            ? `Did not pass: ${b.title}`
            : `The village would have said no: ${b.title}`,
    body: binds
      ? (notYet ? notYetBody : input.outcomeNote)
      : `${input.outcomeNote ?? ""}\n\nThis was an advisory vote. Nothing changed on its own.`.trim(),
    keySuffix: "outcome",
    except: [routing.proposerTold],
  });
  if (!notYet || !input.proposerId) return rung;
  try {
    await deps.notify({
      userId: input.proposerId,
      type: "ballot_not_yet_in_effect",
      title: notYetTitle,
      body: notYetBody,
      link: deps.link(b),
      dedupeKey: `bal:${b.id}:outcome:u${input.proposerId}`,
    });
  } catch (e) {
    console.error(`[governance] telling the proposer that ballot ${b.id} has not taken effect failed (the ballot stands)`, e);
  }
  return rung;
}

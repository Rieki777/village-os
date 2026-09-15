/**
 * THE MOON ASKS, THE VILLAGE ANSWERS, AND ONLY THEN DOES VALUE MOVE.
 *
 * Until this file, closing a gratitude cycle was one admin pressing one button.
 * `server/lib/scheduler.ts` says so in its own header, and the `moon-settlement`
 * job says it again: "Closing a gratitude cycle stays a human act, and the
 * scheduler has been forbidden from doing it since it was written." That rule is
 * not being repealed here. It is being kept by a wider hand.
 *
 * Rye's ruling, 2026-09-05: "in the beginning right now, we should have it be
 * that every human is in charge of minting value... after we've run many cycles
 * and it's working, we can automate it. So let's make sure that there's a
 * foundation that it can be automated and that right now it is not. So
 * currently, at the end of every cycle, what we can automate is a proposal for a
 * cycle and a gratitude cycle end that goes up for a vote from the community as
 * a whole to pass this proposal and distribute that value."
 *
 * So the scheduler's new power is exactly one power: it may ASK. It composes a
 * proposal naming a moon that has ended and the value that would be released,
 * and it opens a ballot. Nothing moves until the village passes it. A machine
 * that can put a question to people is not a machine that decides, and the line
 * between those two is the whole of this module.
 *
 * -- WHAT IS AUTOMATED, SAID PRECISELY --------------------------------------
 *
 * Automated:      noticing a moon ended, computing what it settled to, writing
 *                 the split down, and opening the vote.
 * NOT automated:  the vote, and therefore the minting. Every unit of value that
 *                 leaves the cycle pool leaves because a village voted it out.
 *
 * The foundation for the later step is `SETTLEMENT_MODES`. Adding "automatic"
 * to it, a branch in `settlementProposalDecision`, and a closer that settles
 * without a ballot is the whole of that change when a village has run enough
 * cycles to want it. It is deliberately NOT here: a mode that exists and is
 * never chosen is still a mode somebody can choose by accident, and a dial whose
 * value does nothing is the defect this codebase has shipped twice
 * (`gratitude.cycle_mode`, and the 0108 rhythm dial before it).
 */

/** The subject type a settlement ballot carries. One string, one home. */
export const CYCLE_SETTLEMENT = "cycle_settlement";

/**
 * How a village settles its moons.
 *
 *  - `manual`   the founder's button and nothing else. What every village did
 *               before this, and what a village keeps if it wants to.
 *  - `proposal` the scheduler asks, the village answers. The default.
 *
 * "automatic" is not here, and the block above says why.
 */
export const SETTLEMENT_MODES = ["manual", "proposal"] as const;
export type SettlementMode = (typeof SETTLEMENT_MODES)[number];

/**
 * FAIL CLOSED, WHICH IS NOT THE SAME AS FAIL TO THE DEFAULT.
 *
 * The registry default is `proposal`, because that is what a village should
 * get. An UNREADABLE value is a different question: it means nobody knows what
 * this village asked for, and the safe answer to "should a machine open a vote
 * about money" when nobody knows is no. So a value this cannot read lands on
 * `manual`, where a human is already in charge.
 */
export function settlementModeFrom(raw: unknown): SettlementMode {
  const text = String(raw ?? "").trim().toLowerCase();
  return (SETTLEMENT_MODES as readonly string[]).includes(text) ? (text as SettlementMode) : "manual";
}

/**
 * How long a settlement ballot stays open, clamped to the registry's own
 * bounds. A window longer than a lunation would leave one moon's vote still
 * running when the next moon's opens, so 21 is the ceiling and the description
 * on the dial says why.
 */
export const SETTLEMENT_VOTE_DAYS_DEFAULT = 3;

export function settlementVoteDaysFrom(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return SETTLEMENT_VOTE_DAYS_DEFAULT;
  return Math.max(1, Math.min(21, n));
}

/** A moon that has ended and has not been settled. */
export interface DueMoon {
  id: string;
  cycleNumber: number;
}

/**
 * What has already been asked about one moon. `outcome` is null while a ballot
 * is still open.
 */
export interface SettlementAsk {
  cycleId: string;
  open: boolean;
  outcome: "passed" | "failed" | "no_quorum" | "withdrawn" | null;
}

export type ProposalDecision =
  | { post: true; cycleId: string; cycleNumber: number }
  | { post: false; why: string };

/**
 * ONE RE-ASK AND NO MORE.
 *
 * A quorum nobody met is not a refusal. The Birthing's `no_answer` policy in
 * shared/ballotSubjects.ts makes exactly this distinction, and it is the right
 * one here too: a village that did not finish deciding is not a village that
 * said no. So a settlement that fell short of quorum is asked once more.
 *
 * Once, and then it stops, because a machine that re-posts a vote every time
 * the vote goes unanswered is a machine that has learned to nag. After the
 * second silence the moon waits for a person, and the admin's own
 * settlement-proposal door is where that person acts.
 */
export const MAX_ASKS_AFTER_SILENCE = 2;

/**
 * WHICH MOON TO ASK ABOUT, and the sentence for why not.
 *
 * Oldest first, because `dueCycles` hands them over oldest first and a village
 * works through its backlog in the order it happened. But a moon that cannot be
 * asked about does NOT stop the ones behind it: a single failed vote would
 * otherwise park every later moon behind it forever, which turns one decision
 * into a permanent blockage of a mechanism the village needs every month. So
 * this walks the list and takes the first moon that is genuinely askable.
 *
 * A moon whose vote FAILED is skipped and never returns here. The village said
 * no to releasing that value, and a machine that asks again until it gets the
 * answer it wants is not conducting a vote.
 */
export function settlementProposalDecision(input: {
  mode: SettlementMode;
  /** Is the governance module on? A village with it off cannot see a ballot. */
  governanceOn: boolean;
  due: readonly DueMoon[];
  asks: readonly SettlementAsk[];
}): ProposalDecision {
  if (input.mode !== "proposal") {
    return {
      post: false,
      why: `This village settles its moons by hand (cycle.settlement_mode is "${input.mode}"), so nothing was proposed.`,
    };
  }
  /*
   * A BALLOT IN A VILLAGE THAT CANNOT SEE BALLOTS IS A MOON THAT NEVER SETTLES.
   *
   * The mode defaults to `proposal`, and a village may perfectly well be
   * running with the governance module off: it has no decisions page, no
   * notices about votes, and no way to reach the one this would open. Without
   * this check, such a village posts a ballot every moon, nobody can answer any
   * of them, and its economy quietly stops paying anybody — the settlement
   * waiting forever on a vote its members were never shown.
   *
   * The founder's button is untouched and still settles, which is why refusing
   * here is safe: it hands the village back to the path it already has, rather
   * than to nothing.
   */
  if (!input.governanceOn) {
    return {
      post: false,
      why:
        "This village does not run the governance module, so there is nowhere for a settlement vote to be seen. " +
        "Moons settle from the Cycles desk until governance is switched on.",
    };
  }
  if (input.due.length === 0) {
    return { post: false, why: "No moon has ended without being settled, so there is nothing to propose." };
  }

  const skipped: string[] = [];
  for (const moon of input.due) {
    const asks = input.asks.filter((a) => a.cycleId === moon.id);
    /*
     * ONE SETTLEMENT VOTE AT A TIME, AND THIS RETURNS RATHER THAN CONTINUING.
     *
     * An open ask stops the whole walk, so a village never holds two settlement
     * ballots at once. Two would sit side by side on the decisions page with
     * near-identical titles and different amounts, and a member would have to
     * check a moon number to know which money they were voting about.
     *
     * It cannot stall: the vote window is capped at 21 days by
     * `settlementVoteDaysFrom` and a lunation is about 29.5, so the ballot on
     * the older moon always closes before the newer moon's would be due. That
     * cap and this `return` are the same decision said twice, and neither is
     * safe to change without the other.
     */
    if (asks.some((a) => a.open)) {
      return { post: false, why: `The village is already voting on cycle ${moon.cycleNumber}.` };
    }
    if (asks.some((a) => a.outcome === "passed")) {
      skipped.push(`cycle ${moon.cycleNumber} was already carried and is waiting to land`);
      continue;
    }
    if (asks.some((a) => a.outcome === "failed")) {
      skipped.push(`the village voted not to settle cycle ${moon.cycleNumber}`);
      continue;
    }
    /*
     * A WITHDRAWAL IS A PERSON SAYING NOT THIS, AND IT HAS TO STICK.
     *
     * This first treated a withdrawn ballot as no answer at all, on the
     * reasoning that a question taken back is not a question answered. That is
     * true of the ANSWER and useless as a rule, because this job runs hourly: a
     * facilitator calling off a settlement would have watched the machine post
     * the same ballot again within the hour, which makes the withdraw button a
     * button that does nothing. It is the nagging this file is built to
     * prevent, arriving through the one door left open to it.
     *
     * So a withdrawal parks the moon for the JOB. A person can put it straight
     * back through the admin's own settlement-proposal door, which is the same
     * shape every other restraint here takes: the machine stops, and a human
     * decides whether to go on.
     */
    if (asks.some((a) => a.outcome === "withdrawn")) {
      skipped.push(`a settlement vote on cycle ${moon.cycleNumber} was called off`);
      continue;
    }
    if (asks.length >= MAX_ASKS_AFTER_SILENCE) {
      skipped.push(`cycle ${moon.cycleNumber} was asked ${asks.length} times and nobody answered`);
      continue;
    }
    return { post: true, cycleId: moon.id, cycleNumber: moon.cycleNumber };
  }
  return { post: false, why: `Nothing could be proposed: ${skipped.join("; ")}.` };
}

/** One member's frozen share, exactly as it will be paid. */
export interface FrozenShare {
  name: string;
  received: number;
  distinctSenders: number;
  credited: number;
}

export interface SettlementFacts {
  cycleNumber: number;
  startsAt: string;
  endsAt: string;
  poolToken: string;
  /** The token's own name, so the document reads in the village's words. */
  tokenName: string;
  currencyName: string;
  shares: readonly FrozenShare[];
}

/** How many people the document names before it starts counting instead. */
const NAMED_IN_DOC = 12;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

const day = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * The latest settlement vote on a moon, when it ended in a no.
 *
 * `vetoed` separates the two ways a settlement ends `failed`: the village voted
 * it down, or a steward stopped it inside the window (a veto reads as failed,
 * Rye 2026-09-08). Both are true of a vetoed ballot, and the warning names the
 * one that happened because that is the fact a founder needs.
 */
export interface SettlementRefusal {
  ballotId: string;
  /** When the no happened: the veto instant, or the close of the vote. */
  at: string;
  vetoed: boolean;
}

/**
 * THE SENTENCE A FOUNDER READS BEFORE OVERRULING THE VILLAGE.
 *
 * Rye, 2026-09-14: "A founder has the power to overrule the village on this -
 * if the community votes the proposal down and a founder still closes it, just
 * give a warning on the card that the village voted it down so a founder doesn't
 * do it on accident, but can still override." So it says what happened and what
 * pressing Close will do, and it blocks nothing.
 */
export function settlementRefusalWarning(r: SettlementRefusal): string {
  const when = day(r.at);
  return r.vetoed
    ? `A steward stopped this moon's settlement on ${when}. Closing it pays this split anyway.`
    : `The village voted this moon's settlement down on ${when}. Closing it pays this split anyway.`;
}

export function settlementProposalTitle(cycleNumber: number): string {
  return `Settle the moon that ended: cycle ${cycleNumber}`;
}

/**
 * THE DOCUMENT IS THE SPLIT, NOT A SUMMARY OF IT.
 *
 * A member voting on this is voting on where value goes, so the numbers in
 * front of them have to be the numbers that get paid, not a preview computed
 * from live data that will be recomputed at execution. The caller freezes the
 * split into the distributions table BEFORE composing this, and both this
 * document and the payment read those same rows. That is what makes the vote a
 * vote on something rather than on an estimate.
 *
 * It says what it is not, too. Recognition is the signal and it was already
 * credited when it was sent; what is being decided here is the separate pool.
 * A member who reads this and concludes their gratitude is being voted on has
 * been told the wrong thing by the document, not by the engine.
 *
 * -- PLAIN LINES, AND THE COLUMN NAME LIES ----------------------------------
 *
 * `ballots.doc_markdown` is not rendered as Markdown anywhere. The decision
 * page puts it in a `<pre>` with `whitespace-pre-wrap`, so every character is
 * shown exactly as written, and the advisory composer in server/index.ts says
 * so in its own comment: "Plain lines, because the decision page shows this
 * text as it is written."
 *
 * This was written with `##` headings and `**bold**` names first, and every
 * test passed, because a test asserting `toContain("**Maya**")` is satisfied by
 * the very string that would have shown a member two literal asterisks beside
 * their own name on the first vote their village ever held about money. The
 * headings are bare lines and the split is an indented list; both survive
 * `pre-wrap` intact.
 */
export function settlementProposalDoc(f: SettlementFacts): string {
  const paid = f.shares.filter((s) => s.credited > 0);
  const total = f.shares.reduce((n, s) => n + s.credited, 0);
  const recognised = f.shares.reduce((n, s) => n + s.received, 0);

  const lines: string[] = [];
  lines.push(
    `The moon numbered ${f.cycleNumber} began on ${day(f.startsAt)} and ended on ${day(f.endsAt)}. ` +
      "This asks the village to settle it.",
  );
  lines.push("");
  lines.push("WHAT HAPPENED THIS MOON");
  lines.push("");
  lines.push(
    f.shares.length === 0
      ? `Nobody was thanked this moon, so there is no ${f.currencyName} to report and nothing to release.`
      : `${f.shares.length} ${plural(f.shares.length, "member", "members")} received ${recognised} ${f.currencyName} between them.`,
  );
  lines.push("");
  lines.push("WHAT PASSING THIS RELEASES");
  lines.push("");
  if (total <= 0) {
    lines.push(
      `Nothing. The cycle pool releases no ${f.tokenName} for this moon, so passing this settles the ` +
        `record and moves no value. The ${f.currencyName} people sent each other was credited when they sent ` +
        "it and is not affected either way.",
    );
  } else {
    lines.push(
      `${total} ${f.tokenName} from the cycle pool, split between ${paid.length} ` +
        `${plural(paid.length, "member", "members")} in proportion to the ${f.currencyName} they were given ` +
        "this moon. These amounts are already written down and passing this pays exactly them; they do not " +
        "move if a setting changes while the vote is open.",
    );
    lines.push("");
    for (const s of paid.slice(0, NAMED_IN_DOC)) {
      lines.push(
        `  ${s.name}: ${s.credited} ${f.tokenName}, for ${s.received} ${f.currencyName} from ` +
          `${s.distinctSenders} ${plural(s.distinctSenders, "person", "people")}`,
      );
    }
    if (paid.length > NAMED_IN_DOC) {
      const rest = paid.length - NAMED_IN_DOC;
      lines.push(`  and ${rest} more ${plural(rest, "member", "members")}`);
    }
  }
  lines.push("");
  lines.push("WHAT THIS DOES NOT DECIDE");
  lines.push("");
  lines.push(
    `The ${f.currencyName} members sent each other is not on this ballot. It was credited the moment it was ` +
      "sent and it stays where it is whichever way this goes. What is being decided is the separate pool of " +
      `${f.tokenName} the village releases at the end of a moon, and whether this moon's is released now.`,
  );
  lines.push("");
  lines.push(
    "If this does not pass, the moon stays open and no value moves. Nothing is lost and nothing expires.",
  );
  return lines.join("\n");
}

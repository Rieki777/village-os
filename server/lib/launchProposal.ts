/**
 * WHAT THE LAUNCH PROPOSAL SAYS, AND WHO IT MAY NAME.
 *
 * Two halves of one act, kept together because they are the same sentence seen
 * from two sides: `launchSlateProblem` decides who a proposal is ALLOWED to
 * put forward for the inaugural steward's seat, and `launchProposalDoc` writes
 * what the village READS about them.
 *
 * ── RYE'S CHOICE, 2026-09-24 ───────────────────────────────────────────────
 *
 * Shown two designs, he picked this one: "is whoever is clicking the 'launch
 * village' button then selects from a list of members in the proposal to carry
 * the steward role so then it's there in the proposal to be voted on. I like
 * this second route better." Asked who may be on that list and what happens to
 * somebody who does not want the job: "founders only for this first season
 * (after that anyone can raise their hand for a steward role and fill it if
 * voted in), and show the declines".
 *
 * ── WHY THE DOCUMENT HAS TO NAME THEM ──────────────────────────────────────
 *
 * `ballots.doc_markdown` is frozen when the vote opens and is the thing every
 * member actually votes on. A slate that lived only in a side table and a page
 * component would be a proposal whose own text did not say what it proposed,
 * and a member reading the frozen document a year later would find no record
 * of who the village agreed to seat. "So it's there in the proposal to be
 * voted on" is a requirement about this string, not about a screen.
 *
 * ── TWO THINGS THE TEXT IS HONEST ABOUT, AND WHY THEY ARE HERE ─────────────
 *
 * ONE PERSON CHOSE IT. The slate is picked by whoever opened the vote, not by
 * the village, and the village is voting on somebody else's list. The document
 * says whose list it is. That is the whole reason this design needed a consent
 * step: a slate chosen by one hand can name somebody who does not want the
 * job.
 *
 * IT IS ALL NINETEEN POWERS. Accepting is not accepting a title. `HANDOVER_SET`
 * is every entrustable power this village has, and at launch the seat holds all
 * of them for the first season (`seatCatalystsAsStewards`). The count comes off
 * that set rather than being typed, for the reason the set's own header gives:
 * a new transferable power joins it without anybody remembering to, and a
 * hand-typed nineteen would then be a promise nobody checks.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DECIDE ──────────────────────────
 *
 * Whether anybody is SEATED. That is `seatCatalystsAsStewards` at the close,
 * against who was still a founder then. The founder test here is about who may
 * be PUT ON a slate, which is a different question asked at a different
 * moment, and the close asks its own because `users.role` can move in between.
 */
import type { Pool } from "mysql2/promise";
import { HANDOVER_SET } from "../../shared/capabilities";
import { catalystRoster } from "../repos/users";

/** One member a launch proposal puts forward, with the name the village reads. */
export interface SlateMember {
  id: string;
  /** Already shortened by the caller's own `firstName`, so this module holds no second copy of that rule. */
  name: string;
}

/**
 * A DISCRIMINATED UNION ON `ok`, never on the error string.
 *
 * `if (verdict.error)` reads fine and narrows nothing useful: an error string
 * can be empty, so the compiler has to keep the refusal branch alive on the
 * happy path and `members` comes back possibly undefined. A boolean tag makes
 * the narrowing exact, which is the difference between the caller being
 * REQUIRED to handle the refusal and merely being able to.
 */
export type SlateVerdict = { ok: false; error: string } | { ok: true; members: SlateMember[] };

/**
 * A slate bigger than this is not a slate, it is the village.
 *
 * There is no rule from Rye about a maximum and this is deliberately not
 * pretending to be one. It is a bound on a request body, sized so that no
 * plausible founding roll ever meets it, and it exists so a malformed or
 * hostile payload cannot make the opening transaction write an unbounded
 * number of rows. Every real limit is below it already: only founders may be
 * named, and only founders who are on the frozen roll.
 */
const MAX_SLATE = 200;

/**
 * Who may be put on the slate, checked against the roll this vote froze.
 *
 * THREE RULES, and each one is a different failure a village would otherwise
 * discover at the close:
 *
 *   FOUNDERS ONLY, for the first season, in Rye's words. The stored value is
 *   `founder` and the word a player reads is Catalyst; `catalystRoster` holds
 *   the statement and the argument for asking by the stored value.
 *
 *   ON THE ROLL. Accepting rides on the vote row
 *   (`ballot_votes.stands_for_steward`), so somebody who cannot vote on this
 *   ballot has no way to say yes to it. Naming them would be naming somebody
 *   who is guaranteed not to be seated, with nothing on any screen explaining
 *   why. The roll is the one this proposal is about to freeze, so the two
 *   cannot disagree.
 *
 *   NO DUPLICATES. The table's primary key would refuse the second row inside
 *   the opening transaction and roll the whole launch vote back with a driver
 *   error in place of a sentence. Caught here so the answer is a sentence.
 *
 * AN EMPTY SLATE IS NOT AN ERROR. A village may open its launch vote naming
 * nobody, and then it starts its Game with the seat empty, which `nobodyStood`
 * already has words for and which stops nothing. Refusing it would invent a
 * requirement Rye did not make and would block a village whose founders would
 * rather vote somebody in afterwards.
 */
export async function launchSlateProblem(
  pool: Pool,
  raw: unknown,
  roll: readonly { userId: string }[],
  shortName: (name: string) => string,
): Promise<SlateVerdict> {
  if (raw === undefined || raw === null) return { ok: true, members: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "The list of founding stewards has to be a list of members." };
  }
  if (raw.length > MAX_SLATE) {
    return { ok: false, error: `A launch proposal can name at most ${MAX_SLATE} founding stewards.` };
  }
  const ids = raw.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "One member is on the list twice. Each founding steward is named once." };
  }
  if (ids.length === 0) return { ok: true, members: [] };

  const onTheRoll = new Set(roll.map((e) => e.userId));
  const founders = await catalystRoster(pool);
  const byId = new Map(founders.map((f) => [f.id, f]));

  const notFounding = ids.filter((id) => !byId.has(id));
  if (notFounding.length > 0) {
    return {
      ok: false,
      error:
        `Only founding members can carry the steward's seat for this first season, and ${notFounding.length === 1 ? "one of the people named is not one" : `${notFounding.length} of the people named are not`}. ` +
        `After this season anybody can raise their hand for the seat and the village votes them in.`,
    };
  }
  const offTheRoll = ids.filter((id) => !onTheRoll.has(id));
  if (offTheRoll.length > 0) {
    return {
      ok: false,
      error:
        `Everybody named as a founding steward has to be on this vote's roll, because accepting the seat is part of answering this vote, and ${offTheRoll.length === 1 ? "one of them is not" : `${offTheRoll.length} of them are not`}.`,
    };
  }
  /*
   * Returned in the order the proposer chose them, which is the order the
   * document lists. The TABLE reads back sorted by id, because a page should
   * not reorder itself between two loads; the frozen document keeps the
   * proposer's order because it is the proposer's sentence.
   */
  return { ok: true, members: ids.map((id) => ({ id, name: shortName(byId.get(id)!.name) })) };
}

export interface LaunchProposalDocInput {
  villageName: string;
  quorumPct: number;
  unityPct: number;
  onTheRoll: number;
  /** How weight was assigned when this froze. Empty string when there is nothing to say. */
  weightNote: string;
  /** Whoever opened the vote and chose the slate, as the village reads their name. */
  openedBy: string;
  /** The civil date the journey read done, `YYYY-MM-DD`. */
  openedOn: string;
  slate: readonly SlateMember[];
}

/**
 * The frozen document a launch vote carries.
 *
 * PURE, and that is the point of extracting it: every sentence a village votes
 * on can now be asserted in a test with no database, no ballot and no server,
 * which is what `server/launchProposalDoc.test.ts` does. It used to be an
 * array literal inside the route, where the only way to check a word was to
 * open a vote.
 */
export function launchProposalDoc(input: LaunchProposalDocInput): string {
  return [
    `# Start the Game`,
    "",
    `${input.villageName} is built. This vote is what starts it.`,
    "",
    "## What changes when this carries",
    "",
    "Token issuance turns on. Until then this village can be set up in every other way, and nothing can be issued to anybody.",
    "",
    ...stewardSection(input),
    "## What this vote asks",
    "",
    `Everyone on the roll votes yes: ${input.quorumPct}% participation and ${input.unityPct}% agreement. ${input.onTheRoll} people hold a voice today, and this vote is frozen to those ${input.onTheRoll}.`,
    "",
    // The one subject where an abstention is not an answer. The reason is
    // on the village_launch entry in shared/ballotSubjects.ts.
    "An abstention is not a yes here, and neither is a vote nobody cast. If somebody takes no side, this vote closes short of participation and the village can ask again.",
    "",
    // How weight was assigned when this froze, in the document itself. The
    // roll and the dials are already frozen here; the rule that turned
    // members into weights was not written down anywhere a member reads.
    ...(input.weightNote ? [input.weightNote, ""] : []),
    `Every item on the journey to launch read done when ${input.openedBy} opened this, on ${input.openedOn}.`,
    "",
  ].join("\n");
}

/**
 * The part of the document that names the stewards, or says nobody was named.
 *
 * BOTH BRANCHES SAY SOMETHING. A launch that names nobody is a real outcome
 * and the document says so out loud, because the alternative is a village
 * reading a proposal with no steward section and concluding the feature was
 * not part of this vote.
 */
function stewardSection(input: LaunchProposalDocInput): string[] {
  const powers = HANDOVER_SET.length;
  if (input.slate.length === 0) {
    return [
      "## The steward's seat",
      "",
      `${input.openedBy} named nobody for the steward's seat, so the village starts with it empty. ` +
        "That stops nothing: decisions land at their landing time either way, and the village can vote anybody into the seat whenever it likes.",
      "",
    ];
  }
  return [
    "## Who carries the steward's seat",
    "",
    `${input.openedBy} opened this vote and chose who it puts forward. Voting yes is voting for this list as well as for starting the Game.`,
    "",
    ...input.slate.map((m) => `- ${m.name}`),
    "",
    `Each of them answers for themselves. Carrying the seat for this first season means holding all ${powers} of the powers this village has to give, and being able to stop a decision the village has already carried inside the window before it lands. Anybody named can decline, and a decline is shown here beside the vote.`,
    "",
    "Whoever accepts is seated when this vote carries. If nobody accepts, the seat starts empty and the village votes somebody into it whenever it likes.",
    "",
  ];
}

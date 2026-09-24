/**
 * THE SLATE A LAUNCH PROPOSAL NAMES, AND THE ANSWER EACH NAMED PERSON GIVES.
 *
 *   GET  /api/admin/launch/steward-candidates    who a proposal may name
 *   GET  /api/governance/ballots/:id/steward-slate    the slate, as anybody reads it
 *   POST /api/governance/ballots/:id/steward-slate    accept, or decline
 *
 * ── RYE'S CHOICE, 2026-09-24 ───────────────────────────────────────────────
 *
 * "is whoever is clicking the 'launch village' button then selects from a list
 * of members in the proposal to carry the steward role so then it's there in
 * the proposal to be voted on. I like this second route better." And, on who
 * may be named and what happens to somebody who does not want it: "founders
 * only for this first season (after that anyone can raise their hand for a
 * steward role and fill it if voted in), and show the declines".
 *
 * ── WHY THERE IS A CONSENT STEP AT ALL ─────────────────────────────────────
 *
 * The slate is chosen by ONE person. That person can name somebody who does
 * not want the job, and the job is holding every entrustable power this
 * village has for a whole season. Being handed nineteen powers you never asked
 * for is the thing the opt-in ruling of the same morning was protecting
 * against, and the accept-or-decline here is what carries that protection into
 * the design Rye preferred. "Show the declines" only means something if
 * declining exists, so declining is a real, recorded, visible act.
 *
 * ── WHY THESE ROUTES ARE HERE AND NOT IN server/index.ts ───────────────────
 *
 * `scripts/check-server-index-size.mjs` is a one-way ratchet and that file sat
 * exactly AT its baseline on both dials when this lane started. A route module
 * is the shape the guard is pushing every new route toward, and this domain is
 * a clean one: three routes, one table, one rule.
 *
 * ── WHAT IS NOT HERE ───────────────────────────────────────────────────────
 *
 * The slate is WRITTEN by `POST /api/admin/launch/propose`, inside the same
 * transaction that opens the ballot, because a slate is part of the proposal
 * rather than a thing done to it afterwards. `server/lib/launchProposal.ts`
 * holds the rules about who may be on one, and this module asks it nothing: it
 * reads what that write left and takes answers about it.
 *
 * The SEATING is `seatCatalystsAsStewards` at the close. Nothing here seats
 * anybody or moves a power, and nothing here is the decision. This is the
 * surface; the rule lives with the writes.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { HANDOVER_SET } from "../../shared/capabilities";
import { VILLAGE_LAUNCH } from "../../shared/ballotSubjects";
import { ballotById } from "../lib/ballots";
import { catalystRoster } from "../repos/users";
import { answerNomination, slateFor } from "../repos/stewardSlate";

type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "getPool" | "members" | "firstName">;

/** What a named member has said, as one word the page can switch on. */
export type NominationAnswer = "accepted" | "declined" | "waiting";

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, members, firstName } = deps;

  /**
   * THE LIST THE PROPOSER CHOOSES FROM: founding members, and only them.
   *
   * "founders only for this first season". The picker asks the server rather
   * than filtering a member list in the browser, because the rule that decides
   * who may be named has to be the same one the proposal is validated against
   * (`launchSlateProblem`) and the same one the seating applies at the close.
   * Three copies of a rule is how a village ends up being offered a name the
   * next screen refuses.
   *
   * ADMIN-GATED because it is an admin surface and sits under
   * `/api/admin/launch`, the same door as the checklist it appears on. It
   * leaks nothing a member cannot already see: the roster page lists every
   * member and their standing.
   */
  app.get("/api/admin/launch/steward-candidates", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const founders = await catalystRoster(getPool());
    res.json({
      // The count of powers a seat carries, sent rather than typed into the
      // page, for the reason `HANDOVER_SET`'s own header gives: a new
      // transferable power joins the set without anybody remembering to, and
      // a hand-typed number on a screen would then be a promise nobody checks.
      powerCount: HANDOVER_SET.length,
      candidates: founders.map((f) => ({ id: f.id, name: firstName(f.name) })),
    });
  });

  /**
   * THE SLATE ON ONE BALLOT, INCLUDING THE DECLINES, FOR EVERY MEMBER.
   *
   * Rye asked for the declines to be shown, and shown means shown to the
   * VILLAGE and not only to the person who declined or to an administrator.
   * This village does not run secret ballots: `serveBallot` already sends
   * every vote and every weight to every member, and who was asked to hold
   * nineteen powers and said no is a smaller disclosure than that.
   *
   * `mine` is sent as a fact rather than left to be worked out from a name,
   * for the same reason the objection list sends it: the page cannot match a
   * first name to a viewer.
   */
  app.get("/api/governance/ballots/:id/steward-slate", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const ballot = await ballotById(getPool(), req.params.id);
    if (!ballot) return res.status(404).json({ error: "Not found" });
    const rows = await slateFor(getPool(), ballot.id);
    const nameOf = async (id: string) => {
      const u = await members.byId(id);
      return u ? firstName(u.name) : "A departed member";
    };
    res.json({
      subjectType: ballot.subjectType,
      /**
       * Whether an answer can still be given. A closed ballot's slate is a
       * record, and the page has to be able to tell "nobody has answered yet"
       * from "nobody answered and it is too late", which are the same two
       * lists and two different sentences.
       */
      open: ballot.status === "open" && Date.parse(ballot.closesAt) > Date.now(),
      /**
       * One person chose this slate and the page says who. The village is
       * voting on somebody else's list and is owed that fact plainly.
       *
       * Read off the first row rather than off `ballots.opened_by`, because
       * the proposer is stored per row and a later design that let a slate be
       * amended would put a different name on the amended rows. Null when the
       * slate is empty, which is the one case where there is nobody to name.
       */
      proposedBy: rows[0] ? await nameOf(rows[0].proposedBy) : null,
      powerCount: HANDOVER_SET.length,
      members: await Promise.all(
        rows.map(async (r) => ({
          id: r.userId,
          name: await nameOf(r.userId),
          answer: answerOf(r.declinedAt, r.accepted),
          declinedAt: r.declinedAt ? r.declinedAt.toISOString() : null,
          mine: r.userId === user.id,
        })),
      ),
    });
  });

  /**
   * ACCEPT THE SEAT, OR DECLINE IT.
   *
   * ONLY SOMEBODY THE PROPOSAL NAMED CAN ANSWER, and the refusal says so in
   * words. It is the same rule the seating enforces at the close, asked early:
   * a member the proposal did not name has no nomination to answer, and
   * `ballot_votes.stands_for_steward` on somebody off the slate seats nobody.
   *
   * ONLY WHILE THE VOTE IS OPEN. After the close the seating has already read
   * these rows, so an answer given afterwards would be a change to a decision
   * already made, and the record of who was asked and what they said would
   * stop matching what the village acted on.
   *
   * ACCEPTING DOES NOT CAST A VOTE, and declining does not either. The two are
   * separate acts on purpose: somebody may want the seat and still not be
   * ready to vote for the launch, and nothing should quietly answer the
   * village's most consequential question on their behalf.
   *
   * WHICH IS WHY THE ANSWER THIS SENDS BACK IS THE ONE THAT WAS RECORDED,
   * never the one that was asked for. The acceptance is carried on the VOTE
   * row, so accepting before voting stores no yes anywhere and leaves the
   * nominee at `waiting`, with the yes still to be given alongside their vote.
   * Echoing "accepted" there would be a screen telling somebody they had taken
   * a seat the close will not give them. `answerNomination` re-reads the row
   * and this sends what it found.
   */
  app.post("/api/governance/ballots/:id/steward-slate", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const accept = req.body?.accept === true;
    const ballot = await ballotById(getPool(), req.params.id);
    if (!ballot) return res.status(404).json({ error: "Not found" });
    if (ballot.subjectType !== VILLAGE_LAUNCH) {
      return res.status(409).json({ error: "This vote has no steward's seat to accept or decline." });
    }
    if (!(ballot.status === "open" && Date.parse(ballot.closesAt) > Date.now())) {
      return res.status(409).json({
        error:
          "This vote has closed, so the answers it carries are the record of what was decided and cannot change now.",
      });
    }
    const row = await answerNomination(getPool(), ballot.id, user.id, accept);
    if (!row) {
      return res.status(409).json({
        error:
          "This proposal did not name you for the steward's seat, so there is nothing here for you to accept or decline.",
      });
    }
    res.json({ success: true, answer: answerOf(row.declinedAt, row.accepted) });
  });
}

/**
 * The one word a page switches on, derived in ONE place.
 *
 * A DECLINE BEATS AN ACCEPTANCE when both are somehow set, which is the same
 * fail-safe direction the seating takes. The two cannot disagree, because
 * `answerNomination` is the only writer of either and writes both; deriving it
 * this way means that if they ever did, the screen and the seating would still
 * agree with each other about what the member said.
 */
function answerOf(declinedAt: Date | null, accepted: boolean): NominationAnswer {
  if (declinedAt !== null) return "declined";
  return accepted ? "accepted" : "waiting";
}

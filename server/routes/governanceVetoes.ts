/**
 * The steward's veto on a decision the village already carried.
 *
 *   POST /api/governance/ballots/:id/veto          stop it, and say why
 *   POST /api/governance/ballots/:id/no-objection  say early that nothing is wrong
 *   POST /api/governance/vetoes/:id/redact         blank the words, keep the act
 *   GET  /api/governance/stewardship               who holds the seat, and what it may stop
 *
 * ── WHAT THESE ROUTES DO AND DO NOT DO ─────────────────────────────────────
 *
 * They write the ACT and nothing else. Whether a vetoed decision stops landing
 * is read from `stewardVetoStands` by the close dispatcher, which owns
 * `lands_at` and `applyDueGovernance`. Two copies of that rule would disagree
 * eventually, and the disagreement would land on somebody who thinks they
 * stopped something.
 *
 * NOTHING HERE APPROVES ANYTHING. The approval model this file first shipped
 * as is withdrawn. A carried decision lands on its own whether or not anybody
 * holds the seat; the seat's one power is to stop it inside the window before
 * it lands, and a token send is stopped while its ballot is still open by the
 * steward voting no on it, which is the ballot route's job and not this one's.
 *
 * ── THE REFUSALS, AND WHY EACH ONE IS A DIFFERENT ANSWER ───────────────────
 *
 * 401  not signed in
 * 403  signed in and not holding the veto
 * 404  no such decision, or no such act to redact
 * 409  the decision did not carry, so there is nothing to stop; or its window
 *      has closed and the instant it closed is named; or this kind of decision
 *      is outside every steward's reach, with the reason
 * 400  a veto with no reason. The founder ruled that a veto carries a reason;
 *      a blank one is how that requirement gets met without being met.
 *
 * ── THE WINDOW, AND WHO KNOWS ABOUT IT ────────────────────────────────────
 *
 * `lands_at` is the dispatcher lane's column and its lane writes it. This
 * module asks `vetoWindowVerdict`, which the dispatcher fills in at boot
 * through `setVetoWindowCheck`. Until it does, the verdict answers that NO
 * WINDOW IS KNOWN, which is its own answer and not a yes: the route lets the
 * veto through so it is not dead on a build without the dispatcher, and every
 * payload carries `windowKnown` so no surface can render a countdown it does
 * not have.
 *
 * ── AN EMPTY SEAT IS NOT AN ERROR ──────────────────────────────────────────
 *
 * `GET /api/governance/stewardship` is readable by any member and says three
 * different true things about an empty seat: nobody has ever held it, somebody
 * held it and their term ran out, or nobody holds it and nothing here can be
 * stopped by one. None of them is a warning, and none of them says anything
 * waits, because nothing does. `vacancyState` writes the sentence; this route
 * serves it verbatim so the wording lives in one place.
 *
 * MOUNTED BEHIND requireModule("governance"), which server/index.ts installs
 * on the /api/governance prefix before this module's register() is called.
 * Nothing here re-checks that: one place decides, and it is upstream.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { ballotById } from "../lib/ballots";
import { changeSetOf, recordVeto as stopTheLanding } from "../lib/applyDue";
import {
  mayVeto,
  recordNoObjection,
  recordVeto,
  redactVetoReason,
  stewardVetoStands,
  subjectIsVetoable,
  subjectTypesSeen,
  vacancyState,
  vetoReasonProblem,
  vetoWindowIsKnown,
  vetoWindowVerdict,
  vetoesFor,
  REASON_NOTICE,
  STEWARD_COUNCIL_KEY,
  STEWARD_SUBJECTS_KEY,
  STEWARD_VETO,
} from "../lib/stewardship";
import { boolVar, stringVar } from "../lib/variables";

type Deps = Pick<AppDeps, "authedUser" | "mayAct" | "isAdmin" | "getPool" | "members" | "firstName" | "notify">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, mayAct, isAdmin, getPool, members, firstName, notify } = deps;

  /**
   * One gate for both acts, so the veto and the no-objection can never drift
   * apart on who is allowed to make them or on what a carried decision means.
   *
   * `mayAct` rather than `hasCapability`, per docs/ARCHITECTURE.md: this is an
   * act, so it needs the break-glass door and the public record that comes
   * with it. A village that has taken this power off the admin panel can still
   * be reached past in an emergency, and the reach is recorded.
   */
  async function gate(
    req: any,
    res: any,
  ): Promise<{ user: any; ballot: NonNullable<Awaited<ReturnType<typeof ballotById>>> } | null> {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const verdict = await mayAct(req, STEWARD_VETO);
    if (!verdict.ok) {
      res.status(verdict.needsOverride ? 409 : 403).json({
        error: verdict.message,
        holder: verdict.holderName,
        needsOverride: verdict.needsOverride,
      });
      return null;
    }
    const ballot = await ballotById(getPool(), String(req.params.id));
    if (!ballot) {
      res.status(404).json({ error: "No such decision" });
      return null;
    }
    if (ballot.status !== "passed") {
      res.status(409).json({
        error:
          ballot.status === "open"
            ? "This decision is still open. A steward who wants it stopped votes no on it while it is open."
            : `This decision did not carry, so there is nothing to stop. It reads as ${ballot.status.replace("_", " ")}.`,
        status: ballot.status,
      });
      return null;
    }
    return { user, ballot };
  }

  /** Every act on a decision, with each steward named. */
  async function actsPayload(ballotId: string) {
    const rows = await vetoesFor(getPool(), ballotId);
    return Promise.all(
      rows.map(async (r) => {
        const who = await members.byId(r.decidedBy);
        return {
          id: r.id,
          act: r.act,
          reason: r.reason,
          redacted: !!r.redactedAt,
          redactedAt: r.redactedAt,
          decidedAt: r.decidedAt,
          decidedBy: who ? firstName(who.name) : "A departed member",
          decidedByUserId: r.decidedBy,
        };
      }),
    );
  }

  /**
   * THE STEWARD IS NAMED, and that is a ruling rather than an implementation
   * choice. Voter identity defaults to secret and this does not, because the
   * founder's answer every time has been that transparency is the protection:
   * a decision the village carried stopping without anybody being told who
   * stopped it, or why, is the defect the reason requirement exists to close.
   */
  app.post("/api/governance/ballots/:id/veto", async (req, res) => {
    const ok = await gate(req, res);
    if (!ok) return;
    const { user, ballot } = ok;

    /*
     * Is this decision inside any steward's reach at all? Two carve-outs live
     * in the answer: a seat cannot veto its own removal, and cannot veto an
     * edit to its own limits.
     *
     * THE ELEMENTS ARE READ, not assumed. The first build asked the subject
     * type alone, so a change set carrying `governance.veto_hours` beside a
     * dial answered "vetoable" and the seat could stop the village shortening
     * its own window. `changeSetOf` returns an empty list for a subject with
     * no proposal behind it, which is the same answer as before for every
     * subject that carries no elements.
     */
    const reach = await subjectIsVetoable(
      getPool(),
      { subjectType: ballot.subjectType, subjectRef: ballot.subjectRef },
      await changeSetOf(getPool(), ballot),
    );
    if (!reach.vetoable) {
      return res.status(409).json({ error: reach.why, subjectType: ballot.subjectType });
    }

    // Is the window still open? The dispatcher owns the instant; this asks it.
    const window = await vetoWindowVerdict(getPool(), ballot.id);
    if (!window.open) {
      return res.status(409).json({ error: window.error, windowKnown: true });
    }

    const reason = String(req.body?.reason ?? "").trim();
    const problem = vetoReasonProblem(reason);
    if (problem) return res.status(400).json({ error: problem, notice: REASON_NOTICE });

    const result = await recordVeto(getPool(), { ballotId: ballot.id, decidedBy: user.id, reason });
    if (!result.ok) return res.status(400).json({ error: result.error, notice: REASON_NOTICE });

    const standing = await stewardVetoStands(getPool(), ballot.id);

    /*
     * THE ACT IS RECORDED FIRST, THE LANDING IS STOPPED SECOND, and the order
     * is the honest one. What the steward said is theirs and stays on the
     * record whatever happens next; whether it stops the decision is the
     * village's arithmetic, and under `governance.steward_council` one voice
     * out of three stops nothing until the third agrees.
     *
     * The one case where a recorded veto stops nothing and is right to: an
     * override. The village already brought this back and passed it at the
     * highest bar it has set for itself, so it lands, and this objection is
     * read beside the first one rather than instead of it.
     */
    let stopped = false;
    let unstoppable: string | null = null;
    if (standing.stands) {
      const stop = await stopTheLanding({ pool: getPool() }, { ballotId: ballot.id, stewardId: user.id, reason });
      stopped = stop.ok;
      if (!stop.ok) unstoppable = stop.error;
    }

    // The proposer hears it from the person, not from a status change. The
    // proposal goes back to them with its backers, the way a missed quorum
    // already does, so a veto is the start of another turn and not an end.
    if (ballot.openedBy && ballot.openedBy !== user.id) {
      await notify({
        userId: ballot.openedBy,
        type: "ballot_vetoed",
        title: `A steward stopped ${ballot.title}`,
        body: reason,
        link: `/decisions/${ballot.id}`,
        dedupeKey: `bal:${ballot.id}:vetoed:${user.id}`,
      });
    }

    res.json({
      success: true,
      ballotId: ballot.id,
      status: ballot.status,
      stands: standing.stands,
      stopped,
      unstoppable,
      standing: {
        vetoes: standing.vetoes,
        needed: standing.needed,
        seated: standing.seated,
        council: standing.council,
        sentence: standing.sentence,
      },
      windowKnown: window.known,
      acts: await actsPayload(ballot.id),
    });
  });

  /**
   * The courtesy, and it CLOSES NOTHING.
   *
   * A steward who has looked and seen nothing wrong may say so early. The
   * decision still lands at its landing instant and not one minute sooner, and
   * this same steward may still veto later inside the window if they see
   * something. Both acts stay on the record, which is why the response says
   * what it did and does not say the decision is settled.
   */
  app.post("/api/governance/ballots/:id/no-objection", async (req, res) => {
    const ok = await gate(req, res);
    if (!ok) return;
    const { user, ballot } = ok;

    const result = await recordNoObjection(getPool(), {
      ballotId: ballot.id,
      decidedBy: user.id,
      reason: String(req.body?.reason ?? "").trim(),
    });
    if (!result.ok) return res.status(400).json({ error: result.error });

    res.json({
      success: true,
      ballotId: ballot.id,
      status: ballot.status,
      changesNothing: true,
      sentence: "Noted. This decision lands when it was always going to land, and you can still stop it until then.",
      windowKnown: vetoWindowIsKnown(),
      acts: await actsPayload(ballot.id),
    });
  });

  /**
   * Blank the words, keep the act.
   *
   * A veto reason is public permanent free text one member wrote about
   * another's work, so there has to be a way to take the words back without
   * taking back the fact that the decision was stopped. Open to a steward and
   * to an admin: the member the words are ABOUT usually has neither, and a
   * request they cannot make themselves has to be one somebody can make for
   * them.
   */
  app.post("/api/governance/vetoes/:id/redact", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const admin = await isAdmin(req);
    if (!admin) {
      const verdict = await mayAct(req, STEWARD_VETO);
      if (!verdict.ok) {
        return res.status(verdict.needsOverride ? 409 : 403).json({
          error: verdict.message,
          holder: verdict.holderName,
          needsOverride: verdict.needsOverride,
        });
      }
    }
    const result = await redactVetoReason(getPool(), String(req.params.id), user.id);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({
      success: true,
      alreadyRedacted: result.alreadyRedacted,
      act: {
        id: result.row.id,
        act: result.row.act,
        reason: result.row.reason,
        redacted: !!result.row.redactedAt,
        redactedAt: result.row.redactedAt,
        decidedAt: result.row.decidedAt,
        decidedByUserId: result.row.decidedBy,
      },
      sentence: "The words are gone. The veto, who made it and when stay on the record, because the village made that decision together.",
    });
  });

  /**
   * Who holds the seat, for how long, and what this village lets it stop.
   *
   * A member read, not an admin one. The whole point of naming the steward is
   * that the village can see who is holding its last word.
   */
  app.get("/api/governance/stewardship", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });

    const pool = getPool();
    const state = await vacancyState(pool);
    const subjects = await subjectTypesSeen(pool);

    const named = await Promise.all(
      state.holdings.map(async (h) => {
        const who = await members.byId(h.userId);
        return {
          member: who ? firstName(who.name) : "A departed member",
          userId: h.userId,
          roleId: h.roleId,
          roleName: h.roleName,
          seatedAt: h.grantedAt,
          termEndsAt: h.termEndsAt,
          seasonId: h.seasonId,
          lapsed: h.lapsed,
        };
      }),
    );

    res.json({
      seated: state.seated,
      healthy: state.healthy,
      stillAsked: state.stillAsked,
      council: state.council,
      sentence: state.sentence,
      holders: named,
      notice: REASON_NOTICE,
      // False means no landing instant is recorded on this build, so no
      // surface should render a countdown. It is not the same as "the window
      // is open", and the two must never be collapsed.
      windowKnown: vetoWindowIsKnown(),
      // The setting the map was computed from, so a reader can tell an empty
      // list ("this village has held no votes yet") apart from a village that
      // has put every subject out of the seat's reach.
      settings: {
        stewardSubjects: stringVar(STEWARD_SUBJECTS_KEY),
        stewardCouncil: boolVar(STEWARD_COUNCIL_KEY),
      },
      subjects: subjects.map((s) => ({ subjectType: s, mayVeto: mayVeto(s) })),
    });
  });
}

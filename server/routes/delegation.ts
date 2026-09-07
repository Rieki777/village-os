/**
 * Handing your voice to somebody, taking it back, and seeing where every
 * voice in the village ended up.
 *
 * Seven routes:
 *
 *   GET    /api/governance/delegation         mine: who I named, whether they
 *                                             have accepted, who actually
 *                                             decides for me, what is offered
 *                                             to me, and per vote who I
 *                                             followed
 *   PUT    /api/governance/delegation         offer it, or move it to somebody
 *                                             else. It carries nothing until
 *                                             the delegate accepts
 *   DELETE /api/governance/delegation         take it back
 *   POST   /api/governance/delegation/accept  the delegate says yes
 *   POST   /api/governance/delegation/decline the delegate says no, or hands
 *                                             back one they had accepted
 *   POST   /api/governance/delegation/uncast  take my vote back on one open
 *                                             ballot
 *   GET    /api/governance/concentration      who decides how much of this
 *                                             village, with a ballot's own
 *                                             roll when one is named
 *
 * A DELEGATION IS A HANDSHAKE (0175). Naming somebody is an OFFER: both sides
 * see it, and it carries no choice into any ballot until the delegate accepts.
 * Without that, pointing a delegation at a member was enough to read their
 * hidden choice off your own ballot row, take the delegation back and vote
 * your own way with nothing left behind. Consent is what closes that window,
 * and it is why accept and decline are routes rather than a flag.
 *
 * ALL FOUR MOUNT BEHIND requireModule("governance"), installed on the
 * /api/governance prefix in server/index.ts before this register() runs. The
 * module ships OFF, and while it is off every path here is a 404.
 *
 * CONCENTRATION IS VISIBLE TO EVERY PLAYER, by the transparency ruling. The
 * founder settled that a member may hold most of the voice as long as everyone
 * can see it, and delegation is weight concentration by another route, so it
 * gets the same treatment. A member holding twenty delegations quietly is
 * exactly the state that ruling exists to prevent. It takes a signed-in
 * member, because the answer is a list of people and their standing, and that
 * is a village-facing fact rather than a public one.
 *
 * NO NEW CAPABILITY KEY. Giving a delegation is a member acting on their own
 * voice, so the gate is the one that already decides whether they have a voice
 * to give: `ballot.vote`. `capabilityCtx` rather than `guardCapability`, the
 * same call server/routes/governanceWizard.ts makes and for the same reason,
 * because this asks a member about themselves and carries no break-glass.
 *
 * WHAT THIS FILE DOES NOT DECIDE. Whether a delegation may be given at all
 * (cycles, self-delegation), how a chain resolves, and what a change does to
 * an open ballot all live in server/lib/delegation.ts. This file reads the
 * gate, names the people, and reports what the library did.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { hasCapability } from "../../shared/capabilities";
import { uncastDelegatedVote } from "../lib/ballots";
import {
  acceptDelegations,
  applyDelegatedVotesEverywhere,
  ballotDelegationView,
  CONCENTRATION_LABELS,
  declineDelegations,
  delegationsToMe,
  hiddenChoiceView,
  effectiveConcentration,
  isCarrying,
  liveDelegationOf,
  resolveDelegate,
  revokeDelegation,
  setDelegation,
  voterIdentityNow,
  votesFollowedBy,
} from "../lib/delegation";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "capabilityCtx" | "members" | "firstName">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, capabilityCtx, members, firstName } = deps;

  /** Names for a set of ids, so nobody reads a page of identifiers. One roster read. */
  const namesFor = async (ids: string[]): Promise<Map<string, string>> => {
    const wanted = new Set(ids.filter(Boolean));
    const out = new Map<string, string>();
    if (wanted.size === 0) return out;
    for (const m of await members.all()) {
      const id = String(m.id);
      if (wanted.has(id)) out.set(id, firstName(String(m.name ?? "")));
    }
    return out;
  };

  /**
   * MY DELEGATION, AND WHO I ACTUALLY FOLLOWED.
   *
   * Two different facts, and serving only the first would hide the whole
   * mechanism. `delegateTo` is the member I named. `decidedBy` is who my voice
   * reaches at the end of the chain, which is the one that matters once chains
   * are transitive: naming B and being decided by C four hops away is the
   * feature working, and it stops being visible the moment this route reports
   * B alone.
   *
   * THE PER-VOTE LIST HOLDS BACK AN OPEN BALLOT'S CHOICE (0175). Section 4
   * argued that secrecy resolved itself here, because a delegated vote is
   * your own vote in your own row. That was written while every ballot was
   * public. On a hidden ballot the same sentence describes a live window into
   * whoever you named, so while a vote is still running a delegated row says
   * that it was cast and who decided it. The choice arrives at the close,
   * with everybody else's. `hiddenChoiceView` is the one rule and it is
   * applied here through the same shape the ballot page uses.
   *
   * BOTH SIDES SEE A PENDING DELEGATION. `offeredToMe` is the delegate's half
   * of the handshake, and `accepted` is the delegator's, so neither side is
   * left wondering why nothing is being decided.
   */
  app.get("/api/governance/delegation", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const me = String(user.id);
    const mine = await liveDelegationOf(pool, me);
    const chain = await resolveDelegate(pool, me);
    const votes = await votesFollowedBy(pool, me, 50);
    const offers = await delegationsToMe(pool, me);
    const identity = voterIdentityNow();
    const names = await namesFor([
      mine?.delegateId ?? "",
      chain.finalId,
      ...chain.chain,
      ...votes.map((v) => v.followedUserId ?? ""),
      ...offers.map((o) => o.delegatorId),
    ]);
    res.json({
      delegateTo: mine ? mine.delegateId : null,
      delegateToName: mine ? names.get(mine.delegateId) ?? null : null,
      since: mine ? mine.createdAt : null,
      // The handshake, as the delegator sees it. `accepted` false with a
      // `delegateTo` set is an offer nobody has answered, which is a
      // different state from having no delegation at all.
      accepted: mine ? isCarrying(mine) : null,
      acceptedAt: mine ? mine.acceptedAt : null,
      // Null when I decide for myself, which is a different answer from "I
      // delegated to somebody who has not been resolved yet".
      decidedBy: chain.hops > 0 ? chain.finalId : null,
      decidedByName: chain.hops > 0 ? names.get(chain.finalId) ?? null : null,
      hops: chain.hops,
      chain: chain.chain.map((id) => ({ userId: id, name: names.get(id) ?? null })),
      // The delegate's half: everything offered to me and everything I carry.
      offeredToMe: offers.map((o) => ({
        delegatorId: o.delegatorId,
        delegatorName: names.get(o.delegatorId) ?? null,
        since: o.createdAt,
        accepted: o.acceptedAt !== null,
        acceptedAt: o.acceptedAt,
      })),
      pendingToMe: offers.filter((o) => o.acceptedAt === null).length,
      carriedByMe: offers.filter((o) => o.acceptedAt !== null).length,
      choicesHidden: identity.choicesHidden,
      choicesHiddenSource: identity.source,
      votes: votes.map((v) => {
        const followedName = v.followedUserId ? names.get(v.followedUserId) ?? null : null;
        const view = hiddenChoiceView({
          ballotStatus: v.ballotStatus,
          choicesHidden: identity.choicesHidden,
          choice: v.choice,
          followedUserId: v.followedUserId,
          followedName,
        });
        return {
          ballotId: v.ballotId,
          ballotTitle: v.ballotTitle,
          ballotStatus: v.ballotStatus,
          castAt: v.castAt,
          followedUserId: v.followedUserId,
          followedName,
          choice: view.choice,
          choiceHidden: view.choiceHidden,
          sentence: view.sentence,
        };
      }),
    });
  });

  /**
   * OFFER a delegation, or move one that already stands.
   *
   * It carries nothing yet (0175). The delegate accepts before any choice is
   * copied, because a delegation nobody agreed to is a window into their
   * ballot rather than a gift of yours. `pending: true` in the answer is the
   * whole difference, and the copy beside it says what happens next.
   *
   * A cycle is refused here, at the moment the delegation is created, and
   * never at tally time: with transitive chains a cycle is an infinite loop in
   * the routine that counts a season's votes. The guard reads the offers too,
   * because a loop that closes when a pending offer is accepted is still a
   * loop and the accept route is the wrong place to find one.
   *
   * Every ballot still taking votes is re-derived on the way out, because
   * changing a delegation mid-ballot is the same class of act as changing your
   * own vote, which an open ballot already allows. The counts come back so the
   * answer can say what actually moved. On a fresh offer that is usually
   * nothing, and on a re-point away from an accepted delegate it is every row
   * that delegate was deciding.
   */
  app.put("/api/governance/delegation", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const ctx = await capabilityCtx(user);
    if (!hasCapability("ballot.vote", ctx)) {
      return res.status(403).json({
        error: "Voting is not open to your account at the moment, so there is no voice here to hand on yet",
      });
    }
    const delegateId = String(req.body?.delegateId ?? "").trim();
    if (!delegateId) return res.status(400).json({ error: "A delegation names the member you are handing your voice to" });
    const target = await members.byId(delegateId);
    if (!target) return res.status(404).json({ error: "No member here by that name" });
    const pool = getPool();
    const result = await setDelegation(pool, String(user.id), delegateId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    const moved = await applyDelegatedVotesEverywhere(pool);
    const names = await namesFor([result.delegation.delegateId, result.chain.finalId]);
    const delegateName = names.get(result.delegation.delegateId) ?? "them";
    const pending = result.delegation.acceptedAt === null;
    res.json({
      success: true,
      delegateTo: result.delegation.delegateId,
      delegateToName: names.get(result.delegation.delegateId) ?? null,
      pending,
      accepted: !pending,
      message: pending
        ? `Offered to ${delegateName}. Your voice stays yours until they accept, and you can take the offer back at any time`
        : `${delegateName} already carries your voice, so nothing about that changed`,
      decidedBy: result.chain.finalId,
      decidedByName: names.get(result.chain.finalId) ?? null,
      hops: result.chain.hops,
      openBallotsTouched: moved.filter((b) => b.counts.added + b.counts.changed + b.counts.removed > 0).length,
      openBallotsChecked: moved.filter((b) => b.counts.eligible).length,
      // Ballots that took no delegated row because their subject asks every
      // member to answer it themselves. Told apart from "nothing to do".
      openBallotsAskingEveryone: moved.filter((b) => b.counts.eligible && !b.counts.carries).length,
    });
  });

  /**
   * ACCEPT WHAT WAS OFFERED TO ME. The delegate's half of the handshake, and
   * the moment the chain starts carrying.
   *
   * `delegatorId` accepts one offer; leaving it out accepts every offer
   * standing to me. Either way the answer separates "nothing was offered"
   * from "something was offered and it did not land", because a delegate told
   * "accepted 0" and left to guess which will guess wrong.
   *
   * The gate is `ballot.vote`, the same one the offer needed: carrying
   * somebody's voice means casting it, and an account that cannot vote cannot
   * decide for anyone.
   */
  app.post("/api/governance/delegation/accept", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const ctx = await capabilityCtx(user);
    if (!hasCapability("ballot.vote", ctx)) {
      return res.status(403).json({
        error: "Voting is not open to your account at the moment, so you cannot carry anybody's voice yet",
      });
    }
    const pool = getPool();
    const only = String(req.body?.delegatorId ?? "").trim();
    const counts = await acceptDelegations(pool, String(user.id), only || undefined);
    const moved = await applyDelegatedVotesEverywhere(pool);
    const names = await namesFor(counts.delegatorIds);
    res.json({
      success: true,
      accepted: counts.changed,
      // Zero eligible means nothing was offered. Eligible above zero with
      // accepted zero means somebody moved first, which is not the same
      // answer and must not read as one.
      wasOffered: counts.eligible,
      hadNone: counts.eligible === 0,
      delegators: counts.delegatorIds.map((id) => ({ userId: id, name: names.get(id) ?? null })),
      message:
        counts.eligible === 0
          ? "Nobody has offered you their voice right now"
          : `You now carry ${counts.changed} voice(s). Every vote you cast is copied into their row, and they can see who decided it`,
      openBallotsTouched: moved.filter((b) => b.counts.added + b.counts.changed + b.counts.removed > 0).length,
      openBallotsChecked: moved.filter((b) => b.counts.eligible).length,
    });
  });

  /**
   * DECLINE AN OFFER, or hand back a voice I had accepted.
   *
   * One act for both, because they are one act: the delegate ending an
   * arrangement they are half of. Either side may end a delegation at any
   * time, and a delegate asked to carry a voice they do not want is not
   * obliged to leave the offer sitting there.
   *
   * No capability gate. Ending an arrangement is never something an account
   * needs a power to do, and an account that lost `ballot.vote` while
   * carrying voices is exactly the one that should be able to hand them back.
   */
  app.post("/api/governance/delegation/decline", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const only = String(req.body?.delegatorId ?? "").trim();
    const counts = await declineDelegations(pool, String(user.id), only || undefined);
    const moved = await applyDelegatedVotesEverywhere(pool);
    const names = await namesFor(counts.delegatorIds);
    res.json({
      success: true,
      declined: counts.changed,
      wasLive: counts.eligible,
      hadNone: counts.eligible === 0,
      delegators: counts.delegatorIds.map((id) => ({ userId: id, name: names.get(id) ?? null })),
      message:
        counts.eligible === 0
          ? "Nobody has offered you their voice right now"
          : `You handed back ${counts.changed} voice(s). They decide for themselves again, and any vote you had cast for them is no longer cast`,
      openBallotsTouched: moved.filter((b) => b.counts.added + b.counts.changed + b.counts.removed > 0).length,
      openBallotsChecked: moved.filter((b) => b.counts.eligible).length,
    });
  });

  /**
   * TAKE MY VOTE BACK on one open ballot.
   *
   * The delegator's door onto the one DELETE this engine performs against
   * `ballot_votes`. It removes the row somebody else decided and takes the
   * whole delegation back with it, because a row taken back while the
   * delegation still carries is a row the next derivation writes again, and a
   * control that undoes itself an instant later has lied.
   *
   * Afterwards the seat is NOT CAST. It is not an abstain: an abstain is a
   * choice somebody made, and nobody made one here. Quorum falls, which is
   * the honest reading of a seat nobody is deciding.
   */
  app.post("/api/governance/delegation/uncast", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const ballotId = String(req.body?.ballotId ?? "").trim();
    if (!ballotId) return res.status(400).json({ error: "Taking a vote back names the vote it is on" });
    const result = await uncastDelegatedVote(getPool(), ballotId, String(user.id));
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({
      success: true,
      removed: result.removed,
      // Nothing was following here, told apart from a ballot that could not
      // be reached at all (that answered 400 above with a sentence).
      hadNone: result.removed === 0,
      delegationEnded: result.delegationEnded,
      message:
        result.removed === 0
          ? "There was no vote here that somebody else decided for you"
          : "Your vote here is uncast, and you decide for yourself again",
    });
  });

  /**
   * Take it back.
   *
   * Idempotent, and the answer says which of the two things happened, because
   * "you had nothing to revoke" and "the revocation failed" are different
   * answers and only one of them is a problem. Every open ballot is re-derived
   * the same way a change is: a member who takes their voice back before a
   * ballot closes has their row removed, and their vote is uncast again rather
   * than left carrying somebody else's choice.
   */
  app.delete("/api/governance/delegation", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const revoked = await revokeDelegation(pool, String(user.id));
    const moved = await applyDelegatedVotesEverywhere(pool);
    res.json({
      success: true,
      revoked,
      hadNone: !revoked,
      openBallotsTouched: moved.filter((b) => b.counts.added + b.counts.changed + b.counts.removed > 0).length,
      openBallotsChecked: moved.filter((b) => b.counts.eligible).length,
    });
  });

  /**
   * WHO DECIDES HOW MUCH OF THIS VILLAGE.
   *
   * How many delegations somebody holds DIRECTLY is not the interesting number
   * once chains exist, so both are served and the effective count leads: how
   * many votes this member decides, counting everyone who reaches them through
   * anybody, and what share of the village that is.
   *
   * The shares add to one because every member is decided by exactly one
   * member, themselves when they handed their voice to nobody.
   */
  app.get("/api/governance/concentration", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const roster = (await members.all()).map((m) => String(m.id));
    const rows = await effectiveConcentration(pool, roster);
    const names = await namesFor([...roster, ...rows.map((r) => r.decidedBy)]);
    /*
     * ONE BALLOT'S OWN ROLL, WHEN THE CALLER NAMES ONE (0175).
     *
     * The village-wide figure answers "how much of everybody does this member
     * decide". On a live vote the question is narrower and sharper: the roll
     * froze at open, it is the people who were actually asked, and a member
     * deciding four of nine seats holds far more of THIS decision than "four
     * of ninety accounts" suggests. Both go out, both labelled, because a
     * page that showed one under the other's words would mislead quietly and
     * neither number is wrong.
     *
     * The withheld bloc rides along: seats following somebody who has not
     * voted here. A delegate who simply stays silent withholds every one of
     * them, which is stronger than voting no, and it reads from outside as
     * ordinary low turnout until somebody counts it.
     */
    const ballotId = String((req.query as any)?.ballotId ?? "").trim();
    const onBallot = ballotId ? await ballotDelegationView(pool, ballotId, roster) : null;
    const ballotNames = onBallot ? await namesFor(onBallot.rows.map((r) => r.userId)) : new Map();
    res.json({
      memberCount: roster.length,
      labels: CONCENTRATION_LABELS,
      rows: rows
        .map((r) => ({
          ...r,
          name: names.get(r.userId) ?? null,
          decidedByName: names.get(r.decidedBy) ?? null,
        }))
        .sort((a, b) => b.effectiveVotes - a.effectiveVotes || a.userId.localeCompare(b.userId)),
      onBallot: onBallot
        ? {
            ballotId: onBallot.ballotId,
            // Three different answers a caller must be able to tell apart:
            // this ballot is still taking votes, this subject refuses
            // delegated rows, and there is simply nothing following here.
            stillOpen: onBallot.eligible,
            carriesDelegations: onBallot.carries,
            whyNot: onBallot.whyNot,
            electorateCount: onBallot.electorateCount,
            accountCount: onBallot.accountCount,
            withheldSeats: onBallot.withheldSeats,
            rows: onBallot.rows.map((r) => ({
              ...r,
              name: ballotNames.get(r.userId) ?? null,
            })),
          }
        : null,
    });
  });
}

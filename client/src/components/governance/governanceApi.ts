/**
 * The one door onto the governance engine, typed.
 *
 * Every route in this module's block refuses a stranger (`authedUser` then
 * 401), so every call from here carries the session token. That is not a
 * convention: `scripts/check-auth-fetch.mjs` derives the rule from the server
 * and fails the build for a client call that reaches a refusing route without
 * one, which is why nothing in this directory calls `fetch` directly.
 *
 * The payload types mirror what `serveBallot` in server/index.ts answers with.
 * They are written out rather than inferred because a page that renders a
 * field the server stopped sending should fail at the typecheck, not by
 * quietly showing an empty bar to a village mid-vote.
 */
import { authToken } from "@/lib/gameApi";
import type { BallotMethod, VoteChoice } from "@shared/governanceEngine";

export interface BallotVote {
  name: string;
  choice: VoteChoice;
  weight: number;
  castAt: string;
}

export interface BallotSilent {
  name: string;
  weight: number;
}

export interface BallotObjection {
  id: string;
  by: string;
  /** The viewer raised this one, so they may withdraw it. */
  mine: boolean;
  text: string;
  status: "open" | "integrated" | "concern" | "withdrawn";
  rulingNote: string | null;
  ruledAt: string | null;
  createdAt: string;
}

/**
 * WHERE AN OBJECTION LED (0102).
 *
 * An objection that changed a proposal should say so on its own page. This is
 * the forward edge that says it: the vote the amended version ran as, named by
 * the proposer when they opened it.
 *
 * It is fetched beside the ballot instead of arriving inside it. The column is
 * NULL on nearly every objection that will ever exist, because objections are
 * consent-only and "this village's own dials" is the default method, so almost
 * every decision page would carry an empty field. And the facts here belong to
 * a DIFFERENT ballot, which is a second read either way.
 *
 * NOTHING IN THIS SHAPE NAMES A PERSON, and nothing may be added that does.
 * Lineage sits on the artifact. A count of objections per member is the
 * scoreboard this whole idea was reframed to avoid.
 */
export interface ObjectionLineage {
  objectionId: string;
  /** The vote the amended proposal ran as. */
  ballotId: string;
  title: string;
  status: string;
  closedAt: string | null;
}

export interface Ballot {
  id: string;
  subjectType: string;
  subjectRef: string;
  /**
   * Whether closing this changes anything by itself. The server reads it off
   * the close route's own subject table, so "this vote binds" and "this vote
   * executes" are one sentence there and cannot drift apart. A member is owed
   * this BEFORE they vote: someone who thinks they decided something and finds
   * out later that they did not is worse off than someone who never voted.
   */
  binding: boolean;
  title: string;
  docMarkdown: string;
  method: BallotMethod;
  weightMode: "equal" | "token" | "custom";
  weightToken: string | null;
  unityPct: number;
  quorumPct: number;
  totalWeight: number;
  electorateCount: number;
  opensAt: string;
  closesAt: string;
  status: "open" | "passed" | "failed" | "no_quorum" | "withdrawn";
  outcomeNote: string | null;
  closedBy: string | null;
  closedAt: string | null;
  tallies: { yesW: number; noW: number; abstainW: number };
  unity: number;
  quorum: number;
  votes: BallotVote[];
  silent: BallotSilent[];
  objections: BallotObjection[];
  /**
   * How many objections stand between this ballot and passing, counted by the
   * SAME function the close route evaluates with. Both payloads carry it, so
   * no surface recounts: a client that reckoned for itself once showed
   * "nothing stands in the way" over a consent ballot whose upheld objection
   * was about to fail it. Zero on every method but consent.
   */
  standingObjections: number;
  /**
   * WHAT A POWER HANDOVER IS ASKING, AND WHETHER IT LANDED (lane G-C).
   *
   * Null on every other subject type. Every field inside it is a fact the
   * server stated or an explicit null, and `TransferCeremony` renders no
   * sentence that is not one of them: a card that filled a gap with a
   * plausible default would tell a village it holds a power it does not, and
   * the member finds that out by being refused.
   *
   * `crossedHere` is the crossing itself, read off the holding row's own
   * ballot id. It is what makes the ceremony say the same thing on the day
   * and on the anniversary; the close response's `applied` exists only in the
   * session that closed the vote.
   */
  transfer: {
    /**
     * WHICH OF THE THREE POWER CEREMONIES THIS IS.
     *
     * `transfer` is a power crossing to the village, `grant` is the village
     * voting a power onto a role so somebody can act at all, `return` is the
     * village handing one back. The card switches on this and has NO default
     * branch: a kind a build does not know renders nothing, which is the same
     * fail-safe direction as an unparseable subject ref.
     *
     * Typed as a union and never a string, so a fourth ceremony cannot be
     * added server-side and quietly render as one of these three.
     */
    kind: "transfer" | "grant" | "return";
    capability: string;
    /** The registry's noun for this power. Null when nothing names it. */
    title: string | null;
    /** Where in the product it is used. Null when nothing names it. */
    surface: string | null;
    /** What a holder could DO. Null rather than the key dressed as prose. */
    consequence: string | null;
    /** Whether this platform can move this key at all. */
    movable: boolean;
    /** The role the ask names. Null on a return, which names no role. */
    toRoleId: string | null;
    /** Null when the role has been retired since the vote opened. */
    toRoleName: string | null;
    /** Whether that role can actually use it, read now and not at open. */
    roleCarriesIt: boolean;
    heldNow: { roleId: string; roleName: string | null; byBallot: boolean; movedAt: string } | null;
    crossedHere: { movedAt: string } | null;
  } | null;
  /**
   * MY OWN ROW, AS THE SERVER LETS ME READ IT (0175).
   *
   * `choice` is NULL while a vote is running and the village hides choices
   * and somebody else decided this row: a delegated vote is cast, and what it
   * said is not the delegator's to read before everybody else reads it.
   * `sentence` is what the page shows in that state, and it arrives with the
   * choice at the close.
   */
  myVote: {
    choice: VoteChoice | null;
    reason: string | null;
    choiceHidden: boolean;
    state: "cast_by_me" | "cast_following";
    sentence: string;
    followedUserId: string | null;
    followedName: string | null;
  } | null;
  /** Null means the viewer is outside this electorate. Zero means inside it,
   *  holding no weight, which is a different and much louder fact. */
  myWeight: number | null;
}

/** An earlier ballot the village held on this same subject. */
export interface PriorAttempt {
  id: string;
  title: string;
  status: Ballot["status"];
  outcomeNote: string | null;
  opensAt: string;
  closedAt: string | null;
}

/**
 * A DECISION READ COLD, MONTHS LATER, BY SOMEBODY WHO WAS NOT THERE.
 *
 * Everything a `Ballot` carries is about the ballot itself and is the same
 * whichever route answered. These two are about its place in the village's
 * story, they are served only by `GET /api/governance/ballots/:id`, and they
 * have their own type for exactly that reason: the close, vote and withdraw
 * routes answer with a plain `Ballot`, and a field declared on `Ballot` that
 * three of the four routes do not send would be a type saying something the
 * server does not.
 *
 * `appliedKeys` is what this decision changed, read back out of the amendment
 * ledger. The outcome card used to get that from the close response alone, so
 * it existed in one browser session and was gone by morning: open a carried
 * decision the next day and the most interesting thing about it had
 * evaporated. The ledger row is permanent and carries the ballot's own id.
 *
 * `priorAttempts` is every earlier ballot on the same subject, newest first.
 * The engine has kept the chain since 0089 and no surface has ever shown it.
 */
export interface DecisionRecord extends Ballot {
  appliedKeys: string[];
  priorAttempts: PriorAttempt[];
}

/**
 * A ballot as a CARD reads it: the two bars, the clock, and whether this vote
 * is waiting on the viewer. Deliberately NOT a `Ballot`: the list route does
 * not build the voter roll, so a card that reached for `votes` would be
 * reading a field the server never sends, and the typecheck says so here
 * instead of a member seeing an empty list.
 */
export interface BallotCard {
  id: string;
  subjectType: string;
  subjectRef: string;
  /** As on `Ballot`: false means closing it executes nothing. */
  binding: boolean;
  title: string;
  method: BallotMethod;
  /**
   * The card's ONLY source for this, and the reason the server started
   * sending it: a list payload builds no objections array, so a consent card
   * used to name objections as the deciding thing and then say nothing about
   * whether one stood.
   */
  standingObjections: number;
  weightMode: "equal" | "token" | "custom";
  unityPct: number;
  quorumPct: number;
  totalWeight: number;
  electorateCount: number;
  opensAt: string;
  closesAt: string;
  status: "open" | "passed" | "failed" | "no_quorum" | "withdrawn";
  outcomeNote: string | null;
  closedAt: string | null;
  tallies: { yesW: number; noW: number; abstainW: number };
  unity: number;
  quorum: number;
  votedCount: number;
  /**
   * MY OWN ROW, AS THE SERVER LETS ME READ IT (0175).
   *
   * `choice` is NULL while a vote is running and the village hides choices
   * and somebody else decided this row: a delegated vote is cast, and what it
   * said is not the delegator's to read before everybody else reads it.
   * `sentence` is what the page shows in that state, and it arrives with the
   * choice at the close.
   */
  myVote: {
    choice: VoteChoice | null;
    reason: string | null;
    choiceHidden: boolean;
    state: "cast_by_me" | "cast_following";
    sentence: string;
    followedUserId: string | null;
    followedName: string | null;
  } | null;
  myWeight: number | null;
}

export interface Standing {
  mode: "equal" | "token" | "custom";
  token: string | null;
  tokenName: string | null;
  eligible: boolean;
  /**
   * Why `eligible` is false, for the one case a member is owed by name. A
   * warning badge's deny beats role, badge and stage in the one gate, so a
   * member carrying one is left off every roll built while it stands. The
   * card used to name both possible reasons and let her guess which was hers.
   */
  deniedByWarning: boolean;
  weight: number;
  why: string;
  /** Holds proposal.decide: may rule objections and close a ballot early. */
  mayDecide: boolean;
  history: Array<{
    id: number;
    userId: string;
    oldWeight: number | null;
    newWeight: number;
    actorUserId: string;
    note: string;
    at: string;
  }>;
}

export interface ProposalDraft {
  id: string;
  wizardType: string;
  payload: Record<string, unknown>;
  stepIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface WizardFacts {
  conductable: string[];
  /**
   * The kinds this village can put to a NON-BINDING vote today, which is every
   * kind the executors have not reached yet. A type step holding both lists
   * can offer a practice vote where it used to offer a locked card.
   */
  advisory: string[];
  mayOpenAdvisory: boolean;
  draftCap: number;
  supportThreshold: number;
  mayOpenBallot: boolean;
}

const headers = (): Record<string, string> => {
  const t = authToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

export type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One shape for every call, so no caller has to remember whether a route
 * answers `error` or `message`, and so a network failure and a refusal reach
 * the page as the same kind of thing: a sentence to show a person.
 */
async function call<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const res = await fetch(path, { headers: headers(), ...init });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const error =
        body?.message ??
        body?.error ??
        (res.status === 404 ? "That is not here" : "Something went wrong. Try again");
      // The module-off answer is a real state, not an error to apologise for.
      return { ok: false, error: error === "module_disabled" ? "This village has not turned on governance" : String(error) };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: "Nothing answered. Check your connection and try again" };
  }
}

/**
 * The record, a page at a time.
 *
 * The route served a bare `LIMIT 100` and offered no way to ask for row 101,
 * so a village four years in simply lost its founding decisions off the end
 * of its own record. The default is still that same hundred, because every
 * card buys its own tallies read and this week's vote should not cost a
 * village its whole history. Asking for the next page is the member's act.
 */
export const fetchBallots = (page?: { limit?: number; offset?: number }) => {
  const q = new URLSearchParams();
  if (page?.limit) q.set("limit", String(page.limit));
  if (page?.offset) q.set("offset", String(page.offset));
  const qs = q.toString();
  return call<BallotCard[]>(`/api/governance/ballots${qs ? `?${qs}` : ""}`);
};
export const fetchBallot = (id: string) =>
  call<DecisionRecord>(`/api/governance/ballots/${encodeURIComponent(id)}`);
export const fetchStanding = () => call<Standing>("/api/governance/standing");

/**
 * Lineage for the objections a panel is already holding, asked for by their
 * own ids. Objections with no successor come back absent, which is what is
 * true about them.
 *
 * ASKED IN BATCHES BECAUSE THE ROUTE CAPS ITS BATCH, and a village can reach
 * that cap. A `no` vote in consent mode files an objection on its own, so a
 * village of sixty where fifty-five vote no has fifty-five objections on one
 * decision. Sending all of them and taking the first fifty back would leave
 * the tail of that page quietly missing a sentence the record holds, and a
 * page that goes quiet at scale is the kind of gap nobody finds.
 */
const LINEAGE_BATCH = 50;
export async function fetchObjectionLineage(objectionIds: string[]): Promise<Answer<ObjectionLineage[]>> {
  const rows: ObjectionLineage[] = [];
  for (let at = 0; at < objectionIds.length; at += LINEAGE_BATCH) {
    const batch = objectionIds.slice(at, at + LINEAGE_BATCH);
    const answer = await call<ObjectionLineage[]>(
      `/api/governance/objections/lineage?ids=${encodeURIComponent(batch.join(","))}`,
    );
    if (!answer.ok) return answer;
    rows.push(...answer.data);
  }
  return { ok: true, data: rows };
}
export const fetchWizardFacts = () => call<WizardFacts>("/api/governance/wizard");

export const castVote = (id: string, choice: VoteChoice, reason?: string) =>
  call<{ success: true; choice: VoteChoice; ballot: Ballot | null }>(
    `/api/governance/ballots/${encodeURIComponent(id)}/vote`,
    { method: "POST", body: JSON.stringify({ choice, ...(reason ? { reason } : {}) }) },
  );

export const fileObjection = (id: string, text: string) =>
  call<{ success: true; id: string }>(`/api/governance/ballots/${encodeURIComponent(id)}/objections`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

export const ruleObjection = (id: string, objectionId: string, ruling: string, note: string) =>
  call<{ success: true }>(
    `/api/governance/ballots/${encodeURIComponent(id)}/objections/${encodeURIComponent(objectionId)}/rule`,
    { method: "POST", body: JSON.stringify({ ruling, note }) },
  );

export interface CloseResult {
  success: true;
  outcome: "passed" | "failed" | "no_quorum";
  unity: number;
  quorum: number;
  tallies: { yesW: number; noW: number; abstainW: number };
  applied: string[];
  held: string | null;
  ballot: Ballot;
}

/**
 * Call a ballot off. It decides nothing, executes nothing, and frees the
 * subject for a fresh vote straight away.
 *
 * `votesDiscarded` comes back so the surface can say what the withdrawal cost
 * in members' votes. The route's own rule is that whoever opened it may call
 * off a ballot NOBODY has answered, and once even one vote stands it takes a
 * proposal.decide holder or an admin, because cast votes belong to somebody
 * other than the opener.
 */
export const withdrawBallot = (id: string, reason: string) =>
  call<{ success: true; votesDiscarded: number; ballot: Ballot }>(
    `/api/governance/ballots/${encodeURIComponent(id)}/withdraw`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );

/**
 * Ask the village something on the real engine, without the answer doing
 * anything: a real frozen electorate, real weights, a real quorum to reach.
 *
 * `about` names the kind of decision being practised and is optional; the
 * server ignores anything outside its advisory list. `method` is offered here
 * and not on a binding ballot, because practising with consent one moon and
 * majority the next is most of what a practice vote is for.
 */
export const openAdvisory = (input: {
  question: string;
  detail?: string;
  about?: string;
  method?: string;
}) => call<{ success: true; ballot: Ballot }>("/api/governance/advisory", {
  method: "POST",
  body: JSON.stringify(input),
});

export const closeBallot = (id: string, outcomeNote: string) =>
  call<CloseResult>(`/api/governance/ballots/${encodeURIComponent(id)}/close`, {
    method: "POST",
    body: JSON.stringify({ outcomeNote }),
  });

/**
 * The village-wide weight record, in first names.
 *
 * `MyStanding` answers "what do I weigh"; this answers "what does everyone
 * weigh, and who changed it". `governance_weight_changes` is append-only and
 * the constitution's rule is that weight is on the record, so the route serves
 * this to every signed-in member and not only to admins. It had no caller for
 * as long as the allocation table had no screen.
 */
export interface WeightRecord {
  mode: "equal" | "token" | "custom";
  token: string | null;
  allocations: Array<{ member: string; weight: number }>;
  history: Array<{
    member: string;
    oldWeight: number | null;
    newWeight: number;
    by: string;
    note: string;
    at: string;
  }>;
}

export const fetchWeightRecord = () => call<WeightRecord>("/api/governance/weights");

export const fetchDrafts = () => call<{ cap: number; drafts: ProposalDraft[] }>("/api/governance/drafts");

export const saveDraft = (input: {
  id?: string | null;
  wizardType: string;
  payload: Record<string, unknown>;
  stepIndex: number;
}) =>
  call<{ success: true; draft: ProposalDraft; created: boolean }>("/api/governance/drafts", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteDraft = (id: string) =>
  call<{ success: true }>(`/api/governance/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Publish a finished wizard payload to its subject's own route. */
export const publishProposal = (path: string, body: Record<string, unknown>) =>
  call<any>(path, { method: "POST", body: JSON.stringify(body) });

/**
 * Vote delegation: you hand your voice to someone you choose.
 *
 * The word is already in this village's vocabulary. `shared/power.ts` glosses
 * the `delegated` way of deciding as "You hand your voice to someone you
 * choose", and until this file there was nothing behind it.
 *
 * THE ONE DECISION THE WHOLE FEATURE TURNS ON: COPY THE CHOICE, NEVER MOVE
 * THE WEIGHT. A delegated vote is a row for the DELEGATOR carrying the
 * delegate's choice, with `followed_user_id` recording who decided it. The
 * delegate's own weight is untouched. Three things follow, and each one is a
 * problem this design does not have:
 *
 *  - The participation arithmetic stays honest. "9 of 12 people voted" counts
 *    nine rows whoever decided them, so the people-and-weight sentence keeps
 *    meaning what it says.
 *  - The frozen electorate keeps meaning what it says. Who may vote and how
 *    much each vote weighs froze at open. Delegation changes only WHAT a vote
 *    says.
 *  - "Change it at any time" stops colliding with the snapshot law. Changing a
 *    delegation mid-ballot is the same class of act as changing your own vote,
 *    which an open ballot already allows, so it re-derives one row and touches
 *    no frozen column.
 *
 * CHAINS ARE TRANSITIVE, by the founder's ruling: A delegates to B, B
 * delegates to C, and A follows C. He accepted the concentration that creates
 * on the same terms he has accepted every other concentration: the protection
 * is transparency. So three things here are load-bearing rather than nice to
 * have.
 *
 *  1. CYCLES ARE REFUSED AT CREATION, never at tally time. Without
 *     transitivity a cycle is a curiosity. With it, a cycle is an infinite
 *     loop in the routine that counts a season's votes. `delegationProblem`
 *     walks the chain before any write and refuses the delegation that would
 *     close the loop, and every walker in this file carries a visited set too,
 *     so a row written by hand around the route stops a walk instead of
 *     hanging it.
 *  2. A DELEGATOR SEES WHO THEY ACTUALLY FOLLOWED. `followed_user_id` holds
 *     the FINAL decider, never the member the delegator named. If A named B
 *     and C decided four hops away, A reads C. A reading B is the
 *     concentration becoming invisible again.
 *  3. EFFECTIVE CONCENTRATION IS THE NUMBER THAT MATTERS. How many
 *     delegations somebody holds directly stops being interesting the moment
 *     chains exist. `effectiveConcentration` answers the real question: how
 *     many votes does this member decide, counting everyone who reaches them
 *     through anybody, and what share of the electorate is that.
 *
 * A DELEGATE WHO DOES NOT VOTE LEAVES THE DELEGATOR'S VOTE UNCAST. There is
 * no row, so quorum counts that member as not having voted. It is never an
 * abstain, because an abstain is a choice somebody made. That is the same
 * empty-versus-zero rule this codebase has paid for several times.
 *
 * ONE ROUTINE DERIVES EVERY DELEGATED ROW. `applyDelegatedVotes` is called
 * from both places a delegated row can become stale: after a vote is cast or
 * changed, and after a delegation is given, changed or revoked. Deriving the
 * whole ballot each time rather than patching the members who look affected
 * is deliberate, because a delegation change moves everyone downstream of the
 * member who changed it, and a routine that tried to work out who those were
 * would be a second copy of the resolution rule.
 *
 * ── 0175: A DELEGATION IS A HANDSHAKE, AND A HIDDEN CHOICE STAYS HIDDEN ─────
 *
 * Everything above was written while every ballot was public. Choices are
 * hidden by default now, and four rules follow from that one change. Each of
 * them is here rather than in a route, because each of them decides whether a
 * vote exists or what a member is allowed to read, and those are not
 * decisions a caller should be able to forget.
 *
 *  1. THE DELEGATE ACCEPTS FIRST. A delegation with `accepted_at` NULL is an
 *     offer. Both sides see it and it carries nothing. Without this, anybody
 *     could point a delegation at a steward, read her hidden choice off their
 *     own ballot row minutes after she cast it, take the delegation back and
 *     vote their own way with nothing left behind. That is a private window
 *     into somebody else's secret ballot, opened without asking them.
 *     `loadDelegationMap` therefore carries only accepted rows, and
 *     `loadOfferedMap` (offers included) exists for exactly one purpose: the
 *     cycle guard, which has to refuse a loop that has not closed yet.
 *
 *  2. WHILE A BALLOT IS OPEN AND CHOICES ARE HIDDEN, THE DELEGATOR READS THAT
 *     THEIR VOTE WAS CAST AND WHO DECIDED IT, NEVER WHAT IT SAID. Section 4's
 *     "secrecy resolves itself, because your delegated vote is your own vote"
 *     was true of a public ballot and is a disclosure channel on a hidden one.
 *     `hiddenChoiceView` is the whole rule, pure, and `ownVoteView` in
 *     server/lib/ballots.ts is the serving path that applies it. The choice
 *     arrives at the close, with everybody else's.
 *
 *  3. TAKING A DELEGATION BACK RESTORES THE NOT-CAST STATE. There was no
 *     DELETE against `ballot_votes` anywhere in the engine, so a repudiated
 *     choice kept carrying weight. `deleteDelegatedRow` is that DELETE, always
 *     guarded on `followed_user_id IS NOT NULL` so it can never reach a vote
 *     somebody made themselves, and `uncastDelegatedVote` in ballots.ts is the
 *     guarded door both "withdraw my delegation" and "take my vote back" come
 *     through. Quorum falls when a delegation is withdrawn, which is the
 *     honest answer: nobody is deciding that seat any more.
 *
 *  4. A SILENT DELEGATE IS VISIBLE WHILE THE WINDOW IS OPEN. A delegate who
 *     simply does not vote withholds every seat that follows them, which is
 *     stronger than voting no (a no counts toward quorum; an uncast seat does
 *     not) and looks from outside like ordinary apathy.
 *     `unvotedDelegationsOn` names the withheld bloc on the live ballot, so
 *     the village can see it happening rather than read it off the result.
 *
 * AND ONE VOTE DELEGATION NEVER TOUCHES. On a subject that asks for 100%
 * unity, or for a yes from every seat, a delegated row does not exist:
 * `delegationCarriesOn` refuses it and `applyDelegatedVotes` sweeps any that
 * stand. The Birthing's whole meaning is that everybody personally showed up,
 * and one member holding two delegations could otherwise carry a three-seat
 * village alone while the record read as three parties agreeing.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { VoteChoice } from "../../shared/governanceEngine";
import { evaluationRulesFor } from "../../shared/ballotSubjects";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { variable } from "./variables";

export interface DelegationRow {
  delegatorId: string;
  delegateId: string;
  createdAt: string;
  revokedAt: string | null;
  /**
   * NULL until the delegate says yes. A pending delegation is visible to both
   * sides and carries no choice into any ballot.
   */
  acceptedAt: string | null;
}

/** Live and accepted: this delegation is carrying choices right now. */
export function isCarrying(row: DelegationRow | null): boolean {
  return !!row && row.revokedAt === null && row.acceptedAt !== null;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

/**
 * Every CARRYING delegation, as delegator to delegate: live and accepted.
 *
 * This is the map every tally, derivation and concentration read uses, and
 * the acceptance filter is the whole difference between a delegation being a
 * handshake and being a window. One read, then every walk in this file is
 * pure arithmetic over the map, because resolving a whole electorate with one
 * query per hop would make a chain's depth a database cost.
 */
export async function loadDelegationMap(pool: Pool): Promise<Map<string, string>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the delegations table's one enumerable home (the ballots.ts pattern; no cache sits above it)
    "SELECT delegator_id, delegate_id FROM delegations WHERE revoked_at IS NULL AND accepted_at IS NOT NULL",
  );
  const map = new Map<string, string>();
  for (const r of rows) map.set(String(r.delegator_id), String(r.delegate_id));
  return map;
}

/**
 * Every live delegation INCLUDING the ones nobody has accepted yet.
 *
 * One caller, and the reason it exists: the cycle guard. A pending offer
 * carries no choice today and can be accepted an hour from now, so a guard
 * that looked only at accepted rows would let A offer to B and B offer to A,
 * and the loop would close the moment the second one said yes, in a routine
 * with nobody left to refuse it. Cycles are refused at creation or they are
 * refused inside the tally, and the tally is the wrong place.
 *
 * Nothing else may use this map. A delegation that has not been accepted
 * decides nothing, so it must not appear in a concentration figure, a
 * derivation, or an answer about who decides for somebody.
 */
export async function loadOfferedMap(pool: Pool): Promise<Map<string, string>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the delegations table's one enumerable home (the ballots.ts pattern; no cache sits above it)
    "SELECT delegator_id, delegate_id FROM delegations WHERE revoked_at IS NULL",
  );
  const map = new Map<string, string>();
  for (const r of rows) map.set(String(r.delegator_id), String(r.delegate_id));
  return map;
}

export interface ResolvedChain {
  /** Who actually decides for this member. Themselves, when they delegate to nobody. */
  finalId: string;
  /** Every member walked through, starting with the caller. One entry means no delegation. */
  chain: string[];
  /** How many delegations were followed. Zero means this member decides for themselves. */
  hops: number;
  /**
   * True when the walk stopped because it met a member it had already seen.
   * `delegationProblem` makes this unreachable through the route, so a true
   * here means a row was written around it and the chain ends nowhere useful.
   */
  looped: boolean;
}

/**
 * Follow the chain to the member who actually decides.
 *
 * Pure, over a map the caller loaded once. The visited set is a second guard
 * behind the creation-time refusal: this function must terminate on any input,
 * including a cycle somebody wrote straight into the table, because it runs
 * inside the tally.
 */
export function resolveFinal(map: Map<string, string>, userId: string): ResolvedChain {
  const chain: string[] = [userId];
  const seen = new Set<string>([userId]);
  let current = userId;
  for (;;) {
    const next = map.get(current);
    if (next === undefined) return { finalId: current, chain, hops: chain.length - 1, looped: false };
    if (seen.has(next)) return { finalId: current, chain, hops: chain.length - 1, looped: true };
    seen.add(next);
    chain.push(next);
    current = next;
  }
}

/** `resolveFinal` for one member, loading the map for you. One read. */
export async function resolveDelegate(pool: Pool, userId: string): Promise<ResolvedChain> {
  return resolveFinal(await loadDelegationMap(pool), userId);
}

/**
 * WHY THIS DELEGATION CANNOT BE GIVEN, in the sentence the member reads, or
 * null when it can.
 *
 * Pure and exported so the refusal can be proven without a database, and so
 * the route and the writer below cannot drift into two different rules.
 *
 * HAND IT THE OFFERED MAP, never the carrying one (0175). A loop made of
 * offers nobody has accepted yet closes the moment they are accepted, in the
 * tally, where there is nobody left to refuse it.
 */
export function delegationProblem(
  map: Map<string, string>,
  delegatorId: string,
  delegateId: string,
): string | null {
  if (!delegatorId || !delegateId) return "A delegation names the member you are handing your voice to";
  if (delegatorId === delegateId) {
    return "You already decide for yourself. A delegation hands your voice to somebody else";
  }
  // The delegate's own chain, walked as it stands. If the delegator is
  // anywhere along it, adding this edge closes a loop and the votes at the end
  // of it would have nobody deciding them.
  const onward = resolveFinal(map, delegateId);
  // Where the delegator sits on the delegate's chain says which sentence is
  // true. Position 1 is the delegate following the delegator directly, which
  // is the swap somebody tries first. Anything further along is a chain that
  // comes back, which the member cannot see and has to be told about.
  const meetsAt = onward.chain.indexOf(delegatorId);
  if (meetsAt >= 0) {
    return meetsAt === 1
      ? "That member has delegated their voice to you, so this would send your voice in a circle. One of you has to decide"
      : "That member's voice already follows a chain that comes back to you, so this would send both voices in a circle. One of you has to decide";
  }
  return null;
}

export type SetDelegationResult =
  | { ok: true; delegation: DelegationRow; chain: ResolvedChain }
  | { ok: false; error: string };

/**
 * Give a delegation, or move one that already stands. It lands PENDING, and
 * carries nothing until the delegate accepts.
 *
 * One row per member, ever: the primary key is the delegator alone, so this is
 * an upsert that also clears `revoked_at`. Handing your voice to somebody new
 * is one act, never a revocation followed by a gift, and a member who reads
 * their delegation between the two halves of that pair should never see a
 * moment where they had none.
 *
 * THE CYCLE GUARD READS THE OFFERS TOO. A loop that closes when a pending
 * offer is accepted is still a loop, and the accept route is not the place to
 * discover one, so the refusal happens here against every live row.
 *
 * WHEN AN ACCEPTANCE SURVIVES, AND WHY THE SQL IS ORDERED THE WAY IT IS. A
 * member who re-gives a delegation to the SAME delegate while it still stands
 * has changed nothing that delegate consented to, so the acceptance holds and
 * nobody is asked to say yes twice to the same sentence. Re-pointing at
 * somebody new, or reviving a delegation that was revoked, lands at pending:
 * the new delegate has consented to nothing, and a consent given before a
 * revocation was consent to an arrangement that ended.
 *
 * MySQL evaluates an ON DUPLICATE KEY UPDATE list left to right and later
 * assignments see the earlier ones, so `accepted_at` is assigned FIRST, while
 * `delegate_id` and `revoked_at` still hold their old values. Reordering
 * those three assignments silently changes the rule. The case named "keeps an
 * acceptance only for the same live delegate" in delegation.test.ts is what
 * fails if anybody does.
 */
export async function setDelegation(
  pool: Pool,
  delegatorId: string,
  delegateId: string,
): Promise<SetDelegationResult> {
  const delegator = String(delegatorId ?? "").trim();
  const delegate = String(delegateId ?? "").trim();
  const offered = await loadOfferedMap(pool);
  const problem = delegationProblem(offered, delegator, delegate);
  if (problem) return { ok: false, error: problem };
  await pool.query( // module-review-ok: the delegations table's one enumerable home (the ballots.ts pattern; no cache sits above it)
    "INSERT INTO delegations (delegator_id, delegate_id, created_at, revoked_at, accepted_at) VALUES (?,?,NOW(),NULL,NULL) " +
      "ON DUPLICATE KEY UPDATE " +
      "accepted_at = IF(delegate_id = VALUES(delegate_id) AND revoked_at IS NULL, accepted_at, NULL), " +
      "delegate_id = VALUES(delegate_id), created_at = NOW(), revoked_at = NULL",
    [delegator, delegate],
  );
  const row = await delegationOf(pool, delegator);
  if (!row) throw new Error(`delegation for ${delegator} vanished inside its own write`);
  // The chain is walked over what CARRIES. A pending delegation resolves to
  // the delegator themselves, because nobody is deciding for them yet.
  const carrying = await loadDelegationMap(pool);
  return { ok: true, delegation: row, chain: resolveFinal(carrying, delegator) };
}

export interface AcceptanceCounts {
  /** Offers this act turned into carrying delegations, or live rows it ended. */
  changed: number;
  /**
   * How many rows the act was eligible to touch before it ran. Zero with
   * `changed` zero means there was nothing to do; a positive number with
   * `changed` zero means somebody moved first.
   */
  eligible: number;
  /** The delegators this act named, whatever it managed to do to them. */
  delegatorIds: string[];
}

/**
 * ACCEPT A DELEGATION OFFERED TO ME. The delegate's act, and the moment the
 * chain starts carrying.
 *
 * `delegatorId` names one offer; omitting it, or handing in a blank, accepts
 * every offer standing to me, which is the "you have three offers" inbox
 * saying yes to all of them. Blank reads as absent deliberately: a route that
 * forwards an empty form field must not be the difference between one
 * acceptance and all of them, and "all" is the answer the member asked for
 * when they pressed a button that named nobody.
 * Either way the answer separates "there was nothing offered" from "something
 * was offered and I could not take it", because a delegate who is told
 * "accepted 0" and cannot tell which of those happened will assume the wrong
 * one.
 *
 * ONLY A PENDING OFFER IS ACCEPTED. Re-accepting one that already carries is
 * `changed: 0` with `eligible: 0` and no error: the state the delegate asked
 * for is the state that stands.
 */
export async function acceptDelegations(
  pool: Pool,
  delegateId: string,
  delegatorId?: string,
): Promise<AcceptanceCounts> {
  const delegate = String(delegateId ?? "");
  // Blank reads as absent. See the header: an empty form field must not be
  // the difference between one row and every row.
  const named = String(delegatorId ?? "").trim();
  const one = named === "" ? null : named;
  const where =
    "delegate_id = ? AND revoked_at IS NULL AND accepted_at IS NULL" + (one ? " AND delegator_id = ?" : "");
  const args = one ? [delegate, one] : [delegate];
  const [pending] = await pool.query<RowDataPacket[]>( // module-review-ok: the delegations table's one enumerable home (the ballots.ts pattern; no cache sits above it)
    `SELECT delegator_id FROM delegations WHERE ${where}`,
    args,
  );
  const delegatorIds = pending.map((r) => String(r.delegator_id));
  if (delegatorIds.length === 0) return { changed: 0, eligible: 0, delegatorIds: [] };
  const [result] = await pool.query<any>( // module-review-ok: the delegations table's one enumerable home (the ballots.ts pattern; no cache sits above it)
    `UPDATE delegations SET accepted_at = NOW() WHERE ${where}`,
    args,
  );
  return { changed: Number(result.affectedRows), eligible: delegatorIds.length, delegatorIds };
}

/**
 * DECLINE A DELEGATION OFFERED TO ME, or hand one back that I had accepted.
 *
 * One act for both, because they are one act: the delegate ending an
 * arrangement they are half of. Either side may end a delegation at any time,
 * and a delegate who is asked to carry somebody's voice and does not want to
 * is not obliged to keep the offer sitting there. A declined row stamps
 * `revoked_at` like any other ending, so the delegator sees the same "nobody
 * is deciding for me" state they would see if they had taken it back
 * themselves, and the row that says so is one row rather than two states.
 *
 * `delegatorId` names one; omitting it or handing in a blank ends every live
 * delegation pointed at me, the same normalisation `acceptDelegations` makes
 * and for the same reason.
 */
export async function declineDelegations(
  pool: Pool,
  delegateId: string,
  delegatorId?: string,
): Promise<AcceptanceCounts> {
  const delegate = String(delegateId ?? "");
  // Blank reads as absent. See the header: an empty form field must not be
  // the difference between one row and every row.
  const named = String(delegatorId ?? "").trim();
  const one = named === "" ? null : named;
  const where = "delegate_id = ? AND revoked_at IS NULL" + (one ? " AND delegator_id = ?" : "");
  const args = one ? [delegate, one] : [delegate];
  const [live] = await pool.query<RowDataPacket[]>( // module-review-ok: the delegations table's one enumerable home (the ballots.ts pattern; no cache sits above it)
    `SELECT delegator_id FROM delegations WHERE ${where}`,
    args,
  );
  const delegatorIds = live.map((r) => String(r.delegator_id));
  if (delegatorIds.length === 0) return { changed: 0, eligible: 0, delegatorIds: [] };
  const [result] = await pool.query<any>( // module-review-ok: the delegations table's one enumerable home (the ballots.ts pattern; no cache sits above it)
    `UPDATE delegations SET revoked_at = NOW() WHERE ${where}`,
    args,
  );
  return { changed: Number(result.affectedRows), eligible: delegatorIds.length, delegatorIds };
}

/**
 * Take a delegation back. Idempotent: a member with nothing live gets `false`
 * and no error, because "there was nothing to revoke" and "the revocation
 * failed" are different answers and only one of them is a problem.
 */
export async function revokeDelegation(pool: Pool, delegatorId: string): Promise<boolean> {
  const [result] = await pool.query<any>( // module-review-ok: the delegations table's one enumerable home (the ballots.ts pattern; no cache sits above it)
    "UPDATE delegations SET revoked_at = NOW() WHERE delegator_id = ? AND revoked_at IS NULL",
    [String(delegatorId ?? "")],
  );
  return Number(result.affectedRows) > 0;
}

/** The delegation this member gave, live or revoked, or null if they never gave one. */
export async function delegationOf(pool: Pool, delegatorId: string): Promise<DelegationRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the delegations table's one enumerable home (the ballots.ts pattern; no cache sits above it)
    "SELECT delegator_id, delegate_id, created_at, revoked_at, accepted_at FROM delegations WHERE delegator_id = ?",
    [String(delegatorId ?? "")],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    delegatorId: String(r.delegator_id),
    delegateId: String(r.delegate_id),
    createdAt: iso(r.created_at),
    revokedAt: r.revoked_at === null || r.revoked_at === undefined ? null : iso(r.revoked_at),
    acceptedAt: r.accepted_at === null || r.accepted_at === undefined ? null : iso(r.accepted_at),
  };
}

/**
 * The live delegation this member gave, or null. Live includes PENDING: an
 * offer is a real thing the delegator gave and can take back, and hiding it
 * from them until somebody else acts would leave them unable to see why
 * nothing is being decided on their behalf.
 */
export async function liveDelegationOf(pool: Pool, delegatorId: string): Promise<DelegationRow | null> {
  const row = await delegationOf(pool, delegatorId);
  return row && row.revokedAt === null ? row : null;
}

/**
 * EVERY DELEGATION OFFERED TO ME OR CARRIED BY ME, newest first.
 *
 * A pending delegation is visible to both sides, which is what makes the
 * handshake a handshake rather than a request into silence. The delegate sees
 * who is asking; the delegator sees that they are waiting.
 */
export async function delegationsToMe(pool: Pool, delegateId: string): Promise<DelegationRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the delegations table's one enumerable home (the ballots.ts pattern; no cache sits above it)
    "SELECT delegator_id, delegate_id, created_at, revoked_at, accepted_at FROM delegations " +
      "WHERE delegate_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, delegator_id",
    [String(delegateId ?? "")],
  );
  return rows.map((r) => ({
    delegatorId: String(r.delegator_id),
    delegateId: String(r.delegate_id),
    createdAt: iso(r.created_at),
    revokedAt: r.revoked_at === null || r.revoked_at === undefined ? null : iso(r.revoked_at),
    acceptedAt: r.accepted_at === null || r.accepted_at === undefined ? null : iso(r.accepted_at),
  }));
}

export interface ConcentrationRow {
  userId: string;
  /**
   * How many votes this member effectively decides, counting themselves when
   * they decide for themselves and everyone who reaches them through anybody.
   * A member who delegated their own voice away decides zero.
   */
  effectiveVotes: number;
  /** How many members named this one directly. The less interesting number, kept because it is the one people expect. */
  directDelegations: number;
  /** `effectiveVotes` over the roster size, 0 to 1. */
  shareOfElectorate: number;
  /** Who decides for this member. Themselves when they delegate to nobody. */
  decidedBy: string;
  /** How many delegations lie between this member and the one who decides for them. */
  hops: number;
  /**
   * False for a member who is not on the roster and only appears here because
   * somebody on it follows them. Their own vote is not in the arithmetic.
   */
  onRoster: boolean;
}

/**
 * WHO DECIDES HOW MUCH OF THIS VILLAGE, for the roster handed in.
 *
 * The roster comes from the caller rather than from a query here, because
 * "every member" means something different to a route serving the village and
 * to a ballot serving its frozen roll, and a function that guessed would be
 * right for one of them.
 *
 * THE SUM IS THE PROPERTY THAT MAKES THE SHARES READABLE. Every roster member
 * is decided by exactly one member, themselves when they delegated to nobody,
 * so `effectiveVotes` over every row returned adds up to the roster size. A
 * test asserts it.
 *
 * That is why a member OFF the roster who decides for somebody on it gets a
 * row too, marked `onRoster: false`. Dropping them would lose their votes out
 * of the total and make the shares add to less than one, and resolving the
 * chain only as far as the roster would be a second copy of the resolution
 * rule that `applyDelegatedVotes` already holds. One rule: the chain runs to
 * its end, wherever that lands.
 */
export function concentrationOver(map: Map<string, string>, roster: string[]): ConcentrationRow[] {
  const onRoster = new Set(roster);
  const decidedBy = new Map<string, ResolvedChain>();
  const effective = new Map<string, number>();
  const direct = new Map<string, number>();
  for (const member of roster) {
    const walk = resolveFinal(map, member);
    decidedBy.set(member, walk);
    effective.set(walk.finalId, (effective.get(walk.finalId) ?? 0) + 1);
    const named = map.get(member);
    if (named !== undefined) direct.set(named, (direct.get(named) ?? 0) + 1);
  }
  const ids = [...roster];
  // `forEach` rather than iterating the keys: tsconfig.json leaves `target` at
  // its ES5 default, and a `for...of` over a Map iterator is TS2802 there.
  effective.forEach((_count, id) => {
    if (!onRoster.has(id)) ids.push(id);
  });
  const total = roster.length;
  return ids.map((member) => {
    const walk = decidedBy.get(member);
    const votes = effective.get(member) ?? 0;
    return {
      userId: member,
      effectiveVotes: votes,
      directDelegations: direct.get(member) ?? 0,
      shareOfElectorate: total > 0 ? votes / total : 0,
      decidedBy: walk ? walk.finalId : member,
      hops: walk ? walk.hops : 0,
      onRoster: onRoster.has(member),
    };
  });
}

/** `concentrationOver` with the live map loaded for you. One read. */
export async function effectiveConcentration(pool: Pool, roster: string[]): Promise<ConcentrationRow[]> {
  return concentrationOver(await loadDelegationMap(pool), roster);
}

/**
 * WHETHER A DELEGATED ROW MAY EXIST ON THIS BALLOT AT ALL.
 *
 * Pure, and read from the ballot's own FROZEN dials plus the subject's rules,
 * so a village that changes its thresholds mid-vote cannot change the answer
 * for a ballot already running.
 *
 * Three ways a subject says "everybody, personally":
 *
 *  - `unityPct` at 100 or above: every decided vote has to agree.
 *  - `consensus`: the method whose own sentence is unity of 100.
 *  - `minYesHeads: "all"`: the Birthing's rule said in heads, every seat yes.
 *
 * On any of them a delegated row is refused. The Birthing's stated meaning is
 * that every member of a new village personally showed up and said yes, and
 * its floor of three different parties is the whole legitimacy of the act. A
 * member holding two accepted delegations would otherwise satisfy that floor
 * alone: three rows, three seats, one person, and a record that reads as three
 * parties agreeing. The audit found the same hole under the transparency
 * ruling, and this is the door it closes.
 *
 * The refusal is not a punishment for delegating. A member who delegated is
 * simply not cast on this one vote and can vote it themselves, which is a
 * right they never gave up.
 */
export function delegationCarriesOn(ballot: {
  subjectType: string;
  method: string;
  unityPct: number;
}): { carries: boolean; why: string | null } {
  const { minYesHeads } = evaluationRulesFor(ballot.subjectType);
  if (Number(ballot.unityPct) >= 100 || ballot.method === "consensus" || minYesHeads === "all") {
    return {
      carries: false,
      why: "This vote asks every member to answer it themselves, so a delegated voice is not cast on it. Vote it yourself if you want it counted",
    };
  }
  return { carries: true, why: null };
}

/**
 * DELETE ONE DELEGATED ROW. The single statement that un-casts a copied vote,
 * and the only DELETE this engine performs against `ballot_votes`.
 *
 * `followed_user_id IS NOT NULL` is not an optimisation, it is the guard: a
 * vote a member made themselves is theirs, and no delegation machinery may
 * reach it. Every caller goes through here so there is one such statement to
 * read rather than one per caller. The guarded, clock-checking door both
 * routes come through is `uncastDelegatedVote` in server/lib/ballots.ts.
 *
 * Returns how many rows went, so "there was nothing following here" and "the
 * delete did not land" are different answers.
 */
export async function deleteDelegatedRow(pool: Pool, ballotId: string, userId: string): Promise<number> {
  const [result] = await pool.query<any>( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
    "DELETE FROM ballot_votes WHERE ballot_id = ? AND user_id = ? AND followed_user_id IS NOT NULL",
    [String(ballotId), String(userId)],
  );
  return Number(result.affectedRows);
}

export interface DerivationCounts {
  /** Rows written for a member who had none. */
  added: number;
  /** Rows rewritten because the choice or the decider changed. */
  changed: number;
  /** Rows deleted because nobody decides for that member any more. */
  removed: number;
  /**
   * False when the ballot is not taking votes, so the caller can tell "nothing
   * needed doing" from "this ballot was never eligible".
   */
  eligible: boolean;
  /**
   * False on a subject that refuses delegated rows (`delegationCarriesOn`).
   * Separate from `eligible` on purpose: a caller that reports "0 rows" has to
   * be able to say whether the ballot was closed, or open and asking everybody
   * to answer for themselves. Those read the same in a count and are different
   * facts.
   */
  carries: boolean;
}

const NOTHING: DerivationCounts = { added: 0, changed: 0, removed: 0, eligible: false, carries: false };

/**
 * DERIVE EVERY DELEGATED ROW ON ONE BALLOT from the delegations that stand
 * right now, and the votes members cast for themselves.
 *
 * The rule, in one pass over the frozen roll:
 *
 *  - A member who voted for themselves is never touched. `followed_user_id IS
 *    NULL` is what "I decided this" means, and the individual keeps full
 *    rights over their own row, which is the founder's own condition on the
 *    whole feature.
 *  - Otherwise the chain is walked. If the member at the end of it cast their
 *    own vote here, this member gets a row carrying that choice, stamped with
 *    that member's id.
 *  - Otherwise there is no row. A delegate who has not voted leaves the
 *    delegator's vote UNCAST, so quorum counts them as not having voted. An
 *    abstain would be a lie about a choice nobody made.
 *
 * THE REASON IS NEVER COPIED. A `no` may carry the words the voter wrote, and
 * those words belong to the person who wrote them. Copying them into somebody
 * else's row would attribute a sentence to a member who never said it, so a
 * delegated row carries the choice alone.
 *
 * A DELEGATED `no` FILES NO OBJECTION under the consent method, for the same
 * reason: an objection is reasoning, and it belongs to whoever reasoned. The
 * delegate's own objection already stands on the ballot.
 *
 * Refuses quietly on a ballot that is not taking votes, so a caller may hand
 * it any ballot id without checking the clock first.
 */
export async function applyDelegatedVotes(pool: Pool, ballotId: string): Promise<DerivationCounts> {
  const [ballotRows] = await pool.query<RowDataPacket[]>( // module-review-ok: a read of the ballot's own clock and frozen dials, beside the derivation they gate (the ballots.ts pattern)
    "SELECT status, closes_at, subject_type, method, unity_pct FROM ballots WHERE id = ?",
    [ballotId],
  );
  const ballot = ballotRows[0];
  if (!ballot || String(ballot.status) !== "open") return { ...NOTHING };
  // One clock, the same subtraction castVote makes: `closes_at` was written
  // from a process clock, so this holds on a database in any zone.
  if (Date.parse(iso(ballot.closes_at)) <= Date.now()) return { ...NOTHING };

  // EVERYBODY, PERSONALLY. On a subject that asks for unity of 100 or a yes
  // from every seat, no delegated row exists, and any that stand are swept
  // here rather than left to be counted. The sweep runs before the map is
  // even loaded: a village that turned this subject strict after a delegation
  // was derived should still find nothing following on it.
  const { carries } = delegationCarriesOn({
    subjectType: String(ballot.subject_type),
    method: String(ballot.method),
    unityPct: Number(ballot.unity_pct),
  });
  if (!carries) {
    const [swept] = await pool.query<any>( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
      "DELETE FROM ballot_votes WHERE ballot_id = ? AND followed_user_id IS NOT NULL",
      [ballotId],
    );
    return { added: 0, changed: 0, removed: Number(swept.affectedRows), eligible: true, carries: false };
  }

  const map = await loadDelegationMap(pool);
  if (map.size === 0) {
    // NO DELEGATIONS AT ALL, which is every village until somebody gives one,
    // and this is the path a vote takes on the way in. Reading the roll and
    // walking it would answer the same question the slow way: with nothing
    // live, every delegated row on this ballot is stale by definition, and
    // deleting them is exactly what the loop below would decide one at a time.
    const [swept] = await pool.query<any>( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
      "DELETE FROM ballot_votes WHERE ballot_id = ? AND followed_user_id IS NOT NULL",
      [ballotId],
    );
    return { added: 0, changed: 0, removed: Number(swept.affectedRows), eligible: true, carries: true };
  }

  const [rollRows] = await pool.query<RowDataPacket[]>( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
    "SELECT user_id FROM ballot_electorate WHERE ballot_id = ?",
    [ballotId],
  );
  const [voteRows] = await pool.query<RowDataPacket[]>( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
    "SELECT user_id, choice, followed_user_id FROM ballot_votes WHERE ballot_id = ?",
    [ballotId],
  );

  const own = new Map<string, VoteChoice>();
  const delegated = new Map<string, { choice: VoteChoice; followed: string }>();
  for (const r of voteRows) {
    const uid = String(r.user_id);
    const choice = String(r.choice) as VoteChoice;
    if (r.followed_user_id === null || r.followed_user_id === undefined) own.set(uid, choice);
    else delegated.set(uid, { choice, followed: String(r.followed_user_id) });
  }

  const counts: DerivationCounts = { added: 0, changed: 0, removed: 0, eligible: true, carries: true };

  for (const r of rollRows) {
    const member = String(r.user_id);
    if (own.has(member)) continue;
    const { finalId } = resolveFinal(map, member);
    const decidedChoice = finalId === member ? undefined : own.get(finalId);
    const standing = delegated.get(member);

    if (decidedChoice === undefined) {
      if (!standing) continue;
      // The one DELETE, through the one statement that performs it. See
      // `deleteDelegatedRow`: the own-vote guard lives there, once.
      await deleteDelegatedRow(pool, ballotId, member);
      counts.removed += 1;
      continue;
    }

    if (!standing) {
      // `ON DUPLICATE KEY UPDATE choice = choice` is a deliberate no-op: a
      // member who cast their own vote between the read above and this write
      // keeps it, and `affectedRows` is 1 only when a row was really inserted,
      // so the count below reports what happened rather than what was tried.
      const [inserted] = await pool.query<any>( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
        "INSERT INTO ballot_votes (ballot_id, user_id, choice, reason, followed_user_id) VALUES (?,?,?,NULL,?) " +
          "ON DUPLICATE KEY UPDATE choice = choice",
        [ballotId, member, decidedChoice, finalId],
      );
      if (Number(inserted.affectedRows) > 0) counts.added += 1;
      continue;
    }

    if (standing.choice === decidedChoice && standing.followed === finalId) continue;
    // Guarded on `followed_user_id IS NOT NULL`, so a member who cast their own
    // vote between the read above and this write keeps it.
    await pool.query( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
      "UPDATE ballot_votes SET choice = ?, followed_user_id = ?, reason = NULL " +
        "WHERE ballot_id = ? AND user_id = ? AND followed_user_id IS NOT NULL",
      [decidedChoice, finalId, ballotId, member],
    );
    counts.changed += 1;
  }
  return counts;
}

/**
 * Derive every ballot that is still taking votes.
 *
 * What a delegation change calls, because a delegation is village-wide and a
 * member may be on several open rolls at once. Returns one entry per ballot it
 * touched, so a route can say what the change actually moved rather than
 * claiming it moved something.
 */
export async function applyDelegatedVotesEverywhere(
  pool: Pool,
): Promise<{ ballotId: string; counts: DerivationCounts }[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
    "SELECT id FROM ballots WHERE status = 'open'",
  );
  const out: { ballotId: string; counts: DerivationCounts }[] = [];
  for (const r of rows) {
    const ballotId = String(r.id);
    out.push({ ballotId, counts: await applyDelegatedVotes(pool, ballotId) });
  }
  return out;
}

export interface FollowedVote {
  ballotId: string;
  ballotTitle: string;
  ballotStatus: string;
  choice: VoteChoice;
  /** Null on a vote this member cast themselves. */
  followedUserId: string | null;
  castAt: string;
}

/**
 * EVERY VOTE THIS MEMBER HOLDS, AND WHO DECIDED IT.
 *
 * The secrecy question needs no new mechanism here, which is the second
 * reason the copy-the-choice shape is the right one. A member already sees
 * their own vote on a proposal, and a delegated vote IS their own vote sitting
 * in their own row. So a delegator learns what their delegate did by reading
 * what they themselves voted, and no disclosure rule has to be invented.
 */
export async function votesFollowedBy(pool: Pool, userId: string, limit = 50): Promise<FollowedVote[]> {
  const cap = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
    "SELECT v.ballot_id, v.choice, v.followed_user_id, v.cast_at, b.title, b.status FROM ballot_votes v " +
      "JOIN ballots b ON b.id = v.ballot_id WHERE v.user_id = ? ORDER BY v.cast_at DESC, v.ballot_id DESC LIMIT ?",
    [String(userId ?? ""), cap],
  );
  return rows.map((r) => ({
    ballotId: String(r.ballot_id),
    ballotTitle: String(r.title),
    ballotStatus: String(r.status),
    choice: String(r.choice) as VoteChoice,
    followedUserId:
      r.followed_user_id === null || r.followed_user_id === undefined ? null : String(r.followed_user_id),
    castAt: iso(r.cast_at),
  }));
}

// ── 0175: WHAT A DELEGATOR MAY READ WHILE THE VOTE IS STILL RUNNING ─────────

/**
 * The village setting that says whether choices are shown while a ballot runs.
 *
 * NOT REGISTERED HERE. The voter-identity setting belongs to the lane that
 * builds the ballot surfaces, and one key defined in two places is one key
 * that disagrees with itself. This module names the key it reads and defaults
 * to HIDDEN, which is both the founder's ruling (Q12: participation visible,
 * choices hidden) and the fail-safe direction, so the rule below is real
 * before the control that switches it exists.
 */
export const VOTER_IDENTITY_KEY = "governance.voter_identity";

/**
 * Are choices hidden right now, and did a village setting say so.
 *
 * The two facts come back together because a caller printing "hidden" has to
 * be able to say whether the village chose it or whether nothing has been
 * chosen yet. Reading an unregistered key throws by design in
 * server/lib/variables.ts (a typo must not read as 0), so this asks the
 * registry first rather than catching an exception, and an unregistered key
 * answers "default" instead of pretending a village decided anything.
 */
export function voterIdentityNow(): { choicesHidden: boolean; source: "setting" | "default" } {
  if (!VARIABLES_BY_KEY[VOTER_IDENTITY_KEY]) return { choicesHidden: true, source: "default" };
  return { choicesHidden: String(variable(VOTER_IDENTITY_KEY)) !== "public", source: "setting" };
}

export interface OwnVoteFacts {
  /** Null while the choice is held back. Never null once the ballot has closed. */
  choice: VoteChoice | null;
  /** The words this member wrote. Null on a delegated row, which never carries a reason. */
  reason: string | null;
  /** Who decided this row, or null when the member decided it themselves. */
  followedUserId: string | null;
  followedName: string | null;
  /** True when a choice exists and this member may not read it yet. */
  choiceHidden: boolean;
  state: "cast_by_me" | "cast_following";
  /** What the row says on the page, in words rather than a code. */
  sentence: string;
}

/**
 * WHAT A MEMBER'S OWN ROW SAYS, AND WHEN IT SAYS THE CHOICE.
 *
 * Pure, so the rule can be proven with no database and so the serving path
 * and any later surface cannot drift into two versions of it.
 *
 * Section 4 argued that secrecy needed no mechanism here: a delegated vote is
 * your own vote in your own row, so reading your row is how you learn what
 * your delegate did. That was written while every ballot was public, and on a
 * hidden ballot it is a disclosure channel pointed at whoever you name. So
 * while a ballot is OPEN and choices are HIDDEN, a delegated row says that it
 * was cast and who decided it, and not what it said. The choice arrives at
 * the close, with everybody else's.
 *
 * A VOTE THE MEMBER CAST THEMSELVES IS NEVER HELD BACK. They already know it,
 * hiding it would tell them nothing they do not know, and it would take away
 * the one control that lets them check what they answered before the window
 * shuts.
 */
export function hiddenChoiceView(input: {
  ballotStatus: string;
  choicesHidden: boolean;
  choice: VoteChoice;
  reason?: string | null;
  followedUserId?: string | null;
  followedName?: string | null;
}): OwnVoteFacts {
  const followedUserId = input.followedUserId ?? null;
  const followedName = input.followedName ?? null;
  const who = followedName ?? "the member deciding for you";
  if (followedUserId === null) {
    return {
      choice: input.choice,
      reason: input.reason ?? null,
      followedUserId: null,
      followedName: null,
      choiceHidden: false,
      state: "cast_by_me",
      sentence: `You voted ${input.choice}`,
    };
  }
  const hide = input.ballotStatus === "open" && input.choicesHidden;
  return {
    choice: hide ? null : input.choice,
    reason: input.reason ?? null,
    followedUserId,
    followedName,
    choiceHidden: hide,
    state: "cast_following",
    sentence: hide
      ? `Cast, following ${who}. What it says is shown when this vote closes, with everyone else's`
      : `Cast, following ${who}: ${input.choice}`,
  };
}

// ── 0175: THE WITHHELD BLOC, AND CONCENTRATION AGAINST THE PEOPLE ASKED ─────

export interface BallotDelegationRow {
  userId: string;
  /**
   * Seats on THIS ballot's frozen roll that this member decides, counting
   * their own seat when they decide it themselves. The number that matters on
   * a live vote, because the roll is who was asked.
   */
  effectiveVotesOnRoll: number;
  /** `effectiveVotesOnRoll` over the frozen roll size, 0 to 1. */
  shareOfElectorate: number;
  /**
   * The same count over every account in the village, which is the figure the
   * concentration page has always shown. Kept beside the roll figure rather
   * than replaced by it, because the two answer different questions and a
   * page that showed one under the other's label would mislead quietly.
   */
  effectiveVotesAllAccounts: number;
  shareOfAllAccounts: number;
  /**
   * Seats on the roll following this member that have no vote here. A
   * delegate who does not vote withholds every one of them, which is stronger
   * than voting no, and this is the number that makes it visible while the
   * window is open instead of after it shuts.
   */
  unvotedDelegations: number;
  /** Whether this member has a vote of their own on this ballot. */
  votedHere: boolean;
  /** Whether this member is on the frozen roll at all. */
  onRoll: boolean;
}

export interface BallotDelegationView {
  ballotId: string;
  /** False on a ballot that is not taking votes. */
  eligible: boolean;
  /** False on a subject that refuses delegated rows entirely. */
  carries: boolean;
  whyNot: string | null;
  /** The frozen roll size: how many people were asked. */
  electorateCount: number;
  /** Every account in the village, the denominator of the older figure. */
  accountCount: number;
  /** Roll seats following somebody who has not voted here. The whole withheld bloc. */
  withheldSeats: number;
  /**
   * One row per roll member, most concentrated first, PLUS any member off the
   * roll who decides a seat on it. Dropping the second kind would lose their
   * votes out of the total and make the shares add to less than one, which is
   * the same reason `concentrationOver` keeps them.
   */
  rows: BallotDelegationRow[];
}

/**
 * The two denominators, named here once, so no surface has to invent a label
 * for them and no surface can put one number under the other's words.
 */
export const CONCENTRATION_LABELS = {
  electorate: "of the people asked on this vote",
  allAccounts: "of every account in the village",
} as const;

/**
 * WHAT DELEGATION IS DOING TO THIS ONE BALLOT, WHILE IT IS STILL OPEN.
 *
 * Two figures per member and both of them labelled, because they answer
 * different questions and the difference is the point. Share of the
 * ELECTORATE is how much of this decision one member holds: the roll is the
 * people who were asked, and a member deciding four of nine seats decides
 * this vote's outcome far more than "four of ninety accounts" suggests. Share
 * of every account is the village-wide picture the concentration page already
 * served, and dropping it would make a number quietly change meaning.
 *
 * `allAccounts` comes from the caller for the same reason
 * `concentrationOver`'s roster does: "every member" means one thing to a
 * route serving the village and another to a ballot serving its frozen roll,
 * and a function that guessed would be right for one of them.
 */
export async function ballotDelegationView(
  pool: Pool,
  ballotId: string,
  allAccounts: readonly string[],
): Promise<BallotDelegationView> {
  const [ballotRows] = await pool.query<RowDataPacket[]>( // module-review-ok: a read of the ballot's own clock and frozen dials, beside the view they gate (the ballots.ts pattern)
    "SELECT status, closes_at, subject_type, method, unity_pct, electorate_count FROM ballots WHERE id = ?",
    [ballotId],
  );
  const ballot = ballotRows[0];
  // Deduplicated the long way: tsconfig.json leaves `target` at its ES5
  // default, so spreading a Set is TS2802 here (the same reason
  // `concentrationOver` reaches for `forEach` over a Map).
  const seenAccount = new Set<string>();
  const accounts: string[] = [];
  for (const a of allAccounts) {
    const id = String(a);
    if (seenAccount.has(id)) continue;
    seenAccount.add(id);
    accounts.push(id);
  }
  if (!ballot) {
    return {
      ballotId,
      eligible: false,
      carries: false,
      whyNot: null,
      electorateCount: 0,
      accountCount: accounts.length,
      withheldSeats: 0,
      rows: [],
    };
  }
  const verdict = delegationCarriesOn({
    subjectType: String(ballot.subject_type),
    method: String(ballot.method),
    unityPct: Number(ballot.unity_pct),
  });
  const open = String(ballot.status) === "open" && Date.parse(iso(ballot.closes_at)) > Date.now();

  const [rollRows] = await pool.query<RowDataPacket[]>( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
    "SELECT user_id FROM ballot_electorate WHERE ballot_id = ? ORDER BY user_id",
    [ballotId],
  );
  const roll = rollRows.map((r) => String(r.user_id));
  const [voteRows] = await pool.query<RowDataPacket[]>( // module-review-ok: the ballot tables' one enumerable home (the ballots.ts pattern; no cache sits above them)
    "SELECT user_id, followed_user_id FROM ballot_votes WHERE ballot_id = ?",
    [ballotId],
  );
  const votedThemselves = new Set<string>();
  const hasAnyRow = new Set<string>();
  for (const r of voteRows) {
    const uid = String(r.user_id);
    hasAnyRow.add(uid);
    if (r.followed_user_id === null || r.followed_user_id === undefined) votedThemselves.add(uid);
  }

  // A subject that refuses delegated rows has no chains to report on: the
  // empty map makes every member decide their own seat, which is exactly what
  // is true on that ballot.
  const map = verdict.carries ? await loadDelegationMap(pool) : new Map<string, string>();
  const onRoll = concentrationOver(map, roll);
  const wideRows = new Map(concentrationOver(map, accounts).map((r) => [r.userId, r]));

  const unvoted = new Map<string, number>();
  let withheldSeats = 0;
  for (const member of roll) {
    const walk = resolveFinal(map, member);
    if (walk.finalId === member) continue;
    if (hasAnyRow.has(member)) continue;
    unvoted.set(walk.finalId, (unvoted.get(walk.finalId) ?? 0) + 1);
    withheldSeats += 1;
  }

  const rows: BallotDelegationRow[] = onRoll.map((r) => {
    const wide = wideRows.get(r.userId);
    return {
      userId: r.userId,
      effectiveVotesOnRoll: r.effectiveVotes,
      shareOfElectorate: r.shareOfElectorate,
      effectiveVotesAllAccounts: wide ? wide.effectiveVotes : 0,
      shareOfAllAccounts: wide ? wide.shareOfElectorate : 0,
      unvotedDelegations: unvoted.get(r.userId) ?? 0,
      votedHere: votedThemselves.has(r.userId),
      onRoll: r.onRoster,
    };
  });
  rows.sort(
    (a, b) =>
      b.effectiveVotesOnRoll - a.effectiveVotesOnRoll ||
      b.unvotedDelegations - a.unvotedDelegations ||
      a.userId.localeCompare(b.userId),
  );

  return {
    ballotId,
    eligible: open,
    carries: verdict.carries,
    whyNot: verdict.why,
    electorateCount: Number(ballot.electorate_count) || roll.length,
    accountCount: accounts.length,
    withheldSeats,
    rows,
  };
}

/**
 * How many seats following this member have no vote on this ballot. The one
 * number a delegate's own page needs, read through the view above so there is
 * one arithmetic rather than two.
 *
 * `allAccounts` is only the village-wide denominator, which this number does
 * not use, so it defaults to empty. A caller that wants the shares as well
 * should call `ballotDelegationView` and read them off the row.
 */
export async function unvotedDelegationsOn(
  pool: Pool,
  ballotId: string,
  delegateId: string,
  allAccounts: readonly string[] = [],
): Promise<number> {
  const view = await ballotDelegationView(pool, ballotId, allAccounts);
  const mine = view.rows.find((r) => r.userId === String(delegateId));
  return mine ? mine.unvotedDelegations : 0;
}

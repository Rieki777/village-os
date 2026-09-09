/**
 * Capabilities: what a member is allowed to do, as data.
 *
 * Revision 2, step 3. Amora's twelve stages were computed and displayed but
 * gated nothing, so progression was decoration. A capability is a permission
 * key. A member holds a capability if EITHER:
 *
 *   - their computed stage is at or past the stage that unlocks it, OR
 *   - they hold a role whose `capabilities` list includes it.
 *
 * Two paths on purpose. Stage is the earned ladder everyone climbs; roles are
 * appointments a founder makes directly (a treasurer is a treasurer regardless
 * of how many quests they have done). Either grants the capability.
 *
 * The stage thresholds below are the platform defaults. They are intentionally
 * conservative: three real gates, not twelve, because the point is to make
 * progression MEAN something, not to lock the whole app behind tiers.
 */

/** The capability keys the platform knows about. */
export type Capability =
  // `quest.propose` was here and is retired (0090). It named an act nobody
  // ever needed permission for: suggesting a quest goes through
  // `/api/forms/submit`, the house pattern for anonymous public intake, which
  // takes a stranger's suggestion by design and turns it into an inbox row
  // rather than a quest. Only an admin creates a quest. So the key gated
  // nothing anywhere in the product, while the ladder announced it as newly
  // unlocked at contributor and the admin explainer reported it as held.
  // Gating the intake route was the alternative and it is incoherent: it
  // would either shut strangers out of the suggestion box or hold members to
  // a higher bar than strangers.
  | "quest.consent" // release value on someone's quest (also admin/role gated)
  | "forum.post" // start a thread
  | "forum.moderate" // hide, resolve reports, act on the community's behalf
  | "proposal.open" // open a governance decision
  | "proposal.decide" // record a decision's outcome
  | "map.viewPeople" // see WHO holds seats on the village map (not just counts)
  | "map.contact" // reach a role holder through the contact relay
  | "map.edit" // enter build mode and keep a draft of the land
  | "map.publish" // push a draft onto the live map everyone sees
  | "map.photograph" // add a photograph of a place to the village record
  | "map.curatePhotos" // take a photograph down, pin a place's lead shot, work the queue
  | "feed.announce" // post announcements to the village feed (role-only)
  | "stay.member_rate" // book accommodation at the member price, not the guest one
  | "exchange.buy" // buy listed tokens for fiat
  | "exchange.swap" // trade one village token for another at posted prices
  | "exchange.manage" // list tokens, post prices, stock the treasury (role-only)
  | "health.record" // log the land's own measurements (trees, water, hectares)
  | "message.send" // start a conversation and post to one (reading is membership)
  | "mechanics.propose" // propose a change to the game's own rules (Game Mechanics)
  | "event.rsvp" // say you are coming to a gathering
  | "event.manage" // put a gathering on the village calendar, edit or cancel it
  | "org.declare" // declare how the village and its circles hold power (0083)
  | "ballot.vote" // cast a vote on an on-site ballot (round 5 governance engine)
  | "member.vouch" // vouch for an applicant at the membrane (round 5)
  | "member.superVouch" // admit a member outright when the village cannot reach its bar
  // ── The five handover keys (0098) ────────────────────────────────────────
  //
  // 159 admin write routes had no capability behind them and no key that
  // could name them, so a village had nothing to ask for. Adding 159 keys
  // would name every button and no power. These five name POWERS a village
  // would actually want, and each one covers a cluster of routes that
  // already exist. A key is worth adding when a member can finish the
  // sentence "the village's ____ look after that"; it is not worth adding
  // for a route whose only holder could ever be the deployment operator.
  | "org.seat" // seat and unseat the people who hold the village's seats
  | "org.seatAgent" // seat and unseat the software agents that hold seats
  | "intake.moderate" // work the queues strangers and members put things into
  | "library.keep" // keep the shared library: what comes in, what goes out
  | "story.tell" // say what the village is, in its own words, in public
  | "dial.set" // turn the village's own dials, within the open ring
  // ── The proposal key (0141) ──────────────────────────────────────────────
  //
  // `quest.propose` was retired for gating nothing, and this is not it coming
  // back. That key named the act of SUGGESTING a quest, which goes through the
  // anonymous public intake form and needs no permission from anybody. This
  // one names the act of turning a proposed quest into a live one on the
  // board, with a reward typed on it, which is the moment the faucet acquires
  // an obligation. Those are opposite ends of the same pipe.
  //
  // It passes the test the five handover keys set: a member can finish the
  // sentence "the village's ____ look after that", and it covers a real
  // refusal rather than a button.
  | "quest.approve" // put a proposed quest on the board, with what it pays
  /*
   * The steward's veto, and the reason it has to carry.
   *
   * A separate key from `proposal.decide` on purpose, because they are two
   * different acts on the same ballot and a village should be able to split
   * them. `proposal.decide` CLOSES a vote: it reads the tally and writes down
   * what the village decided, which is a facilitation job. This one stops a
   * decision the village already carried, inside the window before it lands.
   * A facilitator who can also veto is one person holding both ends of the
   * decision.
   *
   * NOTHING APPROVES ANY MORE. A passed decision lands on its own, whether or
   * not anybody holds this seat. The key opens one door: stopping a landing
   * inside its window, in the open, with a name and a reason on it.
   */
  | "steward.veto"; // stop a carried decision inside its window, and say why

/**
 * The canonical list, as a VALUE: badge validation and unlock diffs iterate
 * it. Adding a capability to the union above without adding it here makes
 * it ungrantable by badges — keep them in lockstep.
 */
export const ALL_CAPABILITIES: Capability[] = [
  "quest.consent",
  "forum.post",
  "forum.moderate",
  "proposal.open",
  "proposal.decide",
  "map.viewPeople",
  "map.contact",
  "map.edit",
  "map.publish",
  "map.photograph",
  "map.curatePhotos",
  "feed.announce",
  "stay.member_rate",
  "exchange.buy",
  "exchange.swap",
  "exchange.manage",
  "health.record",
  "message.send",
  "mechanics.propose",
  "event.rsvp",
  "event.manage",
  "org.declare",
  "ballot.vote",
  "member.vouch",
  "member.superVouch",
  "org.seat",
  "org.seatAgent",
  "intake.moderate",
  "library.keep",
  "story.tell",
  "dial.set",
  "quest.approve",
  "steward.veto",
];

/**
 * WHAT EACH KEY MEANS, in words a member reads.
 *
 * The union above already carries these phrases as trailing comments, and a
 * comment is invisible at runtime, so every surface that showed a member
 * their own capabilities showed them `forum.post,message.send` instead. A
 * stage advance is the moment that hurts most: the whole point of crossing a
 * rung is learning what opened, and a raw dotted key does not say.
 *
 * Phrased as the completion of "You can now", so the list reads as an
 * invitation on the surfaces that use it that way and still reads correctly
 * as a plain label on the ones that do not.
 *
 * KEEP IN LOCKSTEP with the union and with ALL_CAPABILITIES.
 * `capabilities.test.ts` asserts the three agree, so a new key without a
 * label fails there rather than shipping as machine text on a member's
 * profile.
 */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  "quest.consent": "Release value on someone else's quest",
  "forum.post": "Start a thread in the forum",
  "forum.moderate": "Act on the community's behalf in the forum",
  "proposal.open": "Open a governance decision",
  "proposal.decide": "Record a decision's outcome",
  "map.viewPeople": "See who holds seats on the village map",
  "map.contact": "Reach a role holder through the contact relay",
  "map.edit": "Draft changes to the land in build mode",
  "map.publish": "Publish a draft onto the live map",
  "map.photograph": "Add a photograph to a place on the map",
  "map.curatePhotos": "Take a photograph down and choose a place's lead shot",
  "feed.announce": "Post announcements to the village feed",
  "stay.member_rate": "Book a stay at the member price",
  "exchange.buy": "Buy listed tokens",
  "exchange.swap": "Swap one village token for another",
  "exchange.manage": "List tokens, post prices, and stock the treasury",
  "health.record": "Log the land's own measurements",
  "message.send": "Start a conversation and post to one",
  "mechanics.propose": "Propose a change to the game's rules",
  "event.rsvp": "Say you are coming to a gathering",
  "event.manage": "Put a gathering on the village calendar",
  "org.declare": "Declare how the village holds power",
  "ballot.vote": "Cast a vote on a ballot",
  "member.vouch": "Vouch for an applicant",
  "member.superVouch": "Admit a member outright",
  "org.seat": "Seat and unseat the holders of the village's seats",
  "org.seatAgent": "Seat and unseat the software agents that hold seats",
  "intake.moderate": "Work the village's queues and act on what gets reported",
  "library.keep": "Keep the shared library and its loans",
  "story.tell": "Say what the village is, in public, in its own words",
  "dial.set": "Turn the village's own dials",
  "quest.approve": "Put a proposed quest on the board and set what it pays",
  "steward.veto": "Stop a carried decision inside its window, and say why",
};

/**
 * One capability in words, falling back to the key itself.
 *
 * The fallback is the honest one: a key with no label is a bug in the table
 * above, and printing the key says so out loud instead of dropping the row
 * and telling a member less than they held.
 */
export function capabilityLabel(cap: string): string {
  return CAPABILITY_LABELS[cap as Capability] ?? cap;
}

/**
 * Stage that unlocks each capability by progression alone, referencing the
 * stage ids in gameConfig.ts (visitor, guest, immersant, participant, member,
 * contributor, quest-seeker, initiate, co-creator, role-holder, guide, sage).
 * A capability absent here is never granted by stage, only by a role.
 */
export const STAGE_UNLOCKS: Partial<Record<Capability, string>> = {
  "forum.post": "member", // you can talk once you have joined
  "proposal.open": "co-creator", // open a decision once you are co-creating
  "map.viewPeople": "guest", // any account sees who holds the village's seats
  "map.contact": "member", // reaching people through the relay starts at member
  "stay.member_rate": "member", // the member price comes with membership
  // Messaging opens where forum posting opens: once you have joined, you can
  // talk to the people you joined. A warning badge's deny suspends it, which
  // is the whole reason the deny path outranks role and stage.
  "message.send": "member",
  "exchange.buy": "member", // buying opens at member; exchange.manage is role-only
  // Parity with buying on purpose: the safety work is done by the
  // deployment-level trading switch and fail-closed caps, and a higher stage
  // floor would only show more members a door they cannot open.
  "exchange.swap": "member",
  // The base posture (Rye, 2026-07-31): ANY MEMBER may propose a change to
  // the game's rules. Founders narrow it by moving this rung (the generated
  // progression.unlock variable), setting it to "none" and granting through
  // roles or badges, or requiring earned recognition on top
  // (governance.hypha_threshold). A warning badge's deny suspends it — the
  // remedy for misuse that is short of anything harsher.
  "mechanics.propose": "member",
  // Anyone with an account can say they are coming. A gathering people have
  // to earn their way into is a different product, and a village that wants
  // one moves this rung. `event.manage` is deliberately absent: putting
  // something on the village calendar is an appointment, granted by a role or
  // a badge, never reached by climbing.
  "event.rsvp": "guest",
  // Voting opens where talking opens: membership is the electorate. The
  // ballot electorate builder reads this THROUGH the one gate, so a role or
  // a badge can still grant it below the rung.
  //
  // A warning badge USED TO suspend it here, and that is what R65/R66 ended
  // (0109). The rung is now the only thing between a member and the roll:
  // once she is at it, nothing any other party holds takes her back off it.
  // A village that wants a different electorate moves this rung, which is a
  // rule it sets for everybody and not an act it performs on one person.
  "ballot.vote": "member",
  // Vouching is vouching FROM standing: a member who has contributed speaks
  // for an applicant with something behind the word.
  "member.vouch": "contributor",
  // Contributing a photograph opens where talking opens. Rye asked for this
  // to work "like a google maps listing where the community can upload
  // photos", and in this village the community is its members. A photograph
  // is also the one contribution that proves somebody was physically on the
  // land, so the rung that means "you have joined" is the honest one for it.
  //
  // Being a stage unlock rather than an appointment buys the property that
  // matters for a public gallery: a warning badge's deny suspends posting
  // pictures, because the deny beats stage (Gate E). A village that wants a
  // narrower door moves the rung, sets it to "none" and grants by role or
  // badge, or leaves it here.
  "map.photograph": "member",
  // `map.curatePhotos` is deliberately absent, and it is the R54 key on this
  // surface. Taking somebody's photograph off the village's map is a power
  // that WOULD have been an admin check, and an admin check is scaffolding a
  // village cannot inherit. As a capability it reaches three ways: a role a
  // founder appoints, a badge, or admin. Nobody climbs to it, because
  // deciding what stays in the village's record is an appointment and not a
  // reward for doing enough quests.
  // `map.edit` and `map.publish` are deliberately absent for the same reason,
  // and the second one matters more than the first. The map is the village's
  // front door: a stage rung would hand the land's shape to everyone who
  // climbed far enough, on a surface where one careless drag is visible to
  // every visitor at once. Both are appointments. A founder grants them with
  // the Cartographer badge (0063) or a role.
  //
  // They are TWO keys on purpose. One key would mean anyone trusted to
  // propose a change to the land is also trusted to overwrite it live. Split,
  // they buy the useful middle: a member drafts, a cartographer publishes.
  //
  // `org.declare` is deliberately absent too (0083, P10). Declaring how the
  // village holds power is an appointment a founder makes, granted by a role
  // or a badge, never reached by climbing. The third path to declaring, a
  // live holder of a seat flagged represents_circle, is scoped to that one
  // circle and lives in orgChart.mayDeclare, not here: the one narrow bridge
  // from the seat plane, recorded in
  // docs/ADR_2026-08_REPRESENTS_CIRCLE_DECLARES.md.
  //
  // The five handover keys (0098) are all deliberately absent, and for one
  // reason: every one of them is a job the village fills, so the honest way
  // in is a role or a badge somebody was given. A rung would hand seating,
  // moderation, the library, the village's public voice and its own dials to
  // everyone who did enough quests, which is how you get a power with no
  // holder and nobody to ask about it.
};

/**
 * WHICH KEYS MAY EVER LEAVE THE ADMIN PANEL (0098).
 *
 * R54, the founder's ruling: "these villages are meant to be taken over by
 * the electorate to run the game and put the admins out of a full time job."
 * Admin is scaffolding. But until this map existed, a power could not leave,
 * because `if (ctx.isAdmin) return true;` was the first line of the gate and
 * it answered for every key. Every "the village holds this now" claim was
 * decoration over a short-circuit.
 *
 * A `true` here means: once this village records a holder for this key, an
 * admin stops passing the gate on it by being an admin, and has to reach past
 * the village in the open to act on it.
 *
 * A `false` means one of two things, and they are worth telling apart:
 *
 *  - It is a PERSONAL ACT, not a power. `forum.post`, `event.rsvp`,
 *    `exchange.buy`, `message.send`, `map.photograph`: nobody "holds" the
 *    right to talk on behalf of the village, and a table row saying the
 *    village holds posting would be a category error with a lockout attached.
 *  - It is PLUMBING the deployment operator has to keep reachable. Moving
 *    those would strand a fork whose operator did not choose any of this.
 *  - Nothing REFUSES on it. `ballot.vote` and `member.vouch` are both here:
 *    one is read to build a roll and to report a member their standing, the
 *    other is read nowhere at all. A `true` promises that an admin has to
 *    reach past the village in the open, and a key with no refusal behind it
 *    has no "past" to reach. Each carries its own reasoning below.
 *
 * A Record and not a Set on purpose: a new capability with no line here is a
 * TYPE ERROR, so the classification is a decision somebody makes rather than
 * a default somebody inherits. `capabilities.test.ts` pins that the keys of
 * this map are exactly ALL_CAPABILITIES.
 *
 * The default posture for anything unclassified is non-transferable, which is
 * exactly today's behaviour: an unclassified key can never make the new
 * branch reachable, so it cannot lock anybody out of anything.
 */
export const TRANSFERABLE: Record<Capability, boolean> = {
  // ── TRUE: a power, AND its gate carries the escape hatch ────────────────
  //
  // The second half of that sentence is a hard condition and it is what keeps
  // this map honest. A `true` here removes an admin's short-circuit on a live
  // deployment, so every route behind the key has to be able to say "you can
  // still act, here is how" and leave a record when somebody does. In this
  // codebase that means the route asks `mayAct`/`guardCapability`, which is
  // where `override` and `x-capability-override` are read and where the
  // public record gets written. A key whose routes still call
  // `hasCapability` inline would fall through with no way back through the
  // product, and a ceiling an operator cannot climb over is not a ceiling, it
  // is an outage.
  "intake.moderate": true,
  // Accepting a quest proposal is the moment a payout obligation is created,
  // which is exactly the sort of thing a village takes on for itself. Its one
  // route asks `guardCapability`, so the escape hatch and the public record
  // this column promises are both really there.
  "quest.approve": true,
  "library.keep": true,
  "story.tell": true,
  "org.seat": true,
  "org.seatAgent": true,
  "dial.set": true,
  /*
   * The steward's seat is the one power the founder designed to CHANGE HANDS,
   * so it would be strange for the map to refuse to move it. He ruled that
   * giving the power up is reversible and that the village fills the seat
   * again by voting somebody into it, which is exactly this key crossing to a
   * role the village declared.
   *
   * `true` HERE MEANS MORE THAN IT MEANS ANYWHERE ELSE IN THIS MAP. For every
   * other key it removes an admin's short-circuit and leaves the break-glass
   * door. For this one the admin roles routes refuse the key outright, in
   * both directions, admin path included: a village seats and unseats its
   * steward through the `role_seat` and `role_unseat` ballots and through
   * nothing else. See `stewardSeatRefusal` in server/lib/roleGrants.ts.
   */
  "steward.veto": true,
  "event.manage": true,
  "exchange.manage": true,
  "forum.moderate": true,
  // ── The seven that crossed in 0103 ──────────────────────────────────────
  //
  // Each of these was `false` for one mechanical reason: its routes asked
  // `hasCapability(cap, await capabilityCtx(user))` inline, which never sees
  // the request and therefore cannot carry the break-glass. Each line below
  // moved in the SAME commit as its conversion, never one without the other,
  // because a `true` here on an unconverted gate is a lockout with no way
  // back through the product.
  //
  // What "converted" means for each of them, stated so the next reader can
  // check it instead of trusting it: every route that REFUSES on the key now
  // asks `mayAct`/`guardCapability`, and every surface that merely REPORTS
  // the key still asks the pure gate with an admin short-circuit. The second
  // half matters as much as the first. `mayAct` reads the break-glass and
  // writes the public record, so pointing a visibility read at it would put
  // "acted on a power this village holds" on the pulse for somebody who only
  // looked.
  "quest.consent": true,
  "proposal.decide": true,
  "map.publish": true,
  "map.curatePhotos": true,
  "feed.announce": true,
  "health.record": true,
  "org.declare": true,

  // ── FALSE: a personal act. There is nobody for these to move TO ─────────
  //
  // Talking, coming to a gathering, buying, photographing a wall you built.
  // A row saying the village holds `message.send` is a category error with a
  // lockout attached.
  "forum.post": false,
  "proposal.open": false,
  "message.send": false,
  "mechanics.propose": false,
  "event.rsvp": false,
  "exchange.buy": false,
  "exchange.swap": false,
  "stay.member_rate": false,
  "map.photograph": false,
  "map.viewPeople": false,
  "map.contact": false,
  "map.edit": false,

  // ── FALSE: a power with no act to reach past ────────────────────────────
  //
  // `ballot.vote` was the eighth key of the 0103 sweep and it is the one that
  // did NOT cross. The reason is not the snapshot law and it is not nerve; it
  // is that there is no gate here to convert, and a `true` would therefore be
  // a claim with nothing under it.
  //
  // Both places this key is read were checked by hand:
  //
  //   1. `buildElectorate` runs the gate over EVERY member to freeze a roll.
  //      It has no request, so it cannot read a break-glass and cannot write
  //      a record. `mayAct` is not applicable to it in principle.
  //   2. `GET /api/governance/standing` reports `eligible` to the member
  //      asking. That is a LOOK. Routing it through `mayAct` is the exact
  //      defect the RSVP route shipped: an admin viewing their own standing
  //      with `override` in the request would write "acted on a power this
  //      village holds" to the public pulse for having looked.
  //
  // `POST /api/governance/ballots/:id/vote` asks this key for NOTHING. It
  // reads the frozen roll, which is what the snapshot law requires of it.
  //
  // So the mechanism a `true` promises does not exist for this key. Worse, an
  // admin dropped off a village-held roll has two ways back that write no
  // public record at all: grant themselves a role carrying the key
  // (`PUT /api/admin/roles/:id/capabilities`, admin-only), or move
  // `progression.unlock.ballot.vote`. Reaching past a village-held power has
  // to stay visible, and here it would not be. Converting the roll builder to
  // something request-shaped is the ballot engine's own work, not a gate
  // swap, and it belongs to the lane that owns the snapshot.
  "ballot.vote": false,
  // The membrane's vouching step EXISTS now (server/routes/vouches.ts), and
  // this stays false for the reason the roll builder gives above rather than
  // for the reason this comment used to give.
  "member.vouch": false,
  // Admitting somebody outright, which bypasses the bar the village set for
  // itself. Everything true of the vouch above is more true of this.
  "member.superVouch": false,
};

/**
 * WHICH KEYS A WARNING BADGE MAY EVER TAKE AWAY (0109).
 *
 * R65 and R66, the founder's ruling: "denying a voice is not a power anyone
 * should hold", and "when voice is earned it should never be force taken
 * away". One thing survives it and it is the whole of the design space here:
 *
 *   WANING IS NOT REMOVAL. A rule under which unused voice decays over time
 *   is legitimate, and it belongs to Hypha, which villages that want to run
 *   governance professionally are encouraged to use. An ACT by which one
 *   party strips another's earned voice is not legitimate, at any tier, held
 *   by anybody.
 *
 * Until this map existed, `denies` could name any key in ALL_CAPABILITIES,
 * and the deny sits at step 2 of the gate ahead of role and stage. So a
 * warning badge naming `ballot.vote` took its holder off `ballot_electorate`
 * on every roll built while it stood. `ballot.vote` is also deliberately
 * non-transferable, so the village could never take that power back. That
 * combination is the act the ruling names, and it is what this map ends.
 *
 * `false` means A VOICE: a member's own say in a decision the village makes.
 * Nothing may take one away. The gate ignores a deny naming one of these,
 * `badgeProblem` refuses to save one, and a migration clears the ones already
 * stored. Three locks on the same door, because a hand-written UPDATE is
 * invisible to code review by definition and a stored row outlives the admin
 * who wrote it.
 *
 * THE THIRD LOCK IS PER KEY, so moving a key into this group needs its own
 * migration. `drizzle/0109` cleared `ballot.vote` and `member.vouch`;
 * `drizzle/0114` cleared `mechanics.propose` when the founder ruled on it in
 * round 7. Skipping that step does not merely leave a stale row: the boot
 * runs `assertBadgeInvariants`, which calls `badgeProblem` over every active
 * badge, and a stored deny naming a voice key now REFUSES THE BOOT. A village
 * whose admin had once paused somebody's proposing would fail to start.
 *
 * `true` means the deny still stands, and every one of them is either an act
 * of EXPRESSION or a job. The expression keys are the open question and they
 * are deliberately NOT settled here: a village asking a harasser to stop
 * posting is a different act from a village disenfranchising a dissenter, and
 * the founder ruled on the second. They stay deniable until he rules on the
 * first.
 *
 * A Record and not a Set, for the reason TRANSFERABLE is one: a new
 * capability with no line here is a TYPE ERROR, so whether a new key can be
 * taken away is a decision somebody makes rather than a default somebody
 * inherits. `capabilities.test.ts` pins that the keys are exactly
 * ALL_CAPABILITIES.
 */
export const DENIABLE: Record<Capability, boolean> = {
  // ── FALSE: A VOICE. A say in a decision the village makes ───────────────
  //
  // Casting a vote. The ruling names this one outright.
  "ballot.vote": false,
  // Vouching for an applicant at the membrane. It is a member's say in the
  // village's decision about who joins, it is earned by climbing to
  // contributor, and it is spoken as themselves rather than as a seat. That
  // is a voice in a decision by every part of the definition. The door was
  // closed before the step was built, which was the cheapest possible moment;
  // the step is built now and the door stays shut.
  "member.vouch": false,
  // And the steward's override, which is the same say exercised alone. A seat
  // may hold it; software speaking as that seat may not.
  "member.superVouch": false,
  /*
   * Proposing a change to the Game's own rules. The founder ruled on this one
   * in round 7, and the reason is that it is the say itself, one step
   * earlier. A village's rules are the thing its members vote about, so the
   * power to put a change in front of them is a voice in every decision that
   * follows from it.
   *
   * A DENY HERE IS TOTAL, and that is what separates it from `proposal.open`
   * sitting a few lines below. Denying `proposal.open` leaves the drafts and
   * the whole forum standing, so a member keeps every other way of being
   * heard. `POST /api/game/mechanics/proposals` is the only way anybody
   * reaches the rule set at all, and `proposerStanding` returns
   * `mayDraft: false` on a deny, so the draft path closes with it. There is
   * nothing left over.
   *
   * THE REMEDY THAT NAMES NOBODY ALREADY EXISTS, which is what makes taking
   * this deny away safe as well as right.
   * `governance.proposals_per_member_per_cycle` caps how many proposals one
   * member may open in a cycle. It is read by that same route, it applies to
   * everybody equally, and a village worried about flooding can turn it down
   * without suspending a named person. Villages set their own dials (R56).
   */
  "mechanics.propose": false,
  /*
   * The steward's veto. NOT a voice, and it is here for two reasons, of which
   * the first is about WHICH WAY A PAUSE FAILS.
   *
   * THE DIRECTION INVERTED ON 2026-09-03 (19C), and the comment this replaced
   * had not noticed. Under the approval model this key was `steward.approve`
   * and pausing it was safe: a paused approval meant a proposal waited, and a
   * proposal that waits changes nothing. Under the veto model nothing waits.
   * A PAUSED VETO MEANS THE CHANGE LANDS. Suspending this key for 72 hours is
   * not a pause on the seat, it is the passage of every Game change the seat
   * was seated to look at, and the record shows no seat moving while it
   * happens. There is no fail-safe direction left to argue from, so the deny
   * is refused outright.
   *
   * The second reason is the roles plane. A warning badge is written by an
   * admin, and this key is the one power an admin route may not touch in
   * either direction: a village seats and unseats its steward through the
   * `role_seat` and `role_unseat` ballots (`stewardSeatRefusal` in
   * server/lib/roleGrants.ts). Leaving it deniable would put the removal
   * those ballots own back inside the badge panel, which is the same door
   * under a different name.
   *
   * `capabilityDecision` reads `isDeniable` before it reads the role, so this
   * `false` is what stops a badge deny outranking a seated steward's role
   * grant, and `badgeProblem` refuses to store such a badge at all.
   */
  "steward.veto": false,

  // ── TRUE: EXPRESSION. Speaking, but not deciding ────────────────────────
  //
  // Still with the founder, and unsettled here. Each of these is a member
  // speaking as themselves, so each sits close to a voice, and a village that
  // cannot ask somebody to stop for a while has no remedy short of removing
  // them. `mechanics.propose` used to sit in this group and moved up to the
  // voices when he ruled on it; these are the ones he has not reached.
  "forum.post": true,
  "message.send": true,
  "map.contact": true,
  "map.photograph": true,
  "proposal.open": true,

  // ── TRUE: NEITHER. A job, a power over others, a look, or a trade ───────
  //
  // Nobody earns these as a voice. They are appointments the village fills,
  // powers held over other people's contributions, plain readings, or
  // transactions. Suspending one is the village pausing a job, and a village
  // with no way to pause a job it handed out has only the harsher remedies
  // left.
  "quest.consent": true,
  "forum.moderate": true,
  "proposal.decide": true,
  "map.viewPeople": true,
  "map.edit": true,
  "map.publish": true,
  "map.curatePhotos": true,
  "feed.announce": true,
  "stay.member_rate": true,
  "exchange.buy": true,
  "exchange.swap": true,
  "exchange.manage": true,
  "health.record": true,
  "event.rsvp": true,
  "event.manage": true,
  "org.declare": true,
  "org.seat": true,
  "org.seatAgent": true,
  "intake.moderate": true,
  // A job, and not a voice. Pausing it stops somebody putting paid work on
  // the board while a village works something out; it takes away nothing they
  // earned as a say in a decision the village makes, which is the line R65 and
  // R66 draw.
  "quest.approve": true,
  "library.keep": true,
  "story.tell": true,
  "dial.set": true,
};

/**
 * May a warning badge take this capability away?
 *
 * Takes a plain string because both callers hold one: the gate reads keys off
 * a badge row, and `badgeProblem` validates whatever an admin typed. A key
 * the platform does not know answers `false`, which is the safe direction:
 * an unrecognised key can never take anything away from anybody.
 */
export function isDeniable(cap: string): boolean {
  return DENIABLE[cap as Capability] === true;
}

/**
 * Is this capability one the village is holding right now?
 *
 * Checks the TRANSFERABLE map as well as the holdings, so a row written by
 * hand into `capability_holding` naming a key that may never move cannot
 * close a door on anyone. `assertCapabilityHoldingInvariants` refuses the
 * boot on such a row, and this is the second lock on the same gate: a
 * hand-written UPDATE is invisible to code review by definition.
 */
export function isVillageHeld(cap: Capability, held: readonly string[] | undefined): boolean {
  if (!held || held.length === 0) return false;
  return TRANSFERABLE[cap] === true && held.includes(cap);
}

/** Which step of the gate decided, in the gate's own vocabulary. */
export type CapabilitySource =
  | "admin"
  | "admin-override"
  | "denied by warning badge"
  | "role"
  | "badge"
  | "stage"
  | "not granted";

export interface CapabilityCtx {
  stageIndex: number;
  stageIndexOf: (stageId: string) => number;
  roleCapabilities: readonly string[];
  /** Capabilities granted by the member's active badges. Default []. */
  badgeCapabilities?: readonly string[];
  /** Capabilities DENIED by active warning badges. Default []. */
  badgeDenies?: readonly string[];
  isAdmin?: boolean;
  /**
   * Per-village overrides of STAGE_UNLOCKS, sourced from the variables
   * registry (progression.unlock.*) — the Game Mechanics initiative made
   * the unlock table itself a mechanic. Absent key = platform default;
   * the value "none" disables the stage path for that capability (roles
   * and badges still grant it). The GATE's order of authority is
   * unchanged: this only parameterizes step 5.
   */
  stageUnlockOverrides?: Partial<Record<Capability, string>>;
  /**
   * The capabilities this village holds, read live from `capability_holding`
   * (0098). Default [] means "the village holds nothing", which is byte-for-
   * byte the gate's pre-0098 behaviour, and is what every existing
   * deployment reports until somebody acts.
   */
  villageHeld?: readonly string[];
  /**
   * THE BREAK-GLASS, for exactly one act.
   *
   * Set by a caller that has been told, in the request, that the admin means
   * to reach past a power the village holds. It never persists, it is never
   * inferred, and the caller that sets it owes the village a record and a
   * notification. `capabilityDecision` reports `reachedPastVillage` so the
   * caller cannot forget.
   */
  adminOverride?: boolean;
}

export interface CapabilityDecision {
  allowed: boolean;
  /** The step that decided, for the explainer and for the audit line. */
  source: CapabilitySource;
  /** True when the village holds this key, whatever the answer turned out to be. */
  villageHolds: boolean;
  /** True when an admin passed only because they broke the glass. Owes a record. */
  reachedPastVillage: boolean;
}

/**
 * THE ONE GATE (revised S36, revised again 0098). Given a member's computed
 * stage index, the capabilities their roles grant, the capabilities/denies
 * their badges carry, and what the village itself holds, decide whether they
 * hold a capability and say WHICH step decided. Pure, so it is unit-testable
 * and runs identically on client and server.
 *
 * Order of authority — this ordering IS the policy (Gate E, amended):
 *   1. isAdmin, on a key the village does NOT hold -> true. Unchanged: the
 *      operator can always act on the scaffolding they are responsible for.
 *   1b. isAdmin, on a key the village DOES hold:
 *        - with an explicit break-glass -> true, and the caller owes the
 *          village a record it can read.
 *        - without one -> the admin short-circuit does not apply, and the
 *          same admin is judged on steps 2-5 like anybody else. An admin
 *          who holds the role still passes, and passes AS the holder.
 *   2. badgeDenies, ON A DENIABLE KEY -> false. A warning badge's deny beats
 *      ROLE and stage grants too, not just badge grants: a warning that a
 *      role trivially overrides is not a warning. It reaches only the keys
 *      DENIABLE marks, and it can never reach a voice (0109, R65/R66).
 *   3. roleCapabilities  -> true.  Appointments.
 *   4. badgeCapabilities -> true.  Earned/granted badges.
 *   5. stage unlock      -> true.  The ladder everyone climbs.
 *   6. otherwise false.
 *
 * WHAT 1b CHANGES, stated plainly because it is the highest-blast-radius edit
 * in the round: on a village-held key a warning badge's deny now reaches an
 * ADMIN too, because the admin is being judged on steps 2-5. That is the
 * point. It is also why the break-glass ships in the same commit and not one
 * commit later: a gate that can lock an operator out of a live village must
 * never exist without its escape hatch.
 */
export function capabilityDecision(cap: Capability, ctx: CapabilityCtx): CapabilityDecision {
  const villageHolds = isVillageHeld(cap, ctx.villageHeld);
  if (ctx.isAdmin && !villageHolds) {
    return { allowed: true, source: "admin", villageHolds: false, reachedPastVillage: false };
  }
  if (ctx.isAdmin && villageHolds && ctx.adminOverride === true) {
    return { allowed: true, source: "admin-override", villageHolds: true, reachedPastVillage: true };
  }
  const decided = (allowed: boolean, source: CapabilitySource): CapabilityDecision =>
    ({ allowed, source, villageHolds, reachedPastVillage: false });

  // 0109, R65/R66: a deny only lands on a key that MAY be taken away. A
  // warning badge naming a voice key is ignored here rather than trusted,
  // which is the lock that holds when the row was written by hand.
  if (isDeniable(cap) && (ctx.badgeDenies ?? []).includes(cap)) {
    return decided(false, "denied by warning badge");
  }
  if (ctx.roleCapabilities.includes(cap)) return decided(true, "role");
  if ((ctx.badgeCapabilities ?? []).includes(cap)) return decided(true, "badge");
  const unlockStage = ctx.stageUnlockOverrides?.[cap] ?? STAGE_UNLOCKS[cap];
  if (unlockStage && unlockStage !== "none") {
    const needed = ctx.stageIndexOf(unlockStage);
    if (needed >= 0 && ctx.stageIndex >= needed) return decided(true, "stage");
  }
  return decided(false, "not granted");
}

/**
 * The gate's yes-or-no face, which is what almost every caller wants.
 *
 * It is a projection of `capabilityDecision` and never a second copy of the
 * order. The admin explainer at GET /api/admin/members/:id/capabilities used
 * to re-implement the ladder to report a source, under a comment admitting
 * that "if that order ever changes, this explanation lies". It reads the
 * decision now, so it cannot.
 */
export function hasCapability(cap: Capability, ctx: CapabilityCtx): boolean {
  return capabilityDecision(cap, ctx).allowed;
}

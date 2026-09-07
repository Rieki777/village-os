/**
 * The steward's rules that need no database.
 *
 * REWRITTEN FROM THE APPROVAL MODEL, and every rewritten assertion is here
 * because the rule it pinned is now wrong rather than because the test was.
 * The founder ruled on 2026-09-03 that the steward does not approve anything:
 * a decision the village carried lands on its own, and the seat's one power is
 * to stop it inside the window before it lands. So the old tests that pinned
 * "which decisions WAIT for a steward", "which decisions carry themselves",
 * and "an approval may carry no words" pinned a model that no longer exists.
 * What replaced each one:
 *
 *  - WHAT THE SEAT MAY STOP. One list, not two. The second list said nothing
 *    the first did not once nothing waits.
 *  - A VETO CARRIES A REASON. Unchanged in substance, and the cap came down
 *    from 4000 to 2000 because this is public permanent free text about a
 *    named neighbour.
 *  - AN EMPTY SEAT IS NOT AN ERROR, and the sentence no longer says anything
 *    waits, because nothing does.
 *  - THE COUNCIL, which is new: any single steward stops a decision unless the
 *    village turns the council on.
 *  - THE TERM IS AN INSTANT FROM THE CLOCK, which is new, and is the whole of
 *    what stops a seat that can veto from outliving its mandate.
 *
 * The database halves (the veto row, the seating, the vacancy read, the term
 * history) are in server/stewardship.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  ADVISORY,
  AUTO_EXECUTE_SUBJECTS_KEY,
  DEFAULT_TERM_CYCLES,
  HIGHEST_TIER_KEY,
  REASON_MAX,
  REASON_NOTICE,
  VETO_TEXT_COLUMNS,
  VETO_WATCH_NOTICE_TYPES,
  isVetoable,
  keyIsVetoLocked,
  keyIsVetoMap,
  mayVeto,
  noObjectionReasonProblem,
  stewardIsSubjectOf,
  stewardMayVetoAnything,
  stewardNoBlocks,
  subjectMap,
  termEndsAtFromCycles,
  vetoReasonProblem,
  vetoWatchMarksDue,
  vetoWatchMarksToSend,
  vetoWatchNoticeType,
  vetoWindowIsKnown,
  STEWARD_COUNCIL_KEY,
  STEWARD_SUBJECTS_KEY,
  STEWARD_VETO,
  VETO_HOURS_KEY,
} from "./stewardship";
import { emailCadenceFor, resolveNotifyPrefs } from "./notify";
import { capabilityDecision } from "../../shared/capabilities";
import { NOTIFICATION_KINDS } from "../../shared/notificationKinds";
import { badgeProblem } from "./badges";
import { stewardSeatRefusal, STEWARD_SEAT_REFUSAL } from "./roleGrants";
import { ALL_CAPABILITIES, CAPABILITY_LABELS, TRANSFERABLE, DENIABLE } from "../../shared/capabilities";
import { CAPABILITY_CONSEQUENCE } from "../../shared/draftKinds";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { cycleBoundsFor } from "../../shared/lunar";

describe("which decisions a steward can stop", () => {
  it("can stop everything by default, because a young village runs on training wheels", () => {
    // The founder's default, read off the registry rather than retyped, so a
    // change to the default fails here instead of shipping silently.
    const def = VARIABLES_BY_KEY[STEWARD_SUBJECTS_KEY];
    expect(def, "the setting is registered, or nothing can turn it").toBeTruthy();
    expect(def.default).toBe("all");
    expect(mayVeto("mechanics", def.default)).toBe(true);
    expect(mayVeto("village_launch", def.default)).toBe(true);
  });

  it("can never stop an advisory vote, which changes nothing", () => {
    expect(mayVeto(ADVISORY, "all")).toBe(false);
    expect(mayVeto(ADVISORY, "advisory,mechanics")).toBe(false);
  });

  it("honours a named list, and treats an unnamed subject as out of reach", () => {
    expect(mayVeto("mechanics", "mechanics,mint_rule")).toBe(true);
    expect(mayVeto("role_seat", "mechanics,mint_rule")).toBe(false);
  });

  it("can stop nothing when the village says none, or leaves it blank", () => {
    for (const raw of ["none", "", "  ", "off"]) {
      expect(mayVeto("mechanics", raw), raw).toBe(false);
    }
  });

  it("tolerates the spacing and casing a person actually types", () => {
    expect(mayVeto("mechanics", " Mechanics , mint_rule ")).toBe(true);
  });

  it("answers as one map, so a surface never re-derives the rule per row", () => {
    const map = subjectMap(["mechanics", ADVISORY]);
    expect(map.map((m) => m.subjectType)).toEqual(["mechanics", ADVISORY]);
  });
});

describe("what a steward may NEVER stop, however the list is set", () => {
  /*
   * The audit of 2026-09-03 asked one question the plan had no answer to: what
   * stops a steward vetoing the ballot that removes them? Nothing did. The
   * seat blocked its own unseating, blocked the edit that would exempt it, and
   * the term that was supposed to end it hung on a season list that never
   * turned. These are the two carve-outs that answer it.
   */
  it("puts all five limits on the seat out of reach", () => {
    // The list widened on 2026-09-03 (20.11 names all five as constitutional
    // and the seat's own limits). `governance.auto_execute_subjects` is the
    // older half of the map and carries no registry entry on this build; it is
    // still locked, because a fork's database may hold the row and a change
    // set naming the string must be treated as an edit to the map.
    expect(keyIsVetoLocked(STEWARD_SUBJECTS_KEY)).toBe(true);
    expect(keyIsVetoLocked(AUTO_EXECUTE_SUBJECTS_KEY)).toBe(true);
    expect(keyIsVetoLocked(STEWARD_COUNCIL_KEY)).toBe(true);
    expect(keyIsVetoLocked(VETO_HOURS_KEY)).toBe(true);
    expect(keyIsVetoLocked(HIGHEST_TIER_KEY)).toBe(true);
  });

  it("leaves every other setting exactly where it was", () => {
    expect(keyIsVetoLocked("governance.auto_apply_enabled")).toBe(false);
    expect(keyIsVetoLocked("governance.quorum_pct")).toBe(false);
  });

  it("keeps the MAP question narrower than the reach question", () => {
    // Two different questions, and collapsing them is what put the council
    // switch and the window length on the no-window path. The map is the two
    // keys 20.11 names; the reach is every limit on the seat.
    expect(keyIsVetoMap(STEWARD_SUBJECTS_KEY)).toBe(true);
    expect(keyIsVetoMap(AUTO_EXECUTE_SUBJECTS_KEY)).toBe(true);
    expect(keyIsVetoMap(STEWARD_COUNCIL_KEY)).toBe(false);
    expect(keyIsVetoMap(VETO_HOURS_KEY)).toBe(false);
    expect(keyIsVetoMap(HIGHEST_TIER_KEY)).toBe(false);
  });
});

describe("isVetoable, the one predicate, elements and all", () => {
  /*
   * The second audit's top risk 2 and risk 3 both land here. A change set
   * carrying `governance.veto_hours` beside an ordinary dial used to answer
   * "vetoable", because the only question asked was about the SUBJECT type, so
   * the seat could stop the village shortening its own window by bundling the
   * edit with anything else.
   */
  it("refuses a veto on a change set that edits a limit on the seat, and names the key", () => {
    const verdict = isVetoable("mechanics", [{ key: "gratitude.pool" }, { key: VETO_HOURS_KEY }], {
      stewardSubjects: "all",
    });
    expect(verdict.vetoable).toBe(false);
    expect(verdict.why).toContain(VETO_HOURS_KEY);
  });

  it("lets an ordinary change set through", () => {
    expect(isVetoable("mechanics", [{ key: "gratitude.pool" }], { stewardSubjects: "all" }).vetoable).toBe(true);
    expect(isVetoable("mechanics", [], { stewardSubjects: "all" }).vetoable).toBe(true);
  });

  it("refuses a veto on the seating of a steward-capable role", () => {
    const verdict = isVetoable("role_unseat", [], { stewardSubjects: "all", seatsStewardCapableRole: true });
    expect(verdict.vetoable).toBe(false);
  });

  it("leaves a seating for any other role vetoable", () => {
    expect(isVetoable("role_seat", [], { stewardSubjects: "all" }).vetoable).toBe(true);
  });

  it("SAYS THE WINDOW STANDS, because the carve-out takes the veto and nothing else", () => {
    /*
     * The rule this replaces: 20.11 corrected the first reading, under which
     * these executed at pass with no window at all. That put the one act
     * nobody can stop onto the fastest clock the platform has. They now wait
     * exactly as long as any other Game change of the same timing, and the
     * copy has to say so or a steward reads "no window" into it.
     */
    for (const verdict of [
      isVetoable("role_unseat", [], { stewardSubjects: "all", seatsStewardCapableRole: true }),
      isVetoable("mechanics", [{ key: STEWARD_SUBJECTS_KEY }], { stewardSubjects: "all" }),
    ]) {
      expect(verdict.why).toContain("waits out its window");
      expect(verdict.why).not.toContain("the moment it carries");
    }
  });

  it("still answers no on a subject this village put outside the seat's reach", () => {
    expect(isVetoable("mechanics", [], { stewardSubjects: "none" }).vetoable).toBe(false);
    expect(isVetoable(ADVISORY, [], { stewardSubjects: "all" }).vetoable).toBe(false);
  });
});

describe("a seated steward's no, evaluated at the close", () => {
  const STEWARD = { userId: "st-1" };
  const send = (over: Record<string, unknown> = {}) => ({
    ballot: { subjectType: "token_send", subjectRef: "pay-1", ...over },
    seated: [STEWARD],
    council: false,
  });

  it("fails a token send when the steward said no and said why", () => {
    const verdict = stewardNoBlocks({
      ...send(),
      votes: [
        { userId: "u-a", choice: "yes" },
        { userId: "st-1", choice: "no", reason: "This pays one household twice." },
      ],
    });
    expect(verdict.blocks).toBe(true);
    expect(verdict.kind).toBe("token_send");
    expect(verdict.stewardIds).toEqual(["st-1"]);
    expect(verdict.reason).toContain("one household twice");
  });

  it("does NOT fail a Game change, which has a window and a veto of its own", () => {
    // The wider reading the first build shipped gave one seat a silent,
    // unappealable kill switch over every ballot in the village, the one that
    // would remove them included. 20.11 narrows it to token sends.
    const verdict = stewardNoBlocks({
      ballot: { subjectType: "mechanics", subjectRef: "prop-1" },
      votes: [{ userId: "st-1", choice: "no", reason: "Not this moon." }],
      seated: [STEWARD],
      council: false,
    });
    expect(verdict.blocks).toBe(false);
    expect(verdict.kind).toBe("game_change");
    expect(verdict.sentence).toContain("window");
  });

  it("reads a bundle as a whole, so a mixed set is a Game change", () => {
    const verdict = stewardNoBlocks({
      ballot: { subjectType: "mechanics", subjectRef: "prop-2", itemKinds: ["token_send", "dial"] },
      votes: [{ userId: "st-1", choice: "no", reason: "Not this moon." }],
      seated: [STEWARD],
      council: false,
    });
    expect(verdict.kind).toBe("game_change");
    expect(verdict.blocks).toBe(false);
  });

  it("NEVER fails a ballot the steward is the subject of", () => {
    // Risk 4 of the second audit. The seat that cannot veto its own removal
    // was failing it with a vote instead.
    const verdict = stewardNoBlocks({
      ballot: { subjectType: "token_send", subjectRef: "st-1" },
      votes: [{ userId: "st-1", choice: "no", reason: "I would rather keep this." }],
      seated: [STEWARD],
      council: false,
    });
    expect(verdict.blocks).toBe(false);
    expect(verdict.uncounted[0]?.because).toContain("about them");
  });

  it("reads the userId@roleId reference the seating ballots freeze", () => {
    expect(stewardIsSubjectOf({ subjectRef: "st-1@steward" }, "st-1")).toBe(true);
    expect(stewardIsSubjectOf({ subjectRef: "st-1" }, "st-1")).toBe(true);
    expect(stewardIsSubjectOf({ subjectRef: "st-12@steward" }, "st-1")).toBe(false);
    expect(stewardIsSubjectOf({ subjectRef: null }, "st-1")).toBe(false);
  });

  it("REQUIRES A REASON, held to the veto's own rule", () => {
    // Choices are hidden by default, so a no with no words kills a payout
    // while saying nothing and while nobody can see it coming.
    for (const reason of [undefined, null, "", "   "]) {
      const verdict = stewardNoBlocks({ ...send(), votes: [{ userId: "st-1", choice: "no", reason }] });
      expect(verdict.blocks, String(reason)).toBe(false);
      expect(verdict.uncounted[0]?.because).toContain("no reason");
    }
  });

  it("takes a majority of the seated stewards under a council", () => {
    const seated = [{ userId: "st-1" }, { userId: "st-2" }, { userId: "st-3" }];
    const one = stewardNoBlocks({
      ballot: { subjectType: "token_send", subjectRef: "pay-1" },
      votes: [{ userId: "st-1", choice: "no", reason: "Not this one." }],
      seated,
      council: true,
    });
    expect(one.blocks).toBe(false);
    expect(one.needed).toBe(2);

    const two = stewardNoBlocks({
      ballot: { subjectType: "token_send", subjectRef: "pay-1" },
      votes: [
        { userId: "st-1", choice: "no", reason: "Not this one." },
        { userId: "st-2", choice: "no", reason: "Nor this one." },
      ],
      seated,
      council: true,
    });
    expect(two.blocks).toBe(true);
    expect(two.stewardIds).toEqual(["st-1", "st-2"]);
  });

  it("counts nobody who is not on a seat", () => {
    const verdict = stewardNoBlocks({
      ...send(),
      votes: [{ userId: "u-a", choice: "no", reason: "I would rather not." }],
    });
    expect(verdict.blocks).toBe(false);
    expect(verdict.uncounted).toEqual([]);
  });

  it("leaves the tally alone, because a steward's weight counts like anybody's", () => {
    /*
     * Nothing in this function removes or reweights a vote. The block sits on
     * top of an outcome the engine already computed, so a ballot that failed
     * on the numbers failed on the numbers, and a steward who votes no on a
     * Game change has voted no like any other member.
     */
    const verdict = stewardNoBlocks({
      ballot: { subjectType: "mechanics", subjectRef: "prop-3" },
      votes: [{ userId: "st-1", choice: "no", reason: "Not this moon." }],
      seated: [STEWARD],
      council: false,
    });
    expect(verdict.blocks).toBe(false);
    expect(verdict.stewardIds).toEqual([]);
  });
});

describe("the two settings the gradient is now made of", () => {
  it("runs no council by default, so any one seated steward can stop a decision", () => {
    const def = VARIABLES_BY_KEY[STEWARD_COUNCIL_KEY];
    expect(def, "the setting is registered, or nothing can turn it").toBeTruthy();
    expect(def.default).toBe("false");
    expect(def.criticality).toBe("constitutional");
  });

  it("has retired the second list, because nothing waits for a steward any more", () => {
    // The old `governance.auto_execute_subjects` named subjects that applied
    // themselves with no steward in the loop. Under the veto model every
    // subject does that, so the key said nothing and is gone.
    expect(VARIABLES_BY_KEY["governance.auto_execute_subjects"]).toBeUndefined();
  });

  it("leaves governance.auto_apply_enabled meaning exactly what it always meant", () => {
    // The mechanics brake keeps its own key and its own default. Nothing here
    // changes what an existing village's setting does.
    const brake = VARIABLES_BY_KEY["governance.auto_apply_enabled"];
    expect(brake.default).toBe("true");
    expect(brake.ring).toBe("founder");
  });
});

describe("whether this village leaves the seat anything to stop", () => {
  it("does, on the default, even before the village has held a single vote", () => {
    // The trap this closes: answering from the list of subject types a village
    // has used would tell a brand-new village it had already outgrown the seat.
    expect(stewardMayVetoAnything("all")).toBe(true);
    expect(stewardMayVetoAnything("mechanics")).toBe(true);
  });

  it("does not, when the village says none", () => {
    expect(stewardMayVetoAnything("none")).toBe(false);
    expect(stewardMayVetoAnything("")).toBe(false);
  });
});

describe("a veto carries a reason", () => {
  it("refuses an empty reason", () => {
    expect(vetoReasonProblem("")).toBeTruthy();
  });

  it("refuses a reason that is only whitespace", () => {
    // The way the requirement gets met without being met.
    expect(vetoReasonProblem("   \n\t ")).toBeTruthy();
    expect(vetoReasonProblem(null)).toBeTruthy();
    expect(vetoReasonProblem(undefined)).toBeTruthy();
  });

  it("accepts a real sentence", () => {
    expect(vetoReasonProblem("This turns the mint on before the ledger is settled.")).toBeNull();
  });

  it("caps the reason at 2000 characters, down from the 4000 an approval allowed", () => {
    // It came down because this is public permanent free text about a named
    // neighbour, and a shorter cap is the cheapest part of that being true.
    expect(REASON_MAX).toBe(2000);
    expect(vetoReasonProblem("x".repeat(2000))).toBeNull();
    expect(vetoReasonProblem("x".repeat(2001))).toBeTruthy();
  });

  it("lets a no-objection say nothing, and still holds it to the length", () => {
    expect(noObjectionReasonProblem("")).toBeNull();
    expect(noObjectionReasonProblem("x".repeat(2001))).toBeTruthy();
  });

  it("says above the input that the words are public, permanent and redactable", () => {
    expect(REASON_NOTICE).toContain("public and permanent");
    expect(REASON_NOTICE).toContain("redacted");
  });
});

describe("the window, and the difference between open and unknown", () => {
  it("knows of no window until the dispatcher registers one", () => {
    // A build without the dispatcher lane has no lands_at to read, and saying
    // "the window is open" there would let a veto land after the decision did.
    // Saying "closed" would make the route dead. So it says neither.
    expect(vetoWindowIsKnown()).toBe(false);
  });

  it("marks the three moments a steward is told about, and only once each is due", () => {
    const carried = new Date("2026-03-01T00:00:00.000Z");
    const lands = new Date("2026-03-04T00:00:00.000Z");
    const at = (iso: string) => vetoWatchMarksDue({ carriedAt: carried, landsAt: lands }, new Date(iso));
    expect(at("2026-02-28T23:00:00.000Z")).toEqual([]);
    expect(at("2026-03-01T00:00:00.000Z")).toEqual(["carried"]);
    expect(at("2026-03-02T13:00:00.000Z")).toEqual(["carried", "halfway"]);
    expect(at("2026-03-03T22:30:00.000Z")).toEqual(["carried", "halfway", "two-hours-left"]);
  });

  it("marks nothing on a window with no width, rather than marking everything", () => {
    const t = new Date("2026-03-01T00:00:00.000Z");
    expect(vetoWatchMarksDue({ carriedAt: t, landsAt: t }, t)).toEqual([]);
    expect(vetoWatchMarksDue({ carriedAt: "not a date", landsAt: t }, t)).toEqual([]);
  });
});

describe("a term is an instant from the clock, never a season", () => {
  /*
   * The audit traced the old path: the term was "the next season turn",
   * seasons are an ungoverned admin list, both shipped entries end on one
   * date, and a founding season is documented as open-ended. A term hung on
   * that list never comes due, and the term is the only backstop on a seat
   * that can veto a decision the village carried.
   */
  it("lands on a cycle boundary, so a seat ends when everything else turns", () => {
    const from = new Date("2026-03-15T11:00:00.000Z");
    const ends = termEndsAtFromCycles(3, from);
    const here = cycleBoundsFor(from);
    expect(cycleBoundsFor(ends).cycleNumber).toBe(here.cycleNumber + 3);
    expect(ends.getTime()).toBeGreaterThan(from.getTime());
  });

  it("never returns a term of zero cycles, however it is asked", () => {
    const from = new Date("2026-03-15T11:00:00.000Z");
    for (const n of [0, -4, Number.NaN]) {
      expect(termEndsAtFromCycles(n as number, from).getTime(), String(n)).toBeGreaterThan(from.getTime());
    }
  });

  it("runs for three cycles by default, which is a season's worth of moons", () => {
    expect(DEFAULT_TERM_CYCLES).toBe(3);
  });
});

describe("the seat is the village's, and no admin route may give or take it", () => {
  /*
   * Risk 1 of the audit, in one sentence: once the steward is a veto, the veto
   * is the only human brake on a Game change, it lives on the roles plane, and
   * the roles plane has an admin path. So one account could seat itself as
   * steward, unseat the elected one, and stop whatever it liked, with a record
   * that reads as ordinary administration.
   */
  it("refuses to touch a role that already carries the veto", () => {
    const no = stewardSeatRefusal({ id: "steward", capabilities: [STEWARD_VETO] });
    expect(no).toBeTruthy();
    expect(no!.status).toBe(409);
    expect(no!.body.error).toBe(STEWARD_SEAT_REFUSAL);
  });

  it("refuses to ADD the veto to a role that does not carry it", () => {
    const no = stewardSeatRefusal({ id: "circle", capabilities: ["forum.post"] }, ["forum.post", STEWARD_VETO]);
    expect(no).toBeTruthy();
  });

  it("refuses to REMOVE the veto by writing a list without it", () => {
    // The removal path is the one an admin would reach for to clear the room,
    // and a guard that only watched additions would leave it wide open.
    const no = stewardSeatRefusal({ id: "steward", capabilities: [STEWARD_VETO] }, ["forum.post"]);
    expect(no).toBeTruthy();
  });

  it("names the two ballots, so an administrator is told where the door is", () => {
    const no = stewardSeatRefusal({ id: "steward", capabilities: [STEWARD_VETO] });
    expect(no!.body.ballots).toEqual(["role_seat", "role_unseat"]);
    expect(String(no!.body.error)).toContain("role_seat");
    expect(String(no!.body.error)).toContain("role_unseat");
  });

  it("lets every other role through untouched", () => {
    expect(stewardSeatRefusal({ id: "circle", capabilities: ["forum.post"] })).toBeNull();
    expect(stewardSeatRefusal({ id: "circle", capabilities: [] }, ["forum.post"])).toBeNull();
    expect(stewardSeatRefusal(null)).toBeNull();
  });

  it("reads a capability list however the driver hands it over", () => {
    // MySQL returns a JSON column parsed on one driver version and as a string
    // on another, and a guard that saw only one of them would be off on half
    // the deployments.
    expect(stewardSeatRefusal({ id: "steward", capabilities: JSON.stringify([STEWARD_VETO]) })).toBeTruthy();
    expect(stewardSeatRefusal({ id: "steward", capabilities: "not json at all" })).toBeNull();
  });
});

describe("the capability, in all five places", () => {
  /*
   * Adding or renaming a capability key is five edits and a missed one is
   * invisible until something renders a dotted key at a member.
   * `capabilities.test.ts` pins the first three against each other; these pin
   * the two that live outside that file, so the whole set fails here rather
   * than in production.
   */
  it("is in the canonical list", () => {
    expect(ALL_CAPABILITIES).toContain(STEWARD_VETO);
  });

  it("has left no trace of the name it used to have", () => {
    expect(ALL_CAPABILITIES).not.toContain("steward.approve" as never);
  });

  it("has a label a member can read, and never the raw key", () => {
    expect(CAPABILITY_LABELS[STEWARD_VETO]).toBeTruthy();
    expect(CAPABILITY_LABELS[STEWARD_VETO]).not.toContain("steward.veto");
  });

  it("has the consequence sentence the registry serves", () => {
    expect(CAPABILITY_CONSEQUENCE[STEWARD_VETO]).toBeTruthy();
  });

  it("can move to a role the village declared, because the seat is meant to change hands", () => {
    expect(TRANSFERABLE[STEWARD_VETO]).toBe(true);
  });

  it("CANNOT be paused by a warning badge, which was true of the approval and is not of this", () => {
    // A warning badge is written by an admin. Leaving this key deniable would
    // put the removal the ballots own back inside the badge panel, which is
    // the same door under a different name.
    expect(DENIABLE[STEWARD_VETO]).toBe(false);
  });

  it("survives a warning badge naming it, at the gate itself", () => {
    /*
     * Risk 5 of the second audit, and the half that was never named: 20.8
     * closed the GRANT path at the admin roles routes and left the DENY path
     * open. An admin who could not seat themselves could still issue a warning
     * badge against the elected steward, pass a constitutional change, and
     * wait out the window, with nothing on the roles plane moving.
     *
     * THE DIRECTION IS WHY. Under the approval model a paused approval meant
     * a proposal waited, which changes nothing. Under the veto model A PAUSED
     * VETO MEANS THE CHANGE LANDS.
     *
     * Verified red by flipping DENIABLE["steward.veto"] to true: the decision
     * below then reads "denied by warning badge" and the assertion fails.
     */
    const decision = capabilityDecision(STEWARD_VETO, {
      stageIndex: 0,
      stageIndexOf: () => -1,
      roleCapabilities: [STEWARD_VETO],
      badgeDenies: [STEWARD_VETO],
    });
    expect(decision.allowed).toBe(true);
    expect(decision.source).toBe("role");
  });

  it("cannot even be written into a warning badge, so the admin is told rather than ignored", () => {
    // The second of the three locks on the same door. The gate ignoring a
    // deny is right and silent; an admin who tried deserves the sentence.
    const problem = badgeProblem({
      kind: "warning",
      capabilities: [],
      denies: [STEWARD_VETO],
      rule: null,
    });
    expect(problem).toBeTruthy();
    expect(String(problem)).toContain(CAPABILITY_LABELS[STEWARD_VETO]);
  });
});

describe("the five settings that price and shape the seat", () => {
  /*
   * The second audit, verified against the tree: `governance.steward_subjects`
   * carried no criticality field, so `criticalityOf` returned routine and the
   * whole reach of the seat could be set to none at 20 percent quorum, by the
   * cheapest proposal in the village, with no window and no veto able to reach
   * it. All five are limits on the seat, so all five are priced at the top.
   */
  const CONSTITUTIONAL = [STEWARD_SUBJECTS_KEY, STEWARD_COUNCIL_KEY, VETO_HOURS_KEY, HIGHEST_TIER_KEY];

  for (const key of CONSTITUTIONAL) {
    it(`prices ${key} at the constitutional tier`, () => {
      const def = VARIABLES_BY_KEY[key];
      expect(def, "the setting is registered, or nothing can price it").toBeTruthy();
      expect(def.criticality).toBe("constitutional");
    });
  }

  it("locks the fifth key without registering it, because this build does not serve it", () => {
    // `governance.auto_execute_subjects` is the older half of the veto map.
    // Under the approval model it named which subjects carried themselves;
    // once every subject does that it says nothing, so it has no registry
    // entry here and nothing prices it. It stays in the locked list because a
    // fork's database may still hold the row.
    expect(VARIABLES_BY_KEY[AUTO_EXECUTE_SUBJECTS_KEY]).toBeUndefined();
    expect(keyIsVetoLocked(AUTO_EXECUTE_SUBJECTS_KEY)).toBe(true);
  });
});

describe("the three window notices, and the mail that carries them", () => {
  /*
   * Every governance type resolves to `governanceEmail`, which defaults to
   * daily. So the last warning before a Game change landed, sent two hours
   * out, arrived hours after it had landed. Three types of their own, pinned.
   */
  it("gives each mark its own notification type", () => {
    expect(vetoWatchNoticeType("carried")).toBe("veto_window_opened");
    expect(vetoWatchNoticeType("halfway")).toBe("veto_window_halfway");
    expect(vetoWatchNoticeType("two-hours-left")).toBe("veto_window_closing");
  });

  it("pins all three to immediate, whatever the member set governance mail to", () => {
    for (const setting of ["daily", "off"] as const) {
      const prefs = resolveNotifyPrefs({ notify: { governanceEmail: setting } });
      for (const type of Object.values(VETO_WATCH_NOTICE_TYPES)) {
        expect(emailCadenceFor(type, prefs), `${type} at ${setting}`).toBe("immediate");
      }
      // The rest of the family is untouched: a ballot opening still rides the
      // preference, because its window is measured in days.
      expect(emailCadenceFor("ballot_opened", prefs)).toBe(setting);
    }
  });

  it("reaches a steward who turned all mail off before the village seated them", () => {
    const prefs = resolveNotifyPrefs({ notify: { emailsOff: true } });
    expect(emailCadenceFor("veto_window_closing", prefs)).toBe("immediate");
    expect(emailCadenceFor("ballot_opened", prefs)).toBe("off");
  });

  it("says what each one is about, so a bell row carries its own context", () => {
    for (const type of Object.values(VETO_WATCH_NOTICE_TYPES)) {
      const kind = NOTIFICATION_KINDS[type];
      expect(kind, type).toBeTruthy();
      expect(kind.group).toBe("decisions");
      expect(kind.celebrate, "a countdown is not a moment").toBe(false);
    }
  });

  it("SUPPRESSES a notice whose moment has passed rather than sending it late", () => {
    const carried = new Date("2026-03-01T00:00:00.000Z");
    const lands = new Date("2026-03-04T00:00:00.000Z");
    const window = { carriedAt: carried, landsAt: lands };
    // Inside the window it says the same thing the due list says.
    expect(vetoWatchMarksToSend(window, new Date("2026-03-03T23:00:00.000Z"))).toEqual(
      vetoWatchMarksDue(window, new Date("2026-03-03T23:00:00.000Z")),
    );
    // Once it has landed there is no door left, and a notice about a shut door
    // sends a steward looking for one.
    expect(vetoWatchMarksDue(window, new Date("2026-03-04T00:30:00.000Z")).length).toBeGreaterThan(0);
    expect(vetoWatchMarksToSend(window, new Date("2026-03-04T00:30:00.000Z"))).toEqual([]);
  });
});

describe("where this lane's free text lives", () => {
  /*
   * A veto reason is written once and stored three times, and the first
   * redaction knew about one of them. An inventory that names all three is
   * what makes "the words can be redacted later" true on every page rather
   * than on one.
   */
  it("names every column, so a redaction can reach all of them", () => {
    expect(VETO_TEXT_COLUMNS).toEqual([
      "ballot_vetoes.reason",
      "ballots.veto_reason",
      "mechanics_proposals.veto_reason",
    ]);
  });
});

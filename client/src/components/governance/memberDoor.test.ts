/**
 * THE MEMBER DOOR (Rye, 10 Nov 2026): a member who picks roles on a role card
 * or the roles board lands on an application for THOSE roles, reads it as
 * applying for a role, walks back to where they came from, picks at most
 * three, and is asked what the open form asks (an aim, a season goal, the
 * terms on offer accepted or a wish to talk). A renewal and a season plan
 * keep the editor they had.
 */
import { describe, expect, it } from "vitest";
import { MAX_SEATS } from "@shared/seatApplications";
import { DOOR_HOME, applySeatsHref, doorFrom } from "@shared/seatApplyLinks";
import { proposeTermsHref } from "@shared/seatTermsOffer";
import { applyHrefFor } from "@shared/roleDraft";
import { NO_SEASON_GOALS, ROLE_APPLICATION_TYPE, doorDeliverables, roleApplicationStart, termsChoiceProblem } from "./roleApplicationType";
import { fieldsFor, nextStep, prevStep, problemsFor, walkFor } from "./wizardWalk";
import { doorBack } from "@/pages/Propose";
import { doorSettings } from "./TermsOnOfferField";
import { applyWholePreset, wholePresetById } from "@shared/seatPresets";
import { parseSeatSettings } from "@shared/seatSettings";

const DOOR = roleApplicationStart("?type=role_application&seat=garden&seat=host&from=%2Froles%2Fdraft")!;
const RENEWAL = roleApplicationStart("?type=role_application&seat=garden&renew=garden&season=s-next")!;
const VOLUNTEER = { pay: { kind: "none" } };

describe("a door start", () => {
  it("is a pick from a card or the board, and never a renewal, a season plan or Propose terms", () => {
    expect(DOOR.answers).toEqual({ seatIds: ["garden", "host"], door: true });
    expect(RENEWAL.answers.door).toBeUndefined();
    expect(roleApplicationStart(proposeTermsHref("garden").slice("/propose".length))!.answers.door).toBeUndefined();
  });

  it("walks without the kind step, and Back from its first step leaves for where the member came from", () => {
    expect(walkFor("role_application", DOOR.answers).map((s) => s.key)).not.toContain("type");
    expect(nextStep("role_application", "type", DOOR.answers)).toBe("subject");
    expect(prevStep("role_application", "subject", DOOR.answers)).toBeNull();
    // Any other start still walks back to the kind step.
    expect(prevStep("role_application", "subject", RENEWAL.answers)).toBe("type");
  });

  it("asks the open form's questions, and a renewal keeps its terms editor", () => {
    expect(fieldsFor("role_application", "details", DOOR.answers).map((f) => f.key)).toEqual(["fitStatement", "aim", "goals", "servesGoal"]);
    expect(fieldsFor("role_application", "terms", DOOR.answers).map((f) => f.key)).toEqual(["termsChoice", "startsNoEarlierThan"]);
    expect(fieldsFor("role_application", "details", RENEWAL.answers).map((f) => f.key)).toEqual(["fitStatement", "goals"]);
    expect(fieldsFor("role_application", "terms", RENEWAL.answers).map((f) => f.key)).toEqual(["seatSettings", "startsNoEarlierThan"]);
  });

  it("requires the aim, the goal and a terms choice, and never judges the hidden terms editor", () => {
    const fields = problemsFor("role_application", DOOR.answers).map((p) => p.field);
    expect(fields).toEqual(expect.arrayContaining(["aim", "servesGoal", "termsChoice"]));
    expect(fields).not.toContain("seatSettings");
    expect(termsChoiceProblem({ choice: "talk", note: " ", settings: VOLUNTEER }, DOOR.answers)).toMatch(/talk about in the terms/);
    expect(termsChoiceProblem(undefined, RENEWAL.answers)).toBeNull();
  });

  it("publishes the aim, the goal and the terms choice ahead of the member's own list, and the terms it showed", () => {
    const a = {
      ...DOOR.answers,
      aim: "Food grows here.",
      servesGoal: "Food grown on the land",
      termsChoice: { choice: "talk", note: "The hours", settings: VOLUNTEER },
      goals: [{ title: "Plant three beds", doneWhen: "they are planted", moves: "", serves: "", date: "", roleId: "" }],
      fitStatement: "I grow food.",
    };
    expect(doorDeliverables(a)).toBe("Aim: Food grows here.\nServes the village goal: Food grown on the land\nWants to talk about the terms: The hours\n\n- Plant three beds, done when they are planted");
    const body = ROLE_APPLICATION_TYPE.publish.body(a) as Record<string, unknown>;
    expect(body.seatSettings).toEqual(VOLUNTEER);
    // B1 (0369): the answers go structured, for the proposal's card.
    expect(body.answers).toEqual({ aim: "Food grows here.", servesGoal: "Food grown on the land", terms: { choice: "talk", note: "The hours" },
      // The goals ride in the answers, each tied to the first picked role when the list left it open.
      goals: [{ title: "Plant three beds", doneWhen: "they are planted", moves: "", serves: "", date: "", roleId: "garden" }],
      // About you (PR 2): nothing filled yet, so the route asks for the background-check consent.
      references: [], about: {},
    });
    expect((ROLE_APPLICATION_TYPE.publish.body({ ...RENEWAL.answers, deliverables: "x" }) as Record<string, unknown>).answers).toBeUndefined();
    expect(body.seatIds).toEqual(["garden", "host"]);
    // A season with no goals yet answers for the member, and says nothing about a goal.
    expect(doorDeliverables({ ...a, servesGoal: NO_SEASON_GOALS, termsChoice: { choice: "accept", note: "", settings: VOLUNTEER } })).toBe(
      "Aim: Food grows here.\nAccepts the terms on offer.\n\n- Plant three beds, done when they are planted",
    );
    // A renewal publishes its list and its terms as written.
    expect(doorDeliverables({ ...RENEWAL.answers, deliverables: "Same as before." })).toBe("Same as before.");
  });
});

describe("three everywhere (D3)", () => {
  it("is the limit of one application, the board and the role proposal", () => {
    expect(MAX_SEATS).toBe(3);
  });
});

describe("where the door's back link goes", () => {
  it("is the board or the card that sent the member, read only as a same-site path", () => {
    expect(applyHrefFor(["garden", "host"], true)).toContain("from=%2Froles%2Fdraft");
    expect(applySeatsHref(["garden"], { from: "/roles?seat=garden" })).toContain("from=%2Froles%3Fseat%3Dgarden");
    expect(doorFrom("/roles?seat=garden")).toBe("/roles?seat=garden");
    for (const bad of ["//evil.example", "https://evil.example/", "/\\evil", "javascript:alert(1)", "roles", "/roles\nx", ""]) expect(doorFrom(bad)).toBeNull();
  });

  it("says Back to the role for a card and Back to the roles otherwise, and falls back to the board", () => {
    expect(doorBack("?from=%2Froles%3Fseat%3Dgarden", "")).toEqual({ href: "/roles?seat=garden", card: true, circle: false });
    expect(doorBack("?from=%2Fcircles%2Fland", "")).toEqual({ href: "/circles/land", card: false, circle: true });
    expect(doorBack("?from=%2Froles%2Fdraft", "")).toEqual({ href: "/roles/draft", card: false, circle: false });
    expect(doorBack("?from=%2F%2Fevil.example", "")).toEqual({ href: DOOR_HOME, card: false, circle: false });
    expect(doorBack("", "https://elsewhere.example/roles/draft")).toEqual({ href: DOOR_HOME, card: false, circle: false });
  });
});

describe("the terms a door sends (Rye, 10 Nov 2026: every role is a contract)", () => {
  it("sends the role's own terms on offer unchanged", () => {
    const offer = applyWholePreset(null, wholePresetById("platform:whole-stipend-seat")!, []);
    expect(doorSettings([{ id: "garden", termsOffer: offer }])).toEqual(offer);
  });
  it("for a role that offers none, writes no terms (as the open form does), never the volunteer preset", () => {
    const none = doorSettings([{ id: "garden", termsOffer: null }]);
    expect(none).toEqual({ v: 1 });
    expect(JSON.stringify(none)).not.toMatch(/unpaid|volunteer/i);
    expect(parseSeatSettings(none).ok).toBe(true);
  });
});

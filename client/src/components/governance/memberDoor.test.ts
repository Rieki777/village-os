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
    expect(fieldsFor("role_application", "details", DOOR.answers).map((f) => f.key)).toEqual(["aim", "servesGoal", "deliverables", "fitStatement"]);
    expect(fieldsFor("role_application", "terms", DOOR.answers).map((f) => f.key)).toEqual(["termsChoice", "startsNoEarlierThan"]);
    expect(fieldsFor("role_application", "details", RENEWAL.answers).map((f) => f.key)).toEqual(["deliverables", "fitStatement"]);
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
      deliverables: "Three beds planted.",
      fitStatement: "I grow food.",
    };
    expect(doorDeliverables(a)).toBe("Aim: Food grows here.\nServes the village goal: Food grown on the land\nWants to talk about the terms: The hours\n\nThree beds planted.");
    const body = ROLE_APPLICATION_TYPE.publish.body(a) as Record<string, unknown>;
    expect(body.seatSettings).toEqual(VOLUNTEER);
    expect(body.seatIds).toEqual(["garden", "host"]);
    // A season with no goals yet answers for the member, and says nothing about a goal.
    expect(doorDeliverables({ ...a, servesGoal: NO_SEASON_GOALS, termsChoice: { choice: "accept", note: "", settings: VOLUNTEER } })).toBe(
      "Aim: Food grows here.\nAccepts the terms on offer.\n\nThree beds planted.",
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
    expect(doorBack("?from=%2Froles%3Fseat%3Dgarden", "")).toEqual({ href: "/roles?seat=garden", card: true });
    expect(doorBack("?from=%2Froles%2Fdraft", "")).toEqual({ href: "/roles/draft", card: false });
    expect(doorBack("?from=%2F%2Fevil.example", "")).toEqual({ href: DOOR_HOME, card: false });
    expect(doorBack("", "https://elsewhere.example/roles/draft")).toEqual({ href: DOOR_HOME, card: false });
  });
});

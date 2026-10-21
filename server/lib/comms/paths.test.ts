import { describe, expect, it } from "vitest";
import { CONDITIONS_FOR_KIND } from "../../../shared/comms/journeySteps";
import { CONDITION_KEYS, formSubmittedTrigger, STOP_KEYS } from "../../../shared/comms/contracts";
import { DEFAULT_JOURNEYS, pathJourney } from "../../../shared/comms/defaults/journeys";
import { heldReason } from "../../routes/commsPaths";
import { FORM_TYPE_TO_PATHWAY } from "./mailer";
import { HANDOFF_STEP, peoplePageLink } from "./pathParts";
import { isPathTrigger, JOINING_FORM_TYPE, optionsOf, pathForForm, pathIdOfJourney, PATHWAY_OF_PATH } from "./paths";

/**
 * The paths lane's pure rules (the comms build spec 5.11): which form feeds
 * which path, which triggers the lane owns, the held investor journey, and
 * the shape of the day 21 hand-off's link.
 */

describe("which form feeds which path", () => {
  it("maps every inbox pathway onto its path, and steward interest onto the steward path", () => {
    expect(pathForForm("investor-call")).toBe("investor");
    expect(pathForForm("investor-doc-request")).toBe("investor");
    expect(pathForForm("work-with-us")).toBe("prosperity-creator");
    expect(pathForForm("prosperity")).toBe("prosperity-creator");
    expect(pathForForm("resident")).toBe("resident");
    expect(pathForForm("steward")).toBe("steward");
    expect(pathForForm("steward-interest")).toBe("steward");
  });

  it("puts nobody on a path from a note to the team, a proposed quest, a request to join, or an unknown form", () => {
    expect(pathForForm("contact")).toBeNull();
    expect(pathForForm("quest-proposal")).toBeNull();
    expect(pathForForm(JOINING_FORM_TYPE)).toBeNull();
    expect(pathForForm("membership-508")).toBeNull();
    expect(pathForForm("visit-inquiry")).toBeNull();
    expect(pathForForm("nonsense")).toBeNull();
  });

  it("answers a real path for every form the inbox map routes, except the two that are not a path choice", () => {
    for (const form of Object.keys(FORM_TYPE_TO_PATHWAY)) {
      const path = pathForForm(form);
      if (form === "contact" || form === "quest-proposal") expect(path, form).toBeNull();
      else expect(["investor", "steward", "resident", "prosperity-creator"], form).toContain(path);
    }
  });

  it("routes each path back to its inbox", () => {
    expect(PATHWAY_OF_PATH["prosperity-creator"]).toBe("prosperity");
    expect(PATHWAY_OF_PATH.resident).toBe("resident");
  });

  it("reads the box as ticked only for a real true", () => {
    expect(formSubmittedTrigger("steward-interest", "s1", { email: "a@b.test", commsConsent: true })).toMatchObject({ consentPaths: true });
    expect(formSubmittedTrigger("steward-interest", "s1", { email: "a@b.test", commsConsent: "true" })).toMatchObject({ consentPaths: false });
    expect(formSubmittedTrigger("steward-interest", "s1", { email: "a@b.test" })).toMatchObject({ consentPaths: false });
  });
});

describe("the triggers this lane owns", () => {
  it("takes the path, form, housing, submission and membership triggers, and leaves gatherings alone", () => {
    for (const type of ["path_joined", "path_left", "form_submitted", "submission_status", "housing_status", "member_joined", "member_admitted"]) {
      expect(isPathTrigger({ type } as any), type).toBe(true);
    }
    for (const type of ["rsvp_changed", "gathering_changed", "gathering_cancelled", "waitlist_joined", "stage_advanced"]) {
      expect(isPathTrigger({ type } as any), type).toBe(false);
    }
  });

  it("reads a path id out of a path journey key and nothing else", () => {
    expect(pathIdOfJourney("path.prosperity-creator")).toBe("prosperity-creator");
    expect(pathIdOfJourney("path.resident")).toBe("resident");
    expect(pathIdOfJourney("member.welcome")).toBeNull();
    expect(pathIdOfJourney("path.")).toBeNull();
  });
});

describe("the path journeys", () => {
  it("answers every skip and stop key a path, member or joining journey carries with a key the contract declares", () => {
    const keys = new Set<string>();
    for (const j of DEFAULT_JOURNEYS.filter((d) => d.kind !== "event")) {
      for (const s of j.steps) for (const k of s.skipIf) keys.add(k);
      for (const k of j.stops) keys.add(k);
    }
    for (const k of keys) expect([...CONDITION_KEYS, ...STOP_KEYS], k).toContain(k);
    expect(CONDITIONS_FOR_KIND.path).toContain("investor_words_unreviewed");
  });

  it("hands off on the day 21 step of every path", () => {
    for (const id of ["resident", "investor", "steward", "prosperity-creator", "beekeeper"]) {
      const last = pathJourney(id).steps.at(-1)!;
      expect(last.key).toBe(HANDOFF_STEP);
      expect(last.offsetMinutes).toBe(21 * 1440);
    }
  });

  it("holds the investor journey until its words are reviewed, and says so; no other path is held", () => {
    expect(heldReason("investor", null)).toMatch(/welcome and the day 21 hand-off/);
    expect(heldReason("investor", { by: "u1", at: "2026-10-09T00:00:00Z" })).toBeNull();
    expect(heldReason("resident", null)).toBeNull();
  });

  it("starts with both options off", () => {
    expect(optionsOf(pathJourney("resident"))).toEqual({ includeExisting: false, rungEmails: false });
    expect(optionsOf({ ...pathJourney("resident"), rungEmails: true })).toEqual({ includeExisting: false, rungEmails: true });
  });

  it("links the hand-off to the person's page in People, by contact id only", () => {
    expect(peoplePageLink("ct_abc")).toBe("/admin?tab=comms-people&person=ct_abc");
  });
});
